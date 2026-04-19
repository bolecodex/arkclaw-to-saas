/**
 * Arkclaw — 对外暴露的 SDK 主类。
 *
 * 提供两种集成模式：
 *  1. iframe 模式：把 widget 用 iframe 嵌入，通过 postMessage 通信（推荐，样式完全隔离）
 *  2. inline 模式：直接调用 mountWidget()，把 React 组件挂到宿主 DOM（共享 DOM）
 *
 * mount/unmount/send/open/close/on 接口稳定。
 */

import { HostBridge } from './HostBridge';
import { attachPageObserver, highlightSelector } from './utils';
import type {
  ActionHandler,
  ActionRegistry,
  ArkclawOptions,
  BridgeFromWidget,
  EventMap,
  EventName,
  QuickAction,
  UIOptions,
} from './types';

const DEFAULT_UI: Required<Omit<UIOptions, 'quickActions' | 'title' | 'greeting'>> & {
  quickActions: QuickAction[];
  title: string;
  greeting: string;
} = {
  mode: 'side-drawer',
  width: 420,
  position: 'right',
  theme: 'auto',
  defaultOpen: false,
  zIndex: 2147483600,
  quickActions: [],
  title: 'ArkClaw 助手',
  greeting: '你好！我可以帮你完成页面操作、回答问题、总结内容。',
};

type Listener<K extends EventName> = (data: EventMap[K]) => void;

export class Arkclaw {
  private opts: ArkclawOptions;
  private ui: typeof DEFAULT_UI;
  private rootEl: HTMLElement | null = null;
  private iframe: HTMLIFrameElement | null = null;
  private fab: HTMLButtonElement | null = null;
  private bridge: HostBridge | null = null;
  private actions: ActionRegistry = {};
  private detachObserver: (() => void) | null = null;
  private listeners: { [K in EventName]?: Set<Listener<K>> } = {};
  private isOpen = false;
  private mountedInline: ReturnType<typeof import('./inline').mountInline> | null = null;
  private resolveReady: (() => void) | null = null;
  private readyPromise: Promise<void>;

  constructor(opts: ArkclawOptions) {
    this.opts = opts;
    this.ui = { ...DEFAULT_UI, ...(opts.ui || {}) };
    this.actions = { ...(opts.actions || {}) };
    this.readyPromise = new Promise((res) => (this.resolveReady = res));
  }

  /* ── public API ── */

  mount(target: HTMLElement | string = document.body): void {
    const host = typeof target === 'string' ? document.querySelector(target) : target;
    if (!host) throw new Error('[Arkclaw] mount target not found');
    if (this.rootEl) {
      this.log('warn', 'already mounted');
      return;
    }

    const root = document.createElement('div');
    root.setAttribute('data-arkclaw-widget', 'host');
    root.style.cssText = `position:fixed;${this.ui.position}:0;top:0;height:100vh;z-index:${this.ui.zIndex};pointer-events:none;`;
    (host as HTMLElement).appendChild(root);
    this.rootEl = root;

    this.mountIframe(root);
    this.mountFab();
    this.attachObservers();
    if (this.ui.defaultOpen) this.open();
    else this.updateFabVisibility();
  }

  unmount(): void {
    this.detachObserver?.();
    this.detachObserver = null;
    this.bridge?.destroy();
    this.bridge = null;
    if (this.iframe?.parentElement) this.iframe.parentElement.removeChild(this.iframe);
    if (this.fab?.parentElement) this.fab.parentElement.removeChild(this.fab);
    if (this.mountedInline) this.mountedInline.unmount();
    if (this.rootEl?.parentElement) this.rootEl.parentElement.removeChild(this.rootEl);
    this.iframe = null;
    this.fab = null;
    this.rootEl = null;
    this.mountedInline = null;
  }

  open(): void {
    this.isOpen = true;
    this.bridge?.send({ type: 'OPEN' });
    if (this.iframe) this.iframe.style.transform = 'translateX(0)';
    this.updateFabVisibility();
    this.emit('open', undefined);
    this.emit('state-change', { open: true, status: 'open' });
  }

  close(): void {
    this.isOpen = false;
    this.bridge?.send({ type: 'CLOSE' });
    if (this.iframe) {
      const off = this.ui.position === 'right' ? '100%' : '-100%';
      this.iframe.style.transform = `translateX(${off})`;
    }
    this.updateFabVisibility();
    this.emit('close', undefined);
    this.emit('state-change', { open: false, status: 'open' });
  }

  toggle(): void {
    this.isOpen ? this.close() : this.open();
  }

  private mountFab() {
    const host = this.rootEl?.parentElement || document.body;
    const fab = document.createElement('button');
    fab.setAttribute('data-arkclaw-widget', 'fab');
    fab.setAttribute('aria-label', this.ui.title || 'AI 助手');
    fab.title = this.ui.title || 'AI 助手';
    fab.innerHTML = `
      <span style="font-size:22px;line-height:1;">💬</span>
      <span style="position:absolute;right:-2px;top:-2px;width:10px;height:10px;border-radius:50%;background:#4ade80;border:2px solid white;"></span>
    `;
    const pos = this.ui.position === 'right' ? 'right:24px;' : 'left:24px;';
    fab.style.cssText = `
      position:fixed;${pos}bottom:24px;
      width:56px;height:56px;border-radius:50%;border:0;
      background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);
      color:white;cursor:pointer;
      box-shadow:0 8px 24px rgba(99,102,241,.35);
      z-index:${this.ui.zIndex};
      display:flex;align-items:center;justify-content:center;
      transition:transform .2s ease, box-shadow .2s ease;
      font-family:-apple-system,BlinkMacSystemFont,sans-serif;
    `;
    fab.addEventListener('mouseenter', () => {
      fab.style.transform = 'scale(1.08)';
      fab.style.boxShadow = '0 10px 32px rgba(99,102,241,.5)';
    });
    fab.addEventListener('mouseleave', () => {
      fab.style.transform = 'scale(1)';
      fab.style.boxShadow = '0 8px 24px rgba(99,102,241,.35)';
    });
    fab.addEventListener('click', () => this.toggle());
    host.appendChild(fab);
    this.fab = fab;
  }

  private updateFabVisibility() {
    if (!this.fab) return;
    this.fab.style.opacity = this.isOpen ? '0' : '1';
    this.fab.style.pointerEvents = this.isOpen ? 'none' : 'auto';
    this.fab.style.transform = this.isOpen ? 'scale(0.6)' : 'scale(1)';
  }

  async send(text: string, meta?: Record<string, unknown>): Promise<void> {
    await this.readyPromise;
    this.bridge?.send({ type: 'SEND', text, meta });
    if (!this.isOpen) this.open();
  }

  registerAction(name: string, handler: ActionHandler): void {
    this.actions[name] = handler;
  }

  unregisterAction(name: string): void {
    delete this.actions[name];
  }

  pushContext(opts: { trigger?: 'manual' | 'click' | 'selection'; element?: any; selection?: string; extra?: Record<string, unknown> } = {}) {
    this.bridge?.send({
      type: 'HOST_CONTEXT',
      trigger: opts.trigger || 'manual',
      element: opts.element,
      selection: opts.selection,
      extra: opts.extra,
    });
  }

  on<K extends EventName>(event: K, fn: Listener<K>): () => void {
    let bucket = this.listeners[event] as Set<Listener<K>> | undefined;
    if (!bucket) {
      bucket = new Set<Listener<K>>();
      (this.listeners as Record<string, unknown>)[event] = bucket;
    }
    bucket.add(fn);
    return () => bucket!.delete(fn);
  }

  /* ── private ── */

  private emit<K extends EventName>(event: K, data: EventMap[K]) {
    (this.listeners[event] as Set<Listener<K>> | undefined)?.forEach((fn) => {
      try { fn(data); } catch (e) { this.log('error', `listener for ${event} threw`, e); }
    });
  }

  private log(level: 'info' | 'warn' | 'error', msg: string, data?: unknown) {
    if (this.opts.onLog) this.opts.onLog(level, `[Arkclaw] ${msg}`, data);
    else console[level](`[Arkclaw]`, msg, data ?? '');
  }

  private mountIframe(root: HTMLElement) {
    const iframe = document.createElement('iframe');
    const off = this.ui.position === 'right' ? '100%' : '-100%';
    iframe.style.cssText = `
      position:absolute;${this.ui.position}:0;top:0;
      width:${this.ui.width}px;max-width:100vw;height:100vh;
      border:0;background:transparent;
      transform:translateX(${off});
      transition:transform .3s cubic-bezier(.16,1,.3,1);
      pointer-events:auto;box-shadow:0 8px 30px rgba(0,0,0,.18);
    `;
    iframe.setAttribute('allow', 'clipboard-read; clipboard-write');
    iframe.setAttribute('title', this.ui.title);

    // 内嵌 inline 模式：iframe 内部直接渲染 React 组件，并通过 postMessage 与父通信
    const inlineHTML = this.buildIframeHtml();
    iframe.srcdoc = inlineHTML;
    root.appendChild(iframe);
    this.iframe = iframe;

    this.bridge = new HostBridge();

    iframe.addEventListener('load', () => {
      if (iframe.contentWindow) this.bridge?.attach(iframe.contentWindow);
    });

    this.bridge.on((msg) => this.handleWidgetMessage(msg));
  }

  private buildIframeHtml(): string {
    // 把当前 SDK 脚本通过 location.href 推断出 widget bundle 的位置
    const script = (window as any).__ARKCLAW_BUNDLE_URL__ || autoDetectBundleUrl();
    // 关键：把宿主 localStorage 中保存的 session 注入到 iframe config，
    // 避免 srcdoc iframe origin 隔离导致 session 跨刷新丢失
    const auth = this.opts.auth;
    const persistedSession = readPersistedSession(this.opts.endpoint);
    const finalAuth = (auth.type === 'lark' && !auth.sessionToken && persistedSession)
      ? { ...auth, sessionToken: persistedSession }
      : auth;
    const cfg = JSON.stringify({
      endpoint: this.opts.endpoint,
      auth: finalAuth,
      instanceId: this.opts.instanceId,
      ui: this.ui,
      embedded: true,
    });
    return `<!DOCTYPE html><html lang="zh-CN"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${this.ui.title}</title>
<style>html,body,#root{margin:0;padding:0;height:100%;background:transparent;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}</style>
</head><body><div id="root"></div>
<script>window.__ARKCLAW_CONFIG__ = ${cfg};</script>
<script src="${script}"></script>
<script>window.Arkclaw && window.Arkclaw.mountInline && window.Arkclaw.mountInline(document.getElementById('root'), window.__ARKCLAW_CONFIG__);</script>
</body></html>`;
  }

  private attachObservers() {
    const ctxOpts = this.opts.context || {};
    if (!ctxOpts.captureClicks && !ctxOpts.captureSelection) return;

    this.detachObserver = attachPageObserver({
      captureClicks: !!ctxOpts.captureClicks,
      captureSelection: !!ctxOpts.captureSelection,
      blacklist: ctxOpts.selectorsBlacklist,
      onClickContext: (ctx) => {
        this.bridge?.send({ type: 'HOST_CONTEXT', trigger: 'click', element: ctx });
      },
      onSelection: (text, _rect, ctx) => {
        this.bridge?.send({ type: 'HOST_CONTEXT', trigger: 'selection', selection: text, element: ctx });
      },
    });
  }

  private async handleWidgetMessage(msg: BridgeFromWidget) {
    switch (msg.type) {
      case 'READY':
        this.log('info', 'widget ready');
        this.resolveReady?.();
        break;
      case 'STATE':
        this.isOpen = msg.open;
        this.emit('state-change', { open: msg.open, status: msg.status });
        break;
      case 'MESSAGE':
        this.emit('message', { role: msg.role, text: msg.text });
        break;
      case 'AI_ACTION':
        await this.runAction(msg.callId, msg.action, msg.args);
        break;
      case 'HIGHLIGHT':
        highlightSelector(msg.selector, msg.durationMs);
        this.emit('highlight', { selector: msg.selector });
        break;
      case 'NEED_AUTH':
        this.log('warn', 'widget requested auth: ' + msg.reason);
        this.emit('error', { message: 'NEED_AUTH: ' + msg.reason });
        break;
      case 'SESSION_UPDATE':
        writePersistedSession(this.opts.endpoint, msg.sessionToken);
        this.log('info', msg.sessionToken ? 'session 已保存到宿主' : 'session 已从宿主清除');
        break;
    }
  }

  private async runAction(callId: string, action: string, args: Record<string, unknown>) {
    this.emit('action', { action, args });
    const handler = this.actions[action];
    if (!handler) {
      this.bridge?.send({
        type: 'ACTION_RESULT', callId, ok: false, error: `action "${action}" not registered`,
      } as any);
      return;
    }
    try {
      const result = await handler(args, { actionName: action });
      this.bridge?.send({ type: 'ACTION_RESULT', callId, ok: true, result } as any);
    } catch (e) {
      this.bridge?.send({
        type: 'ACTION_RESULT', callId, ok: false, error: (e as Error).message,
      } as any);
    }
  }
}

function autoDetectBundleUrl(): string {
  const scripts = Array.from(document.querySelectorAll('script[src]')) as HTMLScriptElement[];
  const found = scripts.find((s) => /arkclaw-widget(\.umd|\.es)?\.js/.test(s.src));
  return found?.src || '/dist/arkclaw-widget.umd.js';
}

/* ── session 持久化（与 ApiClient 保持一致的 key） ── */
const SESSION_LS_PREFIX = 'arkclaw:session-token:';
function readPersistedSession(endpoint: string): string {
  try { return localStorage.getItem(SESSION_LS_PREFIX + endpoint.replace(/\/$/, '')) || ''; }
  catch { return ''; }
}
function writePersistedSession(endpoint: string, token: string) {
  try {
    const key = SESSION_LS_PREFIX + endpoint.replace(/\/$/, '');
    if (token) localStorage.setItem(key, token);
    else localStorage.removeItem(key);
  } catch { /* noop */ }
}
