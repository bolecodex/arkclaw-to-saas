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
          fillForm: ({ field, value }: any) => {
            const el = document.querySelector(`[name="${field}"]`) as HTMLInputElement | null;
            if (el) {
              el.value = String(value);
              el.dispatchEvent(new Event('input', { bubbles: true }));
            }
            return { ok: !!el };
          },
        },
      });
      instance.mount();
    })();

    return () => instance?.unmount?.();
  }, []);

  return <>{children}</>;
}
