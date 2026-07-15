import type { CanvasDocument, CanvasNode } from '@guideanything/contracts';
import { describe, expect, it } from 'vitest';

import { getSwimlaneBounds, isContentNode, isPrimaryFlowNode, layoutFlowHierarchy } from './hierarchy';

const base = { position: { x: 0, y: 0 }, zIndex: 0 };
const start = (id: string, stageId?: string) => ({ ...base, id, type: 'start' as const, ...(stageId ? { stageId } : {}), data: { label: '开始', shape: 'start' as const } });
const process = (id: string, stageId?: string, laneId?: string) => ({ ...base, id, type: 'process' as const, ...(stageId ? { stageId } : {}), ...(laneId ? { laneId } : {}), data: { label: id, shape: 'process' as const } });
const end = (id: string, stageId?: string) => ({ ...base, id, type: 'end' as const, ...(stageId ? { stageId } : {}), data: { label: '结束', shape: 'end' as const } });
const markdown = (id: string, contentParentId?: string) => ({ ...base, id, type: 'markdown' as const, ...(contentParentId ? { contentParentId } : {}), data: { markdown: id } });
const image = (id: string, contentParentId?: string) => ({ ...base, id, type: 'image' as const, ...(contentParentId ? { contentParentId } : {}), data: { url: 'https://example.com/a.png', alt: id } });
const video = (id: string, contentParentId?: string) => ({ ...base, id, type: 'video' as const, ...(contentParentId ? { contentParentId } : {}), data: { url: 'https://example.com/a.mp4', keypoints: [] } });
const decision = (id: string, stageId?: string) => ({ ...base, id, type: 'decision' as const, ...(stageId ? { stageId } : {}), data: { label: '是否继续？', shape: 'decision' as const, branchLabels: ['是', '否'] } });
const edge = (id: string, source: string, target: string) => ({ id, source, target });
const makeDocument = (overrides: Partial<CanvasDocument>): CanvasDocument => ({ schemaVersion: 1, nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 }, steps: [], exitNodeIds: [], ...overrides });

describe('flow hierarchy layout', () => {
  it('places primary flow by business order while retaining responsibility metadata', () => {
    const derived: CanvasNode = {
      ...process('derived'),
      position: { x: 9_000, y: 8_000 },
      source: { referenceNodeId: 'reference', sourceGuideId: 'source-guide', sourceVersionId: 'source-version', sourceElementId: 'source-process' },
    };
    const result = layoutFlowHierarchy(makeDocument({
      stages: [{ id: 'prepare', title: '准备', order: 0 }, { id: 'entry', title: '录入', order: 1 }],
      lanes: [
        { id: 'sales', title: '销售人员', kind: 'ROLE', order: 0 },
        { id: 'erp', title: 'ERP', kind: 'SYSTEM', order: 1 },
      ],
      nodes: [
        process('collect', 'prepare', 'sales'),
        process('enter', 'entry', 'erp'),
        process('save', 'entry', 'erp'),
        markdown('attached-note', 'enter'),
        derived,
      ],
      edges: [edge('collect-enter', 'collect', 'enter'), edge('enter-save', 'enter', 'save')],
      entryNodeId: 'collect',
    }));
    const byId = new Map(result.document.nodes.map((node) => [node.id, node]));

    expect(byId.get('collect')!.position.y).toBeLessThan(byId.get('enter')!.position.y);
    expect(byId.get('collect')!.position.x).toBe(byId.get('enter')!.position.x);
    expect(byId.get('save')!.position.x).toBeGreaterThan(byId.get('enter')!.position.x);
    expect(byId.get('attached-note')!.position.x).toBe(byId.get('enter')!.position.x);
    expect(byId.get('attached-note')!.position.y).toBeGreaterThan(byId.get('enter')!.position.y);
    expect(result.report.laneCount).toBe(2);
    expect(getSwimlaneBounds(result.document).map((lane) => lane.title)).toEqual(['销售人员', 'ERP']);
    expect(result.stageBounds.map((stage) => stage.title)).toEqual(['准备', '录入']);
    expect(byId.get('derived')!.position).toEqual({ x: 9_000, y: 8_000 });
  });

  it('keeps empty configured stages and lanes visible in grid bounds', () => {
    const result = layoutFlowHierarchy(makeDocument({
      stages: [{ id: 'prepare', title: '准备', order: 0 }, { id: 'archive', title: '归档', order: 1 }],
      lanes: [
        { id: 'sales', title: '销售人员', kind: 'ROLE', order: 0 },
        { id: 'erp', title: 'ERP', kind: 'SYSTEM', order: 1 },
      ],
      nodes: [process('collect', 'prepare', 'sales')],
      edges: [],
    }));
    const [prepare, archive] = result.stageBounds;
    const [sales, erp] = getSwimlaneBounds(result.document);

    expect(result.stageBounds.map((stage) => stage.title)).toEqual(['准备', '归档']);
    expect(archive!.y).toBeGreaterThan(prepare!.y);
    expect(prepare!.width).toBe(archive!.width);
    expect(erp!.x).toBeGreaterThan(sales!.x);
    expect(erp!.width).toBeGreaterThan(0);
  });

  it('reserves an explicit unassigned stage area for loose authored resources', () => {
    const result = layoutFlowHierarchy(makeDocument({
      stages: [{ id: 'prepare', title: '准备', order: 0 }],
      lanes: [
        { id: 'sales', title: '销售人员', kind: 'ROLE', order: 0 },
        { id: 'erp', title: 'ERP', kind: 'SYSTEM', order: 1 },
      ],
      nodes: [
        process('collect', 'prepare', 'sales'),
        markdown('loose-markdown'),
        image('loose-image'),
        video('loose-video'),
      ],
      edges: [],
    }));
    const byId = new Map(result.document.nodes.map((node) => [node.id, node]));
    const unassignedStage = result.stageBounds.find((stage) => stage.title === '未分阶段')!;
    const loose = [
      [byId.get('loose-markdown')!, { width: 300, height: 180 }],
      [byId.get('loose-image')!, { width: 320, height: 260 }],
      [byId.get('loose-video')!, { width: 320, height: 260 }],
    ] as const;

    expect(result.stageBounds.map((stage) => stage.title)).toEqual(['准备', '未分阶段']);
    expect(getSwimlaneBounds(result.document).map((lane) => lane.title)).toEqual(['销售人员', 'ERP', '未分配责任']);
    loose.forEach(([node, size]) => {
      expect(node.position.x).toBeGreaterThanOrEqual(unassignedStage.x);
      expect(node.position.y).toBeGreaterThanOrEqual(unassignedStage.y);
      expect(node.position.x + size.width).toBeLessThanOrEqual(unassignedStage.x + unassignedStage.width);
      expect(node.position.y + size.height).toBeLessThanOrEqual(unassignedStage.y + unassignedStage.height);
    });
  });

  it('places source-free main flow, attached content, and stages deterministically', () => {
    const result = layoutFlowHierarchy(makeDocument({
      stages: [{ id: 'prepare', title: '准备', order: 0 }, { id: 'entry', title: '录入', order: 1 }],
      nodes: [start('start', 'prepare'), process('enter', 'entry'), end('end', 'entry'), markdown('note', 'enter'), image('screen', 'enter'), markdown('loose')],
      edges: [edge('e1', 'start', 'enter'), edge('e2', 'enter', 'end')],
      entryNodeId: 'start', exitNodeIds: ['end'],
    }));
    const byId = new Map(result.document.nodes.map((node) => [node.id, node]));

    expect(byId.get('start')!.position.x).toBe(byId.get('enter')!.position.x);
    expect(byId.get('enter')!.position.x).toBeLessThan(byId.get('end')!.position.x);
    expect(byId.get('note')!.position.x).toBe(byId.get('enter')!.position.x);
    expect(byId.get('note')!.position.y).toBeGreaterThan(byId.get('enter')!.position.y);
    expect(byId.get('screen')!.position.y).toBeGreaterThan(byId.get('note')!.position.y);
    expect(result.report.unassignedContentIds).toEqual(['loose']);
    expect(result.stageBounds.map((bound) => bound.title)).toEqual(['准备', '录入', '未分阶段']);
  });

  it('keeps connected resource nodes in the authored flow instead of dropping them below the business spine', () => {
    const result = layoutFlowHierarchy(makeDocument({
      nodes: [start('start'), markdown('context'), image('screen'), video('demo'), decision('check'), process('save'), end('done')],
      edges: [
        edge('e1', 'start', 'context'),
        edge('e2', 'context', 'screen'),
        edge('e3', 'screen', 'demo'),
        edge('e4', 'demo', 'check'),
        { ...edge('e5', 'check', 'save'), sourceHandle: 'yes' },
        edge('e6', 'save', 'done'),
      ],
      entryNodeId: 'start',
      exitNodeIds: ['done'],
    }));
    const byId = new Map(result.document.nodes.map((node) => [node.id, node]));

    expect(byId.get('start')!.position.x).toBeLessThan(byId.get('context')!.position.x);
    expect(byId.get('context')!.position.x).toBeLessThan(byId.get('screen')!.position.x);
    expect(byId.get('screen')!.position.x).toBeLessThan(byId.get('demo')!.position.x);
    expect(byId.get('demo')!.position.x).toBeLessThan(byId.get('check')!.position.x);
    expect(byId.get('check')!.position.x).toBeLessThan(byId.get('save')!.position.x);
    expect(byId.get('save')!.position.x).toBeLessThan(byId.get('done')!.position.x);
    expect(result.document.nodes.map((node) => node.id).sort()).toEqual(['check', 'context', 'demo', 'done', 'save', 'screen', 'start']);
    expect(result.report.unassignedContentIds).toEqual([]);
  });

  it('preserves deterministic ordering for cycles and isolated primary nodes', () => {
    const document = makeDocument({
      nodes: [
        start('start'),
        process('a'),
        process('b'),
        process('orphan'),
      ],
      edges: [edge('start-a', 'start', 'a'), edge('a-b', 'a', 'b'), edge('b-a', 'b', 'a')],
      entryNodeId: 'start',
    });

    const first = layoutFlowHierarchy(document);
    const second = layoutFlowHierarchy(document);

    expect(first.document.nodes.map((node) => node.position)).toEqual(second.document.nodes.map((node) => node.position));
    expect(first.report.cycleNodeIds).toEqual(['a', 'b']);
    expect(first.report.unconnectedPrimaryIds).toEqual(['orphan']);
  });

  it('leaves expanded subguide artifacts out of host layout', () => {
    const derived: CanvasNode = {
      ...process('derived'),
      position: { x: 912, y: 418 },
      source: { referenceNodeId: 'reference', sourceGuideId: 'source-guide', sourceVersionId: 'source-version', sourceElementId: 'source-process' },
    };
    const derivedContent: CanvasNode = {
      ...markdown('derived-note'),
      position: { x: 1_240, y: 418 },
      source: { referenceNodeId: 'reference', sourceGuideId: 'source-guide', sourceVersionId: 'source-version', sourceElementId: 'source-note' },
    };
    const document = makeDocument({
      nodes: [start('start'), process('authored'), derived, derivedContent],
      edges: [edge('authored-edge', 'start', 'authored'), edge('derived-edge', 'authored', 'derived')],
      entryNodeId: 'start',
    });

    const result = layoutFlowHierarchy(document);
    const byId = new Map(result.document.nodes.map((node) => [node.id, node]));

    expect(isPrimaryFlowNode(derived)).toBe(false);
    expect(isContentNode(derivedContent)).toBe(false);
    expect(byId.get('derived')!.position).toEqual({ x: 912, y: 418 });
    expect(byId.get('derived-note')!.position).toEqual({ x: 1_240, y: 418 });
    expect(result.report.primaryNodeIds).toEqual(['authored', 'start']);
  });

  it('ignores visible source-derived artifacts when calculating host stage bounds', () => {
    const derived: CanvasNode = {
      ...process('derived'),
      position: { x: 9_000, y: 8_000 },
      source: { referenceNodeId: 'reference', sourceGuideId: 'source-guide', sourceVersionId: 'source-version', sourceElementId: 'source-process' },
    };
    const derivedContent: CanvasNode = {
      ...markdown('derived-note'),
      position: { x: 12_000, y: 11_000 },
      source: { referenceNodeId: 'reference', sourceGuideId: 'source-guide', sourceVersionId: 'source-version', sourceElementId: 'source-note' },
    };
    const result = layoutFlowHierarchy(makeDocument({
      stages: [{ id: 'prepare', title: '准备', order: 0 }],
      nodes: [start('start', 'prepare'), process('authored', 'prepare'), derived, derivedContent],
      edges: [edge('e1', 'start', 'authored')],
      entryNodeId: 'start',
    }));
    const byId = new Map(result.document.nodes.map((node) => [node.id, node]));
    const [prepare] = result.stageBounds;

    expect(result.stageBounds.map((bound) => bound.title)).toEqual(['准备']);
    expect(prepare!.x + prepare!.width).toBeLessThan(1_000);
    expect(byId.get('derived')!.position).toEqual({ x: 9_000, y: 8_000 });
    expect(byId.get('derived-note')!.position).toEqual({ x: 12_000, y: 11_000 });
  });

  it('keeps an entry root at rank zero across a feedback cycle', () => {
    const result = layoutFlowHierarchy(makeDocument({
      nodes: [
        { ...start('start'), position: { x: 0, y: 0 } },
        { ...process('a'), position: { x: 10, y: 0 } },
        { ...process('b'), position: { x: 20, y: 0 } },
      ],
      edges: [edge('start-a', 'start', 'a'), edge('a-b', 'a', 'b'), edge('b-start', 'b', 'start')],
      entryNodeId: 'start',
    }));
    const byId = new Map(result.document.nodes.map((node) => [node.id, node]));

    expect(byId.get('start')!.position.x).toBeLessThan(byId.get('a')!.position.x);
    expect(byId.get('a')!.position.x).toBeLessThan(byId.get('b')!.position.x);
    expect(result.report.cycleNodeIds).toEqual(['start', 'a', 'b']);
  });

  it('keeps a normal DAG merge after both incoming ranks', () => {
    const result = layoutFlowHierarchy(makeDocument({
      nodes: [start('start'), process('left'), process('right'), process('merge')],
      edges: [
        edge('start-left', 'start', 'left'),
        edge('start-right', 'start', 'right'),
        edge('left-merge', 'left', 'merge'),
        edge('right-merge', 'right', 'merge'),
      ],
      entryNodeId: 'start',
    }));
    const byId = new Map(result.document.nodes.map((node) => [node.id, node]));

    expect(byId.get('start')!.position.x).toBeLessThan(byId.get('left')!.position.x);
    expect(byId.get('start')!.position.x).toBeLessThan(byId.get('right')!.position.x);
    expect(byId.get('left')!.position.x).toBeLessThan(byId.get('merge')!.position.x);
    expect(byId.get('right')!.position.x).toBeLessThan(byId.get('merge')!.position.x);
  });

  it('places yes before no for sibling decision branches regardless of their prior positions', () => {
    const result = layoutFlowHierarchy(makeDocument({
      nodes: [
        start('start'),
        decision('continue'),
        { ...process('no-branch'), position: { x: 0, y: 0 } },
        { ...process('yes-branch'), position: { x: 0, y: 600 } },
      ],
      edges: [
        edge('start-continue', 'start', 'continue'),
        { ...edge('continue-no', 'continue', 'no-branch'), sourceHandle: 'no' },
        { ...edge('continue-yes', 'continue', 'yes-branch'), sourceHandle: 'yes' },
      ],
      entryNodeId: 'start',
    }));
    const byId = new Map(result.document.nodes.map((node) => [node.id, node]));

    expect(byId.get('yes-branch')!.position.y).toBeLessThan(byId.get('no-branch')!.position.y);
  });

  it('keeps ordered decision branches together when an unrelated node shares their rank', () => {
    const result = layoutFlowHierarchy(makeDocument({
      nodes: [
        start('start'),
        decision('continue'),
        process('parallel'),
        { ...process('no-branch'), position: { x: 0, y: 0 } },
        { ...process('unrelated'), position: { x: 0, y: 300 } },
        { ...process('yes-branch'), position: { x: 0, y: 600 } },
      ],
      edges: [
        edge('start-continue', 'start', 'continue'),
        edge('start-parallel', 'start', 'parallel'),
        { ...edge('continue-no', 'continue', 'no-branch'), sourceHandle: 'no' },
        { ...edge('continue-yes', 'continue', 'yes-branch'), sourceHandle: 'yes' },
        edge('parallel-unrelated', 'parallel', 'unrelated'),
      ],
      entryNodeId: 'start',
    }));
    const byId = new Map(result.document.nodes.map((node) => [node.id, node]));

    expect(byId.get('yes-branch')!.position.y).toBeLessThan(byId.get('no-branch')!.position.y);
  });

  it('resets each configured stage to the left baseline while stages advance downward', () => {
    const result = layoutFlowHierarchy(makeDocument({
      stages: [{ id: 'prepare', title: '准备', order: 0 }, { id: 'execute', title: '执行', order: 1 }],
      nodes: [start('start', 'prepare'), process('prepare-end', 'prepare'), process('execute-start', 'execute'), end('done', 'execute')],
      edges: [edge('e1', 'start', 'prepare-end'), edge('e2', 'prepare-end', 'execute-start'), edge('e3', 'execute-start', 'done')],
      entryNodeId: 'start',
    }));
    const byId = new Map(result.document.nodes.map((node) => [node.id, node]));

    expect(byId.get('prepare-end')!.position.x).toBeGreaterThan(byId.get('start')!.position.x);
    expect(byId.get('execute-start')!.position.x).toBe(byId.get('start')!.position.x);
    expect(byId.get('execute-start')!.position.y).toBeGreaterThan(byId.get('prepare-end')!.position.y);
    expect(byId.get('done')!.position.x).toBeGreaterThan(byId.get('execute-start')!.position.x);
  });

  it('keeps the yes branch on the main row and places the no branch below it', () => {
    const result = layoutFlowHierarchy(makeDocument({
      stages: [{ id: 'check', title: '检查', order: 0 }],
      nodes: [start('start', 'check'), decision('check-stock', 'check'), process('yes', 'check'), process('no', 'check'), process('merge', 'check')],
      edges: [
        edge('start-check', 'start', 'check-stock'),
        { ...edge('yes-edge', 'check-stock', 'yes'), sourceHandle: 'yes' },
        { ...edge('no-edge', 'check-stock', 'no'), sourceHandle: 'no' },
        edge('yes-merge', 'yes', 'merge'), edge('no-merge', 'no', 'merge'),
      ],
      entryNodeId: 'start',
    }));
    const byId = new Map(result.document.nodes.map((node) => [node.id, node]));

    expect(byId.get('yes')!.position.y).toBe(byId.get('check-stock')!.position.y);
    expect(byId.get('no')!.position.y).toBeGreaterThan(byId.get('yes')!.position.y);
    expect(byId.get('merge')!.position.x).toBeGreaterThan(byId.get('yes')!.position.x);
    expect(byId.get('merge')!.position.x).toBeGreaterThan(byId.get('no')!.position.x);
  });

  it('reports backward edges without moving the entry behind the cycle', () => {
    const result = layoutFlowHierarchy(makeDocument({
      nodes: [start('start'), process('review'), process('approve')],
      edges: [edge('start-review', 'start', 'review'), edge('review-approve', 'review', 'approve'), edge('approve-review', 'approve', 'review')],
      entryNodeId: 'start',
    }));
    const byId = new Map(result.document.nodes.map((node) => [node.id, node]));

    expect(byId.get('start')!.position.x).toBeLessThan(byId.get('review')!.position.x);
    expect(byId.get('review')!.position.x).toBeLessThan(byId.get('approve')!.position.x);
    expect(result.report.backEdgeIds).toEqual(['approve-review']);
  });
});
