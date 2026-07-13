import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useNavigate,
  useLocation,
  useParams,
  useSearchParams,
} from 'react-router-dom';

import { LoginPage, type LoginCredentials } from './features/auth/LoginPage';
import type { AuthUser } from './features/auth/types';
import { LibraryPage } from './features/library/LibraryPage';
import { PersonalResourcePage } from './features/personal/PersonalResourcePage';
import { AppearanceProvider } from './features/theme/AppearanceToggle';
import { ReservedModulePage } from './features/workspace/ReservedModulePage';
import { WorkspaceDirectoryPage } from './features/workspace/WorkspaceDirectoryPage';
import { WorkspaceOverviewPage } from './features/workspace/WorkspaceOverviewPage';
import { WorkspaceShell } from './features/workspace/WorkspaceShell';
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
    <Route element={<WorkspaceShell user={user} workspaceApi={workspaceApi} personalApi={personalApi} onLogout={logout} />}>
      <Route path="/" element={<Navigate to="/library" replace />} />
      <Route path="/library" element={<LibraryRoute user={user} />} />
      <Route path="/favorites" element={<PersonalResourcePage kind="favorites" />} />
      <Route path="/recent" element={<PersonalResourcePage kind="recent" />} />
      <Route path="/shared" element={<PersonalResourcePage kind="shared" />} />
      <Route path="/trash" element={<PersonalResourcePage kind="trash" />} />
      <Route path="/workspaces" element={<WorkspaceDirectoryPage />} />
      <Route path="/workspaces/:workspaceId" element={<WorkspaceOverviewPage workspaceApi={workspaceApi} />} />
      <Route path="/workspaces/:workspaceId/guides" element={<LibraryRoute user={user} />} />
      <Route path="/workspaces/:workspaceId/:module" element={<ReservedModulePage />} />
    </Route>
    <Route path="/guides/:guideId/edit" element={<GuideEditorRoute />} />
    <Route path="/versions/:versionId/learn" element={<LessonRoute />} />
    <Route path="*" element={<Navigate to="/library" replace />} />
  </Routes>;

  function LibraryRoute({ user: routeUser }: { user: AuthUser }) {
    const navigate = useNavigate();
    const location = useLocation();
    const { workspaceId } = useParams();
    const [searchParams, setSearchParams] = useSearchParams();
    return <LibraryPage
      user={routeUser}
      api={libraryApi}
      personalApi={personalApi}
      {...(workspaceId ? { workspaceId } : {})}
      createRequested={searchParams.get('create') === '1'}
      onCreateIntentConsumed={() => {
        const next = new URLSearchParams(searchParams);
        next.delete('create');
        setSearchParams(next, { replace: true });
      }}
      onEdit={(guideId) => navigate(withReturnTo(`/guides/${guideId}/edit`, libraryReturnPath(location.pathname, location.search)))}
      onLearn={(versionId) => navigate(withReturnTo(`/versions/${versionId}/learn`, libraryReturnPath(location.pathname, location.search)))}
    />;
  }

  function GuideEditorRoute() {
    const navigate = useNavigate();
    const { guideId } = useParams();
    const [searchParams] = useSearchParams();
    if (!guideId) return <Navigate to="/library" replace />;
    return <Suspense fallback={<LoadingState label="正在载入画布编辑器…" />}>
      <GuideEditor guideId={guideId} api={editorApi} personalApi={personalApi} onBack={() => navigate(safeReturnTo(searchParams.get('returnTo')))} />
    </Suspense>;
  }

  function LessonRoute() {
    const navigate = useNavigate();
    const { versionId } = useParams();
    const [searchParams] = useSearchParams();
    if (!versionId) return <Navigate to="/library" replace />;
    return <Suspense fallback={<LoadingState label="正在载入教学模式…" />}>
      <LessonPage versionId={versionId} api={{ getVersion: editorApi.getVersion }} personalApi={personalApi} onBack={() => navigate(safeReturnTo(searchParams.get('returnTo')))} />
    </Suspense>;
  }
}

export function safeReturnTo(value: string | null | undefined): string {
  return value?.startsWith('/') && !value.startsWith('//') ? value : '/library';
}

export function withReturnTo(path: string, returnTo: string): string {
  return `${path}?returnTo=${encodeURIComponent(safeReturnTo(returnTo))}`;
}

function libraryReturnPath(pathname: string, search: string): string {
  const params = new URLSearchParams(search);
  params.delete('create');
  const query = params.toString();
  return `${pathname}${query ? `?${query}` : ''}`;
}

function LoadingState({ label }: { label: string }) {
  return <main className="center-state"><span className="spinner" /><p>{label}</p></main>;
}
