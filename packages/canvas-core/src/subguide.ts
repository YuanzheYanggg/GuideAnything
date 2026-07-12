import type {
  CanvasDocument,
  CanvasEdge,
  CanvasNode,
  GuideVersionSnapshot,
  LessonStep,
  SourceTrace,
} from '@guideanything/contracts';

const HORIZONTAL_GAP = 320;

type ContinuationEdge = NonNullable<CanvasNode<'subguide'>['data']['expandedContinuationEdges']>[number];

interface ReferenceState {
  reference: CanvasNode<'subguide'>;
  derivedNodes: CanvasNode[];
  derivedNodeIds: Set<string>;
  continuations: ContinuationEdge[];
}

interface BridgeDefinition {
  id: string;
  referenceId: string;
  source: string;
  target: string;
  targetHandle?: string;
  label?: string;
  originalHidden: boolean;
  sourceTrace: SourceTrace;
}

interface SnapshotEndpoints {
  sourceEntryNodeId: string;
  sourceExitNodeIds: string[];
}

export function expandSubguide(
  document: CanvasDocument,
  referenceNode: CanvasNode<'subguide'>,
  snapshot: GuideVersionSnapshot,
): CanvasDocument {
  const alreadyExpanded = document.nodes.some(
    (item) => item.source?.referenceNodeId === referenceNode.id,
  );
  if (alreadyExpanded) return setSubguideExpanded(document, referenceNode.id, true);

  const entryNode = snapshot.document.nodes.find(
    (item) => item.id === snapshot.document.entryNodeId,
  ) ?? snapshot.document.nodes[0];
  if (!entryNode) return markReference(document, referenceNode.id, true);

  const continuations = document.edges
    .filter((edge) => edge.source === referenceNode.id)
    .map((edge) => ({ id: edge.id, hidden: Boolean(edge.hidden) }));
  const continuationIds = new Set(continuations.map((edge) => edge.id));
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

  const derivedNodes = snapshot.document.nodes.map((sourceNode) => {
    const node = structuredClone(sourceNode) as CanvasNode;
    node.id = derivedId(referenceNode.id, sourceNode.id);
    node.position = {
      x: sourceNode.position.x + offset.x,
      y: sourceNode.position.y + offset.y,
    };
    node.source = traceFor(sourceNode.id);
    node.hidden = false;
    if (node.contentParentId) {
      node.contentParentId = derivedId(referenceNode.id, node.contentParentId);
    }
    delete node.stageId;
    if (node.type === 'video') {
      node.data.keypoints = node.data.keypoints.map((point) => ({
        ...point,
        ...(point.stepId ? { stepId: derivedId(referenceNode.id, point.stepId) } : {}),
        ...(point.targetNodeId ? { targetNodeId: derivedId(referenceNode.id, point.targetNodeId) } : {}),
      }));
    }
    return node;
  });

  const derivedEdges: CanvasEdge[] = snapshot.document.edges.map((sourceEdge) => ({
    ...structuredClone(sourceEdge),
    id: derivedId(referenceNode.id, sourceEdge.id),
    source: derivedId(referenceNode.id, sourceEdge.source),
    target: derivedId(referenceNode.id, sourceEdge.target),
    hidden: false,
    sourceTrace: traceFor(sourceEdge.id),
  }));
  derivedEdges.push({
    id: derivedId(referenceNode.id, '__entry__'),
    source: referenceNode.id,
    sourceHandle: 'out',
    target: derivedId(referenceNode.id, entryNode.id),
    targetHandle: 'in',
    label: '展开',
    hidden: false,
    sourceTrace: traceFor('__entry__'),
  });

  const sourceNodeIds = new Set(snapshot.document.nodes.map((node) => node.id));
  const sourceExitNodeIds = [...new Set(snapshot.document.exitNodeIds)].filter((id) => sourceNodeIds.has(id));
  const continuationEdges = document.edges.filter((edge) => continuationIds.has(edge.id));
  for (const sourceExitNodeId of sourceExitNodeIds) {
    for (const continuation of continuationEdges) {
      const sourceElementId = exitBridgeSourceElementId(sourceExitNodeId, continuation.id);
      derivedEdges.push({
        id: derivedId(referenceNode.id, sourceElementId),
        source: derivedId(referenceNode.id, sourceExitNodeId),
        sourceHandle: 'out',
        target: continuation.target,
        ...(continuation.targetHandle ? { targetHandle: continuation.targetHandle } : {}),
        ...(continuation.label ? { label: continuation.label } : {}),
        hidden: Boolean(continuation.hidden),
        sourceTrace: traceFor(sourceElementId),
      });
    }
  }

  const baseOrder = document.steps.reduce((maximum, step) => Math.max(maximum, step.order), -1) + 1;
  const derivedSteps: LessonStep[] = snapshot.document.steps.map((sourceStep, index) => ({
    ...structuredClone(sourceStep),
    id: derivedId(referenceNode.id, sourceStep.id),
    order: baseOrder + index,
    nodeId: derivedId(referenceNode.id, sourceStep.nodeId),
    ...(sourceStep.keypointId ? { keypointId: derivedId(referenceNode.id, sourceStep.keypointId) } : {}),
    source: traceFor(sourceStep.id),
  }));

  const expanded = markReference(document, referenceNode.id, true, continuations, {
    sourceEntryNodeId: entryNode.id,
    sourceExitNodeIds,
  });
  return reconcileSubguideEdges({
    ...expanded,
    nodes: [...expanded.nodes, ...derivedNodes],
    edges: [
      ...expanded.edges.map((edge) => continuationIds.has(edge.id) ? { ...edge, hidden: true } : edge),
      ...derivedEdges,
    ],
    steps: [...expanded.steps, ...derivedSteps],
  });
}

export function setSubguideExpanded(
  document: CanvasDocument,
  referenceNodeId: string,
  expanded: boolean,
): CanvasDocument {
  const reference = document.nodes.find(
    (node): node is CanvasNode<'subguide'> => node.id === referenceNodeId && node.type === 'subguide',
  );
  const continuations = reference?.data.expandedContinuationEdges;
  const continuationById = new Map((continuations ?? []).map((edge) => [edge.id, edge]));
  const marked = markReference(document, referenceNodeId, expanded, continuations);

  return reconcileSubguideEdges({
    ...marked,
    nodes: marked.nodes.map((node) =>
      node.source?.referenceNodeId === referenceNodeId && node.hidden !== !expanded
        ? { ...node, hidden: !expanded }
        : node,
    ),
    edges: marked.edges.map((edge) => {
      const continuation = continuationById.get(edge.id);
      if (!continuation) return edge;
      const hidden = expanded ? true : continuation.hidden;
      return edge.hidden === hidden ? edge : { ...edge, hidden };
    }),
  });
}

export function reconcileSubguideEdges(document: CanvasDocument): CanvasDocument {
  const edgesById = new Map(document.edges.map((edge) => [edge.id, edge]));
  const outgoingBySource = new Map<string, CanvasEdge[]>();
  for (const edge of document.edges) {
    const outgoing = outgoingBySource.get(edge.source) ?? [];
    outgoing.push(edge);
    outgoingBySource.set(edge.source, outgoing);
  }

  const referencesById = new Map<string, CanvasNode<'subguide'>>();
  for (const node of document.nodes) {
    if (node.type === 'subguide') referencesById.set(node.id, node);
  }
  const derivedByReference = new Map<string, CanvasNode[]>();
  for (const node of document.nodes) {
    const referenceNodeId = node.source?.referenceNodeId;
    if (!referenceNodeId || !referencesById.has(referenceNodeId)) continue;
    const derived = derivedByReference.get(referenceNodeId) ?? [];
    derived.push(node);
    derivedByReference.set(referenceNodeId, derived);
  }

  const states = new Map<string, ReferenceState>();
  const derivedReferenceByNodeId = new Map<string, string>();
  for (const [referenceId, reference] of referencesById) {
    const derivedNodes = derivedByReference.get(referenceId) ?? [];
    if (derivedNodes.length === 0) continue;
    const derivedNodeIds = new Set(derivedNodes.map((node) => node.id));
    const storedContinuations = reference.data.expandedContinuationEdges;
    const inferredContinuations = (outgoingBySource.get(referenceId) ?? [])
      .filter((edge) => isContinuationEdge(edge, referenceId, derivedNodeIds))
      .map((edge) => ({ id: edge.id, hidden: Boolean(edge.hidden) }));
    const continuations = (storedContinuations ?? inferredContinuations)
      .filter((continuation) => {
        const edge = edgesById.get(continuation.id);
        return edge !== undefined && isContinuationEdge(edge, referenceId, derivedNodeIds);
      });
    states.set(referenceId, { reference, derivedNodes, derivedNodeIds, continuations });
    for (const derivedNode of derivedNodes) derivedReferenceByNodeId.set(derivedNode.id, referenceId);
  }
  if (states.size === 0) return document;

  const internalOutgoingByReference = new Map<string, Set<string>>();
  for (const edge of document.edges) {
    const sourceReferenceId = derivedReferenceByNodeId.get(edge.source);
    if (!sourceReferenceId || sourceReferenceId !== derivedReferenceByNodeId.get(edge.target)) continue;
    const outgoing = internalOutgoingByReference.get(sourceReferenceId) ?? new Set<string>();
    outgoing.add(edge.source);
    internalOutgoingByReference.set(sourceReferenceId, outgoing);
  }

  let changed = false;
  const normalizedNodes = document.nodes.map((node) => {
    let normalizedNode = node;
    if (node.type === 'subguide') {
      const state = states.get(node.id);
      if (state && !sameContinuations(node.data.expandedContinuationEdges, state.continuations)) {
        changed = true;
        normalizedNode = { ...node, data: { ...node.data, expandedContinuationEdges: state.continuations } };
      }
    }
    const hidden = hiddenByReferenceChain(node, states);
    if (hidden === undefined || normalizedNode.hidden === hidden) return normalizedNode;
    changed = true;
    return { ...normalizedNode, hidden };
  });
  const nodesById = new Map(normalizedNodes.map((node) => [node.id, node]));

  const continuationByEdgeId = new Map<string, { state: ReferenceState; continuation: ContinuationEdge }>();
  const bridgeById = new Map<string, BridgeDefinition>();
  for (const [referenceId, state] of states) {
    for (const continuation of state.continuations) {
      continuationByEdgeId.set(continuation.id, { state, continuation });
    }
    const exits = findExitNodes(state, internalOutgoingByReference.get(referenceId) ?? new Set<string>());
    for (const exitNode of exits) {
      const sourceExitNodeId = exitNode.source?.sourceElementId;
      if (!sourceExitNodeId) continue;
      for (const continuation of state.continuations) {
        const targetEdge = edgesById.get(continuation.id);
        if (!targetEdge) continue;
        const sourceElementId = exitBridgeSourceElementId(sourceExitNodeId, continuation.id);
        const id = derivedId(referenceId, sourceElementId);
        bridgeById.set(id, {
          id,
          referenceId,
          source: exitNode.id,
          target: targetEdge.target,
          ...(targetEdge.targetHandle ? { targetHandle: targetEdge.targetHandle } : {}),
          ...(targetEdge.label ? { label: targetEdge.label } : {}),
          originalHidden: continuation.hidden,
          sourceTrace: {
            referenceNodeId: referenceId,
            sourceGuideId: state.reference.data.guideId,
            sourceVersionId: state.reference.data.guideVersionId,
            sourceElementId,
          },
        });
      }
    }
  }

  const survivingEdges = document.edges.filter((edge) => {
    const sourceNode = nodesById.get(edge.source);
    const sourceReferenceId = sourceNode?.source?.referenceNodeId;
    if (sourceReferenceId && isGeneratedExitBridge(edge, sourceReferenceId) && !bridgeById.has(edge.id)) {
      changed = true;
      return false;
    }
    if (!sourceReferenceId || edge.target !== sourceReferenceId) return true;
    const sourceElementId = sourceNode?.source?.sourceElementId;
    const legacyId = sourceElementId ? derivedId(sourceReferenceId, `__exit__:${sourceElementId}`) : undefined;
    const oldExitTrace = edge.sourceTrace?.referenceNodeId === sourceReferenceId
      && edge.sourceTrace.sourceElementId.startsWith('__exit__:')
      && !edge.sourceTrace.sourceElementId.includes(':to:');
    if (edge.id !== legacyId && !oldExitTrace) return true;
    changed = true;
    return false;
  });
  const existingEdgeIds = new Set(survivingEdges.map((edge) => edge.id));
  const repairedEdges = [...survivingEdges];
  for (const bridge of bridgeById.values()) {
    if (existingEdgeIds.has(bridge.id)) continue;
    changed = true;
    repairedEdges.push({
      id: bridge.id,
      source: bridge.source,
      sourceHandle: 'out',
      target: bridge.target,
      ...(bridge.targetHandle ? { targetHandle: bridge.targetHandle } : {}),
      ...(bridge.label ? { label: bridge.label } : {}),
      hidden: bridge.originalHidden,
      sourceTrace: bridge.sourceTrace,
    });
  }

  const normalizedEdges = repairedEdges.map((edge) => {
    const continuation = continuationByEdgeId.get(edge.id);
    if (continuation) {
      const hidden = continuation.state.reference.data.expanded ? true : continuation.continuation.hidden;
      if (edge.hidden === hidden) return edge;
      changed = true;
      return { ...edge, hidden };
    }

    const bridge = bridgeById.get(edge.id);
    if (bridge) {
      const state = states.get(bridge.referenceId)!;
      const sourceNode = nodesById.get(bridge.source);
      const targetNode = nodesById.get(bridge.target);
      const hidden = Boolean(!state.reference.data.expanded || bridge.originalHidden || sourceNode?.hidden || targetNode?.hidden);
      const normalized: CanvasEdge = {
        id: bridge.id,
        source: bridge.source,
        sourceHandle: 'out',
        target: bridge.target,
        ...(bridge.targetHandle ? { targetHandle: bridge.targetHandle } : {}),
        ...(bridge.label ? { label: bridge.label } : {}),
        hidden,
        sourceTrace: bridge.sourceTrace,
      };
      if (sameEdge(edge, normalized)) return edge;
      changed = true;
      return normalized;
    }

    const sourceNode = nodesById.get(edge.source);
    const targetNode = nodesById.get(edge.target);
    const inferredTrace = sourceNode?.source ?? targetNode?.source;
    if (!inferredTrace) return edge;
    const hidden = Boolean(sourceNode?.hidden || targetNode?.hidden);
    if (edge.hidden === hidden && edge.sourceTrace) return edge;
    changed = true;
    return {
      ...edge,
      hidden,
      ...(edge.sourceTrace ? {} : { sourceTrace: { ...inferredTrace } }),
    };
  });

  return changed ? { ...document, nodes: normalizedNodes, edges: normalizedEdges } : document;
}

function findExitNodes(state: ReferenceState, internallyOutgoingNodeIds: Set<string>): CanvasNode[] {
  const declaredExits = (state.reference.data.sourceExitNodeIds ?? [])
    .map((sourceNodeId) => state.derivedNodes.find((node) => node.source?.sourceElementId === sourceNodeId))
    .filter((node): node is CanvasNode => node !== undefined);
  if (declaredExits.length > 0) return declaredExits;

  const endNodes = state.derivedNodes.filter((node) => node.type === 'end');
  if (endNodes.length > 0) return endNodes;
  return state.derivedNodes.filter((node) => !internallyOutgoingNodeIds.has(node.id));
}

function isContinuationEdge(edge: CanvasEdge, referenceNodeId: string, derivedNodeIds: Set<string>): boolean {
  return edge.source === referenceNodeId
    && !derivedNodeIds.has(edge.target)
    && edge.sourceTrace?.referenceNodeId !== referenceNodeId;
}

function hiddenByReferenceChain(node: CanvasNode, states: Map<string, ReferenceState>): boolean | undefined {
  let referenceNodeId = node.source?.referenceNodeId;
  const seen = new Set<string>();
  let foundReference = false;
  while (referenceNodeId && !seen.has(referenceNodeId)) {
    seen.add(referenceNodeId);
    const state = states.get(referenceNodeId);
    if (!state) break;
    foundReference = true;
    if (!state.reference.data.expanded) return true;
    referenceNodeId = state.reference.source?.referenceNodeId;
  }
  return foundReference ? false : undefined;
}

function isGeneratedExitBridge(edge: CanvasEdge, referenceNodeId: string): boolean {
  const generatedId = edge.id.startsWith(`ref:${referenceNodeId}:__exit__:`) && edge.id.includes(':to:');
  const generatedTrace = edge.sourceTrace?.referenceNodeId === referenceNodeId
    && edge.sourceTrace.sourceElementId.startsWith('__exit__:')
    && edge.sourceTrace.sourceElementId.includes(':to:');
  return generatedId || generatedTrace;
}

function sameContinuations(current: ContinuationEdge[] | undefined, next: ContinuationEdge[]): boolean {
  return current?.length === next.length
    && current.every((edge, index) => edge.id === next[index]?.id && edge.hidden === next[index]?.hidden);
}

function sameEdge(left: CanvasEdge, right: CanvasEdge): boolean {
  return left.id === right.id
    && left.source === right.source
    && left.sourceHandle === right.sourceHandle
    && left.target === right.target
    && left.targetHandle === right.targetHandle
    && left.label === right.label
    && left.hidden === right.hidden
    && left.sourceTrace?.referenceNodeId === right.sourceTrace?.referenceNodeId
    && left.sourceTrace?.sourceGuideId === right.sourceTrace?.sourceGuideId
    && left.sourceTrace?.sourceVersionId === right.sourceTrace?.sourceVersionId
    && left.sourceTrace?.sourceElementId === right.sourceTrace?.sourceElementId;
}

function exitBridgeSourceElementId(sourceExitNodeId: string, continuationEdgeId: string): string {
  return `__exit__:${sourceExitNodeId}:to:${continuationEdgeId}`;
}

function derivedId(referenceNodeId: string, sourceId: string): string {
  return `ref:${referenceNodeId}:${sourceId}`;
}

function markReference(
  document: CanvasDocument,
  referenceNodeId: string,
  expanded: boolean,
  continuations?: ContinuationEdge[],
  snapshotEndpoints?: SnapshotEndpoints,
): CanvasDocument {
  return {
    ...document,
    nodes: document.nodes.map((node) =>
      node.id === referenceNodeId && node.type === 'subguide'
        ? {
          ...node,
          data: {
            ...node.data,
            expanded,
            ...(continuations ? { expandedContinuationEdges: continuations } : {}),
            ...(snapshotEndpoints ? snapshotEndpoints : {}),
          },
        }
        : node,
    ),
  };
}
