import type {
  AgentRunSnapshotV1,
  FlowAnnotationHealthV1,
  WorkspaceFlowRegressionCaseV1,
} from '@guideanything/contracts';
import { useEffect, useState } from 'react';

import { BorderGlow } from '../../components/reactbits/BorderGlow';

export interface FlowRegressionEditorApi {
  listFlowRegressionCases: (guideId: string) => Promise<WorkspaceFlowRegressionCaseV1[]>;
  replayFlowRegressionCase: (guideId: string, caseId: string) => Promise<WorkspaceFlowRegressionCaseV1>;
  archiveFlowRegressionCase: (guideId: string, caseId: string) => Promise<WorkspaceFlowRegressionCaseV1>;
  createFlowRegressionRealRun: (guideId: string, caseId: string) => Promise<AgentRunSnapshotV1>;
  getFlowAnnotationHealth: (guideId: string) => Promise<FlowAnnotationHealthV1>;
}

type Target = Pick<WorkspaceFlowRegressionCaseV1, 'resourceNodeId' | 'annotationId'>;

export function FlowRegressionPanel({
  guideId,
  api,
  annotationTitle,
}: {
  guideId: string;
  api: FlowRegressionEditorApi;
  annotationTitle: (target: Target) => string;
}) {
  const [items, setItems] = useState<WorkspaceFlowRegressionCaseV1[]>([]);
  const [health, setHealth] = useState<FlowAnnotationHealthV1 | null>(null);
  const [loading, setLoading] = useState(true);
  const [pendingCaseId, setPendingCaseId] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    Promise.all([
      api.listFlowRegressionCases(guideId),
      api.getFlowAnnotationHealth(guideId),
    ]).then(([nextItems, nextHealth]) => {
      if (!active) return;
      setItems(nextItems);
      setHealth(nextHealth);
    }).catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : '回归题载入失败');
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [api, guideId]);

  const replaceCase = (next: WorkspaceFlowRegressionCaseV1) => {
    setItems((current) => current.map((item) => item.id === next.id ? next : item));
  };

  const replay = async (item: WorkspaceFlowRegressionCaseV1) => {
    if (pendingCaseId) return;
    setPendingCaseId(item.id);
    setNotice('');
    setError('');
    try {
      replaceCase(await api.replayFlowRegressionCase(guideId, item.id));
      setNotice('确定性复跑已完成');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '确定性复跑失败');
    } finally {
      setPendingCaseId(null);
    }
  };

  const startRealRun = async (item: WorkspaceFlowRegressionCaseV1) => {
    if (pendingCaseId) return;
    setPendingCaseId(item.id);
    setNotice('');
    setError('');
    try {
      await api.createFlowRegressionRealRun(guideId, item.id);
      setNotice('已提交真实试跑');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '真实试跑提交失败');
    } finally {
      setPendingCaseId(null);
    }
  };

  const archive = async (item: WorkspaceFlowRegressionCaseV1) => {
    if (pendingCaseId) return;
    setPendingCaseId(item.id);
    setNotice('');
    setError('');
    try {
      replaceCase(await api.archiveFlowRegressionCase(guideId, item.id));
      setNotice('回归题已归档');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '归档回归题失败');
    } finally {
      setPendingCaseId(null);
    }
  };

  return <details className="flow-regression-panel">
    <summary>回归题（{items.length}）</summary>
    <BorderGlow className="flow-regression-panel-body" active tone="accent">
      {loading ? <p className="flow-regression-muted" role="status">正在载入回归题…</p> : null}
      {health && health.issues.length > 0 ? <section className="flow-regression-health" aria-label="标注健康检查异常">
        <strong>标注健康检查异常</strong>
        <ul>{health.issues.map((issue) => <li key={`${issue.resourceNodeId}:${issue.annotationId}:${issue.code}`}>
          {annotationTitle(issue)} · {issue.code}
        </li>)}</ul>
      </section> : null}
      {!loading && items.length === 0 ? <p className="flow-regression-muted">尚未固定真实问题；可在图片标注引用旁固定。</p> : null}
      {items.map((item) => {
        const pending = pendingCaseId === item.id;
        const archived = item.status === 'ARCHIVED';
        return <article className={`flow-regression-case is-${item.status.toLowerCase()}`} key={item.id}>
          <header><strong>{annotationTitle(item)}</strong><span>{caseStatusLabel(item.status)}</span></header>
          <p>{item.question}</p>
          <div className="flow-regression-results">
            <span>确定性：{verificationLabel(item.lastRetrievalVerification)}</span>
            <span>真实 Agent：{verificationLabel(item.lastAgentVerification)}</span>
          </div>
          <div className="flow-regression-case-actions">
            <button type="button" disabled={pending || archived} onClick={() => { void replay(item); }}>确定性复跑</button>
            <button type="button" disabled={pending || item.status !== 'ACTIVE'} onClick={() => { void startRealRun(item); }}>真实试跑</button>
            <button type="button" disabled={pending || archived} onClick={() => { void archive(item); }}>归档</button>
          </div>
        </article>;
      })}
      {notice ? <p className="flow-regression-notice" role="status">{notice}</p> : null}
      {error ? <p className="flow-regression-error" role="alert">{error}</p> : null}
    </BorderGlow>
  </details>;
}

function caseStatusLabel(status: WorkspaceFlowRegressionCaseV1['status']): string {
  return status === 'ACTIVE' ? '正常' : status === 'NEEDS_REVIEW' ? '需复核' : '已归档';
}

function verificationLabel(value: WorkspaceFlowRegressionCaseV1['lastRetrievalVerification']): string {
  return value === 'PASS' ? '通过' : value === 'FAIL' ? '失败' : value === 'NEEDS_REVIEW' ? '需复核' : '未验证';
}
