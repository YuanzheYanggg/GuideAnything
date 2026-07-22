import { describe, expect, it } from 'vitest';
import type { CanvasDocument } from '@guideanything/contracts';

import { edgeAnchorFromClientPoint, edgePresentationForPathStyle, isEditableBusinessEdge, resetEdgeRoutePresentation, resolveEdgeVisuals } from './edge-presentation';

describe('edge presentation helpers', () => {
  it('maps persisted visual options to controlled SVG values', () => {
    expect(resolveEdgeVisuals({ color: 'red', width: 3, pattern: 'dashed', arrows: 'both' })).toMatchObject({
      style: { stroke: 'var(--ga-edge-red)', strokeWidth: 3, strokeDasharray: '8 5' },
      markerStart: { type: 'arrowclosed' },
      markerEnd: { type: 'arrowclosed' },
    });
  });

  it('passes a custom palette hex through to the SVG stroke', () => {
    expect(resolveEdgeVisuals({ color: '#1020ff' })).toMatchObject({
      style: { stroke: '#1020ff', strokeWidth: 2 },
    });
  });

  it('changes only the visual path style without clearing manual geometry', () => {
    const presentation = {
      color: 'purple' as const,
      routing: 'straight' as const,
      routeMode: 'manual' as const,
      waypoints: [{ x: 120, y: 80 }],
      sourceAnchor: { side: 'RIGHT' as const, offset: 0.5 },
      sourceAnchorMode: 'manual' as const,
      targetAnchor: { side: 'LEFT' as const, offset: 0.5 },
      targetAnchorMode: 'manual' as const,
    };

    expect(edgePresentationForPathStyle(presentation, 'smooth')).toEqual({ ...presentation, pathStyle: 'smooth' });
  });

  it('restores automatic geometry while preserving visual style and endpoint anchors', () => {
    const presentation = {
      color: 'purple' as const,
      arrows: 'both' as const,
      routing: 'straight' as const,
      pathStyle: 'smooth' as const,
      routeMode: 'manual' as const,
      waypoints: [{ x: 120, y: 80 }],
      sourceAnchor: { side: 'RIGHT' as const, offset: 0.5 },
      sourceAnchorMode: 'manual' as const,
      targetAnchor: { side: 'LEFT' as const, offset: 0.5 },
      targetAnchorMode: 'manual' as const,
    };

    expect(resetEdgeRoutePresentation(presentation)).toEqual({
      color: 'purple',
      arrows: 'both',
      routing: 'straight',
      pathStyle: 'smooth',
      sourceAnchor: presentation.sourceAnchor,
      sourceAnchorMode: 'manual',
      targetAnchor: presentation.targetAnchor,
      targetAnchorMode: 'manual',
    });
  });

  it('removes route-edit snapshots while preserving explicit visual presentation', () => {
    expect(resetEdgeRoutePresentation({
      pathStyle: 'diagonal',
      routeMode: 'manual',
      waypoints: [{ x: 120, y: 80 }],
      sourceAnchor: { side: 'RIGHT', offset: 0.5 },
      sourceAnchorMode: 'auto',
      targetAnchor: { side: 'LEFT', offset: 0.5 },
      targetAnchorMode: 'auto',
    })).toEqual({ pathStyle: 'diagonal' });
  });

  it('finds the nearest node edge with an exact relative offset', () => {
    const rect = { left: 100, top: 200, width: 240, height: 120 };

    expect(edgeAnchorFromClientPoint(rect, { x: 148, y: 202 })).toEqual({ side: 'TOP', offset: 0.2 });
    expect(edgeAnchorFromClientPoint(rect, { x: 338, y: 260 })).toEqual({ side: 'RIGHT', offset: 0.5 });
    expect(edgeAnchorFromClientPoint(rect, { x: 100, y: 296 })).toEqual({ side: 'LEFT', offset: 0.8 });
  });

  it('allows edge editing between any persisted local nodes', () => {
    const document: CanvasDocument = {
      schemaVersion: 1,
      nodes: [
        { id: 'process', type: 'process', position: { x: 0, y: 0 }, zIndex: 0, data: { label: '处理', shape: 'process' } },
        { id: 'decision', type: 'decision', position: { x: 320, y: 0 }, zIndex: 1, data: { label: '判断', shape: 'decision' } },
        { id: 'note', type: 'markdown', position: { x: 0, y: 160 }, zIndex: 2, data: { markdown: '资料' } },
      ],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      steps: [],
      exitNodeIds: [],
    };

    expect(isEditableBusinessEdge(document, { id: 'business', source: 'process', target: 'decision' })).toBe(true);
    expect(isEditableBusinessEdge(document, { id: 'reference', source: 'process', target: 'note' })).toBe(true);
    expect(isEditableBusinessEdge(document, {
      id: 'derived',
      source: 'process',
      target: 'decision',
      sourceTrace: { referenceNodeId: 'reference', sourceGuideId: 'guide', sourceVersionId: 'version', sourceElementId: 'edge' },
    })).toBe(false);
  });
});
