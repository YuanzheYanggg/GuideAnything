import { useEffect, useState, type FormEvent } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Books,
  ChatCircleDots,
  CheckCircle,
  MagnifyingGlass,
  Path,
  ShieldCheck,
  Sparkle,
  WarningCircle,
} from '@phosphor-icons/react';
import { Link, useParams, useSearchParams } from 'react-router-dom';

import { SanitizedMarkdown } from '../markdown/SanitizedMarkdown';
import type {
  KnowledgeApi,
  KnowledgeCluster,
  KnowledgeDocument,
  KnowledgeHealth,
  KnowledgeOverview,
  KnowledgeSearchHit,
} from './types';

const clusterCopy: Record<KnowledgeCluster, { title: string; eyebrow: string; description: string }> = {
  'textile-knowledge': { title: '纺织知识', eyebrow: 'TEXTILE', description: '纱线、织片、工艺与产品工程知识。' },
  'quality-ops': { title: '质量与运营', eyebrow: 'QUALITY OPS', description: '验货标准、质量程序与风险控制。' },
  'complaint-case': { title: '投诉案例', eyebrow: 'CASEBOOK', description: '可追溯的异常、投诉与处置经验。' },
};

export function SantexwellKnowledgePage({ api }: { api: KnowledgeApi }) {
  const { documentId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const [health, setHealth] = useState<KnowledgeHealth | null>(null);
  const [overview, setOverview] = useState<KnowledgeOverview | null>(null);
  const [document, setDocument] = useState<KnowledgeDocument | null>(null);
  const [query, setQuery] = useState(searchParams.get('q') ?? '');
  const [results, setResults] = useState<KnowledgeSearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    const load = documentId
      ? Promise.all([api.status(), api.readDocument(documentId)]).then(([nextHealth, nextDocument]) => {
        if (active) {
          setHealth(nextHealth);
          setDocument(nextDocument);
        }
      })
      : Promise.all([api.status(), api.overview()]).then(([nextHealth, nextOverview]) => {
        if (active) {
          setHealth(nextHealth);
          setOverview(nextOverview);
          setDocument(null);
        }
      });
    load.catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : '知识库载入失败');
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [api, documentId]);

  useEffect(() => {
    if (documentId) return;
    const initialQuery = searchParams.get('q')?.trim();
    if (!initialQuery) return;
    let active = true;
    setSearching(true);
    api.search(initialQuery).then((items) => {
      if (active) setResults(items);
    }).catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : '搜索失败');
    }).finally(() => {
      if (active) setSearching(false);
    });
    return () => { active = false; };
  }, [api, documentId, searchParams]);

  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    const normalized = query.trim();
    if (!normalized || health?.status === 'UNAVAILABLE') return;
    setSearchParams({ q: normalized });
  };

  if (loading) return <div className="workspace-loading" role="status"><span className="spinner" /><span>正在连接知识索引…</span></div>;
  if (error) return <section className="page-stack"><p className="workspace-error" role="alert">{error}</p></section>;
  if (!health) return null;

  if (document) {
    return <KnowledgeReader document={document} fragmentId={searchParams.get('fragment')} />;
  }

  const unavailable = health.status === 'UNAVAILABLE';
  return <section className="knowledge-portal page-stack">
    <header className="knowledge-hero">
      <div className="knowledge-hero-copy">
        <span className="page-kicker">SANTEXWELL KNOWLEDGE GRAPH</span>
        <h1>Santexwell 知识库</h1>
        <p>从流程地图进入经过整理的纺织知识、质量程序与真实案例。所有内容只读，答案会保留可验证的证据入口。</p>
      </div>
      <KnowledgeHealthCard health={health} />
      <form className="knowledge-search" role="search" onSubmit={submitSearch}>
        <MagnifyingGlass size={21} aria-hidden="true" />
        <input
          type="search"
          aria-label="搜索知识库"
          placeholder="搜索概念、工艺、质量程序或案例…"
          value={query}
          disabled={unavailable}
          onChange={(event) => setQuery(event.target.value)}
        />
        <button type="submit" disabled={unavailable || !query.trim()}>搜索</button>
      </form>
    </header>

    {unavailable ? <div className="knowledge-status-banner is-unavailable" role="alert">
      <WarningCircle size={22} /><div><strong>知识库当前不可用</strong><span>服务器尚未完成可用索引；网页不会使用旧路径或伪造搜索结果。</span></div>
    </div> : health.status === 'DEGRADED' ? <div className="knowledge-status-banner" role="status">
      <WarningCircle size={22} /><div><strong>正在使用最近一次可用索引</strong><span>后台更新未完成，引用打开时仍会重新验证。</span></div>
    </div> : null}

    {searchParams.get('q') ? <SearchResults query={searchParams.get('q')!} items={results} searching={searching} /> : <>
      <section aria-labelledby="knowledge-clusters-heading">
        <div className="section-title"><div><span className="page-kicker">KNOWLEDGE CLUSTERS</span><h2 id="knowledge-clusters-heading">知识集群</h2></div></div>
        <div className="knowledge-cluster-grid">
          {(overview?.clusters ?? []).map((cluster) => <ClusterCard key={cluster.cluster} cluster={cluster} />)}
        </div>
      </section>

      <div className="knowledge-home-grid">
        <section className="knowledge-map-panel" aria-labelledby="knowledge-map-heading">
          <div className="section-title"><div><span className="page-kicker">MAPS OF CONTENT</span><h2 id="knowledge-map-heading">从地图开始</h2></div></div>
          <div className="knowledge-moc-list">
            {(overview?.mocs ?? []).map((moc) => <Link className="knowledge-moc-card" to={moc.href} key={moc.documentId}>
              <span className="knowledge-moc-icon"><Path size={22} /></span>
              <div><strong>{moc.title}</strong><span>{moc.summary || '打开这张知识地图继续探索。'}</span></div>
              <ArrowRight size={18} />
            </Link>)}
            {overview?.mocs.length === 0 ? <div className="workspace-empty compact"><strong>还没有可用知识地图</strong><span>索引完成后会显示在这里。</span></div> : null}
          </div>
        </section>

        <aside className="knowledge-qa-card">
          <span className="knowledge-qa-icon"><ChatCircleDots size={24} /></span>
          <span className="page-kicker">READ-ONLY QA</span>
          <h2>带着问题进入知识库</h2>
          <p>Agent 会先判断问题范围。聚焦问题只读取最相关页面；复杂问题才拆分任务并汇总。</p>
          <Link to="/knowledge/santexwell?conversation=new">开始新的问答 <ArrowRight size={17} /></Link>
          <small><ShieldCheck size={15} /> 只读访问 · 证据可定位 · 不写回 Vault</small>
        </aside>
      </div>
    </>}
  </section>;
}

function KnowledgeHealthCard({ health }: { health: KnowledgeHealth }) {
  const statusLabel = health.status === 'READY' ? '索引已就绪' : health.status === 'DEGRADED' ? '索引需更新' : '索引不可用';
  return <dl className="knowledge-health-card">
    <div className="knowledge-health-state"><dt>状态</dt><dd><span className={`knowledge-health-dot is-${health.status.toLowerCase()}`} />{statusLabel}</dd></div>
    <div><dt>页面</dt><dd>{health.indexedDocuments.toLocaleString('zh-CN')}</dd></div>
    <div><dt>证据片段</dt><dd>{health.indexedFragments.toLocaleString('zh-CN')}</dd></div>
    <div><dt>最近索引</dt><dd>{formatDateTime(health.indexedAt)}</dd></div>
  </dl>;
}

function ClusterCard({ cluster }: { cluster: KnowledgeOverview['clusters'][number] }) {
  const copy = clusterCopy[cluster.cluster];
  return <article className={`knowledge-cluster-card cluster-${cluster.cluster}`}>
    <div><span className="page-kicker">{copy.eyebrow}</span><span className="knowledge-cluster-icon"><Books size={21} /></span></div>
    <h3>{copy.title}</h3>
    <p>{copy.description}</p>
    <dl><div><dt>页面</dt><dd>{cluster.documentCount}</dd></div><div><dt>可引用</dt><dd>{cluster.supportCount}</dd></div></dl>
  </article>;
}

function SearchResults({ query, items, searching }: { query: string; items: KnowledgeSearchHit[]; searching: boolean }) {
  return <section className="knowledge-results" aria-labelledby="knowledge-results-heading">
    <div className="section-title"><div><span className="page-kicker">SEARCH RESULTS</span><h2 id="knowledge-results-heading">“{query}”的结果</h2></div><Link className="text-link" to="/knowledge/santexwell">返回知识首页</Link></div>
    {searching ? <div className="workspace-loading"><span className="spinner" /><span>正在定位相关知识…</span></div> : items.length === 0 ? <div className="workspace-empty"><strong>没有找到可验证内容</strong><span>尝试使用更具体的术语或流程节点名称。</span></div> : <div className="knowledge-result-list">
      {items.map((item) => <Link key={item.fragmentId} className="knowledge-result-card" to={item.href}>
        <div><span className={`knowledge-evidence-pill is-${item.evidenceRole.toLowerCase()}`}>{evidenceLabel(item.evidenceRole)}</span><span>{item.pageType ?? 'page'}</span></div>
        <h3>{item.title}{item.heading ? <small> / {item.heading}</small> : null}</h3>
        <p>{item.excerpt}</p>
        <span className="knowledge-open-label">打开证据 <ArrowRight size={16} /></span>
      </Link>)}
    </div>}
  </section>;
}

function KnowledgeReader({ document, fragmentId }: { document: KnowledgeDocument; fragmentId: string | null }) {
  return <article className="knowledge-reader page-stack">
    <header className="knowledge-reader-header">
      <Link className="knowledge-back-link" to="/knowledge/santexwell"><ArrowLeft size={17} /> 返回知识库</Link>
      <div><span className="page-kicker">{document.pageType ?? 'KNOWLEDGE PAGE'}</span><h1>{document.title}</h1></div>
      <div className="knowledge-reader-meta"><span><CheckCircle size={16} /> 只读页面</span><span>索引于 {formatDateTime(document.indexedAt)}</span></div>
      {document.aliases.length > 0 ? <p className="knowledge-aliases">别名：{document.aliases.join(' · ')}</p> : null}
    </header>
    <div className="knowledge-reader-layout">
      <div className="knowledge-reader-body">
        {document.sections.map((section) => <section
          key={section.fragmentId}
          id={`fragment-${section.fragmentId}`}
          className={section.fragmentId === fragmentId ? 'is-target-fragment' : undefined}
        >
          {section.heading ? <h2>{section.heading}</h2> : null}
          <SanitizedMarkdown>{section.content}</SanitizedMarkdown>
        </section>)}
      </div>
      <aside className="knowledge-reader-aside">
        <span className="page-kicker">RELATED</span><h2>相关页面</h2>
        {document.resolvedLinks.length === 0 ? <p>暂无已解析链接。</p> : document.resolvedLinks.map((link) => <Link key={`${link.documentId}:${link.heading ?? ''}`} to={`/knowledge/santexwell/documents/${encodeURIComponent(link.documentId)}`}>
          <Sparkle size={15} /><span>{link.title}{link.heading ? ` · ${link.heading}` : ''}</span>
        </Link>)}
      </aside>
    </div>
  </article>;
}

function evidenceLabel(role: KnowledgeSearchHit['evidenceRole']) {
  return { SUPPORT: '可引用', DISCOVERY: '线索', NAVIGATION: '导航' }[role];
}

function formatDateTime(value: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? '—' : new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date);
}
