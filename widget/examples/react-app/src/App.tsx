/**
 * React 集成示例：用 useArkclaw 自定义 hook 把 widget 接入 React 生命周期。
 */

import { useEffect, useRef, useState } from 'react';
import { Arkclaw, type ArkclawOptions } from '@arkclaw/widget';

function useArkclaw(options: ArkclawOptions) {
  const ref = useRef<Arkclaw | null>(null);
  useEffect(() => {
    const instance = new Arkclaw(options);
    instance.mount();
    ref.current = instance;
    return () => instance.unmount();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return ref;
}

export function App() {
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [logs, setLogs] = useState<string[]>([]);

  const claw = useArkclaw({
    endpoint: 'http://127.0.0.1:8000',
    auth: { type: 'lark' },
    ui: {
      mode: 'side-drawer',
      width: 420,
      defaultOpen: true,
      title: 'React Demo 助手',
      quickActions: [{ label: '总结表单', prompt: '请总结当前表单已填的内容' }],
    },
    context: { captureClicks: true, captureSelection: true },
    actions: {
      fillForm: async ({ field, value }: any) => {
        if (field === 'name') setName(String(value));
        else if (field === 'amount') setAmount(String(value));
        return { ok: true };
      },
    },
    onLog: (level, msg) => setLogs((l) => [...l.slice(-20), `[${level}] ${msg}`]),
  });

  return (
    <div style={{
      maxWidth: 720, margin: '60px auto', padding: 32,
      background: 'white', borderRadius: 16,
      boxShadow: '0 8px 30px rgba(0,0,0,.06)',
      fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
    }}>
      <h1>React + ArkClaw</h1>
      <p>这是一个 React 接入示例，演示如何在 React 组件树中使用 widget。</p>

      <div style={{ display: 'grid', gap: 12 }}>
        <label>
          姓名
          <input name="name" value={name} onChange={(e) => setName(e.target.value)}
            style={{ marginLeft: 12, padding: 8, borderRadius: 6, border: '1px solid #ddd' }} />
        </label>
        <label>
          金额
          <input name="amount" value={amount} onChange={(e) => setAmount(e.target.value)}
            style={{ marginLeft: 12, padding: 8, borderRadius: 6, border: '1px solid #ddd' }} />
        </label>
      </div>

      <div style={{ marginTop: 16 }}>
        <button onClick={() => claw.current?.send('帮我把这个表单填好')}
          style={{ padding: '10px 16px', background: '#6366f1', color: 'white',
                   border: 0, borderRadius: 8, cursor: 'pointer' }}>
          调用 AI 帮我填
        </button>
      </div>

      <pre style={{ marginTop: 24, background: '#f3f4f6', padding: 12,
                    borderRadius: 8, fontSize: 12, maxHeight: 200, overflow: 'auto' }}>
        {logs.join('\n') || '日志…'}
      </pre>
    </div>
  );
}
