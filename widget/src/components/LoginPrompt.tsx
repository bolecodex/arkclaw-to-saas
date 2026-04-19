/**
 * 登录引导卡片：Lark 弹窗登录 + 开发模式快捷登录。
 */

import { useState } from 'react';

export interface LoginPromptProps {
  /** 飞书登录 URL（已含 redirect_to=popup） */
  larkUrl: string;
  /** 后端 endpoint，用于 dev session */
  endpoint: string;
  /** 登录成功后回调，参数是 session_token */
  onSuccess: (sessionToken: string, userName?: string) => void;
  /** 是否显示开发模式登录（默认仅当 endpoint 是 127.0.0.1/localhost 时显示） */
  showDev?: boolean;
}

export function LoginPrompt({ larkUrl, endpoint, onSuccess, showDev }: LoginPromptProps) {
  const [busy, setBusy] = useState<'lark' | 'dev' | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const isLocal = /127\.0\.0\.1|localhost/.test(endpoint);
  const canDev = showDev !== false && isLocal;

  const onLark = () => {
    setErr(null);
    setBusy('lark');
    const w = window.open(larkUrl, 'arkclaw-lark', 'width=520,height=720,menubar=no,toolbar=no,location=yes');
    if (!w) {
      setErr('浏览器拦截了弹窗，请允许后重试');
      setBusy(null);
      return;
    }
    // 监控弹窗关闭：如果关闭但没收到成功消息，复位 busy 状态
    const timer = setInterval(() => {
      if (w.closed) {
        clearInterval(timer);
        setTimeout(() => setBusy((b) => (b === 'lark' ? null : b)), 600);
      }
    }, 500);
  };

  const onDev = async () => {
    setErr(null);
    setBusy('dev');
    try {
      const res = await fetch(endpoint.replace(/\/$/, '') + '/auth/dev/session', { method: 'POST' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = (await res.json()) as { session_token: string; user_name?: string };
      onSuccess(data.session_token, data.user_name || 'Demo');
    } catch (e) {
      setErr((e as Error).message || 'dev session failed');
      setBusy(null);
    }
  };

  return (
    <div className="ac-login">
      <div className="ac-login__icon">🔐</div>
      <div className="ac-login__title">使用 ArkClaw 助手</div>
      <div className="ac-login__hint">登录后即可开始与 AI 对话、操作页面</div>

      <button
        type="button"
        className="ac-login__btn ac-login__btn--lark"
        disabled={busy !== null}
        onClick={onLark}
      >
        {busy === 'lark' ? '请在弹窗中完成登录…' : '使用飞书账号登录'}
      </button>

      {canDev && (
        <button
          type="button"
          className="ac-login__btn ac-login__btn--ghost"
          disabled={busy !== null}
          onClick={onDev}
          title="跳过 OAuth，使用本地 demo 身份"
        >
          {busy === 'dev' ? '登录中…' : '开发模式快速登录'}
        </button>
      )}

      {err && <div className="ac-login__err">{err}</div>}
    </div>
  );
}
