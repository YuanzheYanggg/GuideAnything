import type { GuideVersionSnapshot } from '@guideanything/contracts';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { LessonPage, resolveStepLane, resolveStepStage, resourcesForStep, toLessonFlowEdges } from './LessonPage';
import { createPersonalApiMock } from '../../test/workspace-api-mocks';

const version: GuideVersionSnapshot = {
  id: 'version-lesson', guideId: 'guide-lesson', workspaceItemId: 'item-guide-1', version: 2, title: 'ERP 销售订单创建', summary: 'VA01 教学', tags: ['ERP'],
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
    lanes: [{ id: 'erp', title: 'ERP', kind: 'SYSTEM', order: 0 }],
    nodes: [
      { id: 'intro', type: 'process', stageId: 'prepare', laneId: 'erp', position: { x: 0, y: 0 }, zIndex: 0, data: { label: '确认销售范围', shape: 'process' } },
      { id: 'video', type: 'video', contentParentId: 'intro', position: { x: 320, y: 0 }, zIndex: 1, data: { url: 'https://example.com/va01.mp4', caption: 'VA01 操作演示', keypoints: [] } },
      { id: 'hidden-note', type: 'markdown', contentParentId: 'intro', hidden: true, position: { x: 320, y: 200 }, zIndex: 2, data: { markdown: '不应显示' } },
      { id: 'subguide', type: 'subguide', stageId: 'prepare', laneId: 'erp', position: { x: 640, y: 0 }, zIndex: 3, data: { guideId: 'guide-child', guideVersionId: 'version-child', title: '子流程', version: 1, expanded: true } },
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
  it('derives orthogonal route data for the published flow map', () => {
    const edges = toLessonFlowEdges(version.document);

    expect(edges).toContainEqual(expect.objectContaining({
      id: 'e1', sourceHandle: 'out', targetHandle: 'in', type: 'orthogonal', data: expect.objectContaining({ route: expect.objectContaining({ edgeId: 'e1' }) }),
    }));
  });
  it('records the root version as recent after a successful load', async () => {
    const personalApi = createPersonalApiMock();
    render(<LessonPage versionId="version-lesson" api={{ getVersion: vi.fn().mockResolvedValue(version) }} personalApi={personalApi} onBack={vi.fn()} />);
    await screen.findByRole('heading', { name: 'ERP 销售订单创建' });
    expect(personalApi.recordRecent).toHaveBeenCalledWith(
      'item-guide-1',
      expect.objectContaining({ mode: 'lesson', versionId: 'version-lesson' }),
    );
  });
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

  it('plays image annotations, opens linked resources, and returns to the same annotation', async () => {
    const user = userEvent.setup();
    const annotatedVersion: GuideVersionSnapshot = {
      ...hierarchyVersion,
      document: {
        ...hierarchyVersion.document,
        nodes: [
          hierarchyVersion.document.nodes[0]!,
          {
            id: 'screen', type: 'image', contentParentId: 'intro', position: { x: 320, y: 0 }, zIndex: 1,
            data: { url: 'https://example.com/erp.png', alt: 'ERP 页面', annotations: [{ id: 'field', order: 0, title: '客户字段', shape: 'POINT', region: { x: 0.2, y: 0.3 }, targetNodeId: 'note' }] },
          },
          { id: 'note', type: 'markdown', contentParentId: 'intro', position: { x: 320, y: 280 }, zIndex: 2, data: { markdown: '# 字段解释\n填写售达方。' } },
        ],
        edges: [],
        steps: [{ id: 'step-intro', order: 0, title: '确认业务范围', nodeId: 'intro' }],
      },
    };
    render(<LessonPage versionId={annotatedVersion.id} api={{ getVersion: vi.fn().mockResolvedValue(annotatedVersion) }} onBack={vi.fn()} />);
    await screen.findByRole('heading', { name: annotatedVersion.title });

    await user.click(screen.getByRole('button', { name: '放大查看 ERP 页面' }));
    await user.click(screen.getByRole('button', { name: '开始图片讲解' }));
    expect(screen.getByRole('heading', { name: '客户字段' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: '查看关联资料' }));
    expect(within(screen.getByRole('dialog', { name: '资料预览' })).getByRole('heading', { name: '字段解释' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: '返回上一项资料' }));
    expect(screen.getByRole('heading', { name: '客户字段' })).toBeVisible();
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
    const personalApi = createPersonalApiMock();
    render(<LessonPage versionId={parentVersion.id} api={api} personalApi={personalApi} onBack={vi.fn()} />);

    await screen.findByRole('heading', { name: 'ERP 销售订单创建' });
    fireEvent.click(screen.getByText('物料主数据检查', { selector: 'strong' }));
    expect(await screen.findByRole('heading', { name: '物料主数据检查' })).toBeVisible();
    expect(screen.getByText('步骤 1 / 1')).toBeVisible();
    expect(api.getVersion).toHaveBeenCalledWith(childVersion.id);
    expect(personalApi.recordRecent).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: '返回上一级指南' }));
    expect(await screen.findByRole('heading', { name: 'ERP 销售订单创建' })).toBeVisible();
  });

  it('records a subguide only when it belongs to another workspace item', async () => {
    const childVersion: GuideVersionSnapshot = {
      ...version,
      id: 'version-child',
      guideId: 'guide-child',
      workspaceItemId: 'item-guide-child',
      title: '独立子指南',
      document: { ...version.document, steps: [] },
    };
    const parentVersion: GuideVersionSnapshot = {
      ...version,
      document: {
        ...version.document,
        nodes: [{ id: 'subguide-node', type: 'subguide', position: { x: 0, y: 0 }, zIndex: 0, data: { guideId: childVersion.guideId, guideVersionId: childVersion.id, title: childVersion.title, version: childVersion.version, expanded: false } }],
        edges: [], steps: [{ id: 'step-child', order: 0, title: '打开独立子指南', nodeId: 'subguide-node' }], entryNodeId: 'subguide-node', exitNodeIds: ['subguide-node'],
      },
    };
    const personalApi = createPersonalApiMock();
    const api = { getVersion: vi.fn((id: string) => Promise.resolve(id === childVersion.id ? childVersion : parentVersion)) };
    render(<LessonPage versionId={parentVersion.id} api={api} personalApi={personalApi} onBack={vi.fn()} />);
    await screen.findByRole('heading', { name: parentVersion.title });
    fireEvent.click(screen.getAllByText(childVersion.title, { selector: 'strong' })[0]!);
    await screen.findByText('这个发布版本还没有编排教学步骤');
    expect(personalApi.recordRecent).toHaveBeenNthCalledWith(2, 'item-guide-child', { mode: 'lesson', versionId: 'version-child' });
  });

  it('ignores duplicate subguide activation while the version request is in flight', async () => {
    let resolveChild!: (value: GuideVersionSnapshot) => void;
    const child = { ...version, id: 'version-child', guideId: 'guide-child', workspaceItemId: 'item-child', title: '异步子指南', document: { ...version.document, steps: [] } };
    const parent = { ...version, document: { ...version.document, nodes: [{ id: 'sub', type: 'subguide' as const, position: { x: 0, y: 0 }, zIndex: 0, data: { guideId: child.guideId, guideVersionId: child.id, title: child.title, version: 2, expanded: false } }], edges: [], steps: [{ id: 'step-sub', order: 0, title: '打开异步子指南', nodeId: 'sub' }], entryNodeId: 'sub', exitNodeIds: ['sub'] } };
    const api = { getVersion: vi.fn((id: string) => id === child.id ? new Promise<GuideVersionSnapshot>((resolve) => { resolveChild = resolve; }) : Promise.resolve(parent)) };
    const personalApi = createPersonalApiMock();
    render(<LessonPage versionId={parent.id} api={api} personalApi={personalApi} onBack={vi.fn()} />);
    await screen.findByRole('heading', { name: parent.title });
    const target = screen.getAllByText(child.title, { selector: 'strong' })[0]!;
    act(() => {
      target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(api.getVersion).toHaveBeenCalledTimes(2);
    resolveChild(child);
    await screen.findByText('这个发布版本还没有编排教学步骤');
    expect(personalApi.recordRecent).toHaveBeenCalledTimes(2);
  });

  it('groups learner steps and shows resources attached to the current flow node', async () => {
    const api = { getVersion: vi.fn().mockResolvedValue(hierarchyVersion) };
    render(<LessonPage versionId="hierarchy" api={api} onBack={vi.fn()} />);

    expect(await screen.findByText('准备')).toBeVisible();
    expect(screen.getByText('系统 · ERP')).toBeVisible();
    expect(screen.getByRole('heading', { name: '本步骤资料' })).toBeVisible();
    expect(screen.getByLabelText('VA01 操作演示')).toBeVisible();
    expect(screen.getByRole('button', { name: '2 观看录入演示' })).toBeVisible();
    expect(screen.queryByText('不应显示')).not.toBeInTheDocument();
  });

  it('keeps legacy steps ungrouped while source-derived steps inherit their pinned subguide stage', () => {
    expect(resolveStepStage(version.document, 'intro')).toBeNull();
    expect(resolveStepStage(hierarchyVersion.document, 'expanded-copy')?.title).toBe('准备');
    expect(resolveStepLane(hierarchyVersion.document, 'intro')).toEqual(expect.objectContaining({ title: 'ERP', kind: 'SYSTEM' }));
    expect(resolveStepLane(hierarchyVersion.document, 'expanded-copy')).toEqual(expect.objectContaining({ title: 'ERP' }));
    expect(resolveStepLane(version.document, 'intro')).toBeNull();
    expect(resourcesForStep(hierarchyVersion.document, 'intro').map((node) => node.id)).toEqual(['video']);
  });
});
