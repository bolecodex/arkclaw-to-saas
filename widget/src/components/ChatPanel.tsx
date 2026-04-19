/**
 * ChatPanel — 主面板，协调 token 获取、WebSocket、消息流、与 host 通信。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiClient, ApiError, type InstanceInfo } from '@/api/client';
import { useWebSocket } from '@/hooks/useWebSocket';
import { useHostBridge } from '@/hooks/useHostBridge';
import { useChatStore, uuid, type Message } from '@/store/chatStore';
import type { ArkclawOptions, BridgeFromHost, HostInfo, QuickAction } from '@/sdk/types';
import { buildHostCapabilityPrompt, buildHostShortReminder } from '@/utils/hostPrompt';
import { MessageList } from './MessageList';
import { InputBar } from './InputBar';
import { QuickActions } from './QuickActions';
import { SelectionToolbar } from './SelectionToolbar';
import { LoginPrompt } from './LoginPrompt';
import { InstancePicker } from './InstancePicker';

const INSTANCE_LS_KEY = 'arkclaw:selected-instance-id';

export interface ChatPanelProps {
  config: ArkclawOptions & { embedded?: boolean };
}

export function ChatPanel({ config }: ChatPanelProps) {
  const ui = config.ui || {};
  const status = useChatStore((s) => s.status);
  const open = useChatStore((s) => s.open);
  const setOpen = useChatStore((s) => s.setOpen);
  const addMessage = useChatStore((s) => s.addMessage);
  const setPendingContext = useChatStore((s) => s.setPendingContext);
  const pendingContext = useChatStore((s) => s.pendingContext);
  const hostInfo = useChatStore((s) => s.hostInfo);
  const setHostInfo = useChatStore((s) => s.setHostInfo);
  // 是否已经把宿主能力清单注入给 AI（每次对话只注入一次，避免每条消息都重复刷一大段提示）
  const hostInfoSentRef = useRef(false);

  const [wsUrl, setWsUrl] = useState<string | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  const [needLogin, setNeedLogin] = useState(false);
  const [bootSeq, setBootSeq] = useState(0);
  // 选中的 instanceId 优先级：用户在 picker 选过的（localStorage） > config.instanceId > undefined（让后端用 default）
  const [selectedInstanceId, setSelectedInstanceId] = useState<string | undefined>(() => {
    try {
      const saved = localStorage.getItem(INSTANCE_LS_KEY);
      return saved || config.instanceId || undefined;
    } catch {
      return config.instanceId || undefined;
    }
  });
  // 当前实际生效的 instanceId（boot 后从 chatToken 响应中拿到，可能就是上面那个，也可能是后端 default）
  const [activeInstanceId, setActiveInstanceId] = useState<string>('');

  const apiRef = useRef<ApiClient>();
  if (!apiRef.current) {
    apiRef.current = new ApiClient({ endpoint: config.endpoint, auth: config.auth });
  }
  // 节流刷新 chatToken：避免 ws 抖动反复 fetch（默认 5s 内最多一次）
  const lastRefreshAtRef = useRef(0);

  const bridge = useHostBridge({
    onHost: (msg) => handleHostMessage(msg),
  });

  // initial boot：换 ChatToken → 拼 wsUrl
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const data = await apiRef.current!.fetchChatToken(selectedInstanceId);
        if (alive) {
          setWsUrl(data.ws_url);
          setActiveInstanceId(data.instance_id);
          setBootError(null);
          setNeedLogin(false);
        }
      } catch (e) {
        const err = e as ApiError;
        if (alive) {
          if (err.message.startsWith('NEED_LARK_LOGIN')) {
            // session 缺失或过期：让宿主也清掉持久化，避免下次刷新还把旧 session 注入回来
            bridge.send({ type: 'SESSION_UPDATE', sessionToken: '' });
            setBootError(null);
            setNeedLogin(true);
            bridge.send({ type: 'NEED_AUTH', reason: 'lark login required' });
          } else {
            setBootError(err.message);
            addSystemMessage(`初始化失败：${err.message}`);
          }
        }
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedInstanceId, bootSeq]);

  // 应用新 session：写 ApiClient 内存 + iframe 自身 localStorage（inline 模式）
  // + 通过 bridge 通知宿主写宿主 localStorage（iframe 模式 srcdoc origin 隔离需要）
  const applyNewSession = useCallback((token: string) => {
    apiRef.current?.setSessionToken(token);
    bridge.send({ type: 'SESSION_UPDATE', sessionToken: token });
  }, [bridge]);

  // 监听 OAuth 弹窗回调（postMessage）
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const data = e.data;
      if (!data || typeof data !== 'object') return;
      if (data.type === 'arkclaw:lark-success' && typeof data.session_token === 'string') {
        applyNewSession(data.session_token);
        setNeedLogin(false);
        setBootSeq((n) => n + 1);
      }
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [applyNewSession]);

  const handleLoginSuccess = useCallback((token: string, name?: string) => {
    applyNewSession(token);
    setNeedLogin(false);
    setBootSeq((n) => n + 1);
    if (name) addSystemMessage(`已登录：${name}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applyNewSession]);

  const handlePickInstance = useCallback((info: InstanceInfo) => {
    if (info.instance_id === activeInstanceId) return;
    try { localStorage.setItem(INSTANCE_LS_KEY, info.instance_id); } catch { /* noop */ }
    addSystemMessage(`切换实例：${info.name || info.instance_id}`);
    setWsUrl(null);
    setSelectedInstanceId(info.instance_id);
    setBootSeq((n) => n + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeInstanceId]);

  const loadInstances = useCallback(async (): Promise<InstanceInfo[]> => {
    return apiRef.current!.listInstances();
  }, []);

  // 手动重连：用户在 header 上点"重连"，强制重新拿 chatToken
  const handleManualReconnect = useCallback(() => {
    lastRefreshAtRef.current = Date.now();
    addSystemMessage('正在重新连接…');
    setWsUrl(null);
    setBootSeq((n) => n + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ws 失活兜底：旧 chatToken 已失效，重新去后端签一次再连。
  // 5s 内只触发一次，避免 ws 抖动导致 fetch 风暴。
  const handleNeedRefreshUrl = useCallback((reason: string) => {
    const now = Date.now();
    if (now - lastRefreshAtRef.current < 5000) return;
    lastRefreshAtRef.current = now;
    addSystemMessage(`链路异常（${reason}），尝试重新签发 chatToken…`);
    setWsUrl(null);
    setBootSeq((n) => n + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ws = useWebSocket({
    wsUrl,
    onLog: (level, msg, data) => {
      config.onLog?.(level, msg, data);
      const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.info;
      try { fn('[Arkclaw][ws]', msg, data ?? ''); } catch { /* noop */ }
    },
    onAiAction: (callId, action, args) => {
      bridge.send({ type: 'AI_ACTION', callId, action, args });
    },
    onAssistantText: (text) => {
      bridge.send({ type: 'MESSAGE', role: 'assistant', text });
    },
    onNeedRefreshUrl: handleNeedRefreshUrl,
  });

  // 通知 host bridge 已就绪 + 状态变化
  useEffect(() => {
    bridge.send({ type: 'READY' });
  }, [bridge]);

  useEffect(() => {
    bridge.send({ type: 'STATE', open, status });
  }, [bridge, open, status]);

  const addSystemMessage = useCallback(
    (text: string) => {
      const m: Message = { id: uuid(), role: 'system', text, ts: Date.now() };
      addMessage(m);
    },
    [addMessage]
  );

  const sendUser = useCallback(
    (text: string, _opts?: { isContextOnly?: boolean }) => {
      if (!text.trim()) return;
      const m: Message = {
        id: uuid(),
        role: 'user',
        text,
        ts: Date.now(),
        contextChip: pendingContext || undefined,
      };
      addMessage(m);
      bridge.send({ type: 'MESSAGE', role: 'user', text });

      const contextParts: string[] = [];

      if (hostInfo) {
        if (!hostInfoSentRef.current) {
          // 第一条：完整能力清单 + 强约束身份定位
          const cap = buildHostCapabilityPrompt(hostInfo);
          if (cap) contextParts.push(cap);
          hostInfoSentRef.current = true;
        } else {
          // 后续每条：精简提醒，避免 AI 中途忘了身份去搜索
          const tip = buildHostShortReminder(hostInfo);
          if (tip) contextParts.push(tip);
        }
      }

      if (pendingContext) {
        contextParts.push(
          `[页面上下文]\n标签: ${pendingContext.tagName}` +
            (pendingContext.text ? `\n内容: ${pendingContext.text}` : '') +
            (pendingContext.selector ? `\nselector: ${pendingContext.selector}` : '')
        );
      }

      const contextStr = contextParts.length ? contextParts.join('\n\n') : undefined;
      // deliver=false 才会触发 AI 回复（demo 验证过）；
      // deliver=true 是把消息直接投递给会话端，不进入 agent 推理
      ws.send(text, { context: contextStr, deliver: false });
      setPendingContext(null);
    },
    [addMessage, bridge, pendingContext, setPendingContext, ws, hostInfo]
  );

  const onQuickAction = useCallback((a: QuickAction) => sendUser(a.prompt), [sendUser]);

  const handleHostMessage = useCallback((msg: BridgeFromHost) => {
    switch (msg.type) {
      case 'OPEN':
        setOpen(true); break;
      case 'CLOSE':
        setOpen(false); break;
      case 'TOGGLE':
        setOpen(!open); break;
      case 'SEND':
        sendUser(msg.text); break;
      case 'HOST_INFO':
        // 宿主推送了能力 / 字段清单 → 存到 store；下次 sendUser 时会注入到 AI 上下文
        setHostInfo(msg.info as HostInfo);
        // 字段或 actions 发生显著变化时（比如切了路由），允许重新注入一次
        hostInfoSentRef.current = false;
        break;
      case 'HOST_CONTEXT':
        // 只在有具体元素或 selection 时入栈，避免噪音
        if (msg.element || msg.selection) {
          setPendingContext(msg.element || {
            tagName: 'selection',
            text: msg.selection || '',
            page: window.location.pathname,
          });
        }
        break;
      case 'ACTION_RESULT':
        // 把 action 结果作为系统消息再发回 AI
        ws.send(
          `[宿主动作结果] callId=${msg.callId} ok=${msg.ok}` +
            (msg.error ? ` error=${msg.error}` : '') +
            (msg.result ? ` result=${JSON.stringify(msg.result)}` : ''),
          { deliver: false }
        );
        break;
    }
  }, [open, sendUser, setOpen, setPendingContext, setHostInfo, ws]);

  const themedRoot = useMemo(() => (
    <div className="ac-panel ac-root" data-theme={ui.theme || 'auto'}>
      <header className="ac-header">
        <div className="ac-header__avatar">AI</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="ac-header__title">{ui.title || 'ArkClaw 助手'}</div>
          <div className="ac-header__status" data-status={status}>
            {statusText(status)}
          </div>
        </div>
        {!needLogin && (status === 'closed' || status === 'error') && (
          <button
            type="button"
            className="ac-header__reconnect"
            onClick={handleManualReconnect}
            title="重新签发 chatToken 并连接"
          >
            重连
          </button>
        )}
        {!needLogin && (
          <InstancePicker
            currentId={activeInstanceId}
            loading={!wsUrl}
            onLoadInstances={loadInstances}
            onPick={handlePickInstance}
          />
        )}
        {config.embedded && (
          <button className="ac-header__close" onClick={() => bridge.send({ type: 'STATE', open: false, status })}>
            ×
          </button>
        )}
      </header>

      {!needLogin && <QuickActions actions={ui.quickActions || []} onClick={onQuickAction} />}

      {needLogin ? (
        <LoginPrompt
          larkUrl={apiRef.current!.buildLarkLoginUrl('popup')}
          endpoint={config.endpoint}
          onSuccess={handleLoginSuccess}
        />
      ) : (
        <MessageList greeting={ui.greeting} />
      )}

      {bootError && (
        <div style={{ padding: '0 16px 8px', color: 'var(--ac-color-error)', fontSize: 12 }}>
          {bootError}
        </div>
      )}

      <InputBar onSend={sendUser} disabled={needLogin || !wsUrl || status === 'error'} />

      <SelectionToolbar onAsk={sendUser} />
    </div>
  ), [ui, status, config.embedded, bridge, onQuickAction, bootError, sendUser, wsUrl, needLogin, handleLoginSuccess, config.endpoint, activeInstanceId, loadInstances, handlePickInstance, handleManualReconnect]);

  return themedRoot;
}

function statusText(status: string): string {
  switch (status) {
    case 'connecting': return '连接中…';
    case 'open': return '已连接';
    case 'closed': return '已断开';
    case 'error': return '连接异常';
    default: return '待机';
  }
}
