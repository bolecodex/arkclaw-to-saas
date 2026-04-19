/**
 * Zustand chat 状态。
 */

import { create } from 'zustand';
import type { ConnectionStatus, ContextElement, HostInfo } from '@/sdk/types';

export type Role = 'user' | 'assistant' | 'system' | 'error';

export interface ThinkingStep {
  id: string;
  text: string;
  ts: number;
}

export interface MediaAttachment {
  type: 'image' | 'video' | 'file';
  url?: string;
  blobUrl?: string;
  name?: string;
  path?: string;
  loading?: boolean;
  error?: string;
}

export interface Message {
  id: string;
  role: Role;
  text: string;
  streaming?: boolean;
  thinking?: ThinkingStep[];
  thinkingDone?: boolean;
  media?: MediaAttachment[];
  ts: number;
  contextChip?: ContextElement;
}

export interface ChatState {
  status: ConnectionStatus;
  open: boolean;
  messages: Message[];
  pendingContext: ContextElement | null;
  /** 宿主推送的能力清单 + 页面字段，sendUser 时拼到 system context 给 AI */
  hostInfo: HostInfo | null;

  setStatus: (status: ConnectionStatus) => void;
  setOpen: (open: boolean) => void;
  toggle: () => void;
  setHostInfo: (info: HostInfo | null) => void;

  addMessage: (msg: Message) => void;
  updateMessage: (id: string, patch: Partial<Message>) => void;
  appendStreamText: (id: string, delta: string) => void;
  finishStream: (id: string) => void;

  addThinkingStep: (msgId: string, step: ThinkingStep) => void;
  finishThinking: (msgId: string) => void;

  attachMedia: (msgId: string, media: MediaAttachment) => void;
  updateMedia: (msgId: string, idx: number, patch: Partial<MediaAttachment>) => void;

  setPendingContext: (ctx: ContextElement | null) => void;
  clear: () => void;
}

export const useChatStore = create<ChatState>((set) => ({
  status: 'idle',
  open: false,
  messages: [],
  pendingContext: null,
  hostInfo: null,

  setStatus: (status) => set({ status }),
  setOpen: (open) => set({ open }),
  toggle: () => set((s) => ({ open: !s.open })),
  setHostInfo: (info) => set({ hostInfo: info }),

  addMessage: (msg) => set((s) => ({ messages: [...s.messages, msg] })),

  updateMessage: (id, patch) =>
    set((s) => ({
      messages: s.messages.map((m) => (m.id === id ? { ...m, ...patch } : m)),
    })),

  appendStreamText: (id, delta) =>
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === id ? { ...m, text: m.text + delta, streaming: true } : m
      ),
    })),

  finishStream: (id) =>
    set((s) => ({
      messages: s.messages.map((m) => (m.id === id ? { ...m, streaming: false } : m)),
    })),

  addThinkingStep: (msgId, step) =>
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === msgId ? { ...m, thinking: [...(m.thinking || []), step] } : m
      ),
    })),

  finishThinking: (msgId) =>
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === msgId ? { ...m, thinkingDone: true } : m
      ),
    })),

  attachMedia: (msgId, media) =>
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === msgId ? { ...m, media: [...(m.media || []), media] } : m
      ),
    })),

  updateMedia: (msgId, idx, patch) =>
    set((s) => ({
      messages: s.messages.map((m) => {
        if (m.id !== msgId || !m.media) return m;
        const media = [...m.media];
        media[idx] = { ...media[idx], ...patch };
        return { ...m, media };
      }),
    })),

  setPendingContext: (ctx) => set({ pendingContext: ctx }),
  clear: () => set({ messages: [], pendingContext: null }),
}));

export const uuid = () =>
  globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
      });
