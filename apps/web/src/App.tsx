import { useEffect, useMemo, useState } from 'react';

import { LoginPage, type LoginCredentials } from './features/auth/LoginPage';
import type { AuthUser } from './features/auth/types';
import { LibraryPage } from './features/library/LibraryPage';
import { apiClient } from './lib/api';

type Page = { name: 'library' } | { name: 'editor'; guideId: string } | { name: 'lesson'; versionId: string };

export function App() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [restoring, setRestoring] = useState(apiClient.hasToken);
  const [page, setPage] = useState<Page>({ name: 'library' });
  const libraryApi = useMemo(() => apiClient.libraryApi(), []);

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
  if (page.name === 'editor') return <main className="center-state"><button onClick={() => setPage({ name: 'library' })}>返回资料库</button><p>画布编辑器正在载入：{page.guideId}</p></main>;
  if (page.name === 'lesson') return <main className="center-state"><button onClick={() => setPage({ name: 'library' })}>返回资料库</button><p>教学模式正在载入：{page.versionId}</p></main>;
  return <LibraryPage
    user={user}
    api={libraryApi}
    onEdit={(guideId) => setPage({ name: 'editor', guideId })}
    onLearn={(versionId) => setPage({ name: 'lesson', versionId })}
    onLogout={() => { apiClient.logout(); setUser(null); }}
  />;
}

