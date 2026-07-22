import type { JSX } from 'react';
import { useEffect, useState } from 'react';

import type { GuideDraftDetail } from '../editor/GuideEditor';
import { GuidePdfExportDocument } from './GuidePdfExportDocument';
import { buildGuidePdfExportModel } from './export-model';
import { prepareGuidePdfMedia, releaseGuidePdfMedia, type PreparedGuidePdfMedia } from './export-media';

export interface GuidePdfExportApi {
  getGuide: (guideId: string) => Promise<GuideDraftDetail>;
  mediaObjectUrl: (path: string) => Promise<string>;
}

type ExportPageState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; model: ReturnType<typeof buildGuidePdfExportModel>; media: PreparedGuidePdfMedia };

export function GuidePdfExportPage({
  guideId,
  api,
  onBack,
}: {
  guideId: string;
  api: GuidePdfExportApi;
  onBack: () => void;
}): JSX.Element {
  const [state, setState] = useState<ExportPageState>({ status: 'loading' });

  useEffect(() => {
    let active = true;
    let preparedMedia: PreparedGuidePdfMedia | undefined;
    setState({ status: 'loading' });
    void (async () => {
      try {
        const guide = await api.getGuide(guideId);
        const model = buildGuidePdfExportModel({
          title: guide.title,
          summary: guide.summary,
          tags: guide.tags,
          status: guide.status,
          revision: guide.revision,
          publishedVersion: guide.publishedVersion,
          document: guide.document,
          generatedAt: new Date().toISOString(),
        });
        const media = await prepareGuidePdfMedia(model, api.mediaObjectUrl);
        preparedMedia = media;
        if (!active) {
          releaseGuidePdfMedia(media);
          return;
        }
        setState({ status: 'ready', model, media });
      } catch (reason) {
        if (!active) return;
        setState({ status: 'error', message: reason instanceof Error ? reason.message : '无法准备 PDF 导出' });
      }
    })();
    return () => {
      active = false;
      if (preparedMedia) releaseGuidePdfMedia(preparedMedia);
    };
  }, [api, guideId]);

  const isReady = state.status === 'ready';
  return <div className="pdf-export-shell">
    <header className="pdf-export-toolbar" aria-label="PDF 导出操作">
      <button className="secondary-button" type="button" onClick={onBack}>返回编辑器</button>
      <div className="pdf-export-toolbar-title"><span className="pdf-export-kicker">PDF EXPORT</span><span>{isReady ? state.model.cover.title : '正在准备导出…'}</span></div>
      <button className="primary-button" type="button" onClick={() => { if (isReady) window.print(); }} disabled={!isReady}>打印 / 保存为 PDF</button>
    </header>
    {state.status === 'loading' ? <main className="center-state"><span className="spinner" /><p>正在准备 PDF 导出…</p></main> : null}
    {state.status === 'error' ? <main className="center-state pdf-export-error"><p className="error-message" role="alert">{state.message}</p></main> : null}
    {state.status === 'ready' ? <GuidePdfExportDocument model={state.model} media={state.media} /> : null}
  </div>;
}
