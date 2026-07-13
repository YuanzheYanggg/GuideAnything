import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import {
  BrowserRouter,
  Navigate,
  Outlet,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from 'react-router-dom';

import { LoginPage, type LoginCredentials } from './features/auth/LoginPage';
import type { AuthUser } from './features/auth/types';
import { LibraryPage } from './features/library/LibraryPage';
import { AppearanceProvider } from './features/theme/AppearanceToggle';
import type { PersonalApi, WorkspaceApi, WorkspaceSummary } from './features/workspace/types';
import { apiClient } from './lib/api';

const GuideEditor = lazy(() => import('./features/editor/GuideEditor').then((module) => ({ default: module.GuideEditor })));
const LessonPage = lazy(() => import('./features/lesson/LessonPage').then((module) => ({ default: module.LessonPage })));

export function App() {
  return <AppearanceProvider><BrowserRouter><AppContent /></BrowserRouter></AppearanceProvider>;
}

function AppContent() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [restoring, setRestoring] = useState(apiClient.hasToken);
  const libraryApi = useMemo(() => apiClient.libraryApi(), []);
  const editorApi = useMemo(() => apiClient.editorApi(), []);
  const workspaceApi = useMemo(() => apiClient.workspaceApi(), []);
  const personalApi = useMemo(() => apiClient.personalApi(), []);

  useEffect(() => {
    if (!apiClient.hasToken) return;
    apiClient.me().then(setUser).catch(() => apiClient.logout()).finally(() => setRestoring(false));
  }, []);

  const login = async (credentials: LoginCredentials) => {
    const session = await apiClient.login(credentials);
    setUser(session.user);
  };
  const logout = () => {
    apiClient.logout();
    setUser(null);
  };

  if (restoring) return <main className="center-state"><span className="spinner" /><p>正在恢复工作台…</p></main>;
  if (!user) return <LoginPage onLogin={login} />;

  return <Routes>
    <Route element={<AuthenticatedWorkspaceLayout user={user} workspaceApi={workspaceApi} personalApi={personalApi} onLogout={logout} />}>
      <Route path="/" element={<Navigate to="/library" replace />} />
      <Route path="/library" element={<LibraryRoute user={user} onLogout={logout} />} />
      <Route path="/favorites" element={<PersonalResourcePage kind="favorites" />} />
      <Route path="/recent" element={<PersonalResourcePage kind="recent" />} />
      <Route path="/shared" element={<PersonalResourcePage kind="shared" />} />
      <Route path="/trash" element={<PersonalResourcePage kind="trash" />} />
      <Route path="/workspaces" element={<WorkspaceDirectoryPage />} />
      <Route path="/workspaces/:workspaceId" element={<WorkspaceOverviewPage workspaceApi={workspaceApi} />} />
      <Route path="/workspaces/:workspaceId/guides" element={<LibraryRoute user={user} onLogout={logout} />} />
      <Route path="/workspaces/:workspaceId/:module" element={<ReservedModulePage />} />
    </Route>
    <Route path="/guides/:guideId/edit" element={<GuideEditorRoute />} />
    <Route path="/versions/:versionId/learn" element={<LessonRoute />} />
    <Route path="*" element={<Navigate to="/library" replace />} />
  </Routes>;

  function LibraryRoute({ user: routeUser, onLogout }: { user: AuthUser; onLogout: () => void }) {
    const navigate = useNavigate();
    return <LibraryPage
      user={routeUser}
      api={libraryApi}
      onEdit={(guideId) => navigate(`/guides/${guideId}/edit`)}
      onLearn={(versionId) => navigate(`/versions/${versionId}/learn`)}
      onLogout={onLogout}
    />;
  }

  function GuideEditorRoute() {
    const navigate = useNavigate();
    const { guideId } = useParams();
    if (!guideId) return <Navigate to="/library" replace />;
    return <Suspense fallback={<LoadingState label="正在载入画布编辑器…" />}>
      <GuideEditor guideId={guideId} api={editorApi} onBack={() => navigate('/library')} />
    </Suspense>;
  }

  function LessonRoute() {
    const navigate = useNavigate();
    const { versionId } = useParams();
    if (!versionId) return <Navigate to="/library" replace />;
    return <Suspense fallback={<LoadingState label="正在载入教学模式…" />}>
      <LessonPage versionId={versionId} api={{ getVersion: editorApi.getVersion }} onBack={() => navigate('/library')} />
    </Suspense>;
  }
}

function AuthenticatedWorkspaceLayout({
  user,
  workspaceApi,
  personalApi,
  onLogout,
}: {
  user: AuthUser;
  workspaceApi: WorkspaceApi;
  personalApi: PersonalApi;
  onLogout: () => void;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  void user;
  void workspaceApi;
  void personalApi;
  const destinations = [
    ['/library', '指南库'],
    ['/favorites', '收藏夹'],
    ['/recent', '最近查看'],
    ['/shared', '与我共享'],
    ['/trash', '回收站'],
    ['/workspaces', '工作区'],
  ] as const;
  return <>
    <nav aria-label="工作台路由">
      {destinations.map(([path, label]) => <button
        key={path}
        type="button"
        aria-current={location.pathname === path ? 'page' : undefined}
        onClick={() => navigate(path)}
      >{label}</button>)}
      <button type="button" onClick={onLogout}>退出登录</button>
    </nav>
    <Outlet />
  </>;
}

const personalTitles = {
  favorites: '收藏夹',
  recent: '最近查看',
  shared: '与我共享',
  trash: '回收站',
} as const;

function PersonalResourcePage({ kind }: { kind: keyof typeof personalTitles }) {
  return <main><h1>{personalTitles[kind]}</h1></main>;
}

function WorkspaceDirectoryPage() {
  return <main><h1>工作区</h1></main>;
}

function WorkspaceOverviewPage({ workspaceApi }: { workspaceApi: WorkspaceApi }) {
  const { workspaceId } = useParams();
  const [workspace, setWorkspace] = useState<WorkspaceSummary | null>(null);

  useEffect(() => {
    let active = true;
    workspaceApi.list().then((items) => {
      if (active) setWorkspace(items.find((item) => item.id === workspaceId) ?? null);
    });
    return () => { active = false; };
  }, [workspaceApi, workspaceId]);

  return <main><h1>{workspace?.name ?? '正在载入工作区…'}</h1></main>;
}

function ReservedModulePage() {
  const { module } = useParams();
  return <main><h1>{module ?? '工作区模块'}</h1></main>;
}

function LoadingState({ label }: { label: string }) {
  return <main className="center-state"><span className="spinner" /><p>{label}</p></main>;
}
