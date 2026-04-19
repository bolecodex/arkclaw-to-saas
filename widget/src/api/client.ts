/**
 * 后端 API 客户端。
 */

import type { AuthMode } from '@/sdk/types';

export interface ChatTokenResponse {
  chat_token: string;
  endpoint: string;
  instance_id: string;
  ws_url: string;
}

export interface InstanceInfo {
  instance_id: string;
  name: string;
  status: string;
  spec: string;
}

export interface ApiClientOptions {
  endpoint: string;
  auth: AuthMode;
}

export class ApiError extends Error {
  status: number;
  detail: unknown;
  constructor(status: number, message: string, detail?: unknown) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

export class ApiClient {
  private endpoint: string;
  private auth: AuthMode;
  private sessionToken: string = '';

  constructor(opts: ApiClientOptions) {
    this.endpoint = opts.endpoint.replace(/\/$/, '');
    this.auth = opts.auth;
    if (opts.auth.type === 'session') {
      this.sessionToken = opts.auth.token;
    } else if (opts.auth.type === 'lark' && opts.auth.sessionToken) {
      this.sessionToken = opts.auth.sessionToken;
    }
  }

  setSessionToken(token: string) {
    this.sessionToken = token;
  }

  private headers(): HeadersInit {
    const h: HeadersInit = { 'Content-Type': 'application/json' };
    if (this.sessionToken) {
      (h as Record<string, string>)['Authorization'] = `Bearer ${this.sessionToken}`;
    }
    return h;
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(this.endpoint + path, {
      ...init,
      headers: { ...this.headers(), ...(init?.headers || {}) },
    });
    if (!res.ok) {
      let detail: unknown;
      try {
        detail = await res.json();
      } catch {
        detail = await res.text();
      }
      const msg = typeof detail === 'object' && detail && 'detail' in (detail as Record<string, unknown>)
        ? String((detail as Record<string, unknown>).detail)
        : `HTTP ${res.status}`;
      throw new ApiError(res.status, msg, detail);
    }
    return res.json() as Promise<T>;
  }

  /** 用 SaaS JWT 换取自家 session token */
  async exchangeSaasJwt(saasToken: string): Promise<{ session_token: string; user_name: string }> {
    const data = await this.request<{
      session_token: string;
      user_name: string;
      user_id: string;
      expires_in: number;
    }>('/auth/saas/verify', {
      method: 'POST',
      body: JSON.stringify({ saas_token: saasToken }),
    });
    this.sessionToken = data.session_token;
    return data;
  }

  async ensureSession(): Promise<void> {
    if (this.sessionToken) return;
    if (this.auth.type === 'jwt') {
      await this.exchangeSaasJwt(this.auth.token);
      return;
    }
    if (this.auth.type === 'lark') {
      throw new ApiError(401, 'NEED_LARK_LOGIN: redirect user to /auth/lark/login');
    }
    throw new ApiError(401, 'no auth credential');
  }

  /**
   * 构造飞书登录 URL。默认是弹窗模式（returnTo='popup'），回调页会通过
   * postMessage 把 session_token 发回 opener；如果传具体 URL，则按整页跳转模式回退。
   */
  buildLarkLoginUrl(returnTo: string = 'popup'): string {
    const params = new URLSearchParams({ redirect_to: returnTo });
    return `${this.endpoint}/auth/lark/login?${params.toString()}`;
  }

  async fetchChatToken(instanceId?: string): Promise<ChatTokenResponse> {
    await this.ensureSession();
    return this.request<ChatTokenResponse>('/api/chat/token', {
      method: 'POST',
      body: JSON.stringify({ instance_id: instanceId || null }),
    });
  }

  /** 列出当前 SpaceId 下所有实例。ArkClaw OpenAPI 规模一般在十几到几十之间，无需分页。 */
  async listInstances(): Promise<InstanceInfo[]> {
    await this.ensureSession();
    return this.request<InstanceInfo[]>('/api/instances', { method: 'GET' });
  }
}
