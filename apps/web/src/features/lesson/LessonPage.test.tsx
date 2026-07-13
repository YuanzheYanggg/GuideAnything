import type { GuideVersionSnapshot } from '@guideanything/contracts';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { LessonPage } from './LessonPage';

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

describe('LessonPage', () => {
  it('navigates ordered steps and seeks video keypoints', async () => {
    const user = userEvent.setup();
    const api = { getVersion: vi.fn().mockResolvedValue(version) };
    render(<LessonPage versionId="version-lesson" api={api} onBack={vi.fn()} />);

    expect(await screen.findByRole('heading', { name: 'ERP 销售订单创建' })).toBeVisible();
    expect(screen.getByText('步骤 1 / 2')).toBeVisible();
    expect(screen.getByRole('heading', { name: '理解业务场景' })).toBeVisible();
    expect(screen.getByText('确认销售组织。')).toBeVisible();
    expect(screen.getByLabelText('当前步骤内容')).toHaveAttribute('data-step-id', 'step-1');
    expect(screen.getByRole('button', { name: '上一步' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: '下一步' }));
    expect(screen.getByText('步骤 2 / 2')).toBeVisible();
    expect(screen.getByRole('heading', { name: '观看录入演示' })).toBeVisible();
    expect(screen.getByLabelText('当前步骤内容')).toHaveAttribute('data-step-id', 'step-2');
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

  it('opens a pinned subguide from the lesson canvas and returns to the parent guide', async () => {
    const user = userEvent.setup();
    const childVersion: GuideVersionSnapshot = {
      ...version,
      id: 'version-material',
      guideId: 'guide-material',
      title: '物料主数据检查',
      document: {
        ...version.document,
        nodes: [{ id: 'material-start', type: 'start', position: { x: 0, y: 0 }, zIndex: 0, data: { label: '检查物料主数据', description: '确认物料销售视图。', shape: 'start' } }],
        edges: [],
        steps: [{ id: 'material-step-1', order: 0, title: '检查物料主数据', nodeId: 'material-start' }],
        entryNodeId: 'material-start',
        exitNodeIds: ['material-start'],
      },
    };
    const parentVersion: GuideVersionSnapshot = {
      ...version,
      document: {
        ...version.document,
        nodes: [
          ...version.document.nodes,
          { id: 'subguide-node', type: 'subguide', position: { x: 320, y: 160 }, zIndex: 2, data: { guideId: childVersion.guideId, guideVersionId: childVersion.id, title: childVersion.title, version: childVersion.version, expanded: false } },
        ],
        steps: [...version.document.steps, { id: 'step-subguide', order: 2, title: '打开物料主数据检查', nodeId: 'subguide-node' }],
      },
    };
    const api = { getVersion: vi.fn((id: string) => Promise.resolve(id === childVersion.id ? childVersion : parentVersion)) };
    render(<LessonPage versionId={parentVersion.id} api={api} onBack={vi.fn()} />);

    await screen.findByRole('heading', { name: 'ERP 销售订单创建' });
    fireEvent.click(screen.getByText('物料主数据检查', { selector: 'strong' }));
    expect(await screen.findByRole('heading', { name: '物料主数据检查' })).toBeVisible();
    expect(screen.getByText('步骤 1 / 1')).toBeVisible();
    expect(api.getVersion).toHaveBeenCalledWith(childVersion.id);

    await user.click(screen.getByRole('button', { name: '返回上一级指南' }));
    expect(await screen.findByRole('heading', { name: 'ERP 销售订单创建' })).toBeVisible();
  });
});
