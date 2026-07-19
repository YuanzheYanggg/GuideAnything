import type { GuideDigestDraftV1 } from '@guideanything/contracts';
import { useEffect, useMemo, useState } from 'react';

import { SanitizedMarkdown } from '../markdown/SanitizedMarkdown';

export type GuideFlowSnapshotStatus = {
  guideRevision: number;
  sourceStatus: string | null;
  snapshotId: string | null;
  snapshotRevision: number | null;
  snapshotSchemaVersion: number | null;
  failureCode: string | null;
};

export type GuideDigestProposal = {
  id: string;
  guideId: string;
  workspaceId: string;
  baseSnapshotId: string;
  baseRevision: number;
  bundleRevision: number;
  rendererVersion: string;
  generationMetadata: Record<string, unknown>;
  status: 'DRAFT' | 'REJECTED' | 'APPLIED' | 'STALE' | 'FAILED';
  draft: GuideDigestDraftV1 | null;
  markdown: string | null;
  failureCode: string | null;
  supersedesProposalId: string | null;
  appliedRevision: number | null;
  selectedSummary: boolean | null;
  acceptedTags: string[] | null;
  acceptedMarkdown: boolean | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

type GuideDigestSelection = { applySummary: boolean; acceptedTagLabels: string[]; acceptMarkdown: boolean };

export function GuideDigestDialog({
  guide,
  status,
  proposal,
  generating = false,
  error,
  onReconcile,
  onGenerate,
  onReject,
  onApply,
  onClose,
}: {
  guide: Pick<{ id: string; revision: number; summary: string; tags: string[] }, 'id' | 'revision' | 'summary' | 'tags'>;
  status: GuideFlowSnapshotStatus | null;
  proposal: GuideDigestProposal | null;
  generating?: boolean;
  error?: string;
  onReconcile: () => Promise<void> | void;
  onGenerate: (regenerate?: boolean) => Promise<void> | void;
  onReject: (proposalId: string) => Promise<void> | void;
  onApply: (proposalId: string, selection: GuideDigestSelection) => Promise<void> | void;
  onClose: () => void;
}) {
  const [applySummary, setApplySummary] = useState(false);
  const [acceptMarkdown, setAcceptMarkdown] = useState(false);
  const [selectedTags, setSelectedTags] = useState<ReadonlySet<string>>(() => new Set());
  const [selectionError, setSelectionError] = useState('');
  const [busy, setBusy] = useState(false);
  const ready = status?.sourceStatus === 'READY'
    && status.snapshotId !== null
    && status.snapshotRevision === guide.revision
    && status.snapshotSchemaVersion === 2;
  const isStale = proposal?.status === 'STALE' || (proposal?.baseRevision !== undefined && proposal.baseRevision !== guide.revision);
  const suggestedTags = proposal?.draft?.tagSuggestions ?? [];
  const selectedTagLabels = useMemo(() => suggestedTags.map((tag) => tag.label).filter((label) => selectedTags.has(label)), [selectedTags, suggestedTags]);
  const sourceIndex = useMemo(() => buildSourceIndex(proposal?.draft), [proposal?.draft]);
  const sourceIds = useMemo(() => collectSourceIds(proposal?.draft), [proposal?.draft]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || busy || generating) return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [busy, generating, onClose]);

  const run = async (work: () => Promise<void> | void) => {
    if (busy || generating) return;
    setBusy(true);
    setSelectionError('');
    try { await work(); } finally { setBusy(false); }
  };
  const toggleTag = (label: string) => setSelectedTags((current) => {
    const next = new Set(current);
    if (next.has(label)) next.delete(label); else next.add(label);
    return next;
  });
  const apply = () => {
    const selection = { applySummary, acceptedTagLabels: selectedTagLabels, acceptMarkdown };
    if (!selection.applySummary && selection.acceptedTagLabels.length === 0 && !selection.acceptMarkdown) {
      setSelectionError('至少选择一项摘要、标签或 Markdown');
      return;
    }
    if (!proposal || isStale) return;
    void run(() => onApply(proposal.id, selection));
  };
  const disabled = busy || generating;

  return <div className="modal-backdrop" role="presentation">
    <section className="reference-modal guide-digest-dialog" role="dialog" aria-modal="true" aria-labelledby="guide-digest-title">
      <button className="modal-close" type="button" onClick={onClose} disabled={disabled} aria-label="关闭指南总览">×</button>
      <span className="eyebrow">GUIDE DIGEST REVIEW</span>
      <h2 id="guide-digest-title">生成指南总览</h2>
      <p>仅从当前已保存的流程快照生成；接受 Markdown 只记录提案审计，不会写入画布或检索。</p>
      {error ? <p className="error-message" role="alert">{error}</p> : null}
      {selectionError ? <p className="error-message" role="alert">{selectionError}</p> : null}
      {!status ? <p className="status-line">正在检查流程快照…</p> : null}
      {status ? <div className="guide-digest-status"><span>当前草稿 revision {guide.revision}</span><span>快照 revision {status.snapshotRevision ?? '—'} · {status.sourceStatus ?? 'NOT_INDEXED'}</span>{status.failureCode ? <span>诊断代码：{status.failureCode}</span> : null}</div> : null}
      {!proposal ? <div className="guide-digest-actions">
        {!ready ? <><p className="muted">当前 revision 没有可用的 V2 快照。请先同步，再显式生成。</p><button className="secondary-button" type="button" onClick={() => void run(onReconcile)} disabled={disabled}>重新同步快照</button></> : null}
        {ready ? <button className="primary-button" type="button" onClick={() => void run(() => onGenerate(false))} disabled={disabled}>{generating ? '正在生成…' : '生成结构化摘要'}</button> : null}
      </div> : null}
      {proposal?.status === 'FAILED' ? <div className="guide-digest-actions"><p className="error-message" role="alert">生成失败：{proposal.failureCode ?? 'GUIDE_DIGEST_FAILED'}</p><button className="secondary-button" type="button" onClick={() => void run(() => onGenerate(true))} disabled={disabled}>重试生成</button></div> : null}
      {proposal && proposal.status !== 'FAILED' ? <div className="guide-digest-review">
        {isStale ? <p className="error-message" role="alert">提案基于旧 revision，无法应用。请重新生成。</p> : null}
        {proposal.draft ? <>
          <section><h3>摘要差异</h3><div className="guide-digest-summary"><p><span>当前</span>{guide.summary || '（未填写）'}</p><p><span>建议</span>{proposal.draft.shortSummary}</p></div><label><input type="checkbox" checked={applySummary} disabled={disabled || isStale} onChange={(event) => setApplySummary(event.target.checked)} />采用建议摘要</label></section>
          <section><h3>标签建议</h3><div className="guide-digest-tags">{guide.tags.map((tag) => <span className="guide-digest-current-tag" key={tag}>{tag}</span>)}{suggestedTags.map((tag) => <label className="guide-digest-suggested-tag" key={tag.label}><input type="checkbox" aria-label={`采用标签 ${tag.label}`} checked={selectedTags.has(tag.label)} disabled={disabled || isStale} onChange={() => toggleTag(tag.label)} />{tag.label}<small>类别：{categoryLabel(tag.category)}</small><span className="guide-digest-provenance">{describeSources(tag.sourceIds, sourceIndex).map((source) => <span key={source}>{source}</span>)}</span></label>)}</div></section>
          <section><h3>待完善项</h3>{proposal.draft.gaps.length ? <ul className="guide-digest-gaps">{proposal.draft.gaps.map((gap, index) => <li key={`${gap.code}-${index}`}>{gap.message}<small>{describeSources(gap.sourceIds, sourceIndex).join('；')}</small></li>)}</ul> : <p className="muted">未报告信息缺口。</p>}</section>
        </> : null}
        {proposal.markdown ? <section><h3>Markdown 总览（只读）</h3><div className="guide-digest-markdown"><SanitizedMarkdown>{proposal.markdown}</SanitizedMarkdown></div></section> : null}
        <details><summary>诊断信息</summary><code>proposal={proposal.id} · snapshot={proposal.baseSnapshotId} · revision={proposal.baseRevision}{sourceIds.length ? ` · sourceIds=${sourceIds.join(',')}` : ''}</code></details>
        <div className="guide-digest-actions"><button className="secondary-button" type="button" onClick={() => void run(() => onGenerate(true))} disabled={disabled}>重新生成</button><button className="secondary-button" type="button" onClick={() => void run(() => onReject(proposal.id))} disabled={disabled || proposal.status !== 'DRAFT'}>拒绝提案</button><label><input type="checkbox" checked={acceptMarkdown} disabled={disabled || isStale} onChange={(event) => setAcceptMarkdown(event.target.checked)} />接受 Markdown 审计记录</label><button className="primary-button" type="button" onClick={apply} disabled={disabled || isStale || proposal.status !== 'DRAFT'}>接受并应用到草稿</button></div>
      </div> : null}
    </section>
  </div>;
}

function buildSourceIndex(draft: GuideDigestDraftV1 | null | undefined): ReadonlyMap<string, string> {
  const sources = new Map<string, string>();
  for (const section of draft?.stageSections ?? []) {
    sources.set(section.stageId, `阶段：${section.title}`);
    for (const step of section.steps) {
      sources.set(step.targetId, `步骤：${step.title}`);
      for (const resourceId of step.resourceIds) sources.set(resourceId, `资料：${step.title}中的关联资料`);
    }
  }
  return sources;
}

function describeSources(sourceIds: readonly string[], sources: ReadonlyMap<string, string>): string[] {
  if (sourceIds.length === 0) return ['未提供可追溯来源'];
  return sourceIds.map((sourceId) => sources.get(sourceId) ?? '未命名流程证据（来源类型未知）');
}

function collectSourceIds(draft: GuideDigestDraftV1 | null | undefined): string[] {
  if (!draft) return [];
  return [...new Set([
    ...draft.stageSections.flatMap((section) => [section.stageId, ...section.steps.flatMap((step) => [step.targetId, ...step.resourceIds])]),
    ...draft.keyRules.flatMap((rule) => rule.sourceIds),
    ...draft.tagSuggestions.flatMap((tag) => tag.sourceIds),
    ...draft.gaps.flatMap((gap) => gap.sourceIds),
  ])];
}

function categoryLabel(category: GuideDigestDraftV1['tagSuggestions'][number]['category']): string {
  return { DOMAIN: '领域', PROCESS: '流程', SYSTEM: '系统', OBJECT: '业务对象', ROLE: '角色', RISK: '风险' }[category];
}
