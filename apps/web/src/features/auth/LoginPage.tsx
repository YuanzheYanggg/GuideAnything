import { type FormEvent, useState } from 'react';

export interface LoginCredentials {
  email: string;
  password: string;
}

export function LoginPage({ onLogin }: { onLogin: (credentials: LoginCredentials) => Promise<unknown> }) {
  const [email, setEmail] = useState('author@guide.local');
  const [password, setPassword] = useState('Guide123!');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setPending(true);
    setError('');
    try {
      await onLogin({ email, password });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '登录失败，请稍后重试');
    } finally {
      setPending(false);
    }
  };

  const useDemo = (role: 'author' | 'editor' | 'learner') => {
    setEmail(`${role}@guide.local`);
    setPassword('Guide123!');
    setError('');
  };

  return (
    <main className="login-page">
      <section className="login-intro" aria-labelledby="product-name">
        <span className="eyebrow">MULTIMODAL PROCESS LEARNING</span>
        <h1 id="product-name">GuideAnything</h1>
        <p>把 ERP 操作、字段规则、图像与视频关键点，组织成一张可以复用和逐步学习的流程画布。</p>
        <div className="login-feature-grid" aria-label="产品能力">
          <span>无限画布</span><span>发布检索</span><span>子指南复用</span><span>步骤教学</span>
        </div>
      </section>
      <section className="login-card" aria-labelledby="login-title">
        <div>
          <span className="eyebrow">LOCAL DEMO</span>
          <h2 id="login-title">进入教学工作台</h2>
          <p className="muted">使用预置角色体验作者、编辑者和学习者路径。</p>
        </div>
        <form onSubmit={submit}>
          <label>邮箱<input name="email" type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
          <label>密码<input name="password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={8} required /></label>
          {error ? <p className="error-message" role="alert">{error}</p> : null}
          <button className="primary-button" type="submit" disabled={pending}>{pending ? '正在登录…' : '登录'}</button>
        </form>
        <div className="demo-accounts" aria-label="填入演示账号">
          <button type="button" onClick={() => useDemo('author')}>使用作者账号</button>
          <button type="button" onClick={() => useDemo('editor')}>使用编辑者账号</button>
          <button type="button" onClick={() => useDemo('learner')}>使用学习者账号</button>
        </div>
      </section>
    </main>
  );
}

