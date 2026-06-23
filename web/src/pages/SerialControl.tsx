import {useState} from 'react';
import {Activity, Loader2, Power, Radio, RotateCcw, Send, Signal, Terminal, Wifi} from 'lucide-react';
import {toast} from 'sonner';
import {useMutation, useQuery} from '@tanstack/react-query';
import * as serialApi from '../api/serial';
import {Input} from '@/components/ui/input';
import {Textarea} from '@/components/ui/textarea';
import {Button} from '@/components/ui/button';
import {Card, CardContent, CardHeader, CardTitle} from '@/components/ui/card';
import type {DeviceStatus, PingResult} from '@/api/types';
import {formatUptime} from '@/utils/utils.ts';

function Dot({active, warn = false}: { active: boolean; warn?: boolean }) {
    const color = active ? (warn ? 'bg-amber-500' : 'bg-emerald-500') : 'bg-rose-500';
    return <span className={`inline-block h-2 w-2 rounded-full ${color}`}/>;
}

function StatusRow({label, value}: { label: string; value: React.ReactNode }) {
    return (
        <div className="flex items-center justify-between gap-4 border-b border-gray-100 py-2 last:border-0">
            <span className="text-xs text-gray-500">{label}</span>
            <div className="min-w-0 text-right text-sm font-medium text-gray-900">{value}</div>
        </div>
    );
}

function FieldBlock({label, value}: { label: string; value: React.ReactNode }) {
    return (
        <div>
            <div className="mb-1 text-xs text-gray-500">{label}</div>
            <div className="break-all rounded-md bg-gray-50 px-2 py-1.5 font-mono text-xs text-gray-800">{value}</div>
        </div>
    );
}

function pingText(result?: PingResult | null) {
    if (!result) return '无';
    if (result.success) {
        return `${result.time_ms ?? '-'} ms · TTL ${result.ttl ?? '-'} · ${result.dst || result.host}`;
    }
    return result.msg || result.result || '失败';
}

export default function SerialControl() {
    const [to, setTo] = useState('');
    const [content, setContent] = useState('');
    const [lastPing, setLastPing] = useState<PingResult | null>(null);

    const {data: deviceStatus, isFetching, refetch: refetchStatus} = useQuery({
        queryKey: ['deviceStatus'],
        queryFn: async () => {
            const res = await serialApi.getStatus();
            return res as DeviceStatus;
        },
        refetchInterval: 10000,
    });

    const mobile = deviceStatus?.mobile;
    const cellularEnabled = deviceStatus ? Boolean(deviceStatus.cellular_enabled) : false;

    const sendSMSMutation = useMutation({
        mutationFn: (data: { to: string; content: string }) => serialApi.sendSMS(data),
        onSuccess: () => {
            toast.success('短信下发成功，等待确认');
            setTo('');
            setContent('');
        },
        onError: () => toast.error('发送失败'),
    });

    const setCellularMutation = useMutation({
        mutationFn: (enabled: boolean) => serialApi.setCellular(enabled),
        onSuccess: (_, enabled) => {
            toast.success(enabled ? '蜂窝网络开启命令已发送' : '蜂窝网络关闭命令已发送');
            refetchStatus();
        },
        onError: () => toast.error('蜂窝网络操作失败'),
    });

    const setFlymodeMutation = useMutation({
        mutationFn: (enabled: boolean) => serialApi.setFlymode(enabled),
        onSuccess: () => {
            toast.success('飞行模式命令已发送');
            refetchStatus();
        },
        onError: () => toast.error('飞行模式操作失败'),
    });

    const pingMutation = useMutation({
        mutationFn: () => serialApi.pingOnce(),
        onSuccess: (result) => {
            setLastPing(result);
            if (result.success) {
                toast.success(`Ping 成功：${result.time_ms ?? '-'} ms`);
            } else {
                toast.error(`Ping 失败：${result.msg || result.result}`);
            }
            refetchStatus();
        },
        onError: () => toast.error('Ping 操作失败'),
    });

    const rebootMcuMutation = useMutation({
        mutationFn: () => serialApi.rebootMcu(),
        onSuccess: () => {
            toast.success('模块重启命令已发送');
            refetchStatus();
        },
        onError: () => toast.error('重启模块失败'),
    });

    const handleSendSMS = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!to || !content) {
            toast.warning('请输入手机号和短信内容');
            return;
        }
        sendSMSMutation.mutate({to, content});
    };

    return (
        <div className="flex flex-col gap-5 overflow-hidden">
            <div>
                <h1 className="text-2xl font-bold text-gray-900">串口控制</h1>
            </div>

            <div className="grid flex-1 grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
                <div className="grid min-h-0 grid-cols-1 gap-4 lg:grid-cols-2">
                    <Card className="flex min-h-0 flex-col">
                        <CardHeader className="pb-3">
                            <CardTitle className="flex items-center gap-2 text-base">
                                <Signal className="h-4 w-4 text-blue-600"/>
                                移动网络
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="flex-1 overflow-y-auto">
                            {mobile ? (
                                <div className="space-y-3">
                                    <StatusRow
                                        label="SIM"
                                        value={<span className="inline-flex items-center gap-2"><Dot active={mobile.sim_ready}/> {mobile.sim_ready ? '正常' : '未就绪'}</span>}
                                    />
                                    <StatusRow
                                        label="蜂窝数据"
                                        value={<span className="inline-flex items-center gap-2"><Dot active={cellularEnabled}/> {cellularEnabled ? '已打开' : '已关闭'}</span>}
                                    />
                                    <StatusRow
                                        label="网络注册"
                                        value={!mobile.is_registered ? (
                                            <span className="inline-flex items-center gap-2 text-rose-600"><Dot active={false}/> 未注册</span>
                                        ) : mobile.is_roaming ? (
                                            <span className="inline-flex items-center gap-2 text-amber-600"><Dot active warn/> 漫游</span>
                                        ) : (
                                            <span className="inline-flex items-center gap-2 text-emerald-600"><Dot active/> 已注册</span>
                                        )}
                                    />
                                    <StatusRow label="运营商" value={mobile.operator || '-'}/>
                                    <StatusRow label="本地 IP" value={<span className="font-mono">{mobile.local_ip || '-'}</span>}/>
                                    <StatusRow label="CSQ" value={`${mobile.csq || mobile.signal_level || 0} (${mobile.signal_desc || '-'})`}/>
                                    <StatusRow label="RSSI" value={`${mobile.rssi ?? '-'} dBm`}/>
                                    <StatusRow label="RSRP" value={`${mobile.rsrp || 'N/A'} dBm`}/>
                                    <StatusRow label="RSRQ" value={`${mobile.rsrq || 'N/A'} dB`}/>
                                    <FieldBlock label="ICCID" value={mobile.iccid || '-'}/>
                                    <FieldBlock label="IMSI" value={mobile.imsi || '-'}/>
                                    {mobile.number ? <FieldBlock label="手机号" value={mobile.number}/> : null}
                                </div>
                            ) : (
                                <div className="flex h-full flex-col items-center justify-center text-gray-400">
                                    <Wifi className="mb-2 h-12 w-12 opacity-30"/>
                                    <span className="text-sm">加载中</span>
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    <Card className="flex min-h-0 flex-col">
                        <CardHeader className="pb-3">
                            <CardTitle className="flex items-center gap-2 text-base">
                                <Activity className="h-4 w-4 text-purple-600"/>
                                设备状态
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="flex-1 overflow-y-auto">
                            {deviceStatus ? (
                                <div className="space-y-3">
                                    <StatusRow
                                        label="串口连接"
                                        value={<span className="inline-flex items-center gap-2"><Dot active={deviceStatus.connected}/> {deviceStatus.connected ? '已连接' : '未连接'}</span>}
                                    />
                                    <StatusRow label="串口名称" value={<span className="font-mono">{deviceStatus.port_name || '-'}</span>}/>
                                    <StatusRow label="固件版本" value={<span className="font-mono text-blue-600">{deviceStatus.version || '-'}</span>}/>
                                    <StatusRow
                                        label="飞行模式"
                                        value={deviceStatus.flymode ? <span className="text-amber-600">已启用</span> : <span className="text-emerald-600">已禁用</span>}
                                    />
                                    <StatusRow label="开机时长" value={mobile?.uptime ? formatUptime(mobile.uptime) : '-'}/>
                                    <StatusRow label="内存使用" value={`${deviceStatus.mem_kb || 0} KB`}/>
                                    <StatusRow
                                        label="更新时间"
                                        value={deviceStatus.timestamp ? new Date(deviceStatus.timestamp * 1000).toLocaleString('zh-CN') : '-'}
                                    />
                                    <StatusRow label="Ping 结果" value={pingText(lastPing)}/>
                                </div>
                            ) : (
                                <div className="flex h-full items-center justify-center text-sm text-gray-400">暂无状态</div>
                            )}
                        </CardContent>
                    </Card>
                </div>

                <div className="flex min-h-0 flex-col gap-4">
                    <Card>
                        <CardHeader className="pb-3">
                            <CardTitle className="flex items-center gap-2 text-base">
                                <Power className="h-4 w-4 text-orange-600"/>
                                蜂窝操作
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-3">
                            <div className="grid grid-cols-2 gap-2">
                                <Button
                                    onClick={() => setCellularMutation.mutate(true)}
                                    disabled={setCellularMutation.isPending || isFetching}
                                    variant="outline"
                                    className="h-9 border-emerald-300 text-emerald-700 hover:bg-emerald-50"
                                >
                                    开启蜂窝
                                </Button>
                                <Button
                                    onClick={() => setCellularMutation.mutate(false)}
                                    disabled={setCellularMutation.isPending || isFetching}
                                    variant="outline"
                                    className="h-9 border-orange-300 text-orange-700 hover:bg-orange-50"
                                >
                                    关闭蜂窝
                                </Button>
                                <Button
                                    onClick={() => setFlymodeMutation.mutate(true)}
                                    disabled={setFlymodeMutation.isPending || isFetching}
                                    variant="outline"
                                    className="h-9"
                                >
                                    飞行模式开
                                </Button>
                                <Button
                                    onClick={() => setFlymodeMutation.mutate(false)}
                                    disabled={setFlymodeMutation.isPending || isFetching}
                                    variant="outline"
                                    className="h-9"
                                >
                                    飞行模式关
                                </Button>
                            </div>
                            <Button
                                onClick={() => pingMutation.mutate()}
                                disabled={pingMutation.isPending || isFetching}
                                className="h-9 w-full bg-blue-600 hover:bg-blue-700"
                            >
                                {pingMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Radio className="mr-2 h-4 w-4"/>}
                                Ping 8.8.8.8
                            </Button>
                            <div className="rounded-md bg-gray-50 px-3 py-2 text-sm text-gray-800">
                                {pingText(lastPing)}
                            </div>
                        </CardContent>
                    </Card>

                    <Card className="flex min-h-0 flex-col">
                        <CardHeader className="pb-3">
                            <CardTitle className="flex items-center gap-2 text-base">
                                <Send className="h-4 w-4 text-green-600"/>
                                发送短信
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="flex-1">
                            <form onSubmit={handleSendSMS} className="flex h-full flex-col gap-3">
                                <Input
                                    type="tel"
                                    value={to}
                                    onChange={(e) => setTo(e.target.value)}
                                    placeholder="目标手机号"
                                    className="h-9"
                                    required
                                />
                                <Textarea
                                    value={content}
                                    onChange={(e) => setContent(e.target.value)}
                                    placeholder="短信内容"
                                    className="min-h-28 flex-1 resize-none"
                                    required
                                />
                                <Button
                                    type="submit"
                                    disabled={sendSMSMutation.isPending}
                                    className="h-9 w-full bg-green-600 hover:bg-green-700"
                                >
                                    <Send className="mr-2 h-4 w-4"/>
                                    {sendSMSMutation.isPending ? '发送中' : '发送短信'}
                                </Button>
                            </form>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader className="pb-3">
                            <CardTitle className="flex items-center gap-2 text-base">
                                <Terminal className="h-4 w-4 text-gray-700"/>
                                模块操作
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            <Button
                                onClick={() => rebootMcuMutation.mutate()}
                                disabled={rebootMcuMutation.isPending || isFetching}
                                variant="outline"
                                className="h-9 w-full border-orange-300 text-orange-700 hover:bg-orange-50"
                            >
                                <RotateCcw className="mr-2 h-4 w-4"/>
                                重启模块
                            </Button>
                        </CardContent>
                    </Card>
                </div>
            </div>
        </div>
    );
}
