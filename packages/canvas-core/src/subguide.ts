import type {
  CanvasDocument,
  CanvasEdge,
  CanvasNode,
  GuideVersionSnapshot,
  LessonStep,
  SourceTrace,
} from '@guideanything/contracts';

const HORIZONTAL_GAP = 320;

export function expandSubguide(
  document: CanvasDocument,
  referenceNode: CanvasNode<'subguide'>,
  snapshot: GuideVersionSnapshot,
): CanvasDocument {
  const alreadyExpanded = document.nodes.some(
    (item) => item.source?.referenceNodeId === referenceNode.id,
  );
  if (alreadyExpanded) return document;

  const entryNode = snapshot.document.nodes.find(
    (item) => item.id === snapshot.document.entryNodeId,
  ) ?? snapshot.document.nodes[0];
  if (!entryNode) return markReference(document, referenceNode.id, true);

  const offset = {
    x: referenceNode.position.x + HORIZONTAL_GAP - entryNode.position.x,
    y: referenceNode.position.y - entryNode.position.y,
  };
  const traceFor = (sourceElementId: string): SourceTrace => ({
    referenceNodeId: referenceNode.id,
    sourceGuideId: snapshot.guideId,
    sourceVersionId: snapshot.id,
    sourceElementId,
  });
  const derivedId = (sourceId: string) => `ref:${referenceNode.id}:${sourceId}`;

  const derivedNodes = snapshot.document.nodes.map((sourceNode) => {
    const node = structuredClone(sourceNode) as CanvasNode;
    node.id = derivedId(sourceNode.id);
    node.position = {
      x: sourceNode.position.x + offset.x,
      y: sourceNode.position.y + offset.y,
    };
    node.source = traceFor(sourceNode.id);
    node.hidden = false;
    if (node.type === 'video') {
      node.data.keypoints = node.data.keypoints.map((point) => ({
        ...point,
        ...(point.stepId ? { stepId: derivedId(point.stepId) } : {}),
        ...(point.targetNodeId ? { targetNodeId: derivedId(point.targetNodeId) } : {}),
      }));
    }
    return node;
  });

  const derivedEdges: CanvasEdge[] = snapshot.document.edges.map((sourceEdge) => ({
    ...structuredClone(sourceEdge),
    id: derivedId(sourceEdge.id),
    source: derivedId(sourceEdge.source),
    target: derivedId(sourceEdge.target),
    hidden: false,
    sourceTrace: traceFor(sourceEdge.id),
  }));
  derivedEdges.push({
    id: derivedId('__entry__'),
    source: referenceNode.id,
    sourceHandle: 'out',
    target: derivedId(entryNode.id),
    targetHandle: 'in',
    label: '展开',
    hidden: false,
    sourceTrace: traceFor('__entry__'),
  });

  const baseOrder = document.steps.reduce((maximum, step) => Math.max(maximum, step.order), -1) + 1;
  const derivedSteps: LessonStep[] = snapshot.document.steps.map((sourceStep, index) => ({
    ...structuredClone(sourceStep),
    id: derivedId(sourceStep.id),
    order: baseOrder + index,
    nodeId: derivedId(sourceStep.nodeId),
    ...(sourceStep.keypointId ? { keypointId: derivedId(sourceStep.keypointId) } : {}),
    source: traceFor(sourceStep.id),
  }));

  const expanded = markReference(document, referenceNode.id, true);
  return {
    ...expanded,
    nodes: [...expanded.nodes, ...derivedNodes],
    edges: [...expanded.edges, ...derivedEdges],
    steps: [...expanded.steps, ...derivedSteps],
  };
}

export function setSubguideExpanded(
  document: CanvasDocument,
  referenceNodeId: string,
  expanded: boolean,
): CanvasDocument {
  const marked = markReference(document, referenceNodeId, expanded);
  return {
    ...marked,
    nodes: marked.nodes.map((node) =>
      node.source?.referenceNodeId === referenceNodeId ? { ...node, hidden: !expanded } : node,
    ),
    edges: marked.edges.map((edge) =>
      edge.sourceTrace?.referenceNodeId === referenceNodeId ? { ...edge, hidden: !expanded } : edge,
    ),
  };
}

function markReference(
  document: CanvasDocument,
  referenceNodeId: string,
  expanded: boolean,
): CanvasDocument {
  return {
    ...document,
    nodes: document.nodes.map((node) =>
      node.id === referenceNodeId && node.type === 'subguide'
        ? { ...node, data: { ...node.data, expanded } }
        : node,
    ),
  };
}

