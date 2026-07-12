import type { GuideVersionSnapshot } from '@guideanything/contracts';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { LessonPage, resolveStepStage, resourcesForStep } from './LessonPage';

const version: GuideVersionSnapshot = {
  id: 'version-lesson', guideId: 'guide-lesson', version: 2, title: 'ERP 销售订单创建', summary: 'VA01 教学', tags: ['ERP'],
  document: {
    schemaVersion: 1,
    nodes: [
      { id: 'intro', type: 'markdown', position: { x: 0, y: 0 }, zIndex: 0, data: { markdown: '# 场景说明\n确认销售组织。' } },
      { id: 'video', type: 'video', position: { x: 320, y: 0 }, zIndex: 1, data: { url: 'https://example.com/va01.mp4', caption: 'VA01 操作演示', keypoints: [{ id: 'kp-1', title: '填写售达方', timeSeconds: 15 }] } },
    ],
    edges: [{ id: 'e1', source: 'intro', target: 'video' }], viewport: { x: 0, y: 0, zoom: 1 },
    steps: [
      { id: 'step-1', order: 0, title: '理解业务场景', body: '先确认销售范围。', nodeId: 'intro' },
      { id: 'step-2', order: 1, title: '观看录入演示', nodeId: 'video', keypointId: 'kp-1' },
    ],
    entryNodeId: 'intro', exitNodeIds: ['video'],
  },
};

const hierarchyVersion: GuideVersionSnapshot = {
  id: 'version-hierarchy', guideId: 'guide-hierarchy', version: 1, title: '销售订单准备', summary: '按阶段学习', tags: ['ERP'],
  document: {
    schemaVersion: 1,
    stages: [{ id: 'prepare', title: '准备', order: 0 }],
    nodes: [
      { id: 'intro', type: 'process', stageId: 'prepare', position: { x: 0, y: 0 }, zIndex: 0, data: { label: '确认销售范围', shape: 'process' } },
      { id: 'video', type: 'video', contentParentId: 'intro', position: { x: 320, y: 0 }, zIndex: 1, data: { url: 'https://example.com/va01.mp4', caption: 'VA01 操作演示', keypoints: [] } },
      { id: 'hidden-note', type: 'markdown', contentParentId: 'intro', hidden: true, position: { x: 320, y: 200 }, zIndex: 2, data: { markdown: '不应显示' } },
      { id: 'subguide', type: 'subguide', stageId: 'prepare', position: { x: 640, y: 0 }, zIndex: 3, data: { guideId: 'guide-child', guideVersionId: 'version-child', title: '子流程', version: 1, expanded: true } },
      { id: 'expanded-copy', type: 'process', position: { x: 920, y: 0 }, zIndex: 4, source: { referenceNodeId: 'subguide', sourceGuideId: 'guide-child', sourceVersionId: 'version-child', sourceElementId: 'source-process' }, data: { label: '展开副本', shape: 'process' } },
    ],
    edges: [{ id: 'e1', source: 'intro', target: 'video' }], viewport: { x: 0, y: 0, zoom: 1 },
    steps: [
      { id: 'step-1', order: 0, title: '确认业务范围', nodeId: 'intro' },
      { id: 'step-2', order: 1, title: '观看录入演示', nodeId: 'video' },
      { id: 'step-3', order: 2, title: '展开副本', nodeId: 'expanded-copy' },
    ],
    entryNodeId: 'intro', exitNodeIds: ['intro'],
  },
};

describe('LessonPage', () => {
  it('navigates ordered steps and seeks video keypoints', async () => {
    const user = userEvent.setup();
    const api = { getVersion: vi.fn().mockResolvedValue(version) };
    render(<LessonPage versionId="version-lesson" api={api} onBack={vi.fn()} />);

    expect(await screen.findByRole('heading', { name: 'ERP 销售订单创建' })).toBeVisible();
    expect(screen.getByText('步骤 1 / 2')).toBeVisible();
    expect(screen.getByRole('heading', { name: '理解业务场景' })).toBeVisible();
    expect(screen.getByText('确认销售组织。')).toBeVisible();
    expect(screen.getByRole('button', { name: '上一步' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: '下一步' }));
    expect(screen.getByText('步骤 2 / 2')).toBeVisible();
    expect(screen.getByRole('heading', { name: '观看录入演示' })).toBeVisible();
    const video = screen.getByLabelText('VA01 操作演示') as HTMLVideoElement;
    await user.click(screen.getByRole('button', { name: '跳转到 00:15' }));
    expect(video.currentTime).toBe(15);
    expect(screen.getByRole('button', { name: '下一步' })).toBeDisabled();
  });

  it('reports versions without lesson steps as an empty teaching path', async () => {
    const api = { getVersion: vi.fn().mockResolvedValue({ ...version, document: { ...version.document, steps: [] } }) };
    render(<LessonPage versionId="empty" api={api} onBack={vi.fn()} />);
    expect(await screen.findByText('这个发布版本还没有编排教学步骤')).toBeVisible();
  });

  it('groups learner steps and shows resources attached to the current flow node', async () => {
    const api = { getVersion: vi.fn().mockResolvedValue(hierarchyVersion) };
    render(<LessonPage versionId="hierarchy" api={api} onBack={vi.fn()} />);

    expect(await screen.findByText('准备')).toBeVisible();
    expect(screen.getByRole('heading', { name: '本步骤资料' })).toBeVisible();
    expect(screen.getByLabelText('VA01 操作演示')).toBeVisible();
    expect(screen.getByRole('button', { name: '2 观看录入演示' })).toBeVisible();
    expect(screen.queryByText('不应显示')).not.toBeInTheDocument();
  });

  it('keeps legacy steps ungrouped while source-derived steps inherit their pinned subguide stage', () => {
    expect(resolveStepStage(version.document, 'intro')).toBeNull();
    expect(resolveStepStage(hierarchyVersion.document, 'expanded-copy')?.title).toBe('准备');
    expect(resourcesForStep(hierarchyVersion.document, 'intro').map((node) => node.id)).toEqual(['video']);
  });
});
