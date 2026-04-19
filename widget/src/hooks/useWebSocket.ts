/**
 * 封装 ArkClaw WebSocket：握手、心跳、自动重连、消息路由。
 *
 * 协议要点（迁移自旧 demo/web_demo.py）：
 *  - 服务端先发 `connect.challenge`，客户端再发 `connect`
 *  - 之后会收到 `event` 类型消息：chat/heartbeat/tick/state/run.start/run.done/tool/...
 *  - chat.role=assistant + state=final 才是最终回复
 */

import { useCallback, useEffect, useRef } from 'react';
import { uuid, useChatStore, type Message, type ThinkingStep } from '@/store/chatStore';

export interface UseWebSocketOpts {
  wsUrl: string | null;
  userToken?: string;
  onLog?: (level: 'info' | 'warn' | 'error', msg: string, data?: unknown) => void;
  onAiAction?: (callId: string, action: string, args: Record<string, unknown>) => void;
  onAssistantText?: (text: string) => void;
  /**
   * 上层（ChatPanel）听到这个回调时，应该重新去后端 fetchChatToken 拿新的 wsUrl。
   * 触发场景：
   *  - 应用级 close（4xxx，多半是 chatToken 失效或参数错）
   *  - 握手都没完成就被 close（旧 url 已彻底失效）
   *  - 普通 1006/1011 等多次重连仍失败，超过自动重连上限
   */
  onNeedRefreshUrl?: (reason: string) => void;
}

interface SendOptions {
  context?: string;
  deliver?: boolean;
}

/* ── 工具：close code 友好提示 ── */
function closeCodeHint(code: number): string {
  switch (code) {
    case 1000: return '正常关闭';
    case 1001: return '远端走开';
    case 1006: return '异常关闭（网络/CORS/服务端 reset）';
    case 1008: return 'policy violation（认证/授权失败？）';
    case 1011: return '服务端内部错误';
    case 4001: return '认证失败 - 检查 user_access_token';
    case 4003: return 'forbidden - 实例权限或会话不匹配';
    case 4004: return '资源不存在 - chatToken 已失效或 instance 错误';
    case 4008: return 'token 过期';
    default:   return code >= 4000 ? '应用级关闭，请看下方原因或后端日志' : '';
  }
}

/* ── 协议消息构造 ── */

function buildConnect() {
  // 注意：client.id 是服务端 schema 的常量白名单之一，不能随意改成 SDK 名
  // demo/web_demo.py 验证过的合法值之一为 "openclaw-control-ui"
  return {
    type: 'req',
    id: uuid(),
    method: 'connect',
    params: {
      minProtocol: 3,
      maxProtocol: 3,
      client: {
        id: 'openclaw-control-ui',
        version: 'dev',
        platform: typeof navigator !== 'undefined' ? navigator.platform : 'web',
        mode: 'webchat',
      },
      role: 'operator',
      scopes: ['operator.admin'],
      caps: ['tool-events'],
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
      locale: 'zh-CN',
    },
  };
}

function buildChatSend(text: string, deliver = false) {
  return {
    type: 'req',
    id: uuid(),
    method: 'chat.send',
    params: {
      sessionKey: 'agent:main:main',
      message: text,
      deliver,
      idempotencyKey: uuid(),
    },
  };
}

/* ── 工具调用解析 ── */

function tryParseAction(text: string): { action: string; args: Record<string, unknown> } | null {
  // AI 通过 ```action``` 或 ```json action: {...}``` 等结构化输出请求宿主操作。
  // 这里支持: <arkclaw:action name="x">{json}</arkclaw:action>
  const m = text.match(/<arkclaw:action\s+name="([^"]+)"\s*>([\s\S]*?)<\/arkclaw:action>/);
  if (!m) return null;
  try {
    const args = JSON.parse(m[2]);
    return { action: m[1], args };
  } catch {
    return null;
  }
}

/* ── Hook ── */

export function useWebSocket(opts: UseWebSocketOpts) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const handshakeDoneRef = useRef(false);
  const currentMsgIdRef = useRef<string | null>(null);

  const log = useCallback(
    (level: 'info' | 'warn' | 'error', msg: string, data?: unknown) => {
      opts.onLog?.(level, msg, data);
    },
    [opts]
  );

  const setStatus = useChatStore((s) => s.setStatus);
  const addMessage = useChatStore((s) => s.addMessage);
  const updateMessage = useChatStore((s) => s.updateMessage);
  const appendStreamText = useChatStore((s) => s.appendStreamText);
  const finishStream = useChatStore((s) => s.finishStream);
  const addThinkingStep = useChatStore((s) => s.addThinkingStep);
  const finishThinking = useChatStore((s) => s.finishThinking);

  const ensureAssistantMsg = useCallback((): string => {
    if (currentMsgIdRef.current) return currentMsgIdRef.current;
    const id = uuid();
    const msg: Message = {
      id,
      role: 'assistant',
      text: '',
      streaming: true,
      thinking: [],
      thinkingDone: false,
      ts: Date.now(),
    };
    addMessage(msg);
    currentMsgIdRef.current = id;
    return id;
  }, [addMessage]);

  const handleEvent = useCallback(
    (data: Record<string, unknown>) => {
      const event = (data.event as string) || '';
      const payload = (data.payload as Record<string, unknown>) || {};

      // 完成握手
      if (
        !handshakeDoneRef.current &&
        ['heartbeat', 'tick', 'state', 'connect.ready'].includes(event)
      ) {
        handshakeDoneRef.current = true;
        setStatus('open');
        log('info', '握手完成');
      }

      if (event === 'heartbeat' || event === 'tick' || event === 'state') return;

      if (event === 'run.start' || event === 'run') {
        ensureAssistantMsg();
        return;
      }
      if (event === 'run.done' || event === 'run.end') {
        const id = currentMsgIdRef.current;
        if (id) finishThinking(id);
        return;
      }

      if (event === 'tool' || event === 'tool_result') {
        const name = (payload.name as string) || (payload.tool as string) || '';
        const id = ensureAssistantMsg();
        if (name) {
          const step: ThinkingStep = {
            id: uuid(),
            text: `${name} (done)`,
            ts: Date.now(),
          };
          addThinkingStep(id, step);
        }
        return;
      }

      if (event !== 'chat') return;

      const chatMsg = (payload.message as Record<string, unknown>) || {};
      const contents = (chatMsg.content as Array<Record<string, unknown>>) || [];
      const chatState = (payload.state as string) || '';
      const role = (chatMsg.role as string) || 'assistant';

      // 调试摘要：把 chat 事件不论 role 都打到 console（开发期）
      try {
        const debugSummary = {
          role,
          state: chatState,
          contentTypes: contents.map((c) => c.type),
          firstText: contents.find((c) => c.type === 'text')?.text,
        };
        console.log('[Arkclaw][chat-event]', debugSummary, payload);
      } catch {/* noop */}

      // 非 assistant 的 chat 事件（user echo 等）静默忽略，避免干扰 UI
      if (role !== 'assistant') return;

      let chatText = '';
      const msgId = ensureAssistantMsg();

      for (const c of contents) {
        const ctype = c.type as string;
        if (ctype === 'text' && c.text) chatText += c.text as string;

        if (ctype === 'tool_call' || ctype === 'tool_use') {
          const tcName = (c.name as string) || (c.function as string) || (c.tool as string) || 'tool';
          const tcArgs = c.arguments || c.input || c.params || '';
          let summary = tcName;
          const argsStr = typeof tcArgs === 'string' ? tcArgs : JSON.stringify(tcArgs);
          if (argsStr && argsStr.length > 0) {
            summary += ': ' + (argsStr.length > 120 ? argsStr.slice(0, 120) + '...' : argsStr);
          }
          addThinkingStep(msgId, { id: uuid(), text: summary, ts: Date.now() });

          // 试着把 tool_call 当 AI Action 派发（如果 args 是对象且 name 已注册）
          if (typeof tcArgs === 'object' && tcArgs) {
            opts.onAiAction?.(uuid(), tcName, tcArgs as Record<string, unknown>);
          }
        }
      }

      // 如果 AI 文本中含 <arkclaw:action> 标签，触发宿主动作
      const actionTag = tryParseAction(chatText);
      if (actionTag) {
        opts.onAiAction?.(uuid(), actionTag.action, actionTag.args);
      }

      if (chatState === 'final') {
        finishThinking(msgId);
        if (chatText) {
          updateMessage(msgId, { text: chatText, streaming: false });
          opts.onAssistantText?.(chatText);
        } else {
          finishStream(msgId);
        }
        currentMsgIdRef.current = null;
      } else if (chatText) {
        // 流式增量：直接覆盖（ArkClaw 协议是累计文本）
        updateMessage(msgId, { text: chatText, streaming: true });
      }
    },
    [appendStreamText, ensureAssistantMsg, finishStream, finishThinking, log, opts, addThinkingStep, setStatus, updateMessage]
  );

  const connect = useCallback(() => {
    if (!opts.wsUrl) return;
    if (wsRef.current && wsRef.current.readyState !== WebSocket.CLOSED) {
      try { wsRef.current.close(); } catch {/* noop */}
    }

    setStatus('connecting');
    handshakeDoneRef.current = false;

    const url = opts.userToken
      ? `${opts.wsUrl}&token=${encodeURIComponent(opts.userToken)}`
      : opts.wsUrl;

    log('info', '连接 WebSocket', url);
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      log('info', 'WebSocket 已打开，等待 challenge');
    };

    ws.onmessage = (e) => {
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(e.data);
      } catch {
        log('warn', 'invalid ws frame', e.data);
        return;
      }
      // 调试：把每个收到的帧打印出来（生产可关）
      try { console.debug('[Arkclaw][ws◀]', data); } catch {/* noop */}
      // chat 事件特别详细打印，方便看 role/content/state
      if ((data as Record<string, unknown>).event === 'chat') {
        try {
          console.log('[Arkclaw][ws◀ CHAT]', JSON.parse(JSON.stringify(data)));
        } catch {/* noop */}
      }
      const type = (data.type as string) || '';
      const event = (data.event as string) || '';

      if (type === 'event' && event === 'connect.challenge') {
        log('info', '收到 challenge，发送 connect');
        ws.send(JSON.stringify(buildConnect()));
        return;
      }
      if (type === 'resp' || type === 'res') {
        if (data.ok === true || !data.error) {
          if (!handshakeDoneRef.current) {
            handshakeDoneRef.current = true;
            setStatus('open');
            log('info', '握手响应 OK');
          }
        } else {
          setStatus('error');
          log('error', '握手失败', data.error);
        }
        return;
      }
      if (type === 'event') {
        handleEvent(data);
        return;
      }
    };

    ws.onerror = () => {
      log('error', 'WebSocket 错误');
      setStatus('error');
    };

    ws.onclose = (ev) => {
      setStatus('closed');
      const reason = ev.reason || closeCodeHint(ev.code);
      log('warn', `WebSocket 关闭 code=${ev.code}`, ev.reason);
      addMessage({
        id: uuid(),
        role: 'system',
        text: `WebSocket 已断开 · code=${ev.code}${reason ? ' · ' + reason : ''}`,
        ts: Date.now(),
      });

      // 4xxx 是应用级错误（认证/参数等）—— 旧 chatToken 已失效，让上层去后端拿新的
      const appLevelClose = ev.code >= 4000 && ev.code < 5000;
      if (appLevelClose) {
        log('warn', `应用级 close ${ev.code}，请求刷新 chatToken`);
        opts.onNeedRefreshUrl?.(`close-${ev.code}`);
        return;
      }

      // 握手都没完成就 close —— 多半是 wsUrl 本身失效（chatToken 过期、endpoint 变更等）
      // 旧逻辑直接卡死，这里改成主动让上层刷新
      if (!handshakeDoneRef.current) {
        log('warn', 'pre-handshake close，请求刷新 chatToken');
        opts.onNeedRefreshUrl?.('pre-handshake-close');
        return;
      }

      if (ev.code === 1000) return;

      if (reconnectAttemptsRef.current < 5) {
        const delay = Math.min(1000 * 2 ** reconnectAttemptsRef.current, 15000);
        reconnectAttemptsRef.current += 1;
        log('info', `${delay}ms 后重连 (${reconnectAttemptsRef.current}/5)`);
        setTimeout(connect, delay);
      } else {
        // 自动重连上限用完仍然不行，旧 wsUrl 八成已经过期，让上层刷新
        log('warn', '重连上限用尽，请求刷新 chatToken');
        opts.onNeedRefreshUrl?.('reconnect-exhausted');
      }
    };
  }, [opts.wsUrl, opts.userToken, opts.onNeedRefreshUrl, setStatus, log, handleEvent]);

  const send = useCallback((text: string, options: SendOptions = {}) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      log('warn', 'ws not open, cannot send');
      return false;
    }
    let finalText = text;
    if (options.context) {
      finalText = `${options.context}\n\n用户问题：${text}`;
    }
    const frame = buildChatSend(finalText, options.deliver);
    try { console.debug('[Arkclaw][ws▶]', frame); } catch {/* noop */}
    ws.send(JSON.stringify(frame));
    currentMsgIdRef.current = null;
    return true;
  }, [log]);

  const disconnect = useCallback(() => {
    reconnectAttemptsRef.current = 100; // 阻止重连
    wsRef.current?.close(1000, 'manual');
    wsRef.current = null;
  }, []);

  useEffect(() => {
    if (opts.wsUrl) {
      reconnectAttemptsRef.current = 0;
      connect();
    }
    return () => {
      reconnectAttemptsRef.current = 100;
      wsRef.current?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.wsUrl]);

  return { send, disconnect, reconnect: connect };
}
