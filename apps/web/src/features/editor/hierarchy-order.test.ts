import { describe, expect, it } from 'vitest';

import { reorderHierarchyItems } from './hierarchy-order';

describe('reorderHierarchyItems', () => {
  it('moves a source item before the target and normalizes every order field', () => {
    expect(reorderHierarchyItems([
      { id: 'proposal', order: 0 },
      { id: 'sourcing', order: 1 },
      { id: 'sampling', order: 2 },
    ], 'sampling', 'sourcing', 'before')).toEqual([
      { id: 'proposal', order: 0 },
      { id: 'sampling', order: 1 },
      { id: 'sourcing', order: 2 },
    ]);
  });

  it('moves a source item after the target without relying on its old index', () => {
    expect(reorderHierarchyItems([
      { id: 'proposal', order: 0 },
      { id: 'sourcing', order: 1 },
      { id: 'sampling', order: 2 },
    ], 'proposal', 'sourcing', 'after')).toEqual([
      { id: 'sourcing', order: 0 },
      { id: 'proposal', order: 1 },
      { id: 'sampling', order: 2 },
    ]);
  });

  it('returns null when source and target cannot produce a meaningful drop', () => {
    const items = [{ id: 'proposal', order: 0 }];

    expect(reorderHierarchyItems(items, 'proposal', 'proposal', 'before')).toBeNull();
    expect(reorderHierarchyItems(items, 'missing', 'proposal', 'before')).toBeNull();
    expect(reorderHierarchyItems(items, 'proposal', 'missing', 'before')).toBeNull();
  });
});
