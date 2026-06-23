package models

type LastRunStatus string
type ScheduledScheduleType string
type ScheduledTaskType string
type ScheduledSerialAction string

const (
	LastRunStatusUnknown LastRunStatus = "unknown"
	LastRunStatusSuccess LastRunStatus = "success"
	LastRunStatusFailed  LastRunStatus = "failed"

	ScheduledScheduleTypeCron         ScheduledScheduleType = "cron"
	ScheduledScheduleTypeIntervalDays ScheduledScheduleType = "interval_days"

	ScheduledTaskTypeSMS    ScheduledTaskType = "sms"
	ScheduledTaskTypeSerial ScheduledTaskType = "serial"

	ScheduledSerialActionSetFlymode  ScheduledSerialAction = "set_flymode"
	ScheduledSerialActionSetCellular ScheduledSerialAction = "set_cellular"
	ScheduledSerialActionPingOnce    ScheduledSerialAction = "ping_once"
	ScheduledSerialActionRebootMcu   ScheduledSerialAction = "reboot_mcu"
)

// ScheduledTask 定时任务
type ScheduledTask struct {
	ID            string                `gorm:"primaryKey" json:"id"`                  // UUID
	Name          string                `json:"name"`                                  // 任务名称
	Enabled       bool                  `json:"enabled"`                               // 是否启用
	ScheduleType  ScheduledScheduleType `json:"scheduleType"`                          // 执行计划类型：cron 或 interval_days
	CronExpr      string                `json:"cronExpr"`                              // cron 模式表达式
	IntervalDays  int                   `json:"intervalDays"`                          // 间隔天数模式的天数
	StartAt       int64                 `json:"startAt"`                               // 间隔天数模式的起始时间（时间戳毫秒）
	RetryEnabled  bool                  `json:"retryEnabled"`                          // 失败后是否启用重试计划
	RetryMaxCount int                   `json:"retryMaxCount"`                         // 最多重试次数
	RetryInterval int                   `json:"retryInterval"`                         // 重试间隔秒数
	TaskType      ScheduledTaskType     `json:"taskType"`                              // 任务类型
	PhoneNumber   string                `json:"phoneNumber"`                           // 目标手机号
	Content       string                `gorm:"type:text" json:"content"`              // 短信内容
	SerialAction  ScheduledSerialAction `json:"serialAction"`                          // 串口控制动作
	SerialEnabled *bool                 `json:"serialEnabled"`                         // 串口控制开关值
	CreatedAt     int64                 `json:"createdAt" gorm:"autoCreateTime:milli"` // 创建时间（时间戳毫秒）
	UpdatedAt     int64                 `json:"updatedAt" gorm:"autoUpdateTime:milli"` // 更新时间（时间戳毫秒）

	LastMsgId     string        `json:"lastMsgId"`     // 上次发送的短信ID
	LastRunAt     int64         `json:"lastRunAt"`     // 上次执行时间（时间戳毫秒）
	LastRunStatus LastRunStatus `json:"lastRunStatus"` // 上次执行状态
	LastRunType   string        `json:"lastRunType"`   // 上次执行来源：schedule、retry 或 manual
	RetryCount    int           `json:"retryCount"`    // 当前连续失败后的已重试次数
	NextRetryAt   int64         `json:"nextRetryAt"`   // 下次失败重试时间（时间戳毫秒）

	NextRunAt          int64  `gorm:"-" json:"nextRunAt"`          // 下次预计执行时间（时间戳毫秒）
	NextRunType        string `gorm:"-" json:"nextRunType"`        // 下次执行类型：schedule 或 retry
	NextScheduledRunAt int64  `gorm:"-" json:"nextScheduledRunAt"` // 下次主计划执行时间（时间戳毫秒）
}

func (ScheduledTask) TableName() string {
	return "scheduled_tasks"
}
