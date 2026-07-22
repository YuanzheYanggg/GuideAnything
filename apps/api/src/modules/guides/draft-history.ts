import type { CanvasDocument, CanvasNode } from '@guideanything/contracts';
import { CanvasDocumentSchema } from '@guideanything/contracts';

export interface DraftRevisionState {
  title: string;
  summary: string;
  tags: string[];
  document: CanvasDocument | null;
}

export function parseDraftDocument(value: string): CanvasDocument | null {
  try {
    return CanvasDocumentSchema.parse(JSON.parse(value));
  } catch {
    return null;
  }
}

export function describeDraftChange(current: DraftRevisionState, previous?: DraftRevisionState): string {
  if (!previous) return '初始草稿';
  if (!current.document || !previous.document) return '暂无可比较的变更说明';

  const changes: string[] = [];
  if (current.title !== previous.title) changes.push(`指南标题改为“${truncate(current.title, 40)}”`);
  if (current.summary !== previous.summary) changes.push('更新了指南摘要');
  if (!sameTags(current.tags, previous.tags)) changes.push(`更新了标签：${current.tags.length > 0 ? current.tags.join('、') : '无标签'}`);
  changes.push(...describeCollectionChanges('节点', '个', current.document.nodes, previous.document.nodes, nodeName));
  changes.push(...describeCollectionChanges('连线', '条', current.document.edges, previous.document.edges));
  changes.push(...describeCollectionChanges('教学步骤', '个', current.document.steps, previous.document.steps));

  return changes.length > 0 ? changes.join(' · ') : '保存了草稿，未检测到内容变化';
}

function describeCollectionChanges<T extends { id: string }>(
  label: string,
  unit: string,
  current: T[],
  previous: T[],
  getName?: (item: T) => string,
): string[] {
  const previousById = new Map(previous.map((item) => [item.id, item]));
  const currentById = new Map(current.map((item) => [item.id, item]));
  const changes: string[] = [];
  const added = current.filter((item) => !previousById.has(item.id));
  const removed = previous.filter((item) => !currentById.has(item.id));
  const updated = current.filter((item) => {
    const oldItem = previousById.get(item.id);
    return oldItem !== undefined && !sameJson(item, oldItem);
  });

  if (added.length > 0) changes.push(formatCollectionChange('新增', label, unit, added, getName));
  if (removed.length > 0) changes.push(formatCollectionChange('删除', label, unit, removed, getName));
  if (updated.length > 0) changes.push(formatCollectionChange('更新', label, unit, updated, getName));
  return changes;
}

function formatCollectionChange<T>(action: string, label: string, unit: string, items: T[], getName?: (item: T) => string): string {
  const names = getName ? items.map(getName).filter(Boolean).slice(0, 2) : [];
  if (names.length > 0 && items.length <= 2) return `${action}${label}：${names.join('、')}`;
  return `${action} ${items.length} ${unit}${label}`;
}

function nodeName(node: CanvasNode): string {
  switch (node.type) {
    case 'start':
    case 'end':
    case 'process':
    case 'decision':
    case 'data':
      return node.data.label;
    case 'markdown': {
      const heading = node.data.markdown.match(/^#{1,6}\s+(.+)$/m)?.[1]?.trim();
      return heading ? `Markdown：${truncate(heading, 32)}` : 'Markdown 节点';
    }
    case 'image':
      return node.data.caption || node.data.alt;
    case 'video':
      return node.data.caption || '视频节点';
    case 'subguide':
      return node.data.title;
  }
}

function sameTags(current: string[], previous: string[]): boolean {
  return sameJson([...current].sort(), [...previous].sort());
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
}
