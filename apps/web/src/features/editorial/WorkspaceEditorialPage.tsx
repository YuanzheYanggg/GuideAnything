import { useCallback, useEffect, useState } from 'react';
import {
  ArrowsClockwise,
  CheckCircle,
  ClipboardText,
  FlowArrow,
  LockKey,
  WarningCircle,
} from '@phosphor-icons/react';
import { Navigate, useOutletContext, useParams } from 'react-router-dom';

import type { WorkspaceOutletContext } from '../workspace/WorkspaceShell';
import type {
  EditorialApi,
  OwnerQuestionExample,
  WorkspaceFlowProposalV1,
  WorkspaceKnowledgeCardV1,
  WorkspaceQuestionClusterV1,
} from './types';

export function WorkspaceEditorialPage({ api }: { api: EditorialApi }) {
  const { workspaceId } = useParams();
  const { workspaces, workspaceLoading } = useOutletContext<Pick<WorkspaceOutletContext, 'workspaces' | 'workspaceLoading'>>();
  const workspace = workspaces.find((item) => item.id === workspaceId);
  const [clusters, setClusters] = useState<WorkspaceQuestionClusterV1[]>([]);
  const [cards, setCards] = useState<WorkspaceKnowledgeCardV1[]>([]);
  const [proposals, setProposals] = useState<WorkspaceFlowProposalV1[]>([]);
  const [examples, setExamples] = useState<Record<string, OwnerQuestionExample[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionMessage, setActionMessage] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!workspaceId || !workspace || workspace.permission === 'VIEW') return;
    setLoading(true);
    setError('');
    try {
      const [nextClusters, nextCards, nextProposals] = await Promise.all([
        api.listQuestionClusters(workspaceId),
        api.listCards(workspaceId),
        api.listProposals(workspaceId),
      ]);
      setClusters(nextClusters);
      setCards(nextCards);
      setProposals(nextProposals);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : '知识演进工作台载入失败');
    } finally {
      setLoading(false);
    }
  }, [api, workspace, workspaceId]);

  useEffect(() => { void refresh(); }, [refresh]);

  if (!workspaceId) return <Navigate to="/workspaces" replace />;
  if (!workspace) {
    return workspaceLoading
      ? <div className="workspace-loading" role="status"><span className="spinner" /><span>正在确认工作区权限…</span></div>
      : <Navigate to={`/workspaces/${workspaceId}`} replace />;
  }
  if (workspace.permission === 'VIEW') {
    return <Navigate to={workspaceId ? `/workspaces/${workspaceId}` : '/workspaces'} replace />;
  }

  const createCard = async (cluster: WorkspaceQuestionClusterV1) => {
    setBusyId(cluster.id);
    setError('');
    setActionMessage('');
    try {
      const card = await api.createCard(workspaceId, {
        clusterId: cluster.id,
        kind: 'QUESTION_GAP',
        title: '待补充：工作区证据覆盖',
        summary: cluster.summary,
        guideId: null,
        nodeId: null,
        evidenceIds: [],
      });
      setCards((current) => [card, ...current]);
      setClusters((current) => current.map((item) => item.id === cluster.id ? { ...item, status: 'CARD_CREATED' } : item));
      setActionMessage('已从问题聚类创建知识卡。');
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : '创建知识卡失败');
    } finally {
      setBusyId(null);
    }
  };

  const updateCard = async (card: WorkspaceKnowledgeCardV1, status: WorkspaceKnowledgeCardV1['status']) => {
    setBusyId(card.id);
    setError('');
    try {
      const updated = await api.transitionCard(workspaceId, card.id, status);
      setCards((current) => current.map((item) => item.id === card.id ? updated : item));
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : '更新知识卡失败');
    } finally {
      setBusyId(null);
    }
  };

  const updateProposal = async (
    proposal: WorkspaceFlowProposalV1,
    status: Exclude<WorkspaceFlowProposalV1['status'], 'APPLIED' | 'STALE'>,
  ) => {
    setBusyId(proposal.id);
    setError('');
    try {
      const updated = await api.transitionProposal(workspaceId, proposal.id, status);
      setProposals((current) => current.map((item) => item.id === proposal.id ? updated : item));
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : '更新流程提案失败');
    } finally {
      setBusyId(null);
    }
  };

  const applyProposal = async (proposal: WorkspaceFlowProposalV1) => {
    setBusyId(proposal.id);
    setError('');
    setActionMessage('');
    try {
      const result = await api.applyProposal(workspaceId, proposal.id);
      setProposals((current) => current.map((item) => item.id === proposal.id ? {
        ...item,
        status: result.proposal.status,
        appliedRevision: result.proposal.appliedRevision,
      } : item));
      setActionMessage(`已应用到草稿修订 ${result.guide.revision}`);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : '应用流程提案失败');
    } finally {
      setBusyId(null);
    }
  };

  const loadExamples = async (clusterId: string) => {
    if (examples[clusterId]) return;
    setBusyId(clusterId);
    setError('');
    try {
      const samples = await api.listOwnerQuestionExamples(workspaceId, clusterId);
      setExamples((current) => ({ ...current, [clusterId]: samples }));
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : '原始问题样本载入失败');
    } finally {
      setBusyId(null);
    }
  };

  if (loading) return <div className="workspace-loading" role="status"><span className="spinner" /><span>正在汇总知识演进队列…</span></div>;

  return <section className="editorial-workbench page-stack" aria-label="知识演进">
    <header className="page-heading editorial-heading">
      <div>
        <span className="page-kicker">EDITORIAL WORKBENCH</span>
        <h1>知识演进</h1>
        <p>将已验证的工作区问答缺口沉淀为知识卡，并在审阅后把流程提案应用到对应草稿。流程发布仍由既有作者流程负责。</p>
      </div>
      <button className="editorial-refresh-button" type="button" onClick={() => void refresh()} disabled={loading}>
        <ArrowsClockwise size={17} />刷新队列
      </button>
    </header>

    {error ? <p className="workspace-error" role="alert">{error}</p> : null}
    {actionMessage ? <p className="editorial-success" role="status"><CheckCircle size={17} />{actionMessage}</p> : null}

    <section className="editorial-section" aria-labelledby="editorial-queue-heading">
      <div className="section-title"><div><span className="page-kicker">QUESTION QUEUE</span><h2 id="editorial-queue-heading">问题聚类</h2></div><span className="page-count">{clusters.length}</span></div>
      {clusters.length === 0 ? <EmptyState title="当前没有待处理问题" detail="证据不足或冲突的内部问答会在这里形成脱敏聚类。" /> : <div className="editorial-list">
        {clusters.map((cluster) => {
          const clusterExamples = examples[cluster.id];
          return <article className="editorial-row" key={cluster.id}>
            <span className="editorial-row-icon is-gap"><WarningCircle size={20} /></span>
            <div className="editorial-row-copy"><strong>{cluster.summary}</strong><span>{cluster.occurrenceCount} 次出现 · {cluster.ownerVisibleExampleCount} 条 Owner 样本</span></div>
            <div className="editorial-row-actions">
              <span className={`editorial-status is-${cluster.status.toLowerCase()}`}>{clusterStatusLabel(cluster.status)}</span>
              {cluster.status === 'OPEN' ? <button type="button" onClick={() => void createCard(cluster)} disabled={busyId === cluster.id}>创建知识卡</button> : null}
              {workspace.permission === 'OWNER' ? <button type="button" className="editorial-quiet-button" onClick={() => void loadExamples(cluster.id)} disabled={busyId === cluster.id}>查看原始提问</button> : null}
            </div>
            {workspace.permission === 'OWNER' && clusterExamples ? <ol className="editorial-examples">
              {clusterExamples.length === 0 ? <li>暂未保留可查看的原始样本。</li> : clusterExamples.map((example) => <li key={example.id}>{example.content}</li>)}
            </ol> : null}
          </article>;
        })}
      </div>}
    </section>

    <section className="editorial-section" aria-labelledby="editorial-cards-heading">
      <div className="section-title"><div><span className="page-kicker">KNOWLEDGE CARDS</span><h2 id="editorial-cards-heading">知识卡</h2></div><span className="page-count">{cards.length}</span></div>
      {cards.length === 0 ? <EmptyState title="还没有知识卡" detail="从问题聚类创建卡片后，可在这里完成审核和归档。" /> : <div className="editorial-list">
        {cards.map((card) => <article className="editorial-row" key={card.id}>
          <span className="editorial-row-icon"><ClipboardText size={20} /></span>
          <div className="editorial-row-copy"><strong>{card.title}</strong><span>{card.summary}</span></div>
          <div className="editorial-row-actions">
            <label className="editorial-select-label">状态<select aria-label={`更新知识卡 ${card.title}`} value={card.status} onChange={(event) => void updateCard(card, event.target.value as WorkspaceKnowledgeCardV1['status'])} disabled={busyId === card.id}>
              {cardStatuses.map((status) => <option key={status} value={status}>{cardStatusLabel(status)}</option>)}
            </select></label>
          </div>
        </article>)}
      </div>}
    </section>

    <section className="editorial-section" aria-labelledby="editorial-proposals-heading">
      <div className="section-title"><div><span className="page-kicker">FLOW PROPOSALS</span><h2 id="editorial-proposals-heading">流程提案</h2></div><span className="page-count">{proposals.length}</span></div>
      {proposals.length === 0 ? <EmptyState title="还没有待审流程提案" detail="提案必须包含可验证证据、目标指南和基准草稿修订。" /> : <div className="editorial-list">
        {proposals.map((proposal) => <article className="editorial-row editorial-proposal" key={proposal.id}>
          <span className="editorial-row-icon is-proposal"><FlowArrow size={20} /></span>
          <div className="editorial-row-copy"><strong>{proposal.summary}</strong><span>目标指南 {proposal.guideId} · 基准草稿修订 {proposal.baseRevision} · {proposal.evidenceIds.length} 条证据</span><small>{proposal.operations.map(describeOperation).join('；')}</small></div>
          <div className="editorial-row-actions">
            <span className={`editorial-status is-${proposal.status.toLowerCase()}`}>{proposalStatusLabel(proposal.status)}</span>
            {proposal.status === 'DRAFT' ? <button type="button" onClick={() => void updateProposal(proposal, 'UNDER_REVIEW')} disabled={busyId === proposal.id}>提交审核</button> : null}
            {proposal.status === 'UNDER_REVIEW' ? <><button type="button" onClick={() => void updateProposal(proposal, 'ACCEPTED')} disabled={busyId === proposal.id}>接受提案</button><button type="button" className="editorial-quiet-button" onClick={() => void updateProposal(proposal, 'REJECTED')} disabled={busyId === proposal.id}>驳回</button></> : null}
            {proposal.status === 'ACCEPTED' ? <button type="button" onClick={() => void applyProposal(proposal)} disabled={busyId === proposal.id}>应用到草稿</button> : null}
            {proposal.status === 'APPLIED' && proposal.appliedRevision !== null ? <span className="editorial-applied-note">草稿修订 {proposal.appliedRevision}</span> : null}
          </div>
        </article>)}
      </div>}
    </section>

    <aside className="editorial-boundary"><LockKey size={17} /><span>知识卡、原始问题和流程提案均不会进入普通 Agent 检索；只有流程草稿经人工应用并保存/发布后，新的流程快照才会成为可检索的工作区事实。</span></aside>
  </section>;
}

function EmptyState({ title, detail }: { title: string; detail: string }) {
  return <div className="workspace-empty compact"><strong>{title}</strong><span>{detail}</span></div>;
}

const cardStatuses: WorkspaceKnowledgeCardV1['status'][] = ['DRAFT', 'UNDER_REVIEW', 'ACCEPTED', 'REJECTED', 'ARCHIVED'];

function clusterStatusLabel(status: WorkspaceQuestionClusterV1['status']) {
  return { OPEN: '待处理', DISMISSED: '已忽略', CARD_CREATED: '已建卡' }[status];
}

function cardStatusLabel(status: WorkspaceKnowledgeCardV1['status']) {
  return { DRAFT: '草稿', UNDER_REVIEW: '审核中', ACCEPTED: '已采纳', REJECTED: '已驳回', ARCHIVED: '已归档' }[status];
}

function proposalStatusLabel(status: WorkspaceFlowProposalV1['status']) {
  return { DRAFT: '草稿', UNDER_REVIEW: '审核中', ACCEPTED: '已接受', REJECTED: '已驳回', APPLIED: '已应用', STALE: '已过期' }[status];
}

function describeOperation(operation: WorkspaceFlowProposalV1['operations'][number]) {
  switch (operation.kind) {
    case 'ADD_NODE': return `新增节点 ${operation.node.id}`;
    case 'UPDATE_NODE': return `更新节点 ${operation.nodeId}`;
    case 'REMOVE_NODE': return `移除节点 ${operation.nodeId}`;
    case 'ADD_EDGE': return `新增连线 ${operation.edge.id}`;
    case 'UPDATE_EDGE': return `更新连线 ${operation.edgeId}`;
    case 'REMOVE_EDGE': return `移除连线 ${operation.edgeId}`;
    case 'REPLACE_STEPS': return `替换 ${operation.steps.length} 个步骤`;
    case 'SET_ENTRY_EXIT': return '更新入口与出口';
  }
}
