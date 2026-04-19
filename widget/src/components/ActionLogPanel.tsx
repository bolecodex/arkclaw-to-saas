/**
 * 抽屉里的「动作日志」可折叠小面板。
 *
 * 用途：当 AI 应该触发宿主动作但页面没反应时，用户能立刻看到：
 *   - AI 到底有没有发出 action 调用？
 *   - 调用的参数对不对？
 *   - 宿主端 ACTION_RESULT 是 ok 还是 error？错误是什么？
 *
 * 没有任何调用时面板自动隐藏，避免干扰正常对话。
 */

import { useState } from 'react';
import { useChatStore, type ActionLog } from '@/store/chatStore';

export function ActionLogPanel() {
  const logs = useChatStore((s) => s.actionLogs);
  const clearLogs = useChatStore((s) => s.clearActionLogs);
  const [expanded, setExpanded] = useState(true);

  if (!logs.length) return null;

  const failed = logs.filter((l) => l.status === 'error').length;
  const okCount = logs.filter((l) => l.status === 'ok').length;
  const pending = logs.filter((l) => l.status === 'pending').length;

  return (
    <div className="ac-action-log">
      <button
        type="button"
        className="ac-action-log__head"
        onClick={() => setExpanded((v) => !v)}
        title="点开/收起 AI 触发的宿主动作"
      >
        <span className="ac-action-log__title">已执行动作 · {logs.length}</span>
        <span className="ac-action-log__counts">
          {okCount > 0 && <span data-kind="ok">{okCount}✓</span>}
          {failed > 0 && <span data-kind="err">{failed}✗</span>}
          {pending > 0 && <span data-kind="pending">{pending}…</span>}
        </span>
        <span className="ac-action-log__chev">{expanded ? '▾' : '▸'}</span>
      </button>
      {expanded && (
        <div className="ac-action-log__body">
          {logs.map((l) => <ActionLogRow key={l.id} log={l} />)}
          <button type="button" className="ac-action-log__clear" onClick={clearLogs}>
            清空日志
          </button>
        </div>
      )}
    </div>
  );
}

function ActionLogRow({ log }: { log: ActionLog }) {
  const dot =
    log.status === 'ok' ? '✓' :
    log.status === 'error' ? '✗' : '…';
  const argsStr = safeJson(log.args);
  return (
    <div className="ac-action-log__row" data-status={log.status}>
      <div className="ac-action-log__row-head">
        <span className="ac-action-log__dot">{dot}</span>
        <code className="ac-action-log__name">{log.action}</code>
        <span className="ac-action-log__ts">{formatTime(log.ts)}</span>
      </div>
      <pre className="ac-action-log__args">{argsStr}</pre>
      {log.error && <div className="ac-action-log__err">error: {log.error}</div>}
      {log.status === 'ok' && log.result !== undefined && (
        <pre className="ac-action-log__res">→ {safeJson(log.result)}</pre>
      )}
    </div>
  );
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function pad(n: number): string { return String(n).padStart(2, '0'); }

function safeJson(v: unknown): string {
  try { return JSON.stringify(v, null, 2); } catch { return String(v); }
}
