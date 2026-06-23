// 定时任务配置
import apiClient from "@/api/client.ts";

export type LastRunStatus = 'unknown' | 'success' | 'failed';
export type ScheduledScheduleType = 'cron' | 'interval_days';
export type ScheduledTaskType = 'sms' | 'serial';
export type ScheduledSerialAction = 'set_flymode' | 'set_cellular' | 'ping_once' | 'reboot_mcu';

export interface ScheduledTask {
    id: string;
    name: string;
    enabled: boolean;
    scheduleType: ScheduledScheduleType;
    cronExpr: string;
    intervalDays: number;
    startAt: number;
    retryEnabled: boolean;
    retryMaxCount: number;
    retryInterval: number;
    taskType?: ScheduledTaskType;
    phoneNumber: string;
    content: string;
    serialAction?: ScheduledSerialAction;
    serialEnabled?: boolean | null;
    createdAt?: number;
    updatedAt?: number;
    lastRunAt?: number;
    lastMsgId?: string;
    lastRunStatus?: LastRunStatus;
    lastRunType?: 'schedule' | 'retry' | 'manual' | '';
    retryCount?: number;
    nextRetryAt?: number;
    nextRunAt?: number;
    nextRunType?: 'schedule' | 'retry' | '';
    nextScheduledRunAt?: number;
}

export type ScheduledTaskPayload = Omit<
    ScheduledTask,
    | 'id'
    | 'createdAt'
    | 'updatedAt'
    | 'lastRunAt'
    | 'lastMsgId'
    | 'lastRunStatus'
    | 'lastRunType'
    | 'retryCount'
    | 'nextRetryAt'
    | 'nextRunAt'
    | 'nextRunType'
    | 'nextScheduledRunAt'
>;

// 定时任务 API (RESTful)
// 获取所有定时任务
export const getScheduledTasks = () => {
    return apiClient.get<ScheduledTask[]>('/scheduled-tasks');
};

// 获取单个定时任务
export const getScheduledTask = (id: string) => {
    return apiClient.get<ScheduledTask>(`/scheduled-tasks/${id}`);
};

// 创建定时任务
export const createScheduledTask = (task: ScheduledTaskPayload) => {
    return apiClient.post<ScheduledTask>('/scheduled-tasks', task);
};

// 更新定时任务
export const updateScheduledTask = (id: string, task: ScheduledTaskPayload) => {
    return apiClient.put<ScheduledTask>(`/scheduled-tasks/${id}`, task);
};

// 删除定时任务
export const deleteScheduledTask = (id: string) => {
    return apiClient.delete<{ message: string }>(`/scheduled-tasks/${id}`);
};

// 立即触发定时任务
export const triggerScheduledTask = (id: string) => {
    return apiClient.post<{ message: string }>(`/scheduled-tasks/${id}/trigger`, {});
};
