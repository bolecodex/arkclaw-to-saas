'use client';

import { useEffect, useRef, type ReactNode } from 'react';

export function ClawProvider({ children }: { children: ReactNode }) {
  const mounted = useRef(false);

  useEffect(() => {
    if (mounted.current) return;
    mounted.current = true;

    let instance: any;
    (async () => {
      // 动态 import，避免 SSR 时尝试访问 window
      const { Arkclaw } = await import('@arkclaw/widget');
      instance = new Arkclaw({
        endpoint: process.env.NEXT_PUBLIC_ARKCLAW_ENDPOINT || 'http://127.0.0.1:8000',
        auth: { type: 'lark' },
        ui: { mode: 'side-drawer', defaultOpen: false },
        context: { captureClicks: true, captureSelection: true },
        actions: {
          // ⚠️ 注意：本实现适用于"非受控组件"（直接操作 DOM）。
          // 如果你的页面用 React 受控组件（input value={state}），
          // dispatchEvent 不会让 state 更新，必须改用 setState（参考 react-app 示例）。
          fillForm: ({ field, value }: any) => {
            let el = document.querySelector(`[name="${CSS.escape(String(field))}"]`) as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null;
            if (!el) el = document.getElementById(String(field)) as typeof el;
            if (!el) return { ok: false, reason: 'field not found: ' + field };

            el.focus();
            const v = String(value ?? '');
            if (el.tagName === 'SELECT') {
              const sel = el as HTMLSelectElement;
              const opt = Array.from(sel.options).find(o => o.value === v || o.textContent?.trim() === v);
              sel.value = opt ? opt.value : v;
            } else if ((el as HTMLInputElement).type === 'checkbox' || (el as HTMLInputElement).type === 'radio') {
              (el as HTMLInputElement).checked = ['true', '1', 'yes', 'on'].includes(v.toLowerCase());
            } else {
              (el as HTMLInputElement).value = v;
            }
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            el.blur();
            return { ok: true, value: (el as HTMLInputElement).value };
          },
          clickButton: ({ selector }: any) => {
            const el = document.querySelector(String(selector)) as HTMLElement | null;
            el?.click();
            return { ok: !!el, reason: el ? undefined : 'not found' };
          },
        },
      });
      instance.mount();
    })();

    return () => instance?.unmount?.();
  }, []);

  return <>{children}</>;
}
