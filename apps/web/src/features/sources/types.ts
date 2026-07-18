import type { KnowledgeHealth } from '../knowledge/types';

export interface WorkspaceSource {
  sourceId: string;
  documentId: string;
  title: string;
  originalName: string;
  mimeType: string;
  size: number;
  status: 'PENDING' | 'INDEXING' | 'READY' | 'FAILED';
  parseStatus: 'PENDING' | 'READY' | 'FAILED';
  revision: string;
  failureCode?: string;
  failureMessage?: string;
  folderId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FlowSnapshotSummary {
  snapshotId: string;
  sourceId: string;
  documentId: string;
  guideId: string;
  guideTitle: string;
  origin: { kind: 'DRAFT'; revision: number } | { kind: 'PUBLISHED'; versionId: string; version: number };
  nodeCount: number;
  status: 'READY' | 'FAILED' | 'STALE';
  href: string | null;
  invalidReason?: string;
  createdAt: string;
}

export interface WorkspaceSourcesResult {
  workspaceId: string;
  workspacePermission: 'OWNER' | 'EDIT' | 'VIEW';
  capabilities: { canUploadPersistentSource: boolean };
  items: WorkspaceSource[];
}

export interface SourcesApi {
  list: (workspaceId: string) => Promise<WorkspaceSourcesResult>;
  listFlowSnapshots: (workspaceId: string) => Promise<FlowSnapshotSummary[]>;
  santexwellStatus: () => Promise<KnowledgeHealth>;
  upload: (workspaceId: string, file: File, folderId?: string) => Promise<WorkspaceSource>;
}
