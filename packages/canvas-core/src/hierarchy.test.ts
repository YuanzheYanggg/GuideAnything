import type { CanvasDocument, CanvasNode } from '@guideanything/contracts';
import { describe, expect, it } from 'vitest';

import { isContentNode, isPrimaryFlowNode, layoutFlowHierarchy } from './hierarchy';

const base = { position: { x: 0, y: 0 }, zIndex: 0 };
const start = (id: string, stageId?: string) => ({ ...base, id, type: 'start' as const, ...(stageId ? { stageId } : {}), data: { label: '开始', shape: 'start' as const } });
const process = (id: string, stageId?: string) => ({ ...base, id, type: 'process' as const, ...(stageId ? { stageId } : {}), data: { label: id, shape: 'process' as const } });
const end = (id: string, stageId?: string) => ({ ...base, id, type: 'end' as const, ...(stageId ? { stageId } : {}), data: { label: '结束', shape: 'end' as const } });
const markdown = (id: string, contentParentId?: string) => ({ ...base, id, type: 'markdown' as const, ...(contentParentId ? { contentParentId } : {}), data: { markdown: id } });
const image = (id: string, contentParentId?: string) => ({ ...base, id, type: 'image' as const, ...(contentParentId ? { contentParentId } : {}), data: { url: 'https://example.com/a.png', alt: id } });
const edge = (id: string, source: string, target: string) => ({ id, source, target });
const makeDocument = (overrides: Partial<CanvasDocument>): CanvasDocument => ({ schemaVersion: 1, nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 }, steps: [], exitNodeIds: [], ...overrides });

describe('flow hierarchy layout', () => {
  it('places source-free main flow, attached content, and stages deterministically', () => {
    const result = layoutFlowHierarchy(makeDocument({
      stages: [{ id: 'prepare', title: '准备', order: 0 }, { id: 'entry', title: '录入', order: 1 }],
      nodes: [start('start', 'prepare'), process('enter', 'entry'), end('end', 'entry'), markdown('note', 'enter'), image('screen', 'enter'), markdown('loose')],
      edges: [edge('e1', 'start', 'enter'), edge('e2', 'enter', 'end')],
      entryNodeId: 'start', exitNodeIds: ['end'],
    }));
    const byId = new Map(result.document.nodes.map((node) => [node.id, node]));

    expect(byId.get('start')!.position.x).toBeLessThan(byId.get('enter')!.position.x);
    expect(byId.get('enter')!.position.x).toBeLessThan(byId.get('end')!.position.x);
    expect(byId.get('note')!.position.x).toBeGreaterThan(byId.get('enter')!.position.x);
    expect(byId.get('note')!.position.x + 300).toBeLessThan(byId.get('end')!.position.x);
    expect(byId.get('screen')!.position.y).toBeGreaterThan(byId.get('note')!.position.y);
    expect(result.report.unassignedContentIds).toEqual(['loose']);
    expect(result.stageBounds.map((bound) => bound.title)).toEqual(['准备', '录入', '未分阶段']);
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
});
