import { Brain, CheckCircle, LockKey, Path } from '@phosphor-icons/react';
import { useParams } from 'react-router-dom';

import { AgentConversationPanel } from './AgentConversationPanel';
import type { AgentApi } from './types';

export function WorkspaceAgentsPage({ api }: { api: AgentApi }) {
  const { workspaceId } = useParams();
  if (!workspaceId) return <p className="workspace-error" role="alert">工作区不存在</p>;
  return <section className="workspace-agents page-stack">
    <header className="page-heading"><div><span className="page-kicker">BUILT-IN CAPABILITY</span><h1>Agent</h1><p>一个受 Prompt Harness 约束的只读知识 Agent，按问题难度选择最小检索与推理路径。</p></div><span className="agent-capability-state"><CheckCircle size={16} />只读能力</span></header>
    <section className="agent-capability-strip" aria-label="Santexwell QA Agent 能力">
      <div><span><Brain size={21} /></span><strong>推理路由</strong><small>DIRECT 到 OPEN RESEARCH</small></div>
      <div><span><Path size={21} /></span><strong>流程定位</strong><small>节点、阶段、泳道与跳转</small></div>
      <div><span><LockKey size={21} /></span><strong>证据验证</strong><small>路径不出后端，引用再次鉴权</small></div>
    </section>
    <AgentConversationPanel api={api} scope={{ kind: 'WORKSPACE', workspaceId }} />
  </section>;
}
