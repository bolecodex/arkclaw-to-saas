/**
 * postMessage Bridge — 双向通信抽象。
 *
 * - 宿主侧 SDK 用 `HostBridge` 与 widget iframe 通信
 * - Widget 侧用 `WidgetBridge` 与父窗口通信
 *
 * 所有消息都带 `__arkclaw__: true` 标识，避免误处理其他来源消息。
 */

import type { BridgeFromHost, BridgeFromWidget } from './types';

const SIGNATURE = '__arkclaw__';

interface BridgeEnvelope<T> {
  __arkclaw__: true;
  payload: T;
}

function pack<T>(payload: T): BridgeEnvelope<T> {
  return { [SIGNATURE]: true, payload } as BridgeEnvelope<T>;
}

function isEnvelope(data: unknown): data is BridgeEnvelope<unknown> {
  return !!(data && typeof data === 'object' && (data as Record<string, unknown>)[SIGNATURE]);
}

/* ── Host 侧：宿主页面用此与 iframe 通信 ── */

export class HostBridge {
  private target: Window | null = null;
  private origin: string;
  private listeners = new Set<(msg: BridgeFromWidget) => void>();
  private boundOnMessage: (e: MessageEvent) => void;

  constructor(origin: string = '*') {
    this.origin = origin;
    this.boundOnMessage = (e) => {
      if (!isEnvelope(e.data)) return;
      const msg = e.data.payload as BridgeFromWidget;
      this.listeners.forEach((fn) => fn(msg));
    };
    window.addEventListener('message', this.boundOnMessage);
  }

  attach(target: Window) {
    this.target = target;
  }

  send(msg: BridgeFromHost) {
    if (!this.target) return;
    this.target.postMessage(pack(msg), this.origin);
  }

  on(fn: (msg: BridgeFromWidget) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  destroy() {
    window.removeEventListener('message', this.boundOnMessage);
    this.listeners.clear();
    this.target = null;
  }
}

/* ── Widget 侧：iframe 内部用此与父窗口通信 ── */

export class WidgetBridge {
  private parent: Window;
  private origin: string;
  private listeners = new Set<(msg: BridgeFromHost) => void>();
  private boundOnMessage: (e: MessageEvent) => void;

  constructor(origin: string = '*') {
    this.parent = window.parent;
    this.origin = origin;
    this.boundOnMessage = (e) => {
      if (!isEnvelope(e.data)) return;
      const msg = e.data.payload as BridgeFromHost;
      this.listeners.forEach((fn) => fn(msg));
    };
    window.addEventListener('message', this.boundOnMessage);
  }

  send(msg: BridgeFromWidget) {
    if (this.parent === window) return;
    this.parent.postMessage(pack(msg), this.origin);
  }

  on(fn: (msg: BridgeFromHost) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  destroy() {
    window.removeEventListener('message', this.boundOnMessage);
    this.listeners.clear();
  }

  isInIframe(): boolean {
    return this.parent !== window;
  }
}
