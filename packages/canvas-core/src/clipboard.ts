import type { CanvasDocument } from '@guideanything/contracts';

export function duplicateSelection(
  document: CanvasDocument,
  selectedNodeIds: string[],
  pasteId: string,
  offset = { x: 32, y: 32 },
): { document: CanvasDocument; newNodeIds: string[] } {
  const selected = new Set(selectedNodeIds);
  const copiedId = (sourceId: string) => `copy:${pasteId}:${sourceId}`;
  const sourceNodes = document.nodes.filter((node) => selected.has(node.id));
  const newNodeIds = sourceNodes.map((node) => copiedId(node.id));
  const copiedNodes = sourceNodes.map((sourceNode) => {
    const node = structuredClone(sourceNode);
    node.id = copiedId(sourceNode.id);
    node.position = { x: sourceNode.position.x + offset.x, y: sourceNode.position.y + offset.y };
    node.zIndex = sourceNode.zIndex + 1;
    if (node.type === 'image' && node.data.annotations) {
      node.data.annotations = node.data.annotations.map((annotation) => ({
        ...annotation,
        id: copiedId(annotation.id),
        ...(annotation.targetNodeId && selected.has(annotation.targetNodeId)
          ? { targetNodeId: copiedId(annotation.targetNodeId) }
          : {}),
      }));
    }
    if (node.type === 'video') {
      node.data.keypoints = node.data.keypoints.map((point) => ({
        ...point,
        id: copiedId(point.id),
        ...(point.targetNodeId && selected.has(point.targetNodeId) ? { targetNodeId: copiedId(point.targetNodeId) } : {}),
      }));
    }
    return node;
  });
  const copiedEdges = document.edges
    .filter((edge) => selected.has(edge.source) && selected.has(edge.target))
    .map((edge) => ({
      ...structuredClone(edge),
      id: copiedId(edge.id),
      source: copiedId(edge.source),
      target: copiedId(edge.target),
    }));
  const copiedSteps = document.steps
    .filter((step) => selected.has(step.nodeId))
    .map((step, index) => ({
      ...structuredClone(step),
      id: copiedId(step.id),
      order: document.steps.length + index,
      nodeId: copiedId(step.nodeId),
      ...(step.keypointId ? { keypointId: copiedId(step.keypointId) } : {}),
    }));
  return {
    document: {
      ...document,
      nodes: [...document.nodes, ...copiedNodes],
      edges: [...document.edges, ...copiedEdges],
      steps: [...document.steps, ...copiedSteps],
    },
    newNodeIds,
  };
}
