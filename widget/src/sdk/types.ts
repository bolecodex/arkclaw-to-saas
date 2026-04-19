/**
 * 公开 SDK 类型定义。
 */

export type AuthMode =
  | { type: 'jwt'; token: string }
  | { type: 'lark'; sessionToken?: string }
  | { type: 'session'; token: string };

export type WidgetMode = 'side-drawer' | 'floating-bubble' | 'fullscreen';
export type Position = 'left' | 'right';
export type Theme = 'light' | 'dark' | 'auto';

export interface QuickAction {
  id?: string;
  label: string;
  prompt: string;
  icon?: string;
}

export interface ContextElement {
  tagName: string;
  text?: string;
  selector?: string;
  attrs?: Record<string, string>;
  value?: string;
  page?: string;
}

export type ContextProvider = () => Record<string, unknown> | Promise<Record<string, unknown>>;

export type ActionHandler = (
  args: Record<string, unknown>,
  ctx: { actionName: string }
) => Promise<unknown> | unknown;

export interface ActionRegistry {
  [name: string]: ActionHandler;
}

export interface UIOptions {
  mode?: WidgetMode;
  width?: number;
  position?: Position;
  theme?: Theme;
  title?: string;
  greeting?: string;
  quickActions?: QuickAction[];
  defaultOpen?: boolean;
  zIndex?: number;
}

export interface ContextOptions {
  captureClicks?: boolean;
  captureSelection?: boolean;
  selectorsBlacklist?: string[];
  provider?: ContextProvider;
}

export interface ArkclawOptions {
  endpoint: string;
  auth: AuthMode;
  instanceId?: string;
  ui?: UIOptions;
  context?: ContextOptions;
  actions?: ActionRegistry;
  onLog?: (level: 'info' | 'warn' | 'error', msg: string, data?: unknown) => void;
}

/* ── postMessage protocol ── */

export type BridgeFromHost =
  | { type: 'OPEN' }
  | { type: 'CLOSE' }
  | { type: 'TOGGLE' }
  | { type: 'SEND'; text: string; meta?: Record<string, unknown> }
  | { type: 'HOST_CONTEXT'; trigger: 'click' | 'selection' | 'manual'; element?: ContextElement; selection?: string; extra?: Record<string, unknown> }
  | { type: 'ACTION_RESULT'; callId: string; ok: boolean; result?: unknown; error?: string }
  | { type: 'CONFIG_UPDATE'; ui?: UIOptions };

export type BridgeFromWidget =
  | { type: 'READY' }
  | { type: 'STATE'; open: boolean; status: ConnectionStatus }
  | { type: 'MESSAGE'; role: 'user' | 'assistant' | 'system'; text: string }
  | { type: 'AI_ACTION'; callId: string; action: string; args: Record<string, unknown> }
  | { type: 'HIGHLIGHT'; selector: string; durationMs?: number }
  | { type: 'NEED_AUTH'; reason: string }
  /** session 持久化：iframe 内拿到/清掉 session 后通知父窗口写 localStorage，
   * 因为 srcdoc iframe 的 origin 隔离，自身 localStorage 与宿主不共享 */
  | { type: 'SESSION_UPDATE'; sessionToken: string };

export type ConnectionStatus = 'idle' | 'connecting' | 'open' | 'closed' | 'error';

export type EventName =
  | 'message'
  | 'open'
  | 'close'
  | 'error'
  | 'action'
  | 'highlight'
  | 'state-change';

export interface EventMap {
  message: { role: 'user' | 'assistant' | 'system'; text: string };
  open: void;
  close: void;
  error: { message: string };
  action: { action: string; args: Record<string, unknown> };
  highlight: { selector: string };
  'state-change': { open: boolean; status: ConnectionStatus };
}
