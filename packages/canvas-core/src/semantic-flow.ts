import type { CanvasDocument, CanvasNode, LessonStep } from '@guideanything/contracts';

export type SemanticItemKind = 'STEP' | 'BRANCH' | 'RESOURCE';

export interface SemanticFlowItem {
  nodeId: string;
  code: string;
  kind: SemanticItemKind;
  parentId?: string;
  order: number;
}

export interface SemanticFlow {
  items: SemanticFlowItem[];
  itemsByNodeId: Map<string, SemanticFlowItem>;
  lessonSteps: LessonStep[];
  hasExplicitSemantics: boolean;
}

interface PrimaryEntry {
  node: CanvasNode;
  index: number;
  parentId?: string;
  kind: 'STEP' | 'BRANCH';
  order: number;
}

const primaryTypes = new Set<CanvasNode['type']>(['start', 'end', 'process', 'decision', 'data', 'subguide']);
const resourceTypes = new Set<CanvasNode['type']>(['markdown', 'image', 'video']);

export function hasSemanticFlow(document: CanvasDocument): boolean {
  return document.nodes.some((node) => Boolean(node.outline || node.attachment))
    || document.edges.some((edge) => Boolean(edge.semantic));
}

export function deriveSemanticFlow(document: CanvasDocument): SemanticFlow {
  const editablePrimary = document.nodes
    .map((node, index) => ({ node, index }))
    .filter((entry) => isPrimary(entry.node));
  const primaryById = new Map(editablePrimary.map((entry) => [entry.node.id, entry.node]));
  const fallbackOrder = fallbackPrimaryOrder(document, editablePrimary.map((entry) => entry.node));
  const primary = editablePrimary.map(({ node, index }) => {
    const outline = node.outline;
    const parentId = outline?.parentId && primaryById.has(outline.parentId) && outline.parentId !== node.id
      ? outline.parentId
      : undefined;
    const kind = outline?.kind === 'BRANCH' && parentId && primaryById.get(parentId)?.type === 'decision'
      ? 'BRANCH' as const
      : 'STEP' as const;
    return {
      node,
      index,
      ...(parentId ? { parentId } : {}),
      kind,
      order: outline?.order ?? fallbackOrder.get(node.id) ?? index,
    };
  });
  const children = new Map<string | undefined, PrimaryEntry[]>();
  primary.forEach((entry) => {
    const key = entry.parentId;
    const siblings = children.get(key);
    if (siblings) siblings.push(entry);
    else children.set(key, [entry]);
  });
  children.forEach((siblings) => siblings.sort(compareEntry));

  const resourcesByOwner = new Map<string, Array<{ node: CanvasNode; index: number; order: number }>>();
  document.nodes.forEach((node, index) => {
    if (!isResource(node)) return;
    const ownerId = node.attachment?.ownerNodeId ?? node.contentParentId;
    if (!ownerId || !primaryById.has(ownerId)) return;
    const entry = { node, index, order: node.attachment?.order ?? index };
    const resources = resourcesByOwner.get(ownerId);
    if (resources) resources.push(entry);
    else resourcesByOwner.set(ownerId, [entry]);
  });
  resourcesByOwner.forEach((resources) => resources.sort((left, right) => left.order - right.order || left.index - right.index || left.node.id.localeCompare(right.node.id)));

  const items: SemanticFlowItem[] = [];
  const itemsByNodeId = new Map<string, SemanticFlowItem>();
  const visited = new Set<string>();
  const append = (item: SemanticFlowItem) => {
    items.push(item);
    itemsByNodeId.set(item.nodeId, item);
  };
  const visit = (parentId: string | undefined, parentCode: string | undefined) => {
    const siblings = children.get(parentId) ?? [];
    let stepIndex = 0;
    let branchIndex = 0;
    siblings.forEach((entry) => {
      if (visited.has(entry.node.id)) return;
      visited.add(entry.node.id);
      const kind = parentCode && entry.kind === 'BRANCH' ? 'BRANCH' as const : 'STEP' as const;
      const code = parentCode
        ? kind === 'BRANCH'
          ? `${parentCode}.B${branchIndex += 1}`
          : `${parentCode}.${stepIndex += 1}`
        : String(stepIndex += 1);
      append({ nodeId: entry.node.id, code, kind, ...(parentId ? { parentId } : {}), order: entry.order });
      (resourcesByOwner.get(entry.node.id) ?? []).forEach((resource, resourceIndex) => {
        append({ nodeId: resource.node.id, code: `${code}.R${resourceIndex + 1}`, kind: 'RESOURCE', parentId: entry.node.id, order: resource.order });
      });
      visit(entry.node.id, code);
    });
  };
  visit(undefined, undefined);
  primary.sort(compareEntry).forEach((entry) => {
    if (visited.has(entry.node.id)) return;
    const code = String(items.filter((item) => item.kind === 'STEP' && item.parentId === undefined).length + 1);
    visited.add(entry.node.id);
    append({ nodeId: entry.node.id, code, kind: 'STEP', order: entry.order });
    (resourcesByOwner.get(entry.node.id) ?? []).forEach((resource, resourceIndex) => {
      append({ nodeId: resource.node.id, code: `${code}.R${resourceIndex + 1}`, kind: 'RESOURCE', parentId: entry.node.id, order: resource.order });
    });
    visit(entry.node.id, code);
  });

  return {
    items,
    itemsByNodeId,
    lessonSteps: items.map((item, order) => ({
      id: `semantic-step:${item.nodeId}`,
      order,
      title: itemTitle(document.nodes.find((node) => node.id === item.nodeId)!),
      nodeId: item.nodeId,
    })),
    hasExplicitSemantics: hasSemanticFlow(document),
  };
}

export function renumberSemanticFlow(document: CanvasDocument): CanvasDocument {
  const normalizedDocument = normalizeLegacyResourceAttachments(document);
  const flow = deriveSemanticFlow(normalizedDocument);
  const primaryOrders = new Map<string | undefined, number>();
  const resourceOrders = new Map<string, number>();
  const outlineByNodeId = new Map<string, CanvasNode['outline']>();
  const attachmentByNodeId = new Map<string, CanvasNode['attachment']>();
  flow.items.forEach((item) => {
    if (item.kind === 'RESOURCE') {
      const order = resourceOrders.get(item.parentId!) ?? 0;
      resourceOrders.set(item.parentId!, order + 1);
      attachmentByNodeId.set(item.nodeId, { ownerNodeId: item.parentId!, order });
      return;
    }
    const order = primaryOrders.get(item.parentId) ?? 0;
    primaryOrders.set(item.parentId, order + 1);
    outlineByNodeId.set(item.nodeId, {
      ...(item.parentId ? { parentId: item.parentId } : {}),
      order,
      kind: item.kind,
    });
  });
  return {
    ...normalizedDocument,
    nodes: normalizedDocument.nodes.map((node) => {
      const outline = outlineByNodeId.get(node.id);
      if (outline) return { ...node, outline } as CanvasNode;
      const attachment = attachmentByNodeId.get(node.id);
      if (!attachment) return node;
      const { contentParentId: _legacyParent, ...withoutLegacyParent } = node;
      return { ...withoutLegacyParent, attachment } as CanvasNode;
    }),
  };
}

function normalizeLegacyResourceAttachments(document: CanvasDocument): CanvasDocument {
  const primaryIds = new Set(document.nodes.filter(isPrimary).map((node) => node.id));
  const resourceIds = new Set(document.nodes.filter(isResource).map((node) => node.id));
  const incomingPrimaryByResource = new Map<string, string[]>();
  document.edges.forEach((edge) => {
    if (edge.hidden || edge.sourceTrace || edge.semantic || !primaryIds.has(edge.source) || !resourceIds.has(edge.target)) return;
    const incoming = incomingPrimaryByResource.get(edge.target);
    if (incoming) incoming.push(edge.source);
    else incomingPrimaryByResource.set(edge.target, [edge.source]);
  });
  const ownerByResourceId = new Map<string, string>();
  document.nodes.forEach((node) => {
    if (!isResource(node)) return;
    const legacyOwners = incomingPrimaryByResource.get(node.id) ?? [];
    const ownerId = node.attachment?.ownerNodeId ?? node.contentParentId ?? (legacyOwners.length === 1 ? legacyOwners[0] : undefined);
    if (ownerId && primaryIds.has(ownerId)) ownerByResourceId.set(node.id, ownerId);
  });
  if (ownerByResourceId.size === 0) return document;

  const attachmentOrderByResourceId = new Map<string, number>();
  [...ownerByResourceId.entries()]
    .map(([resourceId, ownerId]) => ({
      resourceId,
      ownerId,
      node: document.nodes.find((node) => node.id === resourceId)!,
      index: document.nodes.findIndex((node) => node.id === resourceId),
    }))
    .sort((left, right) => left.ownerId.localeCompare(right.ownerId)
      || (left.node.attachment?.order ?? left.index) - (right.node.attachment?.order ?? right.index)
      || left.resourceId.localeCompare(right.resourceId))
    .forEach((entry, index, all) => {
      const order = all.slice(0, index).filter((candidate) => candidate.ownerId === entry.ownerId).length;
      attachmentOrderByResourceId.set(entry.resourceId, order);
    });

  return {
    ...document,
    nodes: document.nodes.map((node) => {
      const ownerId = ownerByResourceId.get(node.id);
      if (!ownerId) return node;
      const { contentParentId: _legacyParent, ...withoutLegacyParent } = node;
      return { ...withoutLegacyParent, attachment: { ownerNodeId: ownerId, order: attachmentOrderByResourceId.get(node.id) ?? 0 } } as CanvasNode;
    }),
    edges: document.edges.flatMap((edge) => {
      const ownerId = ownerByResourceId.get(edge.target);
      if (!ownerId || edge.semantic || !primaryIds.has(edge.source) || !resourceIds.has(edge.target)) return [edge];
      if (edge.source === ownerId) return [];
      return [{ ...edge, semantic: { kind: 'RESOURCE_REFERENCE' as const } }];
    }),
  };
}

function isPrimary(node: CanvasNode): boolean {
  return primaryTypes.has(node.type) && !node.source;
}

function isResource(node: CanvasNode): boolean {
  return resourceTypes.has(node.type) && !node.source;
}

function compareEntry(left: PrimaryEntry, right: PrimaryEntry): number {
  return left.order - right.order || left.index - right.index || left.node.id.localeCompare(right.node.id);
}

function fallbackPrimaryOrder(document: CanvasDocument, primary: CanvasNode[]): Map<string, number> {
  const primaryById = new Map(primary.map((node) => [node.id, node]));
  const documentIndex = new Map(document.nodes.map((node, index) => [node.id, index]));
  const outgoing = new Map<string, string[]>();
  const incoming = new Map<string, number>();
  primary.forEach((node) => {
    outgoing.set(node.id, []);
    incoming.set(node.id, 0);
  });
  document.edges.forEach((edge) => {
    if (edge.hidden || edge.sourceTrace || edge.semantic?.kind === 'RESOURCE_REFERENCE') return;
    if (!primaryById.has(edge.source) || !primaryById.has(edge.target)) return;
    outgoing.get(edge.source)!.push(edge.target);
    incoming.set(edge.target, (incoming.get(edge.target) ?? 0) + 1);
  });
  const queue = primary
    .filter((node) => incoming.get(node.id) === 0)
    .sort((left, right) => (left.id === document.entryNodeId ? -1 : right.id === document.entryNodeId ? 1 : (documentIndex.get(left.id) ?? 0) - (documentIndex.get(right.id) ?? 0) || left.id.localeCompare(right.id)));
  const ordered: string[] = [];
  while (queue.length > 0) {
    const node = queue.shift()!;
    ordered.push(node.id);
    (outgoing.get(node.id) ?? []).sort((left, right) => (documentIndex.get(left) ?? 0) - (documentIndex.get(right) ?? 0) || left.localeCompare(right)).forEach((target) => {
      const nextIncoming = (incoming.get(target) ?? 1) - 1;
      incoming.set(target, nextIncoming);
      if (nextIncoming === 0) {
        queue.push(primaryById.get(target)!);
        queue.sort((left, right) => (documentIndex.get(left.id) ?? 0) - (documentIndex.get(right.id) ?? 0) || left.id.localeCompare(right.id));
      }
    });
  }
  primary
    .filter((node) => !ordered.includes(node.id))
    .sort((left, right) => (documentIndex.get(left.id) ?? 0) - (documentIndex.get(right.id) ?? 0) || left.id.localeCompare(right.id))
    .forEach((node) => ordered.push(node.id));
  return new Map(ordered.map((id, index) => [id, index]));
}

function itemTitle(node: CanvasNode): string {
  if (node.type === 'markdown') return node.data.markdown.split('\n').find(Boolean)?.replace(/^#+\s*/, '').slice(0, 200) || 'Markdown 资料';
  if (node.type === 'image') return node.data.caption || node.data.alt;
  if (node.type === 'video') return node.data.caption || '视频资料';
  if (node.type === 'subguide') return node.data.title;
  return node.data.label;
}
