import type { DatabaseSync } from 'node:sqlite';

export const DEFAULT_WORKSPACES = [
  ['workspace-finance', 'finance', '财务管理', 'ChartLineUp', 'finance'],
  ['workspace-materials', 'materials', '物料管理', 'FileText', 'materials'],
  ['workspace-sales', 'sales', '销售与分销', 'ChartLineUp', 'sales'],
  ['workspace-production', 'production', '生产计划', 'SquaresFour', 'production'],
  ['workspace-people', 'people', '人力资源', 'UsersThree', 'people'],
  ['workspace-general', 'general', '通用工作区', 'SquaresFour', 'general'],
] as const;

type LegacyGuide = {
  id: string; owner_id: string; title: string; summary: string; tags_json: string;
  created_at: string; updated_at: string;
};

export function upgradeWorkspaceV1(database: DatabaseSync): void {
  database.exec('BEGIN IMMEDIATE');
  try {
    const fallbackOwner = database.prepare(
      `SELECT id FROM users ORDER BY CASE role WHEN 'AUTHOR' THEN 0 WHEN 'EDITOR' THEN 1 ELSE 2 END, created_at LIMIT 1`,
    ).get() as { id: string } | undefined;
    if (!fallbackOwner) {
      database.exec('COMMIT');
      return;
    }
    const guides = database.prepare(
      `SELECT id, owner_id, title, summary, tags_json, created_at, updated_at
       FROM guides WHERE status != 'ARCHIVED' ORDER BY created_at, id`,
    ).all() as unknown as LegacyGuide[];
    const ownerByWorkspace = new Map<string, string>();
    for (const guide of guides) {
      const workspaceId = classifyWorkspace(guide.title, guide.tags_json);
      if (!ownerByWorkspace.has(workspaceId)) ownerByWorkspace.set(workspaceId, guide.owner_id);
    }
    const now = new Date().toISOString();
    const insertWorkspace = database.prepare(
      `INSERT INTO workspaces (id,slug,name,description,icon_key,color_key,owner_id,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING`,
    );
    const insertMember = database.prepare(
      `INSERT INTO workspace_members (workspace_id,user_id,permission,created_at) VALUES (?,?,?,?)
       ON CONFLICT(workspace_id,user_id) DO NOTHING`,
    );
    for (const [id, slug, name, iconKey, colorKey] of DEFAULT_WORKSPACES) {
      const ownerId = ownerByWorkspace.get(id) ?? fallbackOwner.id;
      insertWorkspace.run(id, slug, name, '', iconKey, colorKey, ownerId, now, now);
      const workspace = database.prepare('SELECT owner_id FROM workspaces WHERE id = ?').get(id) as { owner_id: string };
      insertMember.run(id, workspace.owner_id, 'OWNER', now);
    }
    const insertItem = database.prepare(
      `INSERT INTO workspace_items
       (id,workspace_id,kind,entity_id,title,summary,created_by,created_at,updated_at)
       VALUES (?,?,'GUIDE',?,?,?,?,?,?) ON CONFLICT(kind,entity_id) DO NOTHING`,
    );
    for (const guide of guides) {
      const existingItem = database.prepare(
        `SELECT 1 FROM workspace_items WHERE kind = 'GUIDE' AND entity_id = ?`,
      ).get(guide.id);
      if (existingItem) continue;
      const workspaceId = classifyWorkspace(guide.title, guide.tags_json);
      const workspace = database.prepare('SELECT owner_id FROM workspaces WHERE id = ?').get(workspaceId) as { owner_id: string };
      insertMember.run(workspaceId, guide.owner_id, guide.owner_id === workspace.owner_id ? 'OWNER' : 'EDIT', now);
      insertItem.run(
        `workspace-item-guide-${guide.id}`, workspaceId, guide.id, guide.title, guide.summary,
        guide.owner_id, guide.created_at, guide.updated_at,
      );
    }
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

function classifyWorkspace(title: string, tagsJson: string): string {
  let tags = '';
  try { tags = (JSON.parse(tagsJson) as unknown[]).join(' '); } catch { /* invalid legacy tags fall back to title */ }
  const text = `${title} ${tags}`;
  if (/(财务|结账|发票)/u.test(text)) return 'workspace-finance';
  if (/(物料|主数据|供应商)/u.test(text)) return 'workspace-materials';
  if (/(销售|订单|分销)/u.test(text)) return 'workspace-sales';
  if (/(生产|计划|供应)/u.test(text)) return 'workspace-production';
  if (/(人力|员工|入职)/u.test(text)) return 'workspace-people';
  return 'workspace-general';
}
