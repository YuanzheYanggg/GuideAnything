import type { AuthUser, Session } from '../features/auth/types';
import type { DraftItem, LibraryApi, SearchItem } from '../features/library/LibraryPage';
import type { EditorApi, GuideDraftDetail, SearchPage } from '../features/editor/GuideEditor';
import type { KnowledgeApi, KnowledgeDocument, KnowledgeHealth, KnowledgeOverview, KnowledgeSearchHit } from '../features/knowledge/types';
import type { SourcesApi, WorkspaceSource, WorkspaceSourcesResult, FlowSnapshotSummary } from '../features/sources/types';
import type { GuideVersionSnapshot } from '@guideanything/contracts';
import type {
  CreateWorkspaceInput,
  PersonalApi,
  WorkspaceApi,
  WorkspaceActivity,
  WorkspaceItemKind,
  WorkspaceItemSummary,
  WorkspaceSummary,
} from '../features/workspace/types';

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
      listDrafts: async (workspaceId) => (await this.request<{ items: DraftItem[] }>(`/guides${workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : ''}`)).items,
      search: async (query: string, workspaceId) => (await this.request<{ items: SearchItem[] }>(`/search?q=${encodeURIComponent(query)}${workspaceId ? `&workspaceId=${encodeURIComponent(workspaceId)}` : ''}`)).items,
      createGuide: async (workspaceId) => (await this.request<{ guide: { id: string } }>('/guides', {
        method: 'POST',
        body: JSON.stringify({ workspaceId, title: '未命名 ERP 教学指南', summary: '', tags: ['ERP'] }),
      })).guide,
      listEditableWorkspaces: async () => (await this.request<{ items: WorkspaceSummary[] }>('/workspaces')).items
        .filter((workspace) => workspace.permission === 'OWNER' || workspace.permission === 'EDIT'),
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

  workspaceApi(): WorkspaceApi {
    return {
      list: async () => (await this.request<{ items: WorkspaceSummary[] }>('/workspaces')).items,
      create: async (input: CreateWorkspaceInput) => (await this.request<{ workspace: WorkspaceSummary }>('/workspaces', {
        method: 'POST',
        body: JSON.stringify(input),
      })).workspace,
      get: (id) => this.request<{
        workspace: WorkspaceSummary;
        counts: Record<WorkspaceItemKind, number>;
      }>(`/workspaces/${id}`),
      listItems: async (id, kind) => (await this.request<{ items: WorkspaceItemSummary[] }>(
        `/workspaces/${id}/items${kind ? `?kind=${kind}` : ''}`,
      )).items,
      activity: async (id) => (await this.request<{ items: WorkspaceActivity[] }>(
        `/workspaces/${id}/activity`,
      )).items,
    };
  }

  personalApi(): PersonalApi {
    return {
      listFavorites: async () => (await this.request<{ items: WorkspaceItemSummary[] }>('/me/favorites')).items,
      listRecent: async () => (await this.request<{ items: WorkspaceItemSummary[] }>('/me/recent')).items,
      listShared: async () => (await this.request<{ items: WorkspaceItemSummary[] }>('/me/shared')).items,
      listTrash: async () => (await this.request<{ items: WorkspaceItemSummary[] }>('/me/trash')).items,
      favorite: async (itemId) => (await this.request<{ item: WorkspaceItemSummary }>(
        `/me/favorites/${itemId}`, { method: 'PUT' },
      )).item,
      unfavorite: async (itemId) => (await this.request<{ item: WorkspaceItemSummary }>(
        `/me/favorites/${itemId}`, { method: 'DELETE' },
      )).item,
      recordRecent: async (itemId, context) => (await this.request<{ item: WorkspaceItemSummary }>(
        `/me/recent/${itemId}`, { method: 'PUT', body: JSON.stringify({ context }) },
      )).item,
      trashItem: async (itemId) => (await this.request<{ item: WorkspaceItemSummary }>(
        `/workspace-items/${itemId}/trash`, { method: 'POST' },
      )).item,
      restoreItem: async (itemId) => (await this.request<{ item: WorkspaceItemSummary }>(
        `/workspace-items/${itemId}/restore`, { method: 'POST' },
      )).item,
      permanentlyRemoveItem: async (itemId) => {
        await this.request<void>(`/workspace-items/${itemId}`, { method: 'DELETE' });
      },
    };
  }

  knowledgeApi(): KnowledgeApi {
    return {
      status: async () => (await this.request<{ status: KnowledgeHealth }>('/knowledge/santexwell/status')).status,
      overview: () => this.request<KnowledgeOverview>('/knowledge/santexwell/overview'),
      search: async (query) => (await this.request<{ items: KnowledgeSearchHit[] }>(
        `/knowledge/santexwell/search?q=${encodeURIComponent(query)}`,
      )).items,
      readDocument: async (documentId) => (await this.request<{ document: KnowledgeDocument }>(
        `/knowledge/santexwell/documents/${encodeURIComponent(documentId)}`,
      )).document,
    };
  }

  sourcesApi(): SourcesApi {
    return {
      list: (workspaceId) => this.request<WorkspaceSourcesResult>(
        `/workspaces/${encodeURIComponent(workspaceId)}/sources`,
      ),
      listFlowSnapshots: async (workspaceId) => (await this.request<{ items: FlowSnapshotSummary[] }>(
        `/workspaces/${encodeURIComponent(workspaceId)}/flow-snapshots`,
      )).items,
      santexwellStatus: async () => (await this.request<{ status: KnowledgeHealth }>(
        '/knowledge/santexwell/status',
      )).status,
      upload: async (workspaceId, file) => {
        const form = new FormData();
        form.append('file', file);
        return (await this.request<{ source: WorkspaceSource }>(
          `/workspaces/${encodeURIComponent(workspaceId)}/sources`,
          { method: 'POST', body: form },
        )).source;
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
