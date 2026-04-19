/**
 * React 接入示例：演示 React 受控组件如何对接 widget 的 fillForm。
 *
 * 关键点：
 *   - React 受控组件的 value 由 useState 控制，DOM 上 dispatchEvent('input') 无效，
 *     fillForm 必须直接 setState（这是与原生 HTML 接入的本质差别）
 *   - 用 useRef 保存最新 setter，避免 closure 闭旧值
 *   - actions 在 useEffect 里只注册一次，state 更新通过 ref 拿
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Arkclaw, type ArkclawOptions } from '@arkclaw/widget';

interface Form {
  title: string;
  amount: string;
  category: 'travel' | 'meal' | 'other' | '';
  memo: string;
  urgent: boolean;
  paymentMethod: 'cash' | 'card' | 'wechat';
}

const initialForm: Form = {
  title: '',
  amount: '',
  category: '',
  memo: '',
  urgent: false,
  paymentMethod: 'card',
};

export function App() {
  const [form, setForm] = useState<Form>(initialForm);
  const [logs, setLogs] = useState<string[]>([]);
  const formRef = useRef(form);
  formRef.current = form;

  const claw = useArkclaw(
    useMemo<ArkclawOptions>(() => ({
      endpoint: 'http://127.0.0.1:8000',
      auth: { type: 'lark' },
      ui: {
        mode: 'side-drawer',
        width: 420,
        defaultOpen: true,
        title: 'React 报销助手',
        quickActions: [
          { label: '总结当前表单', prompt: '请帮我总结当前表单已填的内容' },
          { label: '帮我填差旅', prompt: '帮我填一张差旅报销：4 月差旅 1280 元' },
        ],
      },
      context: { captureClicks: true, captureSelection: true },
      actions: {
        fillForm: async ({ field, value }: { field: string; value: unknown }) => {
          const v = String(value ?? '');
          let ok = true;
          let resolved: unknown = v;
          setForm((prev) => {
            const next = { ...prev };
            switch (field) {
              case 'title': next.title = v; break;
              case 'amount': next.amount = v; break;
              case 'category':
                if (['travel', 'meal', 'other', ''].includes(v)) {
                  next.category = v as Form['category'];
                } else { ok = false; }
                break;
              case 'memo': next.memo = v; break;
              case 'urgent':
                next.urgent = ['true', '1', 'yes', 'on'].includes(v.toLowerCase());
                resolved = next.urgent;
                break;
              case 'paymentMethod':
              case 'payment_method':
                if (['cash', 'card', 'wechat'].includes(v)) {
                  next.paymentMethod = v as Form['paymentMethod'];
                } else { ok = false; }
                break;
              default:
                ok = false;
            }
            return ok ? next : prev;
          });
          appendLog(`fillForm field=${field} value=${v} ok=${ok}`);
          return { ok, value: resolved, reason: ok ? undefined : `unknown field "${field}"` };
        },
        clickButton: ({ selector }: { selector: string }) => {
          if (selector === '#submit-btn' || selector === '#submit') {
            const f = formRef.current;
            appendLog(`submit: ${JSON.stringify(f)}`);
            alert('（演示）已提交：\n' + JSON.stringify(f, null, 2));
            return { ok: true };
          }
          const el = document.querySelector(selector) as HTMLElement | null;
          el?.click();
          return { ok: !!el };
        },
        resetForm: () => {
          setForm(initialForm);
          appendLog('resetForm');
          return { ok: true };
        },
      },
      onLog: (level, msg) => appendLog(`[${level}] ${msg}`),
    }), []),
  );

  function appendLog(line: string) {
    setLogs((l) => [...l.slice(-30), `${new Date().toLocaleTimeString()} ${line}`]);
  }

  return (
    <div style={{
      maxWidth: 760, margin: '60px auto', padding: 32,
      background: 'white', borderRadius: 16,
      boxShadow: '0 8px 30px rgba(0,0,0,.06)',
      fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
    }}>
      <h1>React + ArkClaw · 报销单</h1>
      <p style={{ color: '#6b7280' }}>
        所有字段都是 React 受控组件，AI 通过 fillForm 更新 useState，会触发 React 正常重渲染。
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 24 }}>
        <Field label="标题">
          <input name="title" value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            placeholder="如：4 月差旅"
            style={inputStyle} />
        </Field>
        <Field label="金额">
          <input name="amount" type="number" value={form.amount}
            onChange={(e) => setForm({ ...form, amount: e.target.value })}
            placeholder="0.00" style={inputStyle} />
        </Field>
        <Field label="类别">
          <select name="category" value={form.category}
            onChange={(e) => setForm({ ...form, category: e.target.value as Form['category'] })}
            style={inputStyle}>
            <option value="">请选择</option>
            <option value="travel">差旅</option>
            <option value="meal">餐费</option>
            <option value="other">其他</option>
          </select>
        </Field>
        <Field label="备注">
          <textarea name="memo" rows={2} value={form.memo}
            onChange={(e) => setForm({ ...form, memo: e.target.value })}
            style={{ ...inputStyle, fontFamily: 'inherit' }} />
        </Field>
      </div>

      <div style={{ marginTop: 16, display: 'flex', gap: 24, alignItems: 'center' }}>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 14 }}>
          <input name="urgent" type="checkbox" checked={form.urgent}
            onChange={(e) => setForm({ ...form, urgent: e.target.checked })} />
          加急处理
        </label>
        <span style={{ fontSize: 14, color: '#6b7280' }}>付款方式：</span>
        {(['cash', 'card', 'wechat'] as const).map((pm) => (
          <label key={pm} style={{ display: 'flex', gap: 4, alignItems: 'center', fontSize: 14 }}>
            <input name="paymentMethod" type="radio" value={pm}
              checked={form.paymentMethod === pm}
              onChange={() => setForm({ ...form, paymentMethod: pm })} />
            {pm === 'cash' ? '现金' : pm === 'card' ? '银行卡' : '微信'}
          </label>
        ))}
      </div>

      <div style={{ marginTop: 24, display: 'flex', gap: 12 }}>
        <button id="submit-btn" onClick={() => alert('当前表单：\n' + JSON.stringify(form, null, 2))}
          style={{ ...btn, background: '#6366f1', color: 'white' }}>
          提交
        </button>
        <button onClick={() => claw.current?.send('帮我填一张 4 月差旅报销，金额 1280，加急')}
          style={{ ...btn, border: '1px solid #c7d2fe', color: '#6366f1', background: 'white' }}>
          让 AI 帮我填
        </button>
        <button onClick={() => setForm(initialForm)}
          style={{ ...btn, color: '#6b7280', background: '#f3f4f6' }}>
          重置
        </button>
      </div>

      <div style={{ marginTop: 24 }}>
        <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>当前表单（实时）：</div>
        <pre style={preStyle}>{JSON.stringify(form, null, 2)}</pre>
      </div>

      <details style={{ marginTop: 16 }}>
        <summary style={{ cursor: 'pointer', fontSize: 12, color: '#6b7280' }}>
          AI 操作日志（{logs.length}）
        </summary>
        <pre style={{ ...preStyle, maxHeight: 240 }}>{logs.join('\n') || '尚无日志'}</pre>
      </details>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 12, color: '#6b7280' }}>{label}</span>
      {children}
    </label>
  );
}

function useArkclaw(options: ArkclawOptions) {
  const ref = useRef<Arkclaw | null>(null);
  useEffect(() => {
    const instance = new Arkclaw(options);
    instance.mount();
    ref.current = instance;
    return () => { instance.unmount(); ref.current = null; };
  }, [options]);
  return ref;
}

const inputStyle: React.CSSProperties = {
  padding: '10px 12px', border: '1px solid #e5e7eb',
  borderRadius: 10, fontSize: 14, fontFamily: 'inherit',
};
const btn: React.CSSProperties = {
  padding: '10px 18px', border: 0, borderRadius: 10,
  fontSize: 14, cursor: 'pointer', fontFamily: 'inherit',
};
const preStyle: React.CSSProperties = {
  background: '#f3f4f6', padding: 12, borderRadius: 8,
  fontSize: 12, maxHeight: 180, overflow: 'auto', margin: 0,
};
