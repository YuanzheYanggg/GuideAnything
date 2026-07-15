import {
  Check,
  Circle,
  CircleNotch,
  GitBranch,
  MagnifyingGlass,
  Warning,
} from '@phosphor-icons/react';

import type { AgentRunViewState, AgentRunTaskState } from './useAgentRunStream';

export function AgentRunTimeline({ state }: { state: AgentRunViewState }) {
  if (state.status === 'IDLE') return null;
  return <section className="agent-run-timeline" aria-label="Agent 执行进度">
    <header>
      <div><span className="page-kicker">LIVE RUN · PLAN {Math.max(1, state.planVersion)}</span><h3>{phaseTitle(state.status)}</h3></div>
      {state.route ? <span className={`agent-route-badge route-${state.route.toLowerCase()}`}><GitBranch size={14} />{routeLabel(state.route)}</span> : null}
    </header>
    {state.userFacingPlan ? <p className="agent-public-plan">{state.userFacingPlan}</p> : null}
    {state.tasks.length > 0 ? <ol className="agent-task-list">
      {state.tasks.map((task) => <TaskRow task={task} key={task.id} />)}
    </ol> : <div className="agent-routing-state"><CircleNotch className="spin" size={17} />正在判断问题范围与最小检索路径…</div>}
    {state.draft ? <div className="agent-draft" aria-label="生成中的草稿"><span>生成中的回答</span><p>{state.draft}</p></div> : null}
    {state.error ? <p className="agent-run-error" role="alert"><Warning size={16} />{state.error}</p> : null}
    <span className="sr-only" aria-live="polite">{phaseTitle(state.status)}</span>
  </section>;
}

function TaskRow({ task }: { task: AgentRunTaskState }) {
  const Icon = task.status === 'COMPLETED'
    ? Check
    : task.status === 'FAILED'
      ? Warning
      : task.status === 'RUNNING'
        ? CircleNotch
        : task.sourceKind === 'REDUCE'
          ? GitBranch
          : MagnifyingGlass;
  return <li className={`is-${task.status.toLowerCase()}`}>
    <span className="agent-task-state"><Icon className={task.status === 'RUNNING' ? 'spin' : undefined} size={15} /></span>
    <div><strong>{task.label}</strong>{task.progressMessage ? <span>{task.progressMessage}</span> : null}{task.finding ? <small>{task.finding.summary} · {task.finding.evidenceCount} 条证据</small> : null}</div>
    {task.progress !== undefined ? <span className="agent-task-progress" aria-label={`${Math.round(task.progress * 100)}%`}><i style={{ width: `${Math.round(task.progress * 100)}%` }} /></span> : <Circle size={7} weight="fill" />}
  </li>;
}

function phaseTitle(status: AgentRunViewState['status']) {
  return {
    IDLE: '等待问题', CONNECTING: '正在连接事件流', ROUTING: '正在规划回答路径', RUNNING: '正在检索并生成',
    VALIDATING: '正在验证引用', COMPLETED: '回答已完成', FAILED: '运行失败', CANCELLED: '已取消运行',
  }[status];
}

function routeLabel(route: NonNullable<AgentRunViewState['route']>) {
  return { DIRECT: '直接回答', FOCUSED: '聚焦检索', COMPOSITE: '复合任务', OPEN_RESEARCH: '开放研究' }[route];
}
