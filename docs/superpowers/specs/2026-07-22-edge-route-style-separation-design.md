# Edge Route and Visual Style Separation Design

## Status

Approved for implementation on 2026-07-22.

## Goal

Make every automatic business edge safe, predictable, and orthogonal while separating the route it follows from the way it is rendered. New nodes and newly created edges keep their authored positions; automatic layout remains an explicit preview-and-apply action.

The author can choose one visual style for a business edge:

- `orthogonal`: a folded route, retaining the existing small rounded-corner treatment;
- `smooth`: a continuous Bezier-style curve that leaves and enters ports tangentially rather than merely rounding 90-degree corners;
- `diagonal`: an explicitly selected direct diagonal only when the direct segment is safe.

No automatic routing path may introduce a diagonal segment. When endpoints are exactly aligned horizontally or vertically, the automatic route must collapse to one real horizontal or vertical segment.

## Product Model

```text
business relation and sibling order
  -> route skeleton: automatic orthogonal route or manual orthogonal waypoints
  -> path style: orthogonal, smooth, or diagonal
  -> SVG rendering
```

The route skeleton is the source of truth for safety, endpoint ordering, bridge detection, and manual editing. A style never changes a business edge's source, target, semantic type, sibling order, endpoint anchor, or manual waypoints.

## Preserved Behavior

The implementation must retain the following existing behavior unless a new safety rule explicitly requires a style fallback:

- semantic `FLOW`, `BRANCH`, `RETRY`, `EXCEPTION`, downstream, wrap, cross-stage, and back-route classification;
- sibling-order endpoint fan-out and per-channel ordering;
- manual endpoint anchors, endpoint snapping, and intentional shared anchors;
- manual route editing, waypoint persistence, route conflict detection, save, cancel, and reset;
- node obstacle avoidance, outer-route fallback, and collision reporting;
- bridge annotation for remaining orthogonal crossings;
- edge labels, color, width, patterns, arrows, history, undo/redo, and persistence;
- non-editable hierarchy/resource decoration edges as a separate presentation concern.

## Data Contract

Add a visual-only field to `EdgePresentation`:

```ts
type EdgePathStyle = 'orthogonal' | 'smooth' | 'diagonal';

interface EdgePresentation {
  pathStyle?: EdgePathStyle;
  // Existing routeMode, waypoints, anchors, color, width, pattern, and arrows remain.
}
```

`pathStyle` is optional for backward compatibility. Its resolved value is:

1. `presentation.pathStyle`, when present;
2. `diagonal` for a legacy, explicitly persisted `presentation.routing === 'straight'`;
3. `orthogonal` for legacy `routing === 'elbow'`, `routing === 'smart'`, or an omitted route style.

The legacy `routing` field remains accepted so saved documents continue to parse. New toolbar changes write `pathStyle`, not `routing`. Automatic routing no longer reads `routing` to choose direct diagonal geometry.

Changing `pathStyle` must not erase `routeMode`, `waypoints`, `sourceAnchor`, `targetAnchor`, or either anchor mode. Resetting a route is a separate command that clears only manual route geometry and returns to automatic orthogonal routing while preserving the selected visual style.

## Automatic Route Skeleton

`routeCanvasEdges` continues to classify an edge and select ports, fan out ordered siblings, avoid node rectangles, and select the shortest valid orthogonal candidate.

It must remove the current direct-line branch for `routing === 'straight'` and `routing === 'smart'`. All automatic candidates are orthogonal:

- source and target on one horizontal line: compact to one horizontal segment;
- source and target on one vertical line: compact to one vertical segment;
- otherwise: use one or more horizontal/vertical channel segments;
- blocked candidates: retain the current local-detour then outer-route fallback;
- a valid manual route remains authoritative and must stay orthogonal.

This makes node alignment meaningful: moving a node onto the same row or column can produce a real straight line, but merely being almost aligned does not create an imperceptible diagonal.

## Rendering Styles

### Orthogonal

Render the canonical route skeleton with the existing rounded-corner treatment. Rounded corners are a detail of the folded-line style, not a separately selectable style.

### Smooth

Build a true continuous cubic Bezier path from the canonical route skeleton. The curve must:

- leave the source port in the port's outward direction;
- enter the target port in the target port's inward direction;
- use route skeleton points as guide points, yielding C- or S-shaped paths rather than a series of rounded 90-degree corners;
- sample the generated curve and reject it if it enters an obstacle or crosses an unsafe endpoint clearance area.

When the smooth curve cannot safely fit within the canonical route's clear corridor, render the orthogonal route instead for that edge. The saved style remains `smooth`; the fallback is visual and does not rewrite the document.

### Diagonal

Diagonal is never selected automatically. When the author explicitly selects it, render one direct segment only if the same node-obstacle and endpoint-clearance checks report that segment safe. If it is unsafe, render the canonical orthogonal fallback without altering the saved style or business relation.

### Bridges

Bridge annotation remains computed from canonical orthogonal skeletons. A route with a required bridge renders as orthogonal for clarity if its selected smooth or diagonal presentation cannot safely preserve that bridge. Curve-aware bridge geometry is deliberately out of scope for this pass; existing bridge visibility is preserved instead of being silently lost.

## Editor Interaction

Replace the current "选择连线路由" menu with "选择画线风格":

- 折线
- 平滑曲线
- 斜线

Keep "编辑走向" as a separate action. It exposes the existing main-canvas endpoint and segment editing behavior for the route skeleton. It does not turn a smooth curve into a freehand curve editor. Saving or cancelling route editing affects only manual route geometry; selecting a visual style never clears manual geometry or anchors.

Rename the reset action to "恢复自动走线". It clears manual waypoints and returns to the automatic orthogonal skeleton while preserving colors, labels, arrows, anchors, and `pathStyle`.

Hierarchy/resource decoration edges remain visibly separate and non-editable; their existing direct presentation is not changed by the business-edge style selector.

## Failure and Compatibility Behavior

- Existing documents parse without migration.
- Legacy `straight` presentation preserves an author's explicit diagonal intent only when its segment is safe; otherwise it safely renders as an orthogonal fallback.
- Legacy `smart` and `elbow` presentations render as orthogonal automatic routes and no longer create automatic diagonals.
- An invalid manual route still reports conflict and cannot be saved.
- A style safety fallback is render-time behavior only; it never deletes the author's selected style, manual waypoints, or anchors.

## Validation

Automated tests must cover:

1. Contract parsing and legacy style resolution.
2. Automatic route geometry: `straight` and `smart` legacy settings no longer produce diagonal automatic segments; aligned endpoints produce one exact horizontal or vertical segment.
3. Existing fan-out, shared-anchor, manual-route, endpoint-snap, obstacle, and bridge tests remain green.
4. Style renderer output: folded routes, true cubic smooth curves, safe diagonal paths, and unsafe style fallback.
5. Toolbar behavior: style changes preserve manual waypoints and anchors; route reset clears only manual route geometry.
6. Guide editor integration: selected styles reach the custom edge renderer, manual edit remains available, and hierarchy decoration edges remain non-editable.

Browser QA must demonstrate an aligned real straight line, a non-aligned automatic folded line, a true smooth curve, a blocked smooth/diagonal fallback, endpoint editing, shared-anchor snapping, and a retained bridge on a crossing orthogonal route.

## Scope Boundaries

This pass does not:

- change flow semantics or source/target business relations;
- make layout run automatically after node or edge creation;
- add freehand Bezier control-point editing;
- add curve-aware bridge rendering;
- remove existing manual route controls, endpoint reconnecting, labels, or hierarchy/resource presentation edges.
