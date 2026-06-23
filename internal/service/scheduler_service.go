package service

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/dushixiang/uart_sms_forwarder/internal/models"
	"github.com/dushixiang/uart_sms_forwarder/internal/repo"
	"github.com/go-orz/orz"

	"github.com/google/uuid"
	"github.com/robfig/cron/v3"
	"go.uber.org/zap"
	"gorm.io/gorm"
)

const (
	scheduledRunTypeSchedule = "schedule"
	scheduledRunTypeRetry    = "retry"
	scheduledRunTypeManual   = "manual"
)

// SchedulerService 定时任务调度服务（包含任务管理功能）
type SchedulerService struct {
	logger         *zap.Logger
	cron           *cron.Cron
	repo           *repo.ScheduledTaskRepo
	serialService  *SerialService
	entryMu        sync.Mutex
	taskEntries    map[string][]cron.EntryID
	scheduleTimers map[string]*time.Timer
	retryTimers    map[string]*time.Timer
	runMu          sync.Mutex
	runningTasks   map[string]struct{}
}

// NewSchedulerService 创建定时任务服务实例
func NewSchedulerService(
	logger *zap.Logger,
	db *gorm.DB,
	serialService *SerialService,
) *SchedulerService {
	return &SchedulerService{
		logger:         logger,
		repo:           repo.NewScheduledTaskRepo(db),
		serialService:  serialService,
		taskEntries:    make(map[string][]cron.EntryID),
		scheduleTimers: make(map[string]*time.Timer),
		retryTimers:    make(map[string]*time.Timer),
		runningTasks:   make(map[string]struct{}),
	}
}

// ==================== 任务管理方法 ====================

// GetAll 获取所有定时任务
func (s *SchedulerService) GetAll(ctx context.Context) ([]models.ScheduledTask, error) {
	tasks, err := s.repo.FindAll(ctx)
	if err != nil {
		return nil, err
	}
	s.fillNextRunTimes(tasks)
	return tasks, nil
}

// GetAllEnabled 获取所有启用的定时任务
func (s *SchedulerService) GetAllEnabled(ctx context.Context) ([]models.ScheduledTask, error) {
	tasks, err := s.repo.FindAllEnabled(ctx)
	if err != nil {
		return nil, err
	}
	s.fillNextRunTimes(tasks)
	return tasks, nil
}

// GetById 根据ID获取定时任务
func (s *SchedulerService) GetById(ctx context.Context, id string) (*models.ScheduledTask, error) {
	task, err := s.repo.FindById(ctx, id)
	if err != nil {
		return nil, err
	}
	s.fillNextRunTime(&task)
	return &task, nil
}

// Create 创建定时任务
func (s *SchedulerService) Create(ctx context.Context, task *models.ScheduledTask) error {
	now := time.Now().UnixMilli()
	task.ID = uuid.New().String()
	task.CreatedAt = now
	task.UpdatedAt = now
	s.normalizeTask(task)
	if err := s.repo.Create(ctx, task); err != nil {
		return err
	}
	return s.rescheduleTask(*task)
}

// Update 更新定时任务
func (s *SchedulerService) Update(ctx context.Context, task *models.ScheduledTask) error {
	existingTask, err := s.GetById(ctx, task.ID)
	if err != nil {
		return err
	}
	existingTask.Name = task.Name
	existingTask.Enabled = task.Enabled
	existingTask.ScheduleType = task.ScheduleType
	existingTask.CronExpr = task.CronExpr
	existingTask.IntervalDays = task.IntervalDays
	existingTask.StartAt = task.StartAt
	existingTask.RetryEnabled = task.RetryEnabled
	existingTask.RetryMaxCount = task.RetryMaxCount
	existingTask.RetryInterval = task.RetryInterval
	existingTask.RetryCount = 0
	existingTask.NextRetryAt = 0
	existingTask.TaskType = task.TaskType
	existingTask.PhoneNumber = task.PhoneNumber
	existingTask.Content = task.Content
	existingTask.SerialAction = task.SerialAction
	existingTask.SerialEnabled = task.SerialEnabled
	s.normalizeTask(existingTask)

	if err := s.repo.Save(ctx, existingTask); err != nil {
		return err
	}
	return s.rescheduleTask(*existingTask)
}

// Delete 删除定时任务
func (s *SchedulerService) Delete(ctx context.Context, id string) error {
	if err := s.repo.DeleteById(ctx, id); err != nil {
		return err
	}
	s.removeTaskEntries(id)
	s.cancelScheduleTimer(id)
	s.cancelRetryTimer(id)
	return nil
}

// TriggerTask 立即触发执行指定的任务
func (s *SchedulerService) TriggerTask(ctx context.Context, id string) error {
	task, err := s.GetById(ctx, id)
	if err != nil {
		return fmt.Errorf("获取任务失败: %w", err)
	}

	if err := s.executeTaskWithLock(*task, scheduledRunTypeManual); err != nil {
		return fmt.Errorf("执行任务失败: %w", err)
	}

	return nil
}

// ==================== 调度相关方法 ====================

// Start 启动定时任务服务
func (s *SchedulerService) Start(ctx context.Context) error {
	s.cron = cron.New(cron.WithParser(cronParser()))

	tasks, err := s.repo.FindAllEnabled(ctx)
	if err != nil {
		return fmt.Errorf("获取启用定时任务失败: %w", err)
	}
	for _, task := range tasks {
		if err := s.addTaskEntries(task); err != nil {
			s.logger.Error("添加定时任务失败",
				zap.String("id", task.ID),
				zap.String("name", task.Name),
				zap.Error(err))
		}
		s.schedulePendingRetry(task)
	}

	s.cron.Start()

	s.logger.Info("定时任务服务启动成功")
	return nil
}

func (s *SchedulerService) rescheduleTask(task models.ScheduledTask) error {
	s.removeTaskEntries(task.ID)
	s.cancelScheduleTimer(task.ID)
	s.cancelRetryTimer(task.ID)
	if !task.Enabled || s.cron == nil {
		return nil
	}
	if err := s.addTaskEntries(task); err != nil {
		return err
	}
	s.schedulePendingRetry(task)
	return nil
}

func (s *SchedulerService) addTaskEntries(task models.ScheduledTask) error {
	if s.cron == nil {
		return nil
	}

	switch task.ScheduleType {
	case models.ScheduledScheduleTypeCron:
		mainEntryID, err := s.cron.AddFunc(task.CronExpr, func() {
			s.runScheduledTask(task.ID)
		})
		if err != nil {
			return fmt.Errorf("添加 Cron 定时任务失败: %w", err)
		}

		s.entryMu.Lock()
		s.taskEntries[task.ID] = []cron.EntryID{mainEntryID}
		s.entryMu.Unlock()
		return nil
	case models.ScheduledScheduleTypeIntervalDays:
		return s.scheduleIntervalDaysTask(task)
	default:
		return fmt.Errorf("不支持的计划类型: %s", task.ScheduleType)
	}
}

func (s *SchedulerService) removeTaskEntries(taskID string) {
	s.entryMu.Lock()
	entryIDs := s.taskEntries[taskID]
	delete(s.taskEntries, taskID)
	s.entryMu.Unlock()

	if s.cron == nil {
		return
	}
	for _, entryID := range entryIDs {
		s.cron.Remove(entryID)
	}
}

func (s *SchedulerService) runScheduledTask(taskID string) {
	task, err := s.GetById(context.Background(), taskID)
	if err != nil {
		s.logger.Error("获取定时任务失败", zap.String("id", taskID), zap.Error(err))
		return
	}
	if !task.Enabled {
		return
	}
	if err := s.executeTaskWithLock(*task, scheduledRunTypeSchedule); err != nil {
		s.logger.Error("执行定时任务失败",
			zap.String("id", task.ID),
			zap.String("name", task.Name),
			zap.Error(err))
	}
}

func (s *SchedulerService) runIntervalDaysTask(taskID string) {
	s.cancelScheduleTimer(taskID)

	task, err := s.GetById(context.Background(), taskID)
	if err != nil {
		s.logger.Error("获取定时任务失败", zap.String("id", taskID), zap.Error(err))
		return
	}
	if !task.Enabled || task.ScheduleType != models.ScheduledScheduleTypeIntervalDays {
		return
	}

	if err := s.scheduleIntervalDaysTask(*task); err != nil {
		s.logger.Error("安排下次间隔天数任务失败",
			zap.String("id", task.ID),
			zap.String("name", task.Name),
			zap.Error(err))
	}

	if err := s.executeTaskWithLock(*task, scheduledRunTypeSchedule); err != nil {
		s.logger.Error("执行定时任务失败",
			zap.String("id", task.ID),
			zap.String("name", task.Name),
			zap.Error(err))
	}
}

func (s *SchedulerService) runRetryTask(taskID string) {
	s.cancelRetryTimer(taskID)
	task, err := s.GetById(context.Background(), taskID)
	if err != nil {
		s.logger.Error("获取失败重试任务失败", zap.String("id", taskID), zap.Error(err))
		return
	}
	if !s.canRetry(*task) {
		return
	}
	if err := s.executeTaskWithLock(*task, scheduledRunTypeRetry); err != nil {
		s.logger.Error("执行失败重试任务失败",
			zap.String("id", task.ID),
			zap.String("name", task.Name),
			zap.Error(err))
	}
}

func (s *SchedulerService) fillNextRunTimes(tasks []models.ScheduledTask) {
	for i := range tasks {
		s.fillNextRunTime(&tasks[i])
	}
}

func (s *SchedulerService) fillNextRunTime(task *models.ScheduledTask) {
	task.NextRunAt = 0
	task.NextRunType = ""
	task.NextScheduledRunAt = 0

	if !task.Enabled {
		return
	}

	now := time.Now()
	if nextAt, ok := nextScheduledTime(*task, now); ok {
		task.NextScheduledRunAt = nextAt.UnixMilli()
		task.NextRunAt = task.NextScheduledRunAt
		task.NextRunType = scheduledRunTypeSchedule
	}

	if s.canRetry(*task) && task.NextRetryAt > now.UnixMilli() {
		if task.NextRunAt == 0 || task.NextRetryAt < task.NextRunAt {
			task.NextRunAt = task.NextRetryAt
			task.NextRunType = scheduledRunTypeRetry
		}
	}
}

func (s *SchedulerService) scheduleIntervalDaysTask(task models.ScheduledTask) error {
	nextAt, ok := nextIntervalDaysTime(task, time.Now())
	if !ok {
		return fmt.Errorf("间隔天数计划参数无效")
	}

	delay := time.Until(nextAt)
	if delay < 0 {
		delay = 0
	}

	timer := time.AfterFunc(delay, func() {
		s.runIntervalDaysTask(task.ID)
	})
	s.entryMu.Lock()
	if existing := s.scheduleTimers[task.ID]; existing != nil {
		existing.Stop()
	}
	s.scheduleTimers[task.ID] = timer
	s.entryMu.Unlock()
	return nil
}

func (s *SchedulerService) cancelScheduleTimer(taskID string) {
	s.entryMu.Lock()
	timer := s.scheduleTimers[taskID]
	delete(s.scheduleTimers, taskID)
	s.entryMu.Unlock()

	if timer != nil {
		timer.Stop()
	}
}

func (s *SchedulerService) canRetry(task models.ScheduledTask) bool {
	return task.Enabled &&
		task.RetryEnabled &&
		task.LastRunStatus == models.LastRunStatusFailed &&
		task.NextRetryAt > 0 &&
		task.RetryMaxCount > 0 &&
		task.RetryInterval > 0 &&
		task.RetryCount < task.RetryMaxCount
}

func (s *SchedulerService) schedulePendingRetry(task models.ScheduledTask) {
	if !s.canRetry(task) {
		return
	}

	delay := time.Until(time.UnixMilli(task.NextRetryAt))
	if delay < 0 {
		delay = 0
	}

	timer := time.AfterFunc(delay, func() {
		s.runRetryTask(task.ID)
	})
	s.entryMu.Lock()
	if existing := s.retryTimers[task.ID]; existing != nil {
		existing.Stop()
	}
	s.retryTimers[task.ID] = timer
	s.entryMu.Unlock()
}

func (s *SchedulerService) cancelRetryTimer(taskID string) {
	s.entryMu.Lock()
	timer := s.retryTimers[taskID]
	delete(s.retryTimers, taskID)
	s.entryMu.Unlock()

	if timer != nil {
		timer.Stop()
	}
}

func (s *SchedulerService) scheduleNextRetry(ctx context.Context, task models.ScheduledTask) {
	if !task.Enabled || !task.RetryEnabled || task.RetryMaxCount <= 0 || task.RetryInterval <= 0 || task.RetryCount >= task.RetryMaxCount {
		_ = s.repo.UpdateColumnsById(ctx, task.ID, orz.Map{
			"next_retry_at": int64(0),
		})
		s.cancelRetryTimer(task.ID)
		return
	}

	nextRetryAt := time.Now().Add(time.Duration(task.RetryInterval) * time.Second).UnixMilli()
	if err := s.repo.UpdateColumnsById(ctx, task.ID, orz.Map{
		"next_retry_at": nextRetryAt,
	}); err != nil {
		s.logger.Error("更新下次重试时间失败",
			zap.String("id", task.ID),
			zap.Error(err))
		return
	}

	task.NextRetryAt = nextRetryAt
	s.schedulePendingRetry(task)
}

func nextCronTime(expr string, now time.Time) (time.Time, bool) {
	schedule, err := cronParser().Parse(expr)
	if err != nil {
		return time.Time{}, false
	}
	return schedule.Next(now), true
}

func nextScheduledTime(task models.ScheduledTask, now time.Time) (time.Time, bool) {
	switch task.ScheduleType {
	case models.ScheduledScheduleTypeCron:
		return nextCronTime(task.CronExpr, now)
	case models.ScheduledScheduleTypeIntervalDays:
		return nextIntervalDaysTime(task, now)
	default:
		return time.Time{}, false
	}
}

func nextIntervalDaysTime(task models.ScheduledTask, now time.Time) (time.Time, bool) {
	if task.IntervalDays <= 0 || task.StartAt <= 0 {
		return time.Time{}, false
	}

	const maxIntervalDays = int64(1<<63-1) / int64(24*time.Hour)
	if int64(task.IntervalDays) > maxIntervalDays {
		return time.Time{}, false
	}

	startAt := time.UnixMilli(task.StartAt)
	interval := time.Duration(task.IntervalDays) * 24 * time.Hour
	if startAt.After(now) {
		return startAt, true
	}

	elapsed := now.Sub(startAt)
	steps := elapsed/interval + 1
	return startAt.Add(steps * interval), true
}

func cronParser() cron.Parser {
	return cron.NewParser(cron.Minute | cron.Hour | cron.Dom | cron.Month | cron.Dow | cron.Descriptor)
}

func ValidateCronExpr(expr string) error {
	if _, err := cronParser().Parse(expr); err != nil {
		return err
	}
	return nil
}

func (s *SchedulerService) executeTaskWithLock(task models.ScheduledTask, runType string) error {
	s.runMu.Lock()
	if _, ok := s.runningTasks[task.ID]; ok {
		s.runMu.Unlock()
		return fmt.Errorf("任务正在执行")
	}
	s.runningTasks[task.ID] = struct{}{}
	s.runMu.Unlock()

	defer func() {
		s.runMu.Lock()
		delete(s.runningTasks, task.ID)
		s.runMu.Unlock()
	}()

	if err := s.prepareTaskRun(context.Background(), &task, runType); err != nil {
		return err
	}
	return s.executeTask(task)
}

func (s *SchedulerService) prepareTaskRun(ctx context.Context, task *models.ScheduledTask, runType string) error {
	s.cancelRetryTimer(task.ID)

	updates := orz.Map{
		"last_run_type": runType,
		"next_retry_at": int64(0),
	}
	if runType == scheduledRunTypeRetry {
		task.RetryCount++
		updates["retry_count"] = task.RetryCount
	} else {
		task.RetryCount = 0
		updates["retry_count"] = 0
	}
	task.LastRunType = runType

	return s.repo.UpdateColumnsById(ctx, task.ID, updates)
}

// executeTask 执行任务
func (s *SchedulerService) executeTask(task models.ScheduledTask) error {
	s.normalizeTask(&task)

	s.logger.Info("执行定时任务",
		zap.String("id", task.ID),
		zap.String("name", task.Name),
		zap.String("type", string(task.TaskType)),
		zap.String("runType", task.LastRunType),
		zap.String("phone", task.PhoneNumber),
		zap.String("content", task.Content))

	if task.TaskType == models.ScheduledTaskTypeSerial {
		return s.executeSerialTask(task)
	}

	return s.executeSMSTask(task)
}

func (s *SchedulerService) executeSMSTask(task models.ScheduledTask) error {
	ctx := context.Background()

	flyMode := s.serialService.FlyMode()
	// 如果是飞行模式，取消飞行模式，再等待 30 秒后发送短信
	if flyMode {
		s.logger.Info("当前为飞行模式，取消飞行模式后等待 30 秒")
		// 取消飞行模式
		if err := s.serialService.SetFlymode(false); err != nil {
			s.logger.Error("取消飞行模式失败", zap.Error(err))
			_ = s.UpdateLastRun(ctx, task.ID, "", models.LastRunStatusFailed)
			return err
		}
		s.logger.Info("取消飞行模式成功")
		// 等待 30 秒
		time.Sleep(30 * time.Second)
		s.logger.Info("等待 30 秒后发送短信...")
	}

	// 发送短信
	msgId, err := s.serialService.SendSMS(task.PhoneNumber, task.Content)
	if err != nil {
		s.logger.Error("定时任务发送短信失败",
			zap.String("id", task.ID),
			zap.String("name", task.Name),
			zap.Error(err))
		_ = s.UpdateLastRun(ctx, task.ID, msgId, models.LastRunStatusFailed)
		return err
	}
	s.logger.Info("定时任务发送命令成功",
		zap.String("id", task.ID),
		zap.String("name", task.Name))

	// 短信发送结果异步返回，这里只标记为执行中。
	_ = s.UpdateLastRun(ctx, task.ID, msgId, models.LastRunStatusUnknown)

	// 如果是飞行模式，重新设置飞行模式
	if flyMode {
		s.logger.Info("等待 30 秒后重新设置飞行模式...")
		time.Sleep(30 * time.Second)
		s.logger.Info("重新设置飞行模式")
		if err := s.serialService.SetFlymode(true); err != nil {
			s.logger.Error("设置飞行模式失败", zap.Error(err))
			return err
		}
		s.logger.Info("设置飞行模式成功")
	}

	return nil
}

func (s *SchedulerService) executeSerialTask(task models.ScheduledTask) error {
	ctx := context.Background()
	var err error

	switch task.SerialAction {
	case models.ScheduledSerialActionSetFlymode:
		if task.SerialEnabled == nil {
			err = fmt.Errorf("飞行模式任务缺少开关值")
			break
		}
		err = s.serialService.SetFlymodeAndWait(*task.SerialEnabled)
	case models.ScheduledSerialActionSetCellular:
		if task.SerialEnabled == nil {
			err = fmt.Errorf("蜂窝网络任务缺少开关值")
			break
		}
		err = s.serialService.SetCellularAndWait(*task.SerialEnabled)
	case models.ScheduledSerialActionPingOnce:
		var result map[string]interface{}
		result, err = s.serialService.PingOnce()
		if err == nil {
			if success, ok := result["success"].(bool); !ok || !success {
				err = fmt.Errorf("Ping 失败: %v", result["result"])
			}
		}
	case models.ScheduledSerialActionRebootMcu:
		err = s.serialService.RebootMcu()
	default:
		err = fmt.Errorf("不支持的串口动作: %s", task.SerialAction)
	}

	if err != nil {
		_ = s.UpdateLastRun(ctx, task.ID, "", models.LastRunStatusFailed)
		return err
	}

	_ = s.UpdateLastRun(ctx, task.ID, "", models.LastRunStatusSuccess)
	return nil
}

func (s *SchedulerService) normalizeTask(task *models.ScheduledTask) {
	if task.ScheduleType == "" {
		task.ScheduleType = models.ScheduledScheduleTypeCron
	}
	if task.ScheduleType == models.ScheduledScheduleTypeCron {
		task.IntervalDays = 0
		task.StartAt = 0
	}
	if task.ScheduleType == models.ScheduledScheduleTypeIntervalDays {
		task.CronExpr = ""
	}

	if task.TaskType == "" {
		task.TaskType = models.ScheduledTaskTypeSMS
	}

	if !task.RetryEnabled {
		task.RetryMaxCount = 0
		task.RetryInterval = 0
		task.RetryCount = 0
		task.NextRetryAt = 0
	}

	if task.TaskType == models.ScheduledTaskTypeSMS {
		task.SerialAction = ""
		task.SerialEnabled = nil
		return
	}

	task.PhoneNumber = ""
	task.Content = ""
}

func (s *SchedulerService) UpdateLastRun(ctx context.Context, id, msgId string, status models.LastRunStatus) error {
	task, err := s.repo.FindById(ctx, id)
	if err != nil {
		return err
	}

	updates := orz.Map{
		"last_msg_id":     msgId,
		"last_run_at":     time.Now().UnixMilli(),
		"last_run_status": status,
	}
	if status == models.LastRunStatusSuccess {
		updates["retry_count"] = 0
		updates["next_retry_at"] = int64(0)
	}
	if status == models.LastRunStatusUnknown {
		updates["next_retry_at"] = int64(0)
	}

	if err := s.repo.UpdateColumnsById(ctx, id, updates); err != nil {
		return err
	}

	switch status {
	case models.LastRunStatusFailed:
		s.scheduleNextRetry(ctx, task)
	case models.LastRunStatusSuccess:
		s.cancelRetryTimer(id)
	}
	return nil
}

func (s *SchedulerService) UpdateLastRunStatusByMsgId(ctx context.Context, msgId string, status models.LastRunStatus) error {
	task, err := s.repo.FindByLastMsgId(ctx, msgId)
	if err != nil {
		return err
	}
	return s.UpdateLastRun(ctx, task.ID, msgId, status)
}
