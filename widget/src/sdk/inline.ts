/**
 * Inline 挂载：把 ChatPanel 挂到任意 DOM 节点。
 *
 * 当 widget 跑在 iframe 内（embedded: true）时直接挂到 document.body 即可（已隔离）。
 * 当宿主选 inline 模式 时，会用 Shadow DOM 包裹避免样式污染。
 */

import { createElement, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ChatPanel } from '@/components/ChatPanel';
import widgetCss from '@/styles/widget.css?inline';
import type { ArkclawOptions } from './types';

export interface MountedInline {
  unmount: () => void;
  root: Root;
}

export function mountInline(
  target: HTMLElement,
  config: ArkclawOptions & { embedded?: boolean; useShadow?: boolean }
): MountedInline {
  const useShadow = !config.embedded && config.useShadow !== false;
  let mountPoint: HTMLElement | ShadowRoot = target;

  if (useShadow && typeof target.attachShadow === 'function') {
    const shadow = target.attachShadow({ mode: 'open' });
    if (shadow) {
      const style = document.createElement('style');
      style.textContent = widgetCss;
      shadow.appendChild(style);
      const container = document.createElement('div');
      container.className = 'ac-shadow-root';
      container.style.cssText = 'all: initial; display: block; height: 100%;';
      shadow.appendChild(container);
      mountPoint = container;
    }
  } else {
    // iframe 内：直接把样式注入 head
    if (!document.getElementById('arkclaw-widget-css')) {
      const style = document.createElement('style');
      style.id = 'arkclaw-widget-css';
      style.textContent = widgetCss;
      document.head.appendChild(style);
    }
  }

  const root = createRoot(mountPoint as HTMLElement);
  root.render(
    createElement(StrictMode, null, createElement(ChatPanel, { config }))
  );

  return {
    root,
    unmount: () => {
      try { root.unmount(); } catch {/* noop */}
    },
  };
}
