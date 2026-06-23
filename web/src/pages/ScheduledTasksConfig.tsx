import {useState} from 'react';
import {
    CheckCircle2,
    Clock,
    Edit,
    MessageSquare,
    Phone,
    Plus,
    Play,
    Radio,
    RotateCcw,
    Settings2,
    Trash2,
    XCircle,
} from 'lucide-react';
import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';
import {toast} from 'sonner';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Card, CardContent, CardHeader, CardTitle} from '@/components/ui/card';
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import {
    createScheduledTask,
    deleteScheduledTask,
    getScheduledTasks,
    type LastRunStatus,
    type ScheduledScheduleType,
    type ScheduledSerialAction,
    type ScheduledTaskPayload,
    type ScheduledTask,
    type ScheduledTaskType,
    triggerScheduledTask,
    updateScheduledTask,
} from '../api/scheduled_task';

interface TaskFormData {
    name: string;
    enabled: boolean;
    scheduleType: ScheduledScheduleType;
    cronExpr: string;
    intervalDays: number;
    startAt: string;
    retryEnabled: boolean;
    retryMaxCount: number;
    retryInterval: number;
    taskType: ScheduledTaskType;
    phoneNumber: string;
    content: string;
    serialAction: ScheduledSerialAction;
    serialEnabled: boolean | null;
}

const serialActionText: Record<ScheduledSerialAction, string> = {
    set_flymode: '飞行模式',
    set_cellular: '蜂窝网络',
    ping_once: 'Ping 8.8.8.8',
    reboot_mcu: '重启模块',
};

const cronPresets = [
    {label: '每天 08:00', value: '0 8 * * *'},
    {label: '每周一 08:00', value: '0 8 * * 1'},
    {label: '每月 1 日 08:00', value: '0 8 1 * *'},
    {label: '每 6 小时', value: '0 */6 * * *'},
];

function defaultStartAt() {
    const date = new Date();
    date.setHours(8, 0, 0, 0);
    if (date.getTime() <= Date.now()) {
        date.setDate(date.getDate() + 1);
    }
    return toDateTimeLocalValue(date.getTime());
}

function defaultForm(): TaskFormData {
    return {
        name: '',
        enabled: false,
        scheduleType: 'cron',
        cronExpr: '0 8 * * *',
        intervalDays: 1,
        startAt: defaultStartAt(),
        retryEnabled: false,
        retryMaxCount: 3,
        retryInterval: 60,
        taskType: 'sms',
        phoneNumber: '',
        content: '',
        serialAction: 'set_cellular',
        serialEnabled: true,
    };
}

function normalizeTaskType(task: ScheduledTask): ScheduledTaskType {
    return task.taskType || 'sms';
}

function getSerialValueLabel(task: ScheduledTask) {
    if (task.serialAction === 'ping_once' || task.serialAction === 'reboot_mcu') return '';
    return task.serialEnabled ? '开启' : '关闭';
}

function formatDateTime(timestamp?: number) {
    if (!timestamp || timestamp <= 0) return '-';
    return new Date(timestamp).toLocaleString('zh-CN', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
}

function toDateTimeLocalValue(timestamp?: number) {
    if (!timestamp || timestamp <= 0) return '';
    const date = new Date(timestamp);
    const offset = date.getTimezoneOffset() * 60000;
    return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function fromDateTimeLocalValue(value: string) {
    if (!value) return 0;
    const timestamp = new Date(value).getTime();
    return Number.isNaN(timestamp) ? 0 : timestamp;
}

function nextRunTypeText(type?: string) {
    return type === 'retry' ? '失败重试' : '主计划';
}

function scheduleTypeText(type?: ScheduledScheduleType) {
    return type === 'interval_days' ? '每隔天数' : 'Cron';
}

function formatSchedule(task: ScheduledTask) {
    if (task.scheduleType === 'interval_days') {
        return `每 ${task.intervalDays || 0} 天 · ${formatDateTime(task.startAt)}`;
    }
    return task.cronExpr;
}

function isCronInputValid(value: string) {
    const expr = value.trim();
    return expr.startsWith('@') || expr.split(/\s+/).length === 5;
}

export default function ScheduledTasksConfig() {
    const queryClient = useQueryClient();
    const [dialogOpen, setDialogOpen] = useState(false);
    const [editingTask, setEditingTask] = useState<ScheduledTask | null>(null);
    const [formData, setFormData] = useState<TaskFormData>(defaultForm());

    const getStatusDisplay = (status?: LastRunStatus) => {
        switch (status) {
            case 'success':
                return {icon: CheckCircle2, text: '成功', colorClass: 'text-green-600', bgClass: 'bg-green-50'};
            case 'failed':
                return {icon: XCircle, text: '失败', colorClass: 'text-red-600', bgClass: 'bg-red-50'};
            case 'unknown':
            default:
                return {icon: Clock, text: '执行中', colorClass: 'text-blue-600', bgClass: 'bg-blue-50'};
        }
    };

    const {data: tasks = [], isLoading} = useQuery({
        queryKey: ['scheduledTasks'],
        queryFn: getScheduledTasks,
    });

    const createMutation = useMutation({
        mutationFn: createScheduledTask,
        onSuccess: () => {
            queryClient.invalidateQueries({queryKey: ['scheduledTasks']});
            setDialogOpen(false);
            resetForm();
            toast.success('任务创建成功');
        },
        onError: () => toast.error('创建任务失败'),
    });

    const updateMutation = useMutation({
        mutationFn: ({id, task}: { id: string; task: ScheduledTaskPayload }) => updateScheduledTask(id, task),
        onSuccess: () => {
            queryClient.invalidateQueries({queryKey: ['scheduledTasks']});
            setDialogOpen(false);
            setEditingTask(null);
            resetForm();
            toast.success('任务更新成功');
        },
        onError: () => toast.error('更新任务失败'),
    });

    const deleteMutation = useMutation({
        mutationFn: deleteScheduledTask,
        onSuccess: () => {
            queryClient.invalidateQueries({queryKey: ['scheduledTasks']});
            toast.success('任务删除成功');
        },
        onError: () => toast.error('删除任务失败'),
    });

    const triggerMutation = useMutation({
        mutationFn: triggerScheduledTask,
        onSuccess: () => {
            queryClient.invalidateQueries({queryKey: ['scheduledTasks']});
            toast.success('任务已触发执行');
        },
        onError: () => toast.error('触发任务失败'),
    });

    const resetForm = () => setFormData(defaultForm());

    const handleOpenAddDialog = () => {
        setEditingTask(null);
        resetForm();
        setDialogOpen(true);
    };

    const handleOpenEditDialog = (task: ScheduledTask) => {
        const taskType = normalizeTaskType(task);
        setEditingTask(task);
        setFormData({
            name: task.name,
            enabled: task.enabled,
            scheduleType: task.scheduleType || 'cron',
            cronExpr: task.cronExpr || '0 8 * * *',
            intervalDays: task.intervalDays || 1,
            startAt: toDateTimeLocalValue(task.startAt) || defaultStartAt(),
            retryEnabled: task.retryEnabled || false,
            retryMaxCount: task.retryMaxCount || 3,
            retryInterval: task.retryInterval || 60,
            taskType,
            phoneNumber: task.phoneNumber || '',
            content: task.content || '',
            serialAction: task.serialAction || 'set_cellular',
            serialEnabled: task.serialEnabled ?? true,
        });
        setDialogOpen(true);
    };

    const updateFormField = <K extends keyof TaskFormData>(field: K, value: TaskFormData[K]) => {
        setFormData((current) => {
            const next = {...current, [field]: value};
            if (field === 'serialAction') {
                next.serialEnabled = value === 'ping_once' || value === 'reboot_mcu' ? null : (current.serialEnabled ?? true);
            }
            if (field === 'scheduleType' && value === 'interval_days' && !current.startAt) {
                next.startAt = defaultStartAt();
            }
            return next;
        });
    };

    const handleSubmit = () => {
        if (!formData.name.trim()) {
            toast.warning('请输入任务名称');
            return;
        }
        if (formData.scheduleType === 'cron') {
            if (!formData.cronExpr.trim()) {
                toast.warning('请输入 Cron 表达式');
                return;
            }
            if (!isCronInputValid(formData.cronExpr)) {
                toast.warning('Cron 表达式格式无效');
                return;
            }
        } else {
            if (formData.intervalDays <= 0) {
                toast.warning('请输入有效的间隔天数');
                return;
            }
            if (fromDateTimeLocalValue(formData.startAt) <= 0) {
                toast.warning('请选择起始时间');
                return;
            }
        }
        if (formData.retryEnabled && formData.retryMaxCount <= 0) {
            toast.warning('请输入有效的失败重试次数');
            return;
        }
        if (formData.retryEnabled && formData.retryInterval <= 0) {
            toast.warning('请输入有效的失败重试间隔');
            return;
        }
        if (formData.taskType === 'sms') {
            if (!formData.phoneNumber.trim()) {
                toast.warning('请输入目标手机号');
                return;
            }
            if (!formData.content.trim()) {
                toast.warning('请输入短信内容');
                return;
            }
        }
        if (formData.taskType === 'serial' && ['set_flymode', 'set_cellular'].includes(formData.serialAction) && formData.serialEnabled === null) {
            toast.warning('请选择串口控制开关');
            return;
        }

        const payload: ScheduledTaskPayload = {
            ...formData,
            cronExpr: formData.scheduleType === 'cron' ? formData.cronExpr.trim() : '',
            intervalDays: formData.scheduleType === 'interval_days' ? formData.intervalDays : 0,
            startAt: formData.scheduleType === 'interval_days' ? fromDateTimeLocalValue(formData.startAt) : 0,
            retryMaxCount: formData.retryEnabled ? formData.retryMaxCount : 0,
            retryInterval: formData.retryEnabled ? formData.retryInterval : 0,
            phoneNumber: formData.taskType === 'sms' ? formData.phoneNumber : '',
            content: formData.taskType === 'sms' ? formData.content : '',
            serialAction: formData.taskType === 'serial' ? formData.serialAction : 'set_cellular',
            serialEnabled: formData.taskType === 'serial' ? formData.serialEnabled : null,
        };

        if (editingTask) {
            updateMutation.mutate({id: editingTask.id, task: payload});
        } else {
            createMutation.mutate(payload);
        }
    };

    const handleDeleteTask = (id: string) => {
        if (confirm('确定要删除这个任务吗？')) {
            deleteMutation.mutate(id);
        }
    };

    const handleTriggerTask = (id: string) => {
        if (confirm('确定要立即执行这个任务吗？')) {
            triggerMutation.mutate(id);
        }
    };

    if (isLoading) {
        return (
            <div className="flex items-center justify-center py-20">
                <div className="h-12 w-12 animate-spin rounded-full border-b-2 border-blue-600"/>
            </div>
        );
    }

    return (
        <div className="space-y-6 animate-in fade-in duration-300">
            <div className="flex items-center justify-between pb-2">
                <div>
                    <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900">
                        定时任务配置
                    </h1>
                </div>
                <Button onClick={handleOpenAddDialog} className="bg-blue-600 px-5 py-2.5 transition-colors hover:bg-blue-700">
                    <Plus className="mr-2 h-4 w-4"/>
                    新建任务
                </Button>
            </div>

            {tasks.length === 0 ? (
                <div className="rounded-xl border border-gray-200 bg-white py-20 text-center">
                    <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-blue-50">
                        <Clock className="h-8 w-8 text-blue-500"/>
                    </div>
                    <p className="font-medium text-gray-500">暂无任务</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {tasks.map((task) => {
                        const taskType = normalizeTaskType(task);
                        const isSerial = taskType === 'serial';
                        const TaskIcon = isSerial ? Settings2 : MessageSquare;

                        return (
                            <Card key={task.id} className="relative overflow-hidden border-gray-200 transition-all duration-200">
                                <CardHeader className="border-b border-gray-100 bg-gradient-to-br from-white to-gray-50/30">
                                    <div className="flex items-start justify-between">
                                        <div className="flex min-w-0 flex-1 items-center space-x-2.5">
                                            <div className={`rounded-lg p-2 ${task.enabled ? 'bg-blue-50 text-blue-600' : 'bg-gray-100 text-gray-400'}`}>
                                                <TaskIcon size={18}/>
                                            </div>
                                            <div className="min-w-0 flex-1">
                                                <CardTitle className="truncate text-base font-bold text-gray-800">
                                                    {task.name}
                                                </CardTitle>
                                                <div className="mt-1 flex items-center gap-2">
                                                    <span className={`h-1.5 w-1.5 rounded-full ${task.enabled ? 'bg-green-500' : 'bg-gray-300'}`}/>
                                                    <span className="text-xs font-medium text-gray-500">
                                                        {task.enabled ? '运行中' : '已暂停'}
                                                    </span>
                                                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                                                        {isSerial ? '串口控制' : '短信'}
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </CardHeader>

                                <CardContent>
                                    <div className="mb-3 space-y-2">
                                        <div className="flex items-start space-x-2 rounded-lg border border-gray-100 bg-gray-50 p-2.5">
                                            <Clock size={14} className="mt-0.5 flex-shrink-0 text-gray-400"/>
                                            <div className="min-w-0 flex-1">
                                                <span className="mb-0.5 block text-xs font-medium text-gray-400">{scheduleTypeText(task.scheduleType)}</span>
                                                <span className="break-words text-sm font-semibold text-gray-700">{formatSchedule(task)}</span>
                                            </div>
                                        </div>

                                        <div className="flex items-start space-x-2 rounded-lg border border-gray-100 bg-gray-50 p-2.5">
                                            <Clock size={14} className="mt-0.5 flex-shrink-0 text-gray-400"/>
                                            <div className="min-w-0 flex-1">
                                                <span className="mb-0.5 block text-xs font-medium text-gray-400">下次执行</span>
                                                <span className="text-sm font-semibold text-gray-700">
                                                    {task.enabled ? `${formatDateTime(task.nextRunAt)} · ${nextRunTypeText(task.nextRunType)}` : '-'}
                                                </span>
                                            </div>
                                        </div>

                                        <div className="flex items-start space-x-2 rounded-lg border border-gray-100 bg-gray-50 p-2.5">
                                            <RotateCcw size={14} className="mt-0.5 flex-shrink-0 text-gray-400"/>
                                            <div className="min-w-0 flex-1">
                                                <span className="mb-0.5 block text-xs font-medium text-gray-400">失败重试</span>
                                                <span className="text-sm font-semibold text-gray-700">
                                                    {task.retryEnabled ? `${task.retryCount || 0}/${task.retryMaxCount} 次 · 间隔 ${task.retryInterval} 秒` : '关闭'}
                                                </span>
                                            </div>
                                        </div>

                                        {isSerial ? (
                                            <div className="flex items-start space-x-2 rounded-lg border border-gray-100 bg-gray-50 p-2.5">
                                                <Radio size={14} className="mt-0.5 flex-shrink-0 text-gray-400"/>
                                                <div className="min-w-0 flex-1">
                                                    <span className="mb-0.5 block text-xs font-medium text-gray-400">串口动作</span>
                                                    <span className="text-sm font-semibold text-gray-700">
                                                        {serialActionText[task.serialAction || 'set_cellular']} {getSerialValueLabel(task)}
                                                    </span>
                                                </div>
                                            </div>
                                        ) : (
                                            <>
                                                <div className="flex items-start space-x-2 rounded-lg border border-gray-100 bg-gray-50 p-2.5">
                                                    <Phone size={14} className="mt-0.5 flex-shrink-0 text-gray-400"/>
                                                    <div className="min-w-0 flex-1">
                                                        <span className="mb-0.5 block text-xs font-medium text-gray-400">目标号码</span>
                                                        <span className="font-mono text-sm font-semibold text-gray-700">{task.phoneNumber}</span>
                                                    </div>
                                                </div>
                                                <div className="flex items-start space-x-2 rounded-lg border border-gray-100 bg-gray-50 p-2.5">
                                                    <MessageSquare size={14} className="mt-0.5 flex-shrink-0 text-gray-400"/>
                                                    <div className="min-w-0 flex-1">
                                                        <span className="mb-0.5 block text-xs font-medium text-gray-400">短信内容</span>
                                                        <p className="line-clamp-2 break-words text-sm text-gray-700">{task.content}</p>
                                                    </div>
                                                </div>
                                            </>
                                        )}
                                    </div>

                                    {task.lastRunAt && task.lastRunAt > 0 ? (
                                        <div className="mb-3 space-y-2 border-b border-gray-100 pb-2.5">
                                            <div className="flex items-center text-xs">
                                                <span className="text-gray-400">上次执行：</span>
                                                <span className="ml-1.5 font-medium text-gray-600">
                                                    {formatDateTime(task.lastRunAt)}
                                                </span>
                                            </div>
                                            {task.lastRunStatus ? (
                                                <div className="flex items-center gap-1.5">
                                                    <span className="text-xs text-gray-400">执行状态：</span>
                                                    {(() => {
                                                        const statusInfo = getStatusDisplay(task.lastRunStatus);
                                                        const StatusIcon = statusInfo.icon;
                                                        return (
                                                            <div className={`flex items-center gap-1 rounded-full px-2 py-0.5 ${statusInfo.bgClass}`}>
                                                                <StatusIcon className={`h-3 w-3 ${statusInfo.colorClass}`}/>
                                                                <span className={`text-xs font-medium ${statusInfo.colorClass}`}>{statusInfo.text}</span>
                                                            </div>
                                                        );
                                                    })()}
                                                </div>
                                            ) : null}
                                        </div>
                                    ) : null}

                                    <div className="flex space-x-2 pt-1">
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => handleTriggerTask(task.id)}
                                            disabled={triggerMutation.isPending}
                                            className="flex-1 text-xs font-medium transition-colors hover:border-green-300 hover:bg-green-50 hover:text-green-700"
                                        >
                                            <Play className="mr-1.5 h-3.5 w-3.5"/>
                                            触发
                                        </Button>
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => handleOpenEditDialog(task)}
                                            className="flex-1 text-xs font-medium transition-colors hover:border-gray-300 hover:bg-gray-50"
                                        >
                                            <Edit className="mr-1.5 h-3.5 w-3.5"/>
                                            编辑
                                        </Button>
                                        <Button
                                            variant="destructive"
                                            size="sm"
                                            onClick={() => handleDeleteTask(task.id)}
                                            disabled={deleteMutation.isPending}
                                            className="px-3 text-xs font-medium transition-colors hover:bg-red-700"
                                        >
                                            <Trash2 className="h-3.5 w-3.5"/>
                                        </Button>
                                    </div>
                                </CardContent>
                            </Card>
                        );
                    })}
                </div>
            )}

            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                <DialogContent className="sm:max-w-[520px]">
                    <DialogHeader>
                        <DialogTitle className="text-xl font-bold text-gray-800">
                            {editingTask ? '编辑任务' : '新建任务'}
                        </DialogTitle>
                    </DialogHeader>

                    <div className="space-y-5 py-2">
                        <div>
                            <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-gray-600">
                                任务名称 <span className="text-red-500">*</span>
                            </label>
                            <Input
                                value={formData.name}
                                onChange={(e) => updateFormField('name', e.target.value)}
                                placeholder="任务名称"
                                className="border-gray-200 bg-gray-50 transition-all focus:border-blue-500 focus:bg-white focus:ring-1 focus:ring-blue-500"
                            />
                        </div>

                        <div className="flex items-center gap-3 rounded-lg border border-gray-200 bg-gray-50 p-3.5">
                            <input
                                type="checkbox"
                                id="enabled"
                                checked={formData.enabled}
                                onChange={(e) => updateFormField('enabled', e.target.checked)}
                                className="h-4 w-4 cursor-pointer rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                            />
                            <label htmlFor="enabled" className="flex-1 cursor-pointer text-sm font-medium text-gray-700">
                                启用此任务
                            </label>
                            <div className={`h-2 w-2 rounded-full ${formData.enabled ? 'bg-green-500' : 'bg-gray-300'}`}/>
                        </div>

                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                            <div>
                                <label className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-600">
                                    <Clock size={12} className="text-gray-400"/>
                                    计划类型
                                </label>
                                <Select value={formData.scheduleType} onValueChange={(value) => updateFormField('scheduleType', value as ScheduledScheduleType)}>
                                    <SelectTrigger className="w-full border-gray-200 bg-gray-50">
                                        <SelectValue/>
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="cron">Cron</SelectItem>
                                        <SelectItem value="interval_days">每隔天数</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <div>
                                <label className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-600">
                                    <Settings2 size={12} className="text-gray-400"/>
                                    任务类型
                                </label>
                                <Select value={formData.taskType} onValueChange={(value) => updateFormField('taskType', value as ScheduledTaskType)}>
                                    <SelectTrigger className="w-full border-gray-200 bg-gray-50">
                                        <SelectValue/>
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="sms">短信</SelectItem>
                                        <SelectItem value="serial">串口控制</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>

                        {formData.scheduleType === 'cron' ? (
                            <>
                                <div>
                                    <label className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-600">
                                        <Clock size={12} className="text-gray-400"/>
                                        Cron <span className="text-red-500">*</span>
                                    </label>
                                    <Input
                                        value={formData.cronExpr}
                                        onChange={(e) => updateFormField('cronExpr', e.target.value)}
                                        placeholder="0 8 * * *"
                                        className="border-gray-200 bg-gray-50 font-mono transition-all focus:border-blue-500 focus:bg-white focus:ring-1 focus:ring-blue-500"
                                    />
                                </div>

                                <div className="flex flex-wrap gap-2">
                                    {cronPresets.map((preset) => (
                                        <Button
                                            key={preset.value}
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            onClick={() => updateFormField('cronExpr', preset.value)}
                                            className="h-8 text-xs"
                                        >
                                            {preset.label}
                                        </Button>
                                    ))}
                                </div>
                            </>
                        ) : (
                            <div className="grid grid-cols-1 gap-4 sm:grid-cols-[140px_minmax(0,1fr)]">
                                <div>
                                    <label className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-600">
                                        <Clock size={12} className="text-gray-400"/>
                                        间隔天数 <span className="text-red-500">*</span>
                                    </label>
                                    <Input
                                        type="number"
                                        min="1"
                                        value={formData.intervalDays}
                                        onChange={(e) => updateFormField('intervalDays', parseInt(e.target.value) || 0)}
                                        className="border-gray-200 bg-gray-50 transition-all focus:border-blue-500 focus:bg-white focus:ring-1 focus:ring-blue-500"
                                    />
                                </div>
                                <div>
                                    <label className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-600">
                                        <Clock size={12} className="text-gray-400"/>
                                        起始时间 <span className="text-red-500">*</span>
                                    </label>
                                    <Input
                                        type="datetime-local"
                                        value={formData.startAt}
                                        onChange={(e) => updateFormField('startAt', e.target.value)}
                                        className="border-gray-200 bg-gray-50 transition-all focus:border-blue-500 focus:bg-white focus:ring-1 focus:ring-blue-500"
                                    />
                                </div>
                            </div>
                        )}

                        <div className="space-y-3 rounded-lg border border-gray-200 bg-gray-50 p-3.5">
                            <div className="flex items-center gap-3">
                                <input
                                    type="checkbox"
                                    id="retryEnabled"
                                    checked={formData.retryEnabled}
                                    onChange={(e) => updateFormField('retryEnabled', e.target.checked)}
                                    className="h-4 w-4 cursor-pointer rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                />
                                <label htmlFor="retryEnabled" className="flex-1 cursor-pointer text-sm font-medium text-gray-700">
                                    失败后自动重试
                                </label>
                                <div className={`h-2 w-2 rounded-full ${formData.retryEnabled ? 'bg-green-500' : 'bg-gray-300'}`}/>
                            </div>

                            {formData.retryEnabled ? (
                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-gray-600">
                                            最多次数
                                        </label>
                                        <Input
                                            type="number"
                                            min="1"
                                            value={formData.retryMaxCount}
                                            onChange={(e) => updateFormField('retryMaxCount', parseInt(e.target.value) || 0)}
                                            className="border-gray-200 bg-white transition-all focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                                        />
                                    </div>
                                    <div>
                                        <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-gray-600">
                                            间隔秒数
                                        </label>
                                        <Input
                                            type="number"
                                            min="1"
                                            value={formData.retryInterval}
                                            onChange={(e) => updateFormField('retryInterval', parseInt(e.target.value) || 0)}
                                            className="border-gray-200 bg-white transition-all focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                                        />
                                    </div>
                                </div>
                            ) : null}
                        </div>

                        {formData.taskType === 'sms' ? (
                            <>
                                <div>
                                    <label className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-600">
                                        <Phone size={12} className="text-gray-400"/>
                                        目标号码 <span className="text-red-500">*</span>
                                    </label>
                                    <Input
                                        value={formData.phoneNumber}
                                        onChange={(e) => updateFormField('phoneNumber', e.target.value)}
                                        placeholder="10086"
                                        className="border-gray-200 bg-gray-50 font-mono transition-all focus:border-blue-500 focus:bg-white focus:ring-1 focus:ring-blue-500"
                                    />
                                </div>

                                <div>
                                    <label className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-600">
                                        <MessageSquare size={12} className="text-gray-400"/>
                                        短信内容 <span className="text-red-500">*</span>
                                    </label>
                                    <textarea
                                        value={formData.content}
                                        onChange={(e) => updateFormField('content', e.target.value)}
                                        placeholder="短信内容"
                                        rows={3}
                                        className="w-full resize-none rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm outline-none transition-all focus:border-blue-500 focus:bg-white focus:ring-1 focus:ring-blue-500"
                                    />
                                </div>
                            </>
                        ) : (
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-600">
                                        <Radio size={12} className="text-gray-400"/>
                                        串口动作
                                    </label>
                                    <Select
                                        value={formData.serialAction}
                                        onValueChange={(value) => updateFormField('serialAction', value as ScheduledSerialAction)}
                                    >
                                        <SelectTrigger className="w-full border-gray-200 bg-gray-50">
                                            <SelectValue/>
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="set_cellular">蜂窝网络</SelectItem>
                                            <SelectItem value="set_flymode">飞行模式</SelectItem>
                                            <SelectItem value="ping_once">Ping 8.8.8.8</SelectItem>
                                            <SelectItem value="reboot_mcu">重启模块</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>

                                {formData.serialAction === 'set_cellular' || formData.serialAction === 'set_flymode' ? (
                                    <div>
                                        <label className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-600">
                                            <RotateCcw size={12} className="text-gray-400"/>
                                            开关
                                        </label>
                                        <Select
                                            value={formData.serialEnabled ? 'true' : 'false'}
                                            onValueChange={(value) => updateFormField('serialEnabled', value === 'true')}
                                        >
                                            <SelectTrigger className="w-full border-gray-200 bg-gray-50">
                                                <SelectValue/>
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="true">开启</SelectItem>
                                                <SelectItem value="false">关闭</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                ) : null}
                            </div>
                        )}
                    </div>

                    <DialogFooter className="-mx-6 -mb-6 rounded-b-lg border-t border-gray-100 bg-gray-50 px-6 py-4">
                        <Button
                            variant="outline"
                            onClick={() => {
                                setDialogOpen(false);
                                setEditingTask(null);
                                resetForm();
                            }}
                            disabled={createMutation.isPending || updateMutation.isPending}
                            className="transition-colors hover:bg-white"
                        >
                            取消
                        </Button>
                        <Button
                            onClick={handleSubmit}
                            disabled={createMutation.isPending || updateMutation.isPending}
                            className="min-w-[100px] bg-blue-600 transition-colors hover:bg-blue-700"
                        >
                            {createMutation.isPending || updateMutation.isPending ? '提交中' : editingTask ? '更新任务' : '创建任务'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
