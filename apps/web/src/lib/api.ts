import type { AuthUser, Session } from '../features/auth/types';
import type { AgentApi } from '../features/agents/types';
import { decodeAgentEventStream } from '../features/agents/useAgentRunStream';
import type { ArtifactsApi } from '../features/artifacts/types';
import type { DraftItem, LibraryApi, SearchItem } from '../features/library/LibraryPage';
import type { EditorApi, GuideDraftDetail, SearchPage } from '../features/editor/GuideEditor';
import type { EditorialApi } from '../features/editorial/types';
import type { KnowledgeApi, KnowledgeDocument, KnowledgeHealth, KnowledgeOverview, KnowledgeSearchHit } from '../features/knowledge/types';
import type { SourcesApi, WorkspaceSource, WorkspaceSourcesResult, FlowSnapshotSummary } from '../features/sources/types';
import type { GuideReferenceUpdate, GuideVersionSnapshot } from '@guideanything/contracts';
import type {
  CreateWorkspaceInput,
  PersonalApi,
  WorkspaceApi,
  WorkspaceActivity,
  WorkspaceFolder,
  WorkspaceItemKind,
  WorkspaceItemSummary,
  WorkspaceResourceMount,
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
      search: async (query, offset = 0, consumerWorkspaceId) => this.request<SearchPage>(`/search?q=${encodeURIComponent(query)}&limit=50&offset=${offset}${consumerWorkspaceId ? `&consumerWorkspaceId=${encodeURIComponent(consumerWorkspaceId)}` : ''}`),
      referenceUpdates: async (guideId) => (await this.request<{ items: GuideReferenceUpdate[] }>(`/guides/${guideId}/reference-updates`)).items,
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
      listFolders: async (id) => (await this.request<{ items: WorkspaceFolder[] }>(
        `/workspaces/${encodeURIComponent(id)}/folders`,
      )).items,
      createFolder: async (id, input) => (await this.request<{ folder: WorkspaceFolder }>(
        `/workspaces/${encodeURIComponent(id)}/folders`, { method: 'POST', body: JSON.stringify(input) },
      )).folder,
      renameFolder: async (id, folderId, name) => (await this.request<{ folder: WorkspaceFolder }>(
        `/workspaces/${encodeURIComponent(id)}/folders/${encodeURIComponent(folderId)}`,
        { method: 'PATCH', body: JSON.stringify({ name }) },
      )).folder,
      deleteFolder: async (id, folderId) => {
        await this.request<void>(
          `/workspaces/${encodeURIComponent(id)}/folders/${encodeURIComponent(folderId)}`,
          { method: 'DELETE' },
        );
      },
      moveItemToFolder: async (id, itemId, folderId) => (await this.request<{ item: WorkspaceItemSummary }>(
        `/workspaces/${encodeURIComponent(id)}/items/${encodeURIComponent(itemId)}/folder`,
        { method: 'PATCH', body: JSON.stringify({ folderId }) },
      )).item,
      listResourceMounts: async (id) => (await this.request<{ items: WorkspaceResourceMount[] }>(
        `/workspaces/${encodeURIComponent(id)}/resource-mounts`,
      )).items,
      createResourceMount: async (id, providerWorkspaceId) => (await this.request<{ mount: WorkspaceResourceMount }>(
        `/workspaces/${encodeURIComponent(id)}/resource-mounts`,
        { method: 'POST', body: JSON.stringify({ providerWorkspaceId }) },
      )).mount,
      deleteResourceMount: async (id, mountId) => {
        await this.request<void>(
          `/workspaces/${encodeURIComponent(id)}/resource-mounts/${encodeURIComponent(mountId)}`,
          { method: 'DELETE' },
        );
      },
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
      upload: async (workspaceId, file, folderId) => {
        const form = new FormData();
        if (folderId) form.append('folderId', folderId);
        form.append('file', file);
        return (await this.request<{ source: WorkspaceSource }>(
          `/workspaces/${encodeURIComponent(workspaceId)}/sources`,
          { method: 'POST', body: form },
        )).source;
      },
    };
  }

  editorialApi(): EditorialApi {
    return {
      listQuestionClusters: async (workspaceId) => (await this.request<{ items: Awaited<ReturnType<EditorialApi['listQuestionClusters']>> }>(
        `/workspaces/${encodeURIComponent(workspaceId)}/editorial/question-clusters`,
      )).items,
      listOwnerQuestionExamples: async (workspaceId, clusterId) => (await this.request<{ items: Awaited<ReturnType<EditorialApi['listOwnerQuestionExamples']>> }>(
        `/workspaces/${encodeURIComponent(workspaceId)}/editorial/question-clusters/${encodeURIComponent(clusterId)}/examples`,
      )).items,
      listCards: async (workspaceId) => (await this.request<{ items: Awaited<ReturnType<EditorialApi['listCards']>> }>(
        `/workspaces/${encodeURIComponent(workspaceId)}/editorial/cards`,
      )).items,
      createCard: async (workspaceId, input) => (await this.request<{ card: Awaited<ReturnType<EditorialApi['createCard']>> }>(
        `/workspaces/${encodeURIComponent(workspaceId)}/editorial/cards`,
        { method: 'POST', body: JSON.stringify(input) },
      )).card,
      transitionCard: async (workspaceId, cardId, status) => (await this.request<{ card: Awaited<ReturnType<EditorialApi['transitionCard']>> }>(
        `/workspaces/${encodeURIComponent(workspaceId)}/editorial/cards/${encodeURIComponent(cardId)}/status`,
        { method: 'PATCH', body: JSON.stringify({ status }) },
      )).card,
      listProposals: async (workspaceId) => (await this.request<{ items: Awaited<ReturnType<EditorialApi['listProposals']>> }>(
        `/workspaces/${encodeURIComponent(workspaceId)}/editorial/proposals`,
      )).items,
      transitionProposal: async (workspaceId, proposalId, status) => (await this.request<{ proposal: Awaited<ReturnType<EditorialApi['transitionProposal']>> }>(
        `/workspaces/${encodeURIComponent(workspaceId)}/editorial/proposals/${encodeURIComponent(proposalId)}/status`,
        { method: 'PATCH', body: JSON.stringify({ status }) },
      )).proposal,
      applyProposal: (workspaceId, proposalId) => this.request(
        `/workspaces/${encodeURIComponent(workspaceId)}/editorial/proposals/${encodeURIComponent(proposalId)}/apply`,
        { method: 'POST' },
      ),
    };
  }

  agentApi(): AgentApi {
    return {
      listGlobal: async () => (await this.request<{ items: Awaited<ReturnType<AgentApi['listGlobal']>> }>(
        '/knowledge/santexwell/conversations',
      )).items,
      createGlobal: async (title) => (await this.request<{ conversation: Awaited<ReturnType<AgentApi['createGlobal']>> }>(
        '/knowledge/santexwell/conversations',
        { method: 'POST', body: JSON.stringify(title ? { title } : {}) },
      )).conversation,
      getGlobal: (conversationId) => this.request(
        `/knowledge/santexwell/conversations/${encodeURIComponent(conversationId)}`,
      ),
      sendGlobal: (conversationId, message) => this.request(
        `/knowledge/santexwell/conversations/${encodeURIComponent(conversationId)}/messages`,
        { method: 'POST', body: JSON.stringify(message) },
      ),
      listWorkspace: async (workspaceId) => (await this.request<{ items: Awaited<ReturnType<AgentApi['listWorkspace']>> }>(
        `/workspaces/${encodeURIComponent(workspaceId)}/conversations`,
      )).items,
      createWorkspace: async (workspaceId, title) => (await this.request<{ conversation: Awaited<ReturnType<AgentApi['createWorkspace']>> }>(
        `/workspaces/${encodeURIComponent(workspaceId)}/conversations`,
        { method: 'POST', body: JSON.stringify(title ? { title } : {}) },
      )).conversation,
      getWorkspace: (workspaceId, conversationId) => this.request(
        `/workspaces/${encodeURIComponent(workspaceId)}/conversations/${encodeURIComponent(conversationId)}`,
      ),
      sendWorkspace: (workspaceId, conversationId, message) => this.request(
        `/workspaces/${encodeURIComponent(workspaceId)}/conversations/${encodeURIComponent(conversationId)}/messages`,
        { method: 'POST', body: JSON.stringify(message) },
      ),
      uploadAttachment: async (workspaceId, conversationId, file) => {
        const body = new FormData();
        body.append('file', file);
        return (await this.request<{ attachment: Awaited<ReturnType<AgentApi['uploadAttachment']>> }>(
          `/workspaces/${encodeURIComponent(workspaceId)}/conversations/${encodeURIComponent(conversationId)}/attachments`,
          { method: 'POST', body },
        )).attachment;
      },
      getRun: async (runId) => (await this.request<{ run: Awaited<ReturnType<AgentApi['getRun']>> }>(
        `/agent-runs/${encodeURIComponent(runId)}`,
      )).run,
      streamRun: (eventsPath, options) => this.#streamAgentRun(eventsPath, options),
      cancelRun: async (runId, reason) => (await this.request<{ run: Awaited<ReturnType<AgentApi['cancelRun']>> }>(
        `/agent-runs/${encodeURIComponent(runId)}/cancel`,
        { method: 'POST', body: JSON.stringify(reason ? { reason } : {}) },
      )).run,
      steerRun: async (runId, request) => (await this.request<{ run: Awaited<ReturnType<AgentApi['steerRun']>> }>(
        `/agent-runs/${encodeURIComponent(runId)}/steer`,
        { method: 'POST', body: JSON.stringify(request) },
      )).run,
    };
  }

  artifactsApi(): ArtifactsApi {
    return {
      listWorkspace: async (workspaceId) => (await this.request<{ items: Awaited<ReturnType<ArtifactsApi['listWorkspace']>> }>(
        `/workspaces/${encodeURIComponent(workspaceId)}/artifacts`,
      )).items,
      listWorkspaceConversations: async (workspaceId) => (await this.request<{ items: Awaited<ReturnType<ArtifactsApi['listWorkspaceConversations']>> }>(
        `/workspaces/${encodeURIComponent(workspaceId)}/conversations`,
      )).items,
      resolveReference: (referenceId) => this.request(`/references/${encodeURIComponent(referenceId)}`),
    };
  }

  async *#streamAgentRun(
    eventsPath: string,
    options: { afterSequence?: number; signal: AbortSignal },
  ) {
    if (!/^\/agent-runs\/[^/]+\/events$/u.test(eventsPath) || eventsPath.includes('..')) {
      throw new Error('事件流地址无效');
    }
    let afterSequence = options.afterSequence ?? 0;
    let retry = 0;
    while (!options.signal.aborted) {
      const headers = new Headers({ Accept: 'text/event-stream' });
      if (this.#token) headers.set('Authorization', `Bearer ${this.#token}`);
      if (afterSequence > 0) headers.set('Last-Event-ID', String(afterSequence));
      let response: Response;
      try {
        response = await fetch(`/api${eventsPath}`, { headers, signal: options.signal });
      } catch (reason) {
        if (options.signal.aborted) return;
        if (retry >= 2) throw reason;
        await waitForStreamRetry(150 * (2 ** retry), options.signal);
        retry += 1;
        continue;
      }
      if (!response.ok || !response.body) {
        if (response.status === 401) this.logout();
        const payload = await response.json().catch(() => ({})) as { message?: string };
        throw new Error(payload.message ?? `事件流连接失败（${response.status}）`);
      }
      let terminal = false;
      for await (const event of decodeAgentEventStream(response.body, options.signal)) {
        if (event.sequence <= afterSequence) continue;
        afterSequence = event.sequence;
        terminal = event.type === 'run.completed' || event.type === 'run.failed' || event.type === 'run.cancelled';
        yield event;
        if (terminal) return;
      }
      if (options.signal.aborted || terminal) return;
      if (retry >= 2) throw new Error('事件流意外断开，请刷新后继续');
      await waitForStreamRetry(150 * (2 ** retry), options.signal);
      retry += 1;
    }
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

async function waitForStreamRetry(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return;
  await new Promise<void>((resolve) => {
    const timer = window.setTimeout(done, milliseconds);
    signal.addEventListener('abort', done, { once: true });
    function done() {
      window.clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    }
  });
}
