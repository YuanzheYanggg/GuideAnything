import type { AuthUser, Session } from '../features/auth/types';
import type { DraftItem, LibraryApi, SearchItem } from '../features/library/LibraryPage';

const tokenKey = 'guideanything-token';

export class ApiClient {
  #token = localStorage.getItem(tokenKey);

  get hasToken(): boolean { return Boolean(this.#token); }

  async login(credentials: { email: string; password: string }): Promise<Session> {
    const session = await this.request<Session>('/auth/login', { method: 'POST', body: JSON.stringify(credentials) }, false);
    this.#token = session.token;
    localStorage.setItem(tokenKey, session.token);
    return session;
  }

  async me(): Promise<AuthUser> {
    return (await this.request<{ user: AuthUser }>('/auth/me')).user;
  }

  logout(): void {
    this.#token = null;
    localStorage.removeItem(tokenKey);
  }

  libraryApi(): LibraryApi {
    return {
      listDrafts: async () => (await this.request<{ items: DraftItem[] }>('/guides')).items,
      search: async (query: string) => (await this.request<{ items: SearchItem[] }>(`/search?q=${encodeURIComponent(query)}`)).items,
      createGuide: async () => (await this.request<{ guide: { id: string } }>('/guides', {
        method: 'POST',
        body: JSON.stringify({ title: '未命名 ERP 教学指南', summary: '', tags: ['ERP'] }),
      })).guide,
    };
  }

  async request<T>(path: string, init: RequestInit = {}, authenticated = true): Promise<T> {
    const headers = new Headers(init.headers);
    if (init.body && !(init.body instanceof FormData)) headers.set('Content-Type', 'application/json');
    if (authenticated && this.#token) headers.set('Authorization', `Bearer ${this.#token}`);
    const response = await fetch(`/api${path}`, { ...init, headers });
    const payload = await response.json().catch(() => ({})) as { message?: string } & T;
    if (!response.ok) {
      if (response.status === 401 && authenticated) this.logout();
      throw new Error(payload.message ?? `请求失败（${response.status}）`);
    }
    return payload;
  }
}

export const apiClient = new ApiClient();

