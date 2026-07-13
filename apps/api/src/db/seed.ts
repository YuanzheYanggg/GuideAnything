import type { CanvasDocument, UserRole } from '@guideanything/contracts';
import type { DatabaseSync } from 'node:sqlite';

import { hashPassword } from '../modules/auth/service';
import { getVersion, publishGuide } from '../modules/guides/repository';
import { ensureDefaultWorkspaces } from '../modules/workspaces/repository';

const DEMO_PASSWORD = 'Guide123!';
const AUTHOR_ID = 'demo-author';
const EDITOR_ID = 'demo-editor';
const LEARNER_ID = 'demo-learner';
const MATERIAL_GUIDE_ID = 'demo-material-check';
const SALES_GUIDE_ID = 'demo-sales-order';

const DEFAULT_WORKSPACES = [
  ['workspace-finance', 'finance', '财务管理', 'ChartLineUp', 'finance'],
  ['workspace-materials', 'materials', '物料管理', 'FileText', 'materials'],
  ['workspace-sales', 'sales', '销售与分销', 'ChartLineUp', 'sales'],
  ['workspace-production', 'production', '生产计划', 'SquaresFour', 'production'],
  ['workspace-people', 'people', '人力资源', 'UsersThree', 'people'],
  ['workspace-general', 'general', '通用工作区', 'SquaresFour', 'general'],
] as const;

export async function seedDatabase(database: DatabaseSync): Promise<void> {
  await seedUsers(database);
  seedWorkspaces(database);

  insertGuideIfMissing(
    database,
    MATERIAL_GUIDE_ID,
    AUTHOR_ID,
    '物料主数据检查',
    '确认物料销售视图、基本单位和可用状态，供其他 ERP 教学指南复用。',
    ['ERP', '物料', '主数据'],
    materialCheckDocument(),
  );
  const materialVersion = ensurePublished(database, MATERIAL_GUIDE_ID);

  insertGuideIfMissing(
    database,
    SALES_GUIDE_ID,
    AUTHOR_ID,
    'ERP 销售订单创建',
    '以 VA01 为例，从场景确认、字段填写、物料分支到保存订单的图文视频教学。',
    ['ERP', '销售订单', 'VA01', 'SAP'],
    salesOrderDocument(materialVersion.id, materialVersion.version),
  );
  ensurePublished(database, SALES_GUIDE_ID);

  database.prepare(
    `INSERT INTO guide_collaborators (guide_id, user_id, permission, created_at)
     VALUES (?, ?, 'EDIT', ?)
     ON CONFLICT (guide_id, user_id) DO UPDATE SET permission = 'EDIT'`,
  ).run(SALES_GUIDE_ID, EDITOR_ID, new Date().toISOString());

  backfillGuideWorkspaceItems(database);
}

function seedWorkspaces(database: DatabaseSync): void {
  ensureDefaultWorkspaces(database, AUTHOR_ID, DEFAULT_WORKSPACES.map(
    ([id, slug, name, iconKey, colorKey]) => ({
      id,
      slug,
      name,
      description: '',
      iconKey,
      colorKey,
    }),
  ));
  const upsertMember = database.prepare(
    `INSERT INTO workspace_members (workspace_id, user_id, permission, created_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (workspace_id, user_id) DO UPDATE SET permission = excluded.permission`,
  );
  const now = new Date().toISOString();
  for (const [workspaceId] of DEFAULT_WORKSPACES) {
    upsertMember.run(workspaceId, AUTHOR_ID, 'OWNER', now);
    upsertMember.run(workspaceId, EDITOR_ID, 'EDIT', now);
    upsertMember.run(workspaceId, LEARNER_ID, 'VIEW', now);
  }
}

function backfillGuideWorkspaceItems(database: DatabaseSync): void {
  const guides = database.prepare(
    `SELECT id, owner_id, title, summary, status, created_at, updated_at
     FROM guides`,
  ).all() as unknown as Array<{
    id: string;
    owner_id: string;
    title: string;
    summary: string;
    status: string;
    created_at: string;
    updated_at: string;
  }>;
  const insert = database.prepare(
    `INSERT INTO workspace_items (
      id, workspace_id, kind, entity_id, title, summary, created_by,
      deleted_at, deleted_by, created_at, updated_at
    ) VALUES (?, ?, 'GUIDE', ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (kind, entity_id) DO UPDATE SET
      title = excluded.title,
      summary = excluded.summary`,
  );
  for (const guide of guides) {
    const workspaceId = guide.id === MATERIAL_GUIDE_ID
      ? 'workspace-materials'
      : guide.id === SALES_GUIDE_ID
        ? 'workspace-sales'
        : 'workspace-general';
    insert.run(
      `workspace-item-guide-${guide.id}`,
      workspaceId,
      guide.id,
      guide.title,
      guide.summary,
      guide.owner_id,
      guide.status === 'ARCHIVED' ? guide.updated_at : null,
      guide.status === 'ARCHIVED' ? guide.owner_id : null,
      guide.created_at,
      guide.updated_at,
    );
  }
}

async function seedUsers(database: DatabaseSync): Promise<void> {
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const insert = database.prepare(
    `INSERT INTO users (id, email, password_hash, display_name, role, created_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET
       email = excluded.email,
       display_name = excluded.display_name,
       role = excluded.role`,
  );
  const users: Array<[string, string, string, UserRole]> = [
    [AUTHOR_ID, 'author@guide.local', '王作者', 'AUTHOR'],
    [EDITOR_ID, 'editor@guide.local', '陈编辑', 'EDITOR'],
    [LEARNER_ID, 'learner@guide.local', '李学员', 'LEARNER'],
  ];
  for (const [id, email, displayName, role] of users) {
    insert.run(id, email, passwordHash, displayName, role, new Date().toISOString());
  }
}

function insertGuideIfMissing(
  database: DatabaseSync,
  id: string,
  ownerId: string,
  title: string,
  summary: string,
  tags: string[],
  document: CanvasDocument,
): void {
  const now = new Date().toISOString();
  database.prepare(
    `INSERT INTO guides (
      id, owner_id, title, summary, tags_json, status, visibility, revision,
      draft_document, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 'DRAFT', 'INTERNAL', 0, ?, ?, ?)
    ON CONFLICT (id) DO NOTHING`,
  ).run(id, ownerId, title, summary, JSON.stringify(tags), JSON.stringify(document), now, now);
}

function ensurePublished(database: DatabaseSync, guideId: string) {
  const existing = database.prepare(
    `SELECT id FROM guide_versions WHERE guide_id = ? ORDER BY version DESC LIMIT 1`,
  ).get(guideId) as { id: string } | undefined;
  if (existing) return getVersion(database, existing.id)!;
  return publishGuide(database, guideId, AUTHOR_ID);
}

function materialCheckDocument(): CanvasDocument {
  return {
    schemaVersion: 1,
    nodes: [
      flowNode('material-start', 'start', 0, 0, '开始检查'),
      markdownNode('material-rules', 260, 0, '## 检查规则\n\n1. 基本单位必须正确。\n2. 销售组织视图必须存在。\n3. 物料状态不能阻止销售。'),
      flowNode('material-decision', 'decision', 580, 0, '销售视图完整？', ['是', '否']),
      flowNode('material-fix', 'process', 580, 220, '补充或修正物料主数据'),
      flowNode('material-end', 'end', 900, 0, '检查通过'),
    ],
    edges: [
      { id: 'm-e1', source: 'material-start', target: 'material-rules' },
      { id: 'm-e2', source: 'material-rules', target: 'material-decision' },
      { id: 'm-e3', source: 'material-decision', sourceHandle: 'yes', target: 'material-end', label: '是' },
      { id: 'm-e4', source: 'material-decision', sourceHandle: 'no', target: 'material-fix', label: '否' },
      { id: 'm-e5', source: 'material-fix', target: 'material-decision', label: '重新检查' },
    ],
    viewport: { x: 40, y: 60, zoom: 0.85 },
    steps: [
      { id: 'm-step-1', order: 0, title: '进入物料显示', body: '使用只读事务检查，避免误改主数据。', nodeId: 'material-start' },
      { id: 'm-step-2', order: 1, title: '核对字段规则', nodeId: 'material-rules' },
      { id: 'm-step-3', order: 2, title: '判断销售视图', nodeId: 'material-decision' },
      { id: 'm-step-4', order: 3, title: '完成检查', nodeId: 'material-end' },
    ],
    entryNodeId: 'material-start',
    exitNodeIds: ['material-end'],
  };
}

function salesOrderDocument(materialVersionId: string, materialVersion: number): CanvasDocument {
  return {
    schemaVersion: 1,
    nodes: [
      flowNode('sales-start', 'start', 0, 120, '收到客户下单需求'),
      markdownNode('sales-context', 260, 120, '## 场景说明\n\n客户要求在本周交付常规物料。创建订单前确认售达方、销售组织、分销渠道与产品组。'),
      {
        id: 'sales-image',
        type: 'image',
        position: { x: 580, y: -80 },
        zIndex: 2,
        data: {
          url: 'https://placehold.co/720x420/png?text=ERP+VA01+Field+Map',
          alt: 'VA01 初始界面字段位置示意图',
          caption: '先填写订单类型、销售组织、分销渠道和产品组。',
        },
      },
      {
        id: 'sales-video',
        type: 'video',
        position: { x: 580, y: 260 },
        zIndex: 3,
        data: {
          url: 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4',
          caption: 'VA01 操作演示占位视频；关键点信息为真实 ERP 教学内容。',
          keypoints: [
            { id: 'sales-kp-customer', title: '填写售达方与采购订单号', timeSeconds: 2, stepId: 'sales-step-video', targetNodeId: 'sales-video' },
            { id: 'sales-kp-material', title: '录入物料与订单数量', timeSeconds: 5, stepId: 'sales-step-video', targetNodeId: 'sales-video' },
          ],
        },
      },
      flowNode('sales-decision', 'decision', 940, 120, '物料可销售？', ['是', '否']),
      {
        id: 'sales-subguide',
        type: 'subguide',
        position: { x: 940, y: 400 },
        zIndex: 4,
        data: {
          guideId: MATERIAL_GUIDE_ID,
          guideVersionId: materialVersionId,
          title: '物料主数据检查',
          version: materialVersion,
          expanded: false,
          sourceEntryNodeId: 'material-start',
          sourceExitNodeIds: ['material-end'],
        },
      },
      flowNode('sales-save', 'process', 1260, 120, '检查定价与交期并保存订单'),
      flowNode('sales-end', 'end', 1580, 120, '记录销售订单号'),
    ],
    edges: [
      { id: 's-e1', source: 'sales-start', target: 'sales-context' },
      { id: 's-e2', source: 'sales-context', target: 'sales-image' },
      { id: 's-e3', source: 'sales-image', target: 'sales-video' },
      { id: 's-e4', source: 'sales-video', target: 'sales-decision' },
      { id: 's-e5', source: 'sales-decision', sourceHandle: 'yes', target: 'sales-save', label: '是' },
      { id: 's-e6', source: 'sales-decision', sourceHandle: 'no', target: 'sales-subguide', label: '否' },
      { id: 's-e7', source: 'sales-subguide', target: 'sales-decision', label: '修正后重试' },
      { id: 's-e8', source: 'sales-save', target: 'sales-end' },
    ],
    viewport: { x: 30, y: 100, zoom: 0.7 },
    steps: [
      { id: 'sales-step-1', order: 0, title: '确认业务场景', nodeId: 'sales-context' },
      { id: 'sales-step-image', order: 1, title: '识别初始字段', nodeId: 'sales-image' },
      { id: 'sales-step-video', order: 2, title: '跟随视频录入抬头与物料', body: '采购订单号用于追踪客户原始需求。', nodeId: 'sales-video', keypointId: 'sales-kp-customer' },
      { id: 'sales-step-decision', order: 3, title: '处理物料分支', nodeId: 'sales-decision' },
      { id: 'sales-step-save', order: 4, title: '检查并保存', body: '保存前核对净值、请求交货日期与信用状态。', nodeId: 'sales-save' },
      { id: 'sales-step-end', order: 5, title: '记录订单号', nodeId: 'sales-end' },
    ],
    entryNodeId: 'sales-start',
    exitNodeIds: ['sales-end'],
  };
}

function flowNode(
  id: string,
  type: 'start' | 'end' | 'process' | 'decision',
  x: number,
  y: number,
  label: string,
  branchLabels?: string[],
): CanvasDocument['nodes'][number] {
  return {
    id,
    type,
    position: { x, y },
    zIndex: 1,
    data: {
      label,
      shape: type,
      ...(branchLabels ? { branchLabels } : {}),
    },
  } as CanvasDocument['nodes'][number];
}

function markdownNode(id: string, x: number, y: number, markdown: string): CanvasDocument['nodes'][number] {
  return { id, type: 'markdown', position: { x, y }, zIndex: 1, data: { markdown } };
}
