import type { AuthUser, Session } from '../features/auth/types';
import type { DraftItem, LibraryApi, SearchItem } from '../features/library/LibraryPage';
import type { EditorApi, GuideDraftDetail, SearchPage } from '../features/editor/GuideEditor';
import type { GuideVersionSnapshot } from '@guideanything/contracts';

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

  async mediaObjectUrl(path: string): Promise<string> {
    const headers = new Headers();
    if (this.#token) headers.set('Authorization', `Bearer ${this.#token}`);
    const response = await fetch(path, { headers });
    if (!response.ok) throw new Error('媒体载入失败');
    return URL.createObjectURL(await response.blob());
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

  editorApi(): EditorApi {
    return {
      getGuide: async (guideId) => (await this.request<{ guide: GuideDraftDetail }>(`/guides/${guideId}`)).guide,
      saveGuide: async (guideId, revision, changes) => (await this.request<{ guide: GuideDraftDetail }>(`/guides/${guideId}`, {
        method: 'PATCH',
        body: JSON.stringify({ revision, ...changes }),
      })).guide,
      publishGuide: async (guideId) => (await this.request<{ version: GuideVersionSnapshot }>(`/guides/${guideId}/publish`, { method: 'POST' })).version,
      search: async (query, offset = 0) => this.request<SearchPage>(`/search?q=${encodeURIComponent(query)}&limit=50&offset=${offset}`),
      getVersion: async (versionId) => (await this.request<{ version: GuideVersionSnapshot }>(`/versions/${versionId}`)).version,
      uploadMedia: async (file) => {
        const form = new FormData();
        form.append('file', file);
        return (await this.request<{ asset: { id: string; url: string; kind: 'IMAGE' | 'VIDEO' } }>('/media', { method: 'POST', body: form })).asset;
      },
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
