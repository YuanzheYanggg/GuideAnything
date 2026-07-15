export interface KnowledgeHealth {
  status: 'READY' | 'DEGRADED' | 'UNAVAILABLE';
  revision: string | null;
  indexedDocuments: number;
  indexedFragments: number;
  harnessRevision: string | null;
  harnessFileCount: number;
  reasonCodes: string[];
  indexedAt: string | null;
}

export type KnowledgeCluster = 'textile-knowledge' | 'quality-ops' | 'complaint-case';

export interface KnowledgeClusterSummary {
  cluster: KnowledgeCluster;
  documentCount: number;
  supportCount: number;
  discoveryCount: number;
}

export interface KnowledgeMocSummary {
  documentId: string;
  title: string;
  summary: string;
  href: string;
}

export interface KnowledgeOverview {
  mocs: KnowledgeMocSummary[];
  clusters: KnowledgeClusterSummary[];
}

export interface KnowledgeSearchHit {
  sourceKind: 'SANTEXWELL';
  documentId: string;
  fragmentId: string;
  title: string;
  heading?: string;
  excerpt: string;
  pageType?: string;
  evidenceRole: 'SUPPORT' | 'DISCOVERY' | 'NAVIGATION';
  revision: string;
  indexedAt: string;
  rawEvidenceAvailable: boolean;
  href: string;
  score: number;
}

export interface KnowledgeDocument {
  sourceKind: 'SANTEXWELL';
  documentId: string;
  title: string;
  aliases: string[];
  tags: string[];
  pageType?: string;
  status?: string;
  reviewState?: string;
  evidenceStatus?: string;
  revision: string;
  indexedAt: string;
  rawEvidenceAvailable: boolean;
  sections: Array<{ fragmentId: string; heading?: string; content: string }>;
  resolvedLinks: Array<{ documentId: string; title: string; heading?: string }>;
  unresolvedLinkCount: number;
}

export interface KnowledgeApi {
  status: () => Promise<KnowledgeHealth>;
  overview: () => Promise<KnowledgeOverview>;
  search: (query: string) => Promise<KnowledgeSearchHit[]>;
  readDocument: (documentId: string) => Promise<KnowledgeDocument>;
}
