import type { CanvasDocument, CanvasNode } from '@guideanything/contracts';
import { describe, expect, it } from 'vitest';

import { getStageBounds, getSwimlaneBounds, isContentNode, isPrimaryFlowNode, layoutFlowHierarchy, movePrimaryNodeToStage, translateStageNodes } from './hierarchy';
import { routeCanvasEdges } from './routing';
import { createComplexSemanticFlowDocument } from './complex-semantic-flow-fixture';

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

function assertNoPrimaryOverlap(document: CanvasDocument): void {
  const primary = document.nodes.filter((node) => !node.hidden && isPrimaryFlowNode(node));
  primary.forEach((left, leftIndex) => {
    const leftWidth = left.size?.width ?? 240;
    const leftHeight = left.size?.height ?? 104;
    primary.slice(leftIndex + 1).forEach((right) => {
      const rightWidth = right.size?.width ?? 240;
      const rightHeight = right.size?.height ?? 104;
      const overlapWidth = Math.min(left.position.x + leftWidth, right.position.x + rightWidth) - Math.max(left.position.x, right.position.x);
      const overlapHeight = Math.min(left.position.y + leftHeight, right.position.y + rightHeight) - Math.max(left.position.y, right.position.y);
      expect(overlapWidth > 0 && overlapHeight > 0, `${left.id} overlaps ${right.id}`).toBe(false);
    });
  });
}

describe('flow hierarchy layout', () => {
  it('lays out an inherited child tree to the right without overlapping later top-level blocks', () => {
    const result = layoutFlowHierarchy(createComplexSemanticFlowDocument());
    const byId = new Map(result.document.nodes.map((node) => [node.id, node]));
    const collect = byId.get('collect')!;
    const normalize = byId.get('normalize')!;
    const parse = byId.get('parse')!;
    const manual = byId.get('manual')!;
    const recheck = byId.get('recheck')!;
    const confirm = byId.get('confirm')!;
    const approve = byId.get('approve')!;

    expect(normalize.position.x).toBeGreaterThan(collect.position.x);
    expect(confirm.position.x).toBe(normalize.position.x);
    expect(confirm.position.y).toBeGreaterThan(normalize.position.y);
    expect(parse.position.x).toBe(manual.position.x);
    expect(parse.position.x).toBeGreaterThan(normalize.position.x);
    expect(manual.position.y).toBeGreaterThan(parse.position.y);
    expect(recheck.position.x).toBeGreaterThan(manual.position.x);
    expect(approve.position.y).toBeGreaterThan(recheck.position.y + (recheck.size?.height ?? 0));
    assertNoPrimaryOverlap(result.document);

    const intake = result.stageBounds.find((bound) => bound.stageId === 'intake')!;
    [collect, normalize, parse, manual, recheck, confirm, approve].forEach((node) => {
      expect(node.position.x).toBeGreaterThanOrEqual(intake.x);
      expect(node.position.x + (node.size?.width ?? 240)).toBeLessThanOrEqual(intake.x + intake.width);
      expect(node.position.y).toBeGreaterThanOrEqual(intake.y);
      expect(node.position.y + (node.size?.height ?? 104)).toBeLessThanOrEqual(intake.y + intake.height);
    });
    const sales = getSwimlaneBounds(result.document).find((bound) => bound.laneId === 'sales')!;
    expect(sales.width).toBeGreaterThan(240 + 72);
    const swimlanes = getSwimlaneBounds(result.document).sort((left, right) => left.x - right.x);
    swimlanes.slice(1).forEach((lane, index) => {
      const previous = swimlanes[index]!;
      expect(previous.x + previous.width).toBeLessThanOrEqual(lane.x);
    });
    result.document.nodes.filter((node) => !node.hidden && isPrimaryFlowNode(node)).forEach((node) => {
      const lane = swimlanes.find((candidate) => candidate.laneId === node.laneId)!;
      expect(node.position.x).toBeGreaterThanOrEqual(lane.x);
      expect(node.position.x + (node.size?.width ?? 240)).toBeLessThanOrEqual(lane.x + lane.width);
      expect(node.position.y).toBeGreaterThanOrEqual(lane.y);
      expect(node.position.y + (node.size?.height ?? 104)).toBeLessThanOrEqual(lane.y + lane.height);
    });
  });

  it('inherits the parent stage and lane when a semantic child omits cell metadata', () => {
    const source = createComplexSemanticFlowDocument();
    const expected = layoutFlowHierarchy(source);
    const document: CanvasDocument = {
      ...source,
      nodes: source.nodes.map((node) => ['normalize', 'confirm'].includes(node.id)
        ? { ...node, stageId: undefined, laneId: undefined }
        : node),
    };
    const result = layoutFlowHierarchy(document);
    const byId = new Map(result.document.nodes.map((node) => [node.id, node]));
    const expectedById = new Map(expected.document.nodes.map((node) => [node.id, node]));

    expect(byId.get('normalize')!.position).toEqual(expectedById.get('normalize')!.position);
    expect(byId.get('confirm')!.position).toEqual(expectedById.get('confirm')!.position);
    expect(getSwimlaneBounds(result.document).some((bound) => bound.laneId === null)).toBe(false);
  });

  it('keeps three direct children in one column and only moves grandchildren to the next column', () => {
    const source = createComplexSemanticFlowDocument();
    const collect = source.nodes.find((node) => node.id === 'collect')!;
    const thirdChild: CanvasNode = {
      ...collect,
      id: 'collect-third-child',
      position: { x: -900, y: 3_000 },
      outline: { parentId: 'collect', order: 2, kind: 'STEP' },
      data: { label: '第三个子节点', shape: 'process' },
    } as CanvasNode;
    const result = layoutFlowHierarchy({
      ...source,
      nodes: [...source.nodes, thirdChild],
      edges: [...source.edges, { id: 'flow-collect-third-child', source: 'collect', target: thirdChild.id, semantic: { kind: 'FLOW' } }],
    });
    const byId = new Map(result.document.nodes.map((node) => [node.id, node]));
    const firstChild = byId.get('normalize')!;
    const secondChild = byId.get('confirm')!;
    const thirdDirectChild = byId.get('collect-third-child')!;
    const grandchild = byId.get('parse')!;

    expect(firstChild.position.x).toBe(secondChild.position.x);
    expect(secondChild.position.x).toBe(thirdDirectChild.position.x);
    expect(firstChild.position.y).toBeLessThan(secondChild.position.y);
    expect(secondChild.position.y).toBeLessThan(thirdDirectChild.position.y);
    expect(grandchild.position.x).toBeGreaterThan(firstChild.position.x);
  });

  it('treats three primary flow targets from one process as siblings even when one stale outline points deeper', () => {
    const source = createComplexSemanticFlowDocument();
    const result = layoutFlowHierarchy({
      ...source,
      edges: [...source.edges, { id: 'flow-normalize-recheck', source: 'normalize', target: 'recheck', semantic: { kind: 'FLOW' } }],
    });
    const byId = new Map(result.document.nodes.map((node) => [node.id, node]));

    expect(byId.get('parse')!.position.x).toBe(byId.get('manual')!.position.x);
    expect(byId.get('manual')!.position.x).toBe(byId.get('recheck')!.position.x);
    expect(byId.get('parse')!.position.y).toBeLessThan(byId.get('manual')!.position.y);
    expect(byId.get('manual')!.position.y).toBeLessThan(byId.get('recheck')!.position.y);
  });

  it('sizes a swimlane from the reconciled fan-out before the layout is applied', () => {
    const source = createComplexSemanticFlowDocument();
    const document: CanvasDocument = {
      ...source,
      edges: [...source.edges, { id: 'flow-normalize-recheck', source: 'normalize', target: 'recheck', semantic: { kind: 'FLOW' } }],
    };
    const arranged = layoutFlowHierarchy(document).document;
    const rawSales = getSwimlaneBounds(document).find((bound) => bound.laneId === 'sales')!;
    const arrangedSales = getSwimlaneBounds(arranged).find((bound) => bound.laneId === 'sales')!;

    expect(rawSales.width).toBe(arrangedSales.width);
  });

  it('relinks a simple legacy primary chain to the global semantic order during automatic layout', () => {
    const result = layoutFlowHierarchy(makeDocument({
      stages: [{ id: 'intake', title: '客户提案阶段', order: 0 }],
      lanes: [
        { id: 'sales', title: '业务', kind: 'ROLE', order: 0 },
        { id: 'craft', title: '工艺员', kind: 'ROLE', order: 1 },
      ],
      nodes: [
        {
          ...start('receive', 'intake'),
          laneId: 'sales',
          size: { width: 240, height: 129 },
          data: { label: '收到客人提案需求，可以是邮件或者微信', shape: 'start' },
          outline: { order: 0, kind: 'STEP' },
        },
        { ...process('operate', 'intake', 'craft'), outline: { order: 1, kind: 'STEP' } },
        { ...process('confirm', 'intake', 'sales'), outline: { order: 2, kind: 'STEP' } },
      ],
      edges: [
        {
          ...edge('receive-confirm', 'receive', 'confirm'),
          sourceHandle: 'out',
          targetHandle: 'in',
          presentation: {
            sourceAnchor: { side: 'BOTTOM', offset: 0.51 },
            targetAnchor: { side: 'TOP', offset: 0.49 },
          },
        },
        { ...edge('confirm-operate', 'confirm', 'operate'), sourceHandle: 'out', targetHandle: 'in' },
      ],
      entryNodeId: 'receive',
    }));
    const byId = new Map(result.document.edges.map((candidate) => [candidate.id, candidate]));
    const routing = routeCanvasEdges(result.document);

    expect(byId.get('receive-confirm')).toMatchObject({
      source: 'receive', target: 'operate', semantic: { kind: 'FLOW' },
    });
    expect(byId.get('receive-confirm')?.presentation).toBeUndefined();
    expect(byId.get('confirm-operate')).toMatchObject({
      source: 'operate', target: 'confirm', semantic: { kind: 'FLOW' },
    });
    expect(routing.report.backEdgeIds).toEqual([]);
    expect(routing.report.avoidedEdgeIds).toEqual([]);
  });

  it('uses semantic order to place a fixed stage and lane matrix without reading prior coordinates', () => {
    const result = layoutFlowHierarchy(makeDocument({
      stages: [
        { id: 'intake', title: '需求确认', order: 0 },
        { id: 'production', title: '生产准备', order: 1 },
      ],
      lanes: [
        { id: 'sales', title: '业务', kind: 'ROLE', order: 0 },
        { id: 'erp', title: 'ERP', kind: 'SYSTEM', order: 1 },
      ],
      nodes: [
        { ...process('receive', 'intake', 'sales'), position: { x: 9_000, y: 8_000 }, outline: { order: 0, kind: 'STEP' } },
        { ...process('confirm', 'intake', 'erp'), position: { x: -2_000, y: -1_000 }, outline: { order: 1, kind: 'STEP' } },
        { ...process('revise', 'intake', 'sales'), position: { x: 50_000, y: 120 }, outline: { order: 2, kind: 'STEP' } },
        { ...process('prepare', 'production', 'erp'), position: { x: 80, y: 80 }, outline: { order: 3, kind: 'STEP' } },
        { ...markdown('specification'), attachment: { ownerNodeId: 'confirm', order: 0 } },
      ],
      edges: [
        { ...edge('receive-confirm', 'receive', 'confirm'), semantic: { kind: 'FLOW' } },
        { ...edge('confirm-revise', 'confirm', 'revise'), semantic: { kind: 'FLOW' } },
        { ...edge('revise-prepare', 'revise', 'prepare'), semantic: { kind: 'FLOW' } },
      ],
      entryNodeId: 'receive',
    }));
    const byId = new Map(result.document.nodes.map((node) => [node.id, node]));
    const receive = byId.get('receive')!;
    const confirm = byId.get('confirm')!;
    const revise = byId.get('revise')!;
    const prepare = byId.get('prepare')!;
    const specification = byId.get('specification')!;
    const intake = result.stageBounds.find((bound) => bound.stageId === 'intake')!;

    expect(receive.position.x).toBeLessThan(confirm.position.x);
    expect(receive.position.y).toBe(confirm.position.y);
    expect(revise.position.x).toBe(receive.position.x);
    expect(revise.position.y).toBeGreaterThan(receive.position.y);
    expect(prepare.position.y).toBeGreaterThan(revise.position.y);
    expect(specification.position.x).toBeGreaterThan(intake.x + intake.width);
    expect(specification.position.y).toBe(confirm.position.y);
    expect(result.report.attachedContentIds).toEqual(['specification']);
  });

  it('puts semantic appendix resources on the external rail nearest their owner', () => {
    const result = layoutFlowHierarchy(makeDocument({
      stages: [{ id: 'intake', title: '需求确认', order: 0 }],
      lanes: [
        { id: 'sales', title: '业务', kind: 'ROLE', order: 0 },
        { id: 'erp', title: 'ERP', kind: 'SYSTEM', order: 1 },
      ],
      nodes: [
        { ...process('receive', 'intake', 'sales'), outline: { order: 0, kind: 'STEP' } },
        { ...process('confirm', 'intake', 'erp'), outline: { order: 1, kind: 'STEP' } },
        { ...markdown('specification'), attachment: { ownerNodeId: 'receive', order: 0 } },
      ],
      edges: [],
    }));
    const byId = new Map(result.document.nodes.map((node) => [node.id, node]));
    const specification = byId.get('specification')!;
    const intake = result.stageBounds.find((bound) => bound.stageId === 'intake')!;

    expect(specification.position.x + 300).toBeLessThan(intake.x);
  });

  it('moves a primary node into its new stage and keeps stage rows separated', () => {
    const result = movePrimaryNodeToStage(makeDocument({
      stages: [
        { id: 'request', title: '客人提案', order: 0 },
        { id: 'proposal', title: '客人提案阶段', order: 1 },
      ],
      nodes: [
        { ...start('start', 'request'), position: { x: 0, y: 0 } },
        { ...process('proposal-node', 'proposal'), position: { x: 0, y: 0 } },
        { ...process('moved', 'request'), position: { x: 600, y: 0 } },
        markdown('moved-note', 'moved'),
      ],
      edges: [],
    }), 'moved', 'proposal');
    const moved = result.nodes.find((node) => node.id === 'moved')!;
    const note = result.nodes.find((node) => node.id === 'moved-note')!;
    const bounds = getStageBounds(result);
    const request = bounds.find((bound) => bound.stageId === 'request')!;
    const proposal = bounds.find((bound) => bound.stageId === 'proposal')!;

    expect(moved.stageId).toBe('proposal');
    expect(moved.position.y).toBeGreaterThanOrEqual(proposal.y);
    expect(note.position.x + 300).toBeLessThan(proposal.x);
    expect(note.position.y).toBe(moved.position.y);
    expect(proposal.y).toBeGreaterThan(request.y + request.height);
  });

  it('translates a stage together with its legacy attached content without moving other stages', () => {
    const document = makeDocument({
      stages: [{ id: 'request', title: '客人提案阶段', order: 0 }, { id: 'review', title: '复核', order: 1 }],
      nodes: [
        { ...start('start', 'request'), position: { x: 0, y: 0 } },
        { ...process('review-node', 'review'), position: { x: 320, y: 400 } },
        { ...markdown('note', 'start'), position: { x: 0, y: 128 } },
      ],
      edges: [],
    });

    const result = translateStageNodes(document, 'request', { x: 120, y: 80 });
    const originalBounds = getStageBounds(document).find((bound) => bound.stageId === 'request')!;
    const translatedBounds = getStageBounds(result).find((bound) => bound.stageId === 'request')!;

    expect(result.nodes.find((node) => node.id === 'start')!.position).toEqual({ x: 120, y: 80 });
    expect(result.nodes.find((node) => node.id === 'note')!.position).toEqual({ x: 120, y: 208 });
    expect(result.nodes.find((node) => node.id === 'review-node')!.position).toEqual({ x: 320, y: 400 });
    expect(translatedBounds.x).toBe(originalBounds.x + 120);
    expect(translatedBounds.y).toBe(originalBounds.y + 80);
  });

  it('translates content linked by a real canvas edge together with its stage', () => {
    const document = makeDocument({
      stages: [{ id: 'request', title: '客人提案阶段', order: 0 }],
      nodes: [
        { ...start('start', 'request'), position: { x: 0, y: 0 } },
        { ...markdown('linked-note'), position: { x: 0, y: 128 } },
      ],
      edges: [edge('start-note', 'start', 'linked-note')],
    });

    const result = translateStageNodes(document, 'request', { x: 120, y: 80 });
    const bounds = getStageBounds(result).find((bound) => bound.stageId === 'request')!;
    const linkedNote = result.nodes.find((node) => node.id === 'linked-note')!;

    expect(linkedNote.position).toEqual({ x: 120, y: 208 });
    expect(linkedNote.position.x).toBeGreaterThanOrEqual(bounds.x);
    expect(linkedNote.position.y).toBeGreaterThanOrEqual(bounds.y);
  });

  it('persists a drag for an empty stage', () => {
    const document = makeDocument({
      stages: [{ id: 'request', title: '客人提案阶段', order: 0 }, { id: 'review', title: '复核', order: 1 }],
      nodes: [{ ...start('start', 'request'), position: { x: 0, y: 0 } }],
      edges: [],
    });
    const original = getStageBounds(document).find((bound) => bound.stageId === 'review')!;

    const result = translateStageNodes(document, 'review', { x: 120, y: 80 });
    const moved = getStageBounds(result).find((bound) => bound.stageId === 'review')!;

    expect(result.stages?.find((stage) => stage.id === 'review')?.position).toEqual({ x: original.x + 120, y: original.y + 80 });
    expect(moved.x).toBe(original.x + 120);
    expect(moved.y).toBe(original.y + 80);
  });

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
    const entry = result.stageBounds.find((stage) => stage.stageId === 'entry')!;

    expect(byId.get('collect')!.position.y).toBeLessThan(byId.get('enter')!.position.y);
    expect(byId.get('collect')!.position.x).toBe(byId.get('enter')!.position.x);
    expect(byId.get('save')!.position.x).toBeGreaterThan(byId.get('enter')!.position.x);
    expect(byId.get('attached-note')!.position.x + 300).toBeLessThan(entry.x);
    expect(byId.get('attached-note')!.position.y).toBe(byId.get('enter')!.position.y);
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

  it('keeps loose authored resources outside the business-stage frames until they are attached', () => {
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
    const prepareStage = result.stageBounds.find((stage) => stage.stageId === 'prepare')!;
    const loose = [
      [byId.get('loose-markdown')!, { width: 300, height: 180 }],
      [byId.get('loose-image')!, { width: 320, height: 260 }],
      [byId.get('loose-video')!, { width: 320, height: 260 }],
    ] as const;

    expect(result.stageBounds.map((stage) => stage.title)).toEqual(['准备']);
    expect(getSwimlaneBounds(result.document).map((lane) => lane.title)).toEqual(['销售人员', 'ERP']);
    loose.forEach(([node, size]) => {
      expect(node.position.y).toBeGreaterThan(prepareStage.y + prepareStage.height);
      expect(node.position.x + size.width).toBeGreaterThan(prepareStage.x);
    });
  });

  it('keeps a legacy edge-linked resource in its owner stage bounds', () => {
    const instruction = {
      ...markdown('instruction'),
      position: { x: 40, y: 220 },
      size: { width: 300, height: 180 },
    };
    const [prepare] = getStageBounds(makeDocument({
      stages: [{ id: 'prepare', title: '准备', order: 0 }],
      nodes: [process('confirm', 'prepare'), instruction],
      edges: [edge('confirm-instruction', 'confirm', 'instruction')],
    }));

    expect(prepare!.y + prepare!.height).toBeGreaterThanOrEqual(instruction.position.y + instruction.size.height);
  });

  it('places source-free main flow, attached content, and stages deterministically', () => {
    const result = layoutFlowHierarchy(makeDocument({
      stages: [{ id: 'prepare', title: '准备', order: 0 }, { id: 'entry', title: '录入', order: 1 }],
      nodes: [start('start', 'prepare'), process('enter', 'entry'), end('end', 'entry'), markdown('note', 'enter'), image('screen', 'enter'), markdown('loose')],
      edges: [edge('e1', 'start', 'enter'), edge('e2', 'enter', 'end')],
      entryNodeId: 'start', exitNodeIds: ['end'],
    }));
    const byId = new Map(result.document.nodes.map((node) => [node.id, node]));
    const entry = result.stageBounds.find((stage) => stage.stageId === 'entry')!;

    expect(byId.get('start')!.position.x).toBe(byId.get('enter')!.position.x);
    expect(byId.get('enter')!.position.x).toBeLessThan(byId.get('end')!.position.x);
    expect(byId.get('note')!.position.x + 300).toBeLessThan(entry.x);
    expect(byId.get('screen')!.position.x + 320).toBeLessThan(entry.x);
    expect(byId.get('note')!.position.y).toBe(byId.get('enter')!.position.y);
    expect(byId.get('screen')!.position.y).toBeGreaterThan(byId.get('note')!.position.y);
    expect(result.report.unassignedContentIds).toEqual(['loose']);
    expect(result.stageBounds.map((bound) => bound.title)).toEqual(['准备', '录入']);
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

    expectBeforeInFlow(byId.get('start')!, byId.get('context')!);
    expectBeforeInFlow(byId.get('context')!, byId.get('screen')!);
    expectBeforeInFlow(byId.get('screen')!, byId.get('demo')!);
    expectBeforeInFlow(byId.get('demo')!, byId.get('check')!);
    expectBeforeInFlow(byId.get('check')!, byId.get('save')!);
    expectBeforeInFlow(byId.get('save')!, byId.get('done')!);
    expect(result.document.nodes.map((node) => node.id).sort()).toEqual(['check', 'context', 'demo', 'done', 'save', 'screen', 'start']);
    expect(result.report.unassignedContentIds).toEqual([]);
  });

  it('wraps a resized media-heavy flow instead of stretching one unbounded row', () => {
    const resizedImage = { ...image('screen'), size: { width: 982, height: 517 } };
    const resizedVideo = { ...video('demo'), size: { width: 657, height: 285 } };
    const result = layoutFlowHierarchy(makeDocument({
      nodes: [
        start('start'),
        markdown('context'),
        resizedImage,
        resizedVideo,
        decision('check'),
        process('save'),
        end('done'),
      ],
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
    const visible = result.document.nodes.filter((node) => !node.hidden && !node.source);
    const maximumRight = Math.max(...visible.map((node) => node.position.x + (node.size?.width ?? defaultWidth(node))));

    expect(maximumRight).toBeLessThanOrEqual(1_800);
    expect(byId.get('screen')!.size).toEqual({ width: 982, height: 517 });
    expect(byId.get('demo')!.size).toEqual({ width: 657, height: 285 });
    expect(visible.some((node) => node.position.y > 0)).toBe(true);
    expectNoNodeOverlap(visible);
  });

  it('keeps a decision feedback loop stable across repeated automatic layouts', () => {
    const document = makeDocument({
      nodes: [start('start'), markdown('context'), decision('check'), process('save'), process('fix'), end('done')],
      edges: [
        edge('start-context', 'start', 'context'),
        edge('context-check', 'context', 'check'),
        { ...edge('check-save', 'check', 'save'), sourceHandle: 'yes' },
        edge('save-done', 'save', 'done'),
        { ...edge('check-fix', 'check', 'fix'), sourceHandle: 'no' },
        edge('fix-check', 'fix', 'check'),
      ],
      entryNodeId: 'start',
      exitNodeIds: ['done'],
    });

    const first = layoutFlowHierarchy(document);
    const second = layoutFlowHierarchy(first.document);
    const firstById = new Map(first.document.nodes.map((node) => [node.id, node]));

    expect(second.document.nodes.map((node) => node.position)).toEqual(first.document.nodes.map((node) => node.position));
    expect(firstById.get('check')!.position.x).toBeLessThan(firstById.get('save')!.position.x);
    expect(firstById.get('save')!.position.x).toBeLessThan(firstById.get('done')!.position.x);
    expect(firstById.get('fix')!.position.y).toBeGreaterThan(firstById.get('save')!.position.y);
    expect(first.report.backEdgeIds).toEqual(['fix-check']);
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

  it('keeps expanded subguide artifacts together and reserves space before loose resources', () => {
    const reference: CanvasNode<'subguide'> = {
      ...base,
      id: 'reference',
      type: 'subguide',
      data: {
        guideId: 'source-guide',
        guideVersionId: 'source-version',
        title: '物料主数据检查',
        version: 1,
        expanded: true,
      },
    };
    const derivedStart: CanvasNode = {
      ...process('derived-start'),
      position: { x: 9_000, y: 8_000 },
      source: { referenceNodeId: 'reference', sourceGuideId: 'source-guide', sourceVersionId: 'source-version', sourceElementId: 'source-start' },
    };
    const derivedEnd: CanvasNode = {
      ...process('derived-end'),
      position: { x: 9_360, y: 8_220 },
      source: { referenceNodeId: 'reference', sourceGuideId: 'source-guide', sourceVersionId: 'source-version', sourceElementId: 'source-end' },
    };
    const looseVideo = { ...video('loose-video'), size: { width: 613, height: 425 } };
    const result = layoutFlowHierarchy(makeDocument({
      nodes: [start('start'), reference, derivedStart, derivedEnd, looseVideo],
      edges: [edge('start-reference', 'start', 'reference')],
      entryNodeId: 'start',
    }));
    const byId = new Map(result.document.nodes.map((node) => [node.id, node]));
    const movedStart = byId.get('derived-start')!;
    const movedEnd = byId.get('derived-end')!;

    expect({
      x: movedEnd.position.x - movedStart.position.x,
      y: movedEnd.position.y - movedStart.position.y,
    }).toEqual({ x: 360, y: 220 });
    expect(movedStart.position.y).toBeGreaterThan(byId.get('reference')!.position.y + 120);
    expect(byId.get('loose-video')!.position.y).toBeGreaterThan(movedEnd.position.y + 104);
    expectNoNodeOverlap(result.document.nodes.filter((node) => !node.hidden));
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

function defaultWidth(node: CanvasNode): number {
  if (node.type === 'markdown') return 300;
  if (node.type === 'image' || node.type === 'video') return 320;
  return 240;
}

function defaultHeight(node: CanvasNode): number {
  if (node.type === 'markdown') return 180;
  if (node.type === 'image' || node.type === 'video') return 260;
  if (node.type === 'subguide') return 120;
  return 104;
}

function expectNoNodeOverlap(nodes: CanvasNode[]) {
  nodes.forEach((node, index) => {
    const width = node.size?.width ?? defaultWidth(node);
    const height = node.size?.height ?? defaultHeight(node);
    nodes.slice(index + 1).forEach((other) => {
      const otherWidth = other.size?.width ?? defaultWidth(other);
      const otherHeight = other.size?.height ?? defaultHeight(other);
      const separated = node.position.x + width <= other.position.x
        || other.position.x + otherWidth <= node.position.x
        || node.position.y + height <= other.position.y
        || other.position.y + otherHeight <= node.position.y;
      expect(separated, `${node.id} overlaps ${other.id}`).toBe(true);
    });
  });
}

function expectBeforeInFlow(left: CanvasNode, right: CanvasNode) {
  expect(left.position.y < right.position.y || (left.position.y === right.position.y && left.position.x < right.position.x)).toBe(true);
}
