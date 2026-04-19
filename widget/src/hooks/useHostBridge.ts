/**
 * Widget 内部使用的 React Hook，封装与宿主父窗口的通信。
 * 关键：返回值必须稳定（useMemo），否则会让上游 useEffect deps 反复变化。
 */

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { WidgetBridge } from '@/sdk/HostBridge';
import type { BridgeFromHost, BridgeFromWidget } from '@/sdk/types';

export interface UseHostBridgeOpts {
  onHost?: (msg: BridgeFromHost) => void;
}

export function useHostBridge(opts: UseHostBridgeOpts = {}) {
  const bridgeRef = useRef<WidgetBridge | null>(null);
  if (typeof window !== 'undefined' && !bridgeRef.current) {
    bridgeRef.current = new WidgetBridge();
  }
  const bridge = bridgeRef.current;

  // 用 ref 把 onHost 钉住，避免每次 render 都重订阅
  const onHostRef = useRef(opts.onHost);
  onHostRef.current = opts.onHost;

  useEffect(() => {
    if (!bridge) return;
    const off = bridge.on((m) => onHostRef.current?.(m));
    return off;
  }, [bridge]);

  useEffect(() => {
    return () => {
      bridge?.destroy();
      bridgeRef.current = null;
    };
  }, [bridge]);

  const send = useCallback((msg: BridgeFromWidget) => bridge?.send(msg), [bridge]);
  const isEmbedded = bridge?.isInIframe() ?? false;

  return useMemo(() => ({ send, isEmbedded }), [send, isEmbedded]);
}
