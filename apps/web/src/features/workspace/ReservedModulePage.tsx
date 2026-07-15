import { Archive, ChatCircleDots } from '@phosphor-icons/react';
import { Link, useParams } from 'react-router-dom';

const reservedModules = {
  agents: {
    title: 'Agent',
    status: '尚未配置 Agent Runtime',
    description: '未来通过受控 Runtime Bridge 接入 Codex CLI，并保留权限确认和审计记录。',
    icon: ChatCircleDots,
  },
  artifacts: {
    title: '会话与产物',
    status: '尚未产生会话或产物',
    description: '未来保存咨询记录、报告、分析结果和指南草稿。',
    icon: Archive,
  },
} as const;

export function ReservedModulePage({ module }: { module?: keyof typeof reservedModules }) {
  const { workspaceId, module: routeModule } = useParams();
  const config = reservedModules[module ?? routeModule as keyof typeof reservedModules];

  if (!config) return <div className="reserved-module page-stack">
    <h1>模块不可用</h1>
    <p>这个工作区模块尚未开放。</p>
    <Link to={workspaceId ? `/workspaces/${workspaceId}` : '/workspaces'}>返回工作区概览</Link>
  </div>;

  const IconComponent = config.icon;
  return <div className="reserved-module page-stack">
    <header className="page-heading"><div><span className="page-kicker">RESERVED MODULE</span><h1>{config.title}</h1></div></header>
    <section className="reserved-module-card">
      <span className="reserved-module-icon"><IconComponent size={32} /></span>
      <span className="reserved-status">预留能力</span>
      <h2>{config.status}</h2>
      <p>{config.description}</p>
      <small>当前页面不会连接运行时、同步资料或生成模拟数据。</small>
    </section>
    <Link className="text-link" to={`/workspaces/${workspaceId}`}>返回工作区概览</Link>
  </div>;
}
