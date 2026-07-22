import type { CanvasDocument, CanvasEdge, CanvasNode, FlowLane, FlowStage } from '@guideanything/contracts';

const stages: FlowStage[] = [
  { id: 'intake', title: '需求确认', order: 0 },
  { id: 'production', title: '生产准备', order: 1 },
  { id: 'delivery', title: '交付', order: 2 },
];

const lanes: FlowLane[] = [
  { id: 'sales', title: '业务', kind: 'ROLE', order: 0 },
  { id: 'erp', title: 'ERP', kind: 'SYSTEM', order: 1 },
  { id: 'craft', title: '工艺员', kind: 'ROLE', order: 2 },
  { id: 'quality', title: '质检', kind: 'ROLE', order: 3 },
];

type PrimaryType = 'start' | 'end' | 'process' | 'decision' | 'data' | 'subguide';
type PrimaryOutline = NonNullable<CanvasNode['outline']>;

const primary = (
  id: string,
  type: PrimaryType,
  stageId: string,
  laneId: string,
  label: string,
  outline: PrimaryOutline,
  size: { width: number; height: number },
): CanvasNode => ({
  id,
  type,
  position: { x: 9_000 - id.length * 37, y: -3_000 + id.length * 19 },
  size,
  zIndex: 0,
  stageId,
  laneId,
  outline,
  data: type === 'subguide'
    ? { guideId: `${id}-guide`, guideVersionId: `${id}-version`, title: label, version: 1, expanded: true }
    : { label, shape: type, ...(type === 'decision' ? { branchLabels: ['通过', '驳回'] } : {}) },
} as CanvasNode);

const markdown = (id: string, ownerNodeId: string, order: number): CanvasNode => ({
  id,
  type: 'markdown',
  position: { x: 6_400, y: -2_100 },
  size: { width: 300, height: 180 },
  zIndex: 4,
  attachment: { ownerNodeId, order },
  data: { markdown: `# ${id}` },
} as CanvasNode);

const image = (id: string, ownerNodeId: string, order: number): CanvasNode => ({
  id,
  type: 'image',
  position: { x: 6_800, y: -1_500 },
  size: { width: 320, height: 220 },
  zIndex: 4,
  attachment: { ownerNodeId, order },
  data: { url: 'https://example.com/complex-flow.png', alt: id },
} as CanvasNode);

const video = (id: string, ownerNodeId: string, order: number): CanvasNode => ({
  id,
  type: 'video',
  position: { x: 7_200, y: -900 },
  size: { width: 320, height: 240 },
  zIndex: 4,
  attachment: { ownerNodeId, order },
  data: { url: 'https://example.com/complex-flow.mp4', keypoints: [] },
} as CanvasNode);

const sourceDerived = (id: string, referenceNodeId: string): CanvasNode => ({
  id,
  type: 'process',
  position: { x: 12_000, y: 12_000 },
  size: { width: 240, height: 104 },
  zIndex: 1,
  source: {
    referenceNodeId,
    sourceGuideId: 'source-guide',
    sourceVersionId: 'source-version',
    sourceElementId: 'source-element',
  },
  data: { label: '来源子指南内部节点', shape: 'process' },
} as CanvasNode);

const edge = (id: string, source: string, target: string, semantic?: CanvasEdge['semantic'], label?: string): CanvasEdge => ({
  id,
  source,
  target,
  ...(semantic ? { semantic } : {}),
  ...(label ? { label } : {}),
});

export function createComplexSemanticFlowDocument(): CanvasDocument {
  const nodes: CanvasNode[] = [
    primary('entry', 'start', 'intake', 'sales', '接收需求', { order: 0, kind: 'STEP' }, { width: 240, height: 104 }),
    primary('collect', 'process', 'intake', 'sales', '整理需求树', { order: 1, kind: 'STEP' }, { width: 280, height: 132 }),
    primary('normalize', 'process', 'intake', 'sales', '标准化需求', { parentId: 'collect', order: 0, kind: 'STEP' }, { width: 240, height: 104 }),
    primary('parse', 'process', 'intake', 'sales', '解析字段', { parentId: 'normalize', order: 0, kind: 'STEP' }, { width: 240, height: 104 }),
    primary('manual', 'process', 'intake', 'sales', '人工修订', { parentId: 'normalize', order: 1, kind: 'STEP' }, { width: 280, height: 132 }),
    primary('recheck', 'process', 'intake', 'sales', '复核修订', { parentId: 'manual', order: 0, kind: 'STEP' }, { width: 240, height: 104 }),
    primary('confirm', 'process', 'intake', 'sales', '确认需求', { parentId: 'collect', order: 1, kind: 'STEP' }, { width: 240, height: 104 }),
    primary('approve', 'decision', 'intake', 'sales', '需求是否通过', { order: 2, kind: 'STEP' }, { width: 280, height: 132 }),
    primary('approved', 'process', 'intake', 'sales', '通过', { parentId: 'approve', order: 0, kind: 'BRANCH' }, { width: 240, height: 104 }),
    primary('rejected', 'process', 'intake', 'sales', '驳回', { parentId: 'approve', order: 1, kind: 'BRANCH' }, { width: 240, height: 104 }),
    primary('revise', 'process', 'intake', 'sales', '修订需求', { parentId: 'rejected', order: 0, kind: 'STEP' }, { width: 280, height: 132 }),
    primary('schedule', 'process', 'production', 'erp', '排产', { order: 3, kind: 'STEP' }, { width: 240, height: 104 }),
    primary('reserve', 'process', 'production', 'erp', '锁定资源', { parentId: 'schedule', order: 0, kind: 'STEP' }, { width: 240, height: 104 }),
    primary('sample', 'process', 'production', 'craft', '打样', { order: 4, kind: 'STEP' }, { width: 280, height: 132 }),
    primary('inspect', 'process', 'production', 'craft', '样品检验', { parentId: 'sample', order: 0, kind: 'STEP' }, { width: 240, height: 104 }),
    primary('training', 'subguide', 'production', 'craft', '工艺培训子指南', { order: 5, kind: 'STEP' }, { width: 280, height: 120 }),
    primary('ship', 'process', 'delivery', 'quality', '出货', { order: 6, kind: 'STEP' }, { width: 240, height: 104 }),
    primary('ship-check', 'process', 'delivery', 'quality', '出货复核', { parentId: 'ship', order: 0, kind: 'STEP' }, { width: 240, height: 104 }),
    primary('close', 'end', 'delivery', 'sales', '关闭流程', { order: 7, kind: 'STEP' }, { width: 240, height: 104 }),
    markdown('collect-spec', 'collect', 0),
    image('approve-image', 'approve', 0),
    video('ship-video', 'ship', 0),
    sourceDerived('training-derived', 'training'),
  ];

  const edges: CanvasEdge[] = [
    edge('flow-entry-collect', 'entry', 'collect', { kind: 'FLOW' }),
    edge('flow-collect-normalize', 'collect', 'normalize', { kind: 'FLOW' }),
    edge('flow-normalize-parse', 'normalize', 'parse', { kind: 'FLOW' }),
    edge('flow-normalize-manual', 'normalize', 'manual', { kind: 'FLOW' }),
    edge('flow-manual-recheck', 'manual', 'recheck', { kind: 'FLOW' }),
    edge('flow-collect-confirm', 'collect', 'confirm', { kind: 'FLOW' }),
    edge('flow-confirm-approve', 'confirm', 'approve', { kind: 'FLOW' }),
    edge('branch-approved-schedule', 'approve', 'approved', { kind: 'BRANCH', order: 0 }, '通过'),
    edge('branch-rejected-revise', 'approve', 'rejected', { kind: 'BRANCH', order: 1 }, '驳回'),
    edge('flow-approved-schedule', 'approved', 'schedule', { kind: 'FLOW' }),
    edge('flow-revise-schedule', 'revise', 'schedule', { kind: 'FLOW' }),
    edge('flow-schedule-reserve', 'schedule', 'reserve', { kind: 'FLOW' }),
    edge('flow-reserve-sample', 'reserve', 'sample', { kind: 'FLOW' }),
    edge('flow-sample-inspect', 'sample', 'inspect', { kind: 'FLOW' }),
    edge('flow-inspect-ship', 'inspect', 'ship', { kind: 'FLOW' }),
    edge('flow-ship-check', 'ship', 'ship-check', { kind: 'FLOW' }),
    edge('flow-check-close', 'ship-check', 'close', { kind: 'FLOW' }),
    edge('exception-rejected-collect', 'rejected', 'collect', { kind: 'EXCEPTION' }),
    edge('retry-ship-approve', 'ship', 'approve', { kind: 'RETRY' }),
    edge('resource-reference-revise-collect-spec', 'revise', 'collect-spec', { kind: 'RESOURCE_REFERENCE' }),
  ];

  return {
    schemaVersion: 1,
    stages,
    lanes,
    nodes,
    edges,
    viewport: { x: 0, y: 0, zoom: 1 },
    steps: [],
    entryNodeId: 'entry',
    exitNodeIds: ['close'],
  };
}
