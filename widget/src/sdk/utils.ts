/**
 * 工具函数：CSS selector 推断、元素信息提取等。
 */

import type { ContextElement } from './types';

/** 给元素生成相对稳定的 CSS selector（id > data-testid > tag+nth-of-type 链）。 */
export function inferSelector(el: Element, maxDepth = 5): string {
  if (!el || el === document.body) return 'body';
  if (el.id) return `#${CSS.escape(el.id)}`;
  const testId = el.getAttribute('data-testid') || el.getAttribute('data-test');
  if (testId) return `[data-testid="${testId}"]`;

  const parts: string[] = [];
  let cur: Element | null = el;
  let depth = 0;
  while (cur && cur !== document.body && depth < maxDepth) {
    const tag = cur.tagName.toLowerCase();
    const parent: Element | null = cur.parentElement;
    if (!parent) {
      parts.unshift(tag);
      break;
    }
    const tagName = cur.tagName;
    const sibs = Array.from(parent.children).filter(
      (c: Element) => c.tagName === tagName,
    );
    if (sibs.length === 1) {
      parts.unshift(tag);
    } else {
      const idx = sibs.indexOf(cur) + 1;
      parts.unshift(`${tag}:nth-of-type(${idx})`);
    }
    cur = parent;
    depth += 1;
  }
  return parts.join(' > ');
}

const TEXT_INPUTS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

export function elementToContext(el: Element): ContextElement {
  const attrs: Record<string, string> = {};
  const wantedAttrs = ['name', 'role', 'aria-label', 'placeholder', 'href', 'data-testid', 'type'];
  for (const a of wantedAttrs) {
    const v = el.getAttribute(a);
    if (v) attrs[a] = v;
  }
  const classList = (el as HTMLElement).className;
  if (typeof classList === 'string' && classList.trim()) {
    attrs['class'] = classList.trim().split(/\s+/).slice(0, 3).join(' ');
  }
  let text = '';
  let value: string | undefined;
  if (TEXT_INPUTS.has(el.tagName)) {
    value = (el as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).value;
  }
  text = (el.textContent || '').trim().slice(0, 200);

  return {
    tagName: el.tagName.toLowerCase(),
    text,
    value,
    selector: inferSelector(el),
    attrs,
    page: typeof window !== 'undefined' ? window.location.pathname : '',
  };
}

/** 监听点击与划词事件，把上下文回调出去。 */
export interface PageObserverOpts {
  captureClicks: boolean;
  captureSelection: boolean;
  blacklist?: string[];
  onClickContext?: (ctx: ContextElement) => void;
  onSelection?: (text: string, rect: DOMRect | null, ctx?: ContextElement) => void;
}

export function attachPageObserver(opts: PageObserverOpts): () => void {
  const blacklistSelector = opts.blacklist?.join(',') || '';

  const onClick = (e: MouseEvent) => {
    if (!opts.captureClicks || !opts.onClickContext) return;
    const target = e.target as Element | null;
    if (!target) return;
    if (blacklistSelector && target.closest(blacklistSelector)) return;
    if (target.closest('[data-arkclaw-widget]')) return;
    opts.onClickContext(elementToContext(target));
  };

  let lastSelection = '';
  const onSelectionChange = () => {
    if (!opts.captureSelection || !opts.onSelection) return;
    const sel = window.getSelection();
    const text = sel?.toString().trim() || '';
    if (!text || text === lastSelection) return;
    lastSelection = text;
    let rect: DOMRect | null = null;
    let ctx: ContextElement | undefined;
    try {
      const range = sel?.getRangeAt(0);
      rect = range?.getBoundingClientRect() || null;
      const node = range?.commonAncestorContainer;
      const el = node?.nodeType === 1 ? (node as Element) : node?.parentElement;
      if (el) ctx = elementToContext(el);
    } catch {
      /* ignore */
    }
    opts.onSelection(text, rect, ctx);
  };

  if (opts.captureClicks) document.addEventListener('click', onClick, true);
  if (opts.captureSelection) document.addEventListener('selectionchange', onSelectionChange);

  return () => {
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('selectionchange', onSelectionChange);
  };
}

/* ── 高亮注入 ── */

const HIGHLIGHT_STYLE_ID = 'arkclaw-highlight-style';
const HIGHLIGHT_CLASS = 'arkclaw-highlighted';

export function ensureHighlightStyle() {
  if (document.getElementById(HIGHLIGHT_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = HIGHLIGHT_STYLE_ID;
  style.textContent = `
    .${HIGHLIGHT_CLASS} {
      outline: 3px solid rgba(99, 102, 241, 0.85) !important;
      outline-offset: 2px !important;
      box-shadow: 0 0 0 6px rgba(99, 102, 241, 0.18) !important;
      transition: outline-color .25s, box-shadow .25s !important;
      animation: arkclaw-pulse 1.2s ease-in-out 2 !important;
    }
    @keyframes arkclaw-pulse {
      0%, 100% { box-shadow: 0 0 0 6px rgba(99, 102, 241, 0.18); }
      50% { box-shadow: 0 0 0 12px rgba(99, 102, 241, 0.06); }
    }
  `;
  document.head.appendChild(style);
}

export function highlightSelector(selector: string, durationMs = 2400): boolean {
  ensureHighlightStyle();
  let el: Element | null;
  try {
    el = document.querySelector(selector);
  } catch {
    return false;
  }
  if (!el) return false;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el.classList.add(HIGHLIGHT_CLASS);
  setTimeout(() => el?.classList.remove(HIGHLIGHT_CLASS), durationMs);
  return true;
}
