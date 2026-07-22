export type HierarchyDropPlacement = 'before' | 'after';

export function reorderHierarchyItems<T extends { id: string; order: number }>(
  items: T[],
  sourceId: string,
  targetId: string,
  placement: HierarchyDropPlacement,
): T[] | null {
  if (sourceId === targetId) return null;
  const ordered = [...items].sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
  const sourceIndex = ordered.findIndex((item) => item.id === sourceId);
  const targetIndex = ordered.findIndex((item) => item.id === targetId);
  if (sourceIndex < 0 || targetIndex < 0) return null;

  const [source] = ordered.splice(sourceIndex, 1);
  const nextTargetIndex = ordered.findIndex((item) => item.id === targetId);
  ordered.splice(nextTargetIndex + (placement === 'after' ? 1 : 0), 0, source!);
  return ordered.map((item, order) => ({ ...item, order }));
}
