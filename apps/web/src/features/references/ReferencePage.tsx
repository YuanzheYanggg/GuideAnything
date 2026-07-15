import type { ReferenceResolutionV1 } from '@guideanything/contracts';
import { ArrowLeft, ArrowRight, CheckCircle, WarningCircle } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';

import type { ArtifactsApi } from '../artifacts/types';

export function ReferencePage({ api }: { api: Pick<ArtifactsApi, 'resolveReference'> }) {
  const { referenceId } = useParams();
  const [searchParams] = useSearchParams();
  const [resolution, setResolution] = useState<ReferenceResolutionV1 | null>(null);
  const [error, setError] = useState('');
  const returnTo = safeReturnPath(searchParams.get('returnTo'));

  useEffect(() => {
    if (!referenceId) return;
    let active = true;
    api.resolveReference(referenceId).then((next) => { if (active) setResolution(next); }).catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : '引用解析失败');
    });
    return () => { active = false; };
  }, [api, referenceId]);

  if (error) return <main className="reference-page"><p className="workspace-error" role="alert">{error}</p><Link to={returnTo}>返回</Link></main>;
  if (!resolution) return <main className="center-state"><span className="spinner" /><p>正在重新验证引用…</p></main>;
  const valid = resolution.status === 'VALID';
  return <main className="reference-page">
    <Link className="knowledge-back-link" to={returnTo}><ArrowLeft size={17} />返回原页面</Link>
    <section className={valid ? 'is-valid' : 'is-invalid'}>
      <span className="reference-state-icon">{valid ? <CheckCircle size={28} /> : <WarningCircle size={28} />}</span>
      <span className="page-kicker">{valid ? 'VERIFIED REFERENCE' : 'REFERENCE UNAVAILABLE'}</span>
      <h1>{resolution.title}</h1>
      <p>{resolution.excerpt}</p>
      {valid ? <Link className="workspace-create-button" to={withReturnTo(resolution.target.href, returnTo)}>打开原始位置 <ArrowRight size={17} /></Link> : <div className="reference-invalid-reason"><strong>{resolution.reasonCode}</strong><span>{resolution.invalidReason}</span></div>}
    </section>
  </main>;
}

export function withReturnTo(href: string, returnTo: string) {
  const separator = href.includes('?') ? '&' : '?';
  return `${href}${separator}returnTo=${encodeURIComponent(safeReturnPath(returnTo))}`;
}

function safeReturnPath(value: string | null | undefined) {
  return value?.startsWith('/') && !value.startsWith('//') ? value : '/library';
}
