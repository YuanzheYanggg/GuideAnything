import type { RouteDecisionV1, RouteTaskV1 } from '@guideanything/contracts';
import { createHash } from 'node:crypto';

import type { AgentRunExecutionContext } from '../orchestrator';

const BUNDLE_CONTENT = {
  name: 'guideanything-workspace-query',
  version: 1,
  modules: {
    retrieval: [
      '选中上下文优先；流程命中后最多按服务端预算扩展一至两跳。',
      '字段或图片标注的精确命中，会与服务端提供的所属节点及流程结构索引组成受限结构闭包；只能在该闭包内作答。',
      '不得扫描整张流程图、整个工作区或未经请求的资料集合。',
      '流程图、已发布工作区资料和当前会话附件分别按服务端授权范围使用。',
    ],
    evidence: [
      '流程图和已发布工作区资料是内部事实源；只能引用服务端提供的 evidence ID。',
      '只有直接叶子证据及其服务端提供的受限结构上下文均未命中，或证据冲突时，才明确说明资料缺口；不得仅因缺少整张流程图的摘要而声明资料缺口。',
      '不得用常识补写流程事实。',
    ],
    output: [
      '流程反馈必须绑定已检索的节点 locator。',
      '只读问答只能提出草稿性改进建议，不能修改流程、资料或知识卡。',
    ],
  },
} as const;

export const WORKSPACE_QUERY_BUNDLE = {
  ...BUNDLE_CONTENT,
  revision: revisionFor(BUNDLE_CONTENT),
} as const;

export function loadWorkspaceQueryInstructions(
  context: AgentRunExecutionContext,
  decision: RouteDecisionV1,
  task: RouteTaskV1 | undefined,
): readonly string[] {
  if (
    context.scope !== 'WORKSPACE'
    || !context.workspaceId
    || !task
    || !isInternalWorkspaceTask(task.kind)
    || !isTaskSourceEnabled(decision, task.kind)
  ) {
    return [];
  }
  return Object.values(WORKSPACE_QUERY_BUNDLE.modules).flat();
}

export function workspaceQueryBundleRevisions(tasks: readonly RouteTaskV1[]): Array<{ name: string; revision: string }> {
  return tasks.some((task) => isInternalWorkspaceTask(task.kind))
    ? [{ name: WORKSPACE_QUERY_BUNDLE.name, revision: WORKSPACE_QUERY_BUNDLE.revision }]
    : [];
}

function isInternalWorkspaceTask(kind: RouteTaskV1['kind']): boolean {
  return kind === 'WORKSPACE_FLOW' || kind === 'WORKSPACE_DOCUMENT' || kind === 'SESSION_ATTACHMENT';
}

function isTaskSourceEnabled(decision: RouteDecisionV1, kind: RouteTaskV1['kind']): boolean {
  if (kind === 'WORKSPACE_FLOW') return decision.sources.workspaceFlows;
  if (kind === 'WORKSPACE_DOCUMENT') return decision.sources.workspaceDocuments;
  if (kind === 'SESSION_ATTACHMENT') return decision.sources.sessionAttachments;
  return false;
}

function revisionFor(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
}
