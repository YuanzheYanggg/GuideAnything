import { lazy, Suspense, useEffect, useMemo, useState } from 'react';

import { LoginPage, type LoginCredentials } from './features/auth/LoginPage';
import type { AuthUser } from './features/auth/types';
import { LibraryPage } from './features/library/LibraryPage';
import { apiClient } from './lib/api';

type Page = { name: 'library' } | { name: 'editor'; guideId: string } | { name: 'lesson'; versionId: string };
const GuideEditor = lazy(() => import('./features/editor/GuideEditor').then((module) => ({ default: module.GuideEditor })));

export function App() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [restoring, setRestoring] = useState(apiClient.hasToken);
  const [page, setPage] = useState<Page>({ name: 'library' });
  const libraryApi = useMemo(() => apiClient.libraryApi(), []);
  const editorApi = useMemo(() => apiClient.editorApi(), []);

  useEffect(() => {
    if (!apiClient.hasToken) return;
    apiClient.me().then(setUser).catch(() => apiClient.logout()).finally(() => setRestoring(false));
  }, []);

  const login = async (credentials: LoginCredentials) => {
    const session = await apiClient.login(credentials);
    setUser(session.user);
  };

  if (restoring) return <main className="center-state"><span className="spinner" /><p>正在恢复工作台…</p></main>;
  if (!user) return <LoginPage onLogin={login} />;
  if (page.name === 'editor') return <Suspense fallback={<main className="center-state"><span className="spinner" /><p>正在载入画布编辑器…</p></main>}><GuideEditor guideId={page.guideId} api={editorApi} onBack={() => setPage({ name: 'library' })} /></Suspense>;
  if (page.name === 'lesson') return <main className="center-state"><button onClick={() => setPage({ name: 'library' })}>返回资料库</button><p>教学模式正在载入：{page.versionId}</p></main>;
  return <LibraryPage
    user={user}
    api={libraryApi}
    onEdit={(guideId) => setPage({ name: 'editor', guideId })}
    onLearn={(versionId) => setPage({ name: 'lesson', versionId })}
    onLogout={() => { apiClient.logout(); setUser(null); }}
  />;
}
