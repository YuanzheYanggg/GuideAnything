import { useEffect, useMemo, useState } from 'react';
import {
  Bell,
  BookOpen,
  BookmarkSimple,
  CaretDown,
  ChartLineUp,
  ClockCounterClockwise,
  Cube,
  FileText,
  MagnifyingGlass,
  Question,
  SquaresFour,
  Trash,
  UsersThree,
  type Icon,
} from '@phosphor-icons/react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';

import type { AuthUser } from '../auth/types';
import { AppearanceToggle } from '../theme/AppearanceToggle';
import type { PersonalApi, WorkspaceApi, WorkspaceSummary } from './types';

interface WorkspaceShellProps {
  user: AuthUser;
  workspaceApi: WorkspaceApi;
  personalApi: PersonalApi;
  onLogout: () => void;
}

export interface WorkspaceOutletContext {
  user: AuthUser;
  workspaceApi: WorkspaceApi;
  personalApi: PersonalApi;
  workspaces: WorkspaceSummary[];
  workspaceLoading: boolean;
  workspaceError: string;
}

const primaryNav: Array<{ to: string; label: string; icon: Icon }> = [
  { to: '/library', label: '指南库', icon: BookOpen },
  { to: '/favorites', label: '收藏夹', icon: BookmarkSimple },
  { to: '/recent', label: '最近查看', icon: ClockCounterClockwise },
  { to: '/shared', label: '与我共享', icon: UsersThree },
  { to: '/trash', label: '回收站', icon: Trash },
];

const workspaceIcons: Record<string, Icon> = {
  ChartLineUp,
  FileText,
  SquaresFour,
  UsersThree,
};

export function WorkspaceShell({ user, workspaceApi, personalApi, onLogout }: WorkspaceShellProps) {
  const navigate = useNavigate();
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);

  useEffect(() => {
    let active = true;
    workspaceApi.list()
      .then((items) => { if (active) setWorkspaces(items); })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : '工作区载入失败');
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [workspaceApi]);

  const recentWorkspaces = useMemo(() => [...workspaces]
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
    .slice(0, 5), [workspaces]);

  const focusLibrarySearch = () => {
    navigate('/library');
    window.setTimeout(() => document.getElementById('guide-search')?.focus(), 0);
  };

  return <div className="workspace-shell">
    <header className="workspace-topbar">
      <div className="workspace-topbar-leading">
        <NavLink className="workspace-brand" to="/library" aria-label="GuideAnything 资料库">
          <span className="workspace-brand-mark"><Cube size={24} weight="fill" /></span>
          <span>GuideAnything</span>
        </NavLink>
        <span className="workspace-topbar-divider" aria-hidden="true" />
        <span className="workspace-topbar-hint">知识有边界，流程有路径。</span>
      </div>
      <div className="workspace-topbar-actions">
        <button className="workspace-icon-button" type="button" aria-label="聚焦搜索" onClick={focusLibrarySearch}><MagnifyingGlass size={22} /></button>
        <button className="workspace-icon-button" type="button" aria-label="通知"><Bell size={22} /></button>
        <button className="workspace-icon-button" type="button" aria-label="帮助"><Question size={22} /></button>
        <div className="workspace-account">
          <button className="workspace-avatar" type="button" aria-label={`账户 ${user.displayName}`} aria-haspopup="menu" aria-expanded={accountMenuOpen} onClick={() => setAccountMenuOpen((open) => !open)}>{user.displayName.slice(0, 1)}</button>
          <button className="workspace-icon-button workspace-account-chevron" type="button" aria-label="打开账户菜单" aria-haspopup="menu" aria-expanded={accountMenuOpen} onClick={() => setAccountMenuOpen((open) => !open)}><CaretDown size={16} /></button>
          {accountMenuOpen ? <div className="workspace-account-menu" role="menu">
            <div className="workspace-account-meta"><strong>{user.displayName}</strong><span>{roleLabel(user.role)}</span></div>
            <button type="button" role="menuitem" onClick={onLogout}>退出登录</button>
          </div> : null}
        </div>
      </div>
    </header>

    <aside className="workspace-sidebar" aria-label="工作区导航">
      <nav className="workspace-nav" aria-label="个人视图">
        {primaryNav.map(({ to, label, icon: IconComponent }) => <NavLink key={to} to={to} className={navClass}>
          <IconComponent size={21} /><span>{label}</span>
        </NavLink>)}
      </nav>
      <div className="workspace-sidebar-rule" />
      <span className="workspace-sidebar-label">工作区</span>
      <nav className="workspace-nav workspace-domain-nav" aria-label="业务工作区">
        {recentWorkspaces.map((workspace) => {
          const IconComponent = workspaceIcons[workspace.iconKey] ?? FileText;
          return <NavLink key={workspace.id} to={`/workspaces/${workspace.id}`} className={navClass}>
            <span className={`workspace-domain-icon domain-${workspace.colorKey}`}><IconComponent size={18} weight="bold" /></span>
            <span>{workspace.name}</span>
          </NavLink>;
        })}
        {loading ? <span className="workspace-nav-status">正在载入…</span> : null}
        {error ? <span className="workspace-nav-status" role="alert">{error}</span> : null}
        <NavLink to="/workspaces" end className={navClass}><SquaresFour size={21} /><span>查看全部</span></NavLink>
      </nav>
      <div className="workspace-sidebar-footer">
        <AppearanceToggle />
      </div>
    </aside>

    <main className="workspace-content">
      <Outlet context={{
        user,
        workspaceApi,
        personalApi,
        workspaces,
        workspaceLoading: loading,
        workspaceError: error,
      } satisfies WorkspaceOutletContext} />
    </main>
  </div>;
}

function navClass({ isActive }: { isActive: boolean }) {
  return `workspace-nav-item${isActive ? ' is-active' : ''}`;
}

function roleLabel(role: AuthUser['role']): string {
  return { AUTHOR: '作者', EDITOR: '编辑者', LEARNER: '学习者' }[role];
}
