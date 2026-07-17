# Canvas Interaction Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** 让作者可安全删除阶段和泳道、用实体对话框编辑并按需展开节点明细，以及对业务连线进行精确锚点重连与样式编辑，并让学习页只读复现保存结果。

**Architecture:** 为 CanvasEdge 增加可选 presentation；canvas-core 把锚点转换为正交路径端点；web 编辑器只把 React Flow 物理 handle 当作渲染与拖拽层状态，继续保存 sourceHandle 和 targetHandle 的业务语义。层级删除、节点详情和线条工具栏都经 GuideEditor 的单一 commit 路径修改 CanvasDocument，从而保留历史栈、自动保存与 Schema 校验。

**Tech Stack:** TypeScript 5.9、Zod 4、Vitest 4、React 19、@xyflow/react 12.11.2、现有 Canvas Core 正交避障路由。

## Global Constraints

- 仅删除阶段或泳道本身；受影响的一级主流程节点只清除 stageId 或 laneId，节点、连线、资料、教学步骤、入口和出口均保留。
- EdgePresentation 所有字段可选；旧边继续呈现 accent、2px、实线、正向箭头和既有端口中点路由。
- sourceHandle 和 targetHandle 始终表示 yes、no、out、in 等业务语义；生成的 React Flow 物理 handle id 不得写入 CanvasDocument。
- 颜色、粗细、线型和箭头均为受限枚举，不接受任意 CSS 或 SVG 字符串。
- 只有一级、非派生的 start、end、process、decision、data、subguide 间业务边可编辑。资料挂靠边、隐藏边和 sourceTrace 派生边不可编辑。
- 节点详情展开状态仅为 GuideEditor 展示状态；展开测量高度不得写入 node.size，展开时隐藏 NodeResizer。
- layoutPreview 激活时，层级管理与连线编辑保持禁用。
- 保留 worktree 中已有媒体轻盒和节点删除变动；每次提交只暂存本任务文件。
- 测试从 apps/web 或 package-filter 命令运行，避免根目录测试发现相邻 worktree。

---

## File Structure

- Modify: packages/contracts/src/canvas.ts — EdgeAnchor、EdgePresentation 的 Zod schema 与 CanvasEdgeSchema。
- Modify: packages/contracts/src/canvas.test.ts — 旧边兼容和新 presentation 边界值。
- Modify: packages/canvas-core/src/routing.ts — 精确端点和离开方向，保留路由类别与避障。
- Modify: packages/canvas-core/src/routing.test.ts — 锚点与旧路由回归。
- Create: apps/web/src/features/editor/edge-presentation.ts — 视觉映射、边缘命中计算、业务边门禁。
- Create: apps/web/src/features/editor/edge-presentation.test.ts — 样式映射和任意边缘位置计算。
- Create: apps/web/src/features/editor/EdgeToolbar.tsx — 颜色、粗细、线型、箭头工具栏。
- Create: apps/web/src/features/editor/EdgeToolbar.test.tsx — 控件可访问性与 change 回调。
- Create: apps/web/src/features/editor/NodeDetailDialog.tsx — 实色节点详情编辑对话框、焦点和快捷键。
- Create: apps/web/src/features/editor/NodeDetailDialog.test.tsx — 保存、取消、Escape、Meta/Ctrl+Enter。
- Create: apps/web/src/features/editor/HierarchyDeletionDialog.tsx — 层级影响数确认对话框。
- Create: apps/web/src/features/editor/HierarchyDeletionDialog.test.tsx — 文案与确认/取消。
- Create: apps/web/src/features/nodes/NodeDetailPresentation.tsx — FlowNode 与 GuideEditor 的本地详情展示状态。
- Modify: apps/web/src/features/editor/GuideEditor.tsx — 层级删除、详情状态、边选择、样式更新、新建/重连锚点。
- Modify: apps/web/src/features/editor/GuideEditor.test.tsx — 删除不丢图、详情展示、边样式和重连。
- Modify: apps/web/src/features/editor/HierarchyPanel.tsx — 删除请求按钮与影响数。
- Modify: apps/web/src/features/editor/HierarchyPanel.test.tsx — 删除请求与 preview 锁定。
- Modify: apps/web/src/features/editor/OrthogonalEdge.tsx — markerStart、markerEnd 与受控 SVG style。
- Create: apps/web/src/features/editor/OrthogonalEdge.test.tsx — marker 与 stroke/dash 配置。
- Modify: apps/web/src/features/nodes/FlowNode.tsx — 单行摘要、详情/收起与对话框触发器。
- Modify: apps/web/src/features/nodes/NodeChrome.tsx — 连续四边连接面、精确物理端口、展开态尺寸。
- Modify: apps/web/src/features/nodes/NodeChrome.test.tsx — 连续连接面和展开态无 Resizer。
- Modify: apps/web/src/features/lesson/LessonPage.tsx — 只读 edge data 与视觉/锚点复用。
- Modify: apps/web/src/features/lesson/LessonPage.test.tsx — 学习页复现 edge presentation，且无编辑控件。
- Modify: apps/web/src/styles.css — 对话框、摘要/展开、锚点命中面、边工具栏响应式样式。

### Task 1: 持久化连线展示契约

**Files:**
- Modify: packages/contracts/src/canvas.ts
- Modify: packages/contracts/src/canvas.test.ts

**Interfaces:**
- Produces: EdgeAnchorSchema、EdgePresentationSchema，及 CanvasEdge.presentation。
- Produces: 从 contracts 导出的 EdgeAnchor 和 EdgePresentation 类型，供 routing 和 web 使用。

- [ ] **Step 1: 写失败的契约测试**

在 canvas.test.ts 新增。它同时锁定旧数据兼容、合法 presentation round-trip 与不安全值拒绝。

~~~ts
it('accepts legacy edges and persists constrained edge presentation', () => {
  const legacy = hierarchyDocument({
    edges: [{ id: 'legacy', source: 'start', target: 'start' }],
  });
  const styled = hierarchyDocument({
    edges: [{
      id: 'styled', source: 'start', target: 'start',
      presentation: {
        color: 'purple', width: 4, pattern: 'dotted', arrows: 'both',
        sourceAnchor: { side: 'BOTTOM', offset: 0.2 },
        targetAnchor: { side: 'LEFT', offset: 0.8 },
      },
    }],
  });

  expect(CanvasDocumentSchema.safeParse(legacy).success).toBe(true);
  expect(CanvasDocumentSchema.safeParse(styled).data?.edges[0]?.presentation)
    .toEqual(styled.edges[0]?.presentation);
});

it('rejects unsafe edge presentation values', () => {
  const invalidOffset = hierarchyDocument({
    edges: [{ id: 'bad-offset', source: 'start', target: 'start',
      presentation: { sourceAnchor: { side: 'TOP', offset: 1.01 } } }],
  });
  const invalidStyle = hierarchyDocument({
    edges: [{ id: 'bad-style', source: 'start', target: 'start',
      presentation: { color: 'url(javascript:alert(1))', width: 5 } }],
  });

  expect(CanvasDocumentSchema.safeParse(invalidOffset).success).toBe(false);
  expect(CanvasDocumentSchema.safeParse(invalidStyle).success).toBe(false);
});
~~~

- [ ] **Step 2: 运行测试确认失败**

Run: pnpm --filter @guideanything/contracts test -- canvas.test.ts

Expected: FAIL，因为 CanvasEdgeSchema 尚不认识 presentation。

- [ ] **Step 3: 最小实现受限 Schema 和类型导出**

在 CanvasEdgeSchema 前定义：

~~~ts
const EdgeAnchorSchema = z.object({
  side: z.enum(['TOP', 'RIGHT', 'BOTTOM', 'LEFT']),
  offset: z.number().min(0).max(1),
});

const EdgePresentationSchema = z.object({
  color: z.enum(['default', 'blue', 'green', 'yellow', 'red', 'purple']).optional(),
  width: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).optional(),
  pattern: z.enum(['solid', 'dashed', 'dotted']).optional(),
  arrows: z.enum(['none', 'forward', 'reverse', 'both']).optional(),
  sourceAnchor: EdgeAnchorSchema.optional(),
  targetAnchor: EdgeAnchorSchema.optional(),
});

export type EdgeAnchor = z.infer<typeof EdgeAnchorSchema>;
export type EdgePresentation = z.infer<typeof EdgePresentationSchema>;
~~~

把 CanvasEdgeSchema 增加一行：

~~~ts
presentation: EdgePresentationSchema.optional(),
~~~

不要改变 source、target 端点必填语义或 schemaVersion。确认 packages/contracts/src/index.ts 已 re-export canvas；如果没有，显式 re-export EdgeAnchor 和 EdgePresentation。

- [ ] **Step 4: 运行契约测试与类型检查**

Run: pnpm --filter @guideanything/contracts test -- canvas.test.ts && pnpm --filter @guideanything/contracts typecheck

Expected: PASS，旧边和受限 presentation 均可解析，越界/任意 CSS 值被拒绝。

- [ ] **Step 5: 提交这一个契约任务**

~~~bash
git add packages/contracts/src/canvas.ts packages/contracts/src/canvas.test.ts packages/contracts/src/index.ts
git commit -m "feat: persist constrained edge presentation"
~~~

如果 index.ts 未改动，不把它加入 git add。

### Task 2: 让正交路由使用精确锚点

**Files:**
- Modify: packages/canvas-core/src/routing.ts
- Modify: packages/canvas-core/src/routing.test.ts

**Interfaces:**
- Consumes: CanvasEdge.presentation.sourceAnchor 和 targetAnchor。
- Produces: OrthogonalRoute 的 sourceSide、targetSide 与 points；首尾点等于保存锚点的绝对坐标。
- Preserves: 无锚点时继续使用现有 sidesFor 与 port 中点策略。

- [ ] **Step 1: 写失败的路由测试**

在 routing.test.ts 新增。第一个证明 offset 精确，第二个证明锚点不改变回流分类。

~~~ts
it('uses persisted exact edge anchors as route endpoints', () => {
  const result = routeCanvasEdges(document(
    [process('source', 100, 80), process('target', 500, 300)],
    [edge('anchored', 'source', 'target', {
      presentation: {
        sourceAnchor: { side: 'BOTTOM', offset: 0.25 },
        targetAnchor: { side: 'LEFT', offset: 0.6 },
      },
    })],
  ));
  const route = result.routesByEdgeId.get('anchored')!;

  expect(route.sourceSide).toBe('BOTTOM');
  expect(route.targetSide).toBe('LEFT');
  expect(route.points[0]).toEqual({ x: 150, y: 180 });
  expect(route.points.at(-1)).toEqual({ x: 500, y: 360 });
  expectOrthogonal(route.points);
});

it('keeps a backward edge classified as BACK when endpoints are anchored', () => {
  const result = routeCanvasEdges(document(
    [process('first', 0, 0), process('last', 640, 0)],
    [edge('feedback', 'last', 'first', {
      presentation: {
        sourceAnchor: { side: 'TOP', offset: 0.75 },
        targetAnchor: { side: 'BOTTOM', offset: 0.2 },
      },
    })],
  ));
  const route = result.routesByEdgeId.get('feedback')!;

  expect(route.kind).toBe('BACK');
  expect(route.points[0]).toEqual({ x: 790, y: 0 });
  expect(route.points.at(-1)).toEqual({ x: 40, y: 100 });
  expectOrthogonal(route.points);
});
~~~

- [ ] **Step 2: 运行测试确认失败**

Run: pnpm --filter @guideanything/canvas-core test -- routing.test.ts

Expected: FAIL，当前首尾点均为固定 port 中点。

- [ ] **Step 3: 解析锚点端口并接入全部路由分支**

在 routing.ts 加入：

~~~ts
function clampOffset(value: number | undefined): number {
  return Math.min(1, Math.max(0, value ?? 0.5));
}

function anchoredPort(
  rect: Rect,
  anchor: EdgeAnchor | undefined,
  fallback: Side,
): { point: Point; side: Side } {
  const side = anchor?.side ?? fallback;
  const offset = clampOffset(anchor?.offset);
  if (side === 'TOP') return { side, point: { x: rect.x + rect.width * offset, y: rect.y } };
  if (side === 'RIGHT') return { side, point: { x: rect.x + rect.width, y: rect.y + rect.height * offset } };
  if (side === 'BOTTOM') return { side, point: { x: rect.x + rect.width * offset, y: rect.y + rect.height } };
  return { side, point: { x: rect.x, y: rect.y + rect.height * offset } };
}
~~~

每条边先计算：

~~~ts
const fallback = sidesFor(source, target, edge);
const sourcePort = anchoredPort(source, edge.presentation?.sourceAnchor, fallback.source);
const targetPort = anchoredPort(target, edge.presentation?.targetAnchor, fallback.target);
~~~

directRoute、backRoute、outerRoute 接收 sourcePort/targetPort，不在函数内再次调用 port(rect, side)。首段沿 sourcePort.side 离开，末段沿 targetPort.side 反向进入。保留 channel、collision、BACK、CROSS_STAGE、WRAP、BRANCH 分类与 hidden/sourceTrace 排除逻辑。

- [ ] **Step 4: 运行 canvas-core 回归**

Run: pnpm --filter @guideanything/canvas-core test -- routing.test.ts && pnpm --filter @guideanything/canvas-core typecheck

Expected: PASS，所有段均为水平或垂直，existing BACK/CROSS_STAGE/WRAP/BRANCH 测试继续通过。

- [ ] **Step 5: 提交路由任务**

~~~bash
git add packages/canvas-core/src/routing.ts packages/canvas-core/src/routing.test.ts
git commit -m "feat: route edges through persisted anchors"
~~~

### Task 3: 建立可测的展示映射、只读渲染和边工具栏

**Files:**
- Create: apps/web/src/features/editor/edge-presentation.ts
- Create: apps/web/src/features/editor/edge-presentation.test.ts
- Create: apps/web/src/features/editor/EdgeToolbar.tsx
- Create: apps/web/src/features/editor/EdgeToolbar.test.tsx
- Modify: apps/web/src/features/editor/OrthogonalEdge.tsx
- Create: apps/web/src/features/editor/OrthogonalEdge.test.tsx
- Modify: apps/web/src/features/lesson/LessonPage.tsx
- Modify: apps/web/src/features/lesson/LessonPage.test.tsx
- Modify: apps/web/src/styles.css

**Interfaces:**
- Produces: resolveEdgeVisuals(presentation) 的 SVG style、markerStart、markerEnd。
- Produces: edgeAnchorFromClientPoint(rect, point) 的 EdgeAnchor。
- Produces: isEditableBusinessEdge(document, edge) 作为编辑器唯一门禁。
- Produces: EdgeToolbar 的 onChange(partial: Partial<EdgePresentation>)。

- [ ] **Step 1: 写失败的纯函数测试**

创建 edge-presentation.test.ts：

~~~ts
import { describe, expect, it } from 'vitest';
import { edgeAnchorFromClientPoint, resolveEdgeVisuals } from './edge-presentation';

describe('edge presentation helpers', () => {
  it('maps persisted visual options to controlled SVG values', () => {
    expect(resolveEdgeVisuals({ color: 'red', width: 3, pattern: 'dashed', arrows: 'both' })).toMatchObject({
      style: { stroke: 'var(--ga-edge-red)', strokeWidth: 3, strokeDasharray: '8 5' },
      markerStart: { type: 'arrowclosed' },
      markerEnd: { type: 'arrowclosed' },
    });
  });

  it('finds the nearest node edge with exact relative offset', () => {
    const rect = { left: 100, top: 200, width: 240, height: 120 };
    expect(edgeAnchorFromClientPoint(rect, { x: 148, y: 202 })).toEqual({ side: 'TOP', offset: 0.2 });
    expect(edgeAnchorFromClientPoint(rect, { x: 338, y: 260 })).toEqual({ side: 'RIGHT', offset: 0.5 });
    expect(edgeAnchorFromClientPoint(rect, { x: 100, y: 296 })).toEqual({ side: 'LEFT', offset: 0.8 });
  });
});
~~~

- [ ] **Step 2: 运行测试确认失败**

Run: pnpm --filter @guideanything/web test -- edge-presentation.test.ts

Expected: FAIL，因为 helper 文件尚不存在。

- [ ] **Step 3: 实现受限视觉映射、锚点计算和门禁**

创建 edge-presentation.ts：

~~~ts
import type { CanvasDocument, CanvasEdge, EdgeAnchor, EdgePresentation } from '@guideanything/contracts';

const primaryTypes = new Set(['start', 'end', 'process', 'decision', 'data', 'subguide']);
const colorByName = {
  default: 'var(--ga-accent)',
  blue: 'var(--ga-edge-blue)',
  green: 'var(--ga-edge-green)',
  yellow: 'var(--ga-edge-yellow)',
  red: 'var(--ga-edge-red)',
  purple: 'var(--ga-edge-purple)',
} as const;

export function resolveEdgeVisuals(presentation: EdgePresentation | undefined) {
  const arrows = presentation?.arrows ?? 'forward';
  return {
    style: {
      stroke: colorByName[presentation?.color ?? 'default'],
      strokeWidth: presentation?.width ?? 2,
      ...(presentation?.pattern === 'dashed' ? { strokeDasharray: '8 5' }
        : presentation?.pattern === 'dotted' ? { strokeDasharray: '1 5', strokeLinecap: 'round' }
        : {}),
    },
    markerStart: arrows === 'reverse' || arrows === 'both' ? { type: 'arrowclosed' } : undefined,
    markerEnd: arrows === 'forward' || arrows === 'both' ? { type: 'arrowclosed' } : undefined,
  };
}

export function edgeAnchorFromClientPoint(rect: { left: number; top: number; width: number; height: number }, point: { x: number; y: number }): EdgeAnchor {
  const x = Math.min(1, Math.max(0, (point.x - rect.left) / rect.width));
  const y = Math.min(1, Math.max(0, (point.y - rect.top) / rect.height));
  const distances = [['TOP', y], ['RIGHT', 1 - x], ['BOTTOM', 1 - y], ['LEFT', x]] as const;
  const [side] = distances.reduce((closest, candidate) => candidate[1] < closest[1] ? candidate : closest);
  return { side, offset: side === 'TOP' || side === 'BOTTOM' ? x : y };
}

export function isEditableBusinessEdge(document: CanvasDocument, edge: CanvasEdge): boolean {
  if (edge.hidden || edge.sourceTrace) return false;
  const source = document.nodes.find((node) => node.id === edge.source);
  const target = document.nodes.find((node) => node.id === edge.target);
  return Boolean(source && target && !source.source && !target.source && !source.contentParentId && !target.contentParentId
    && primaryTypes.has(source.type) && primaryTypes.has(target.type));
}
~~~

在 styles.css 定义 --ga-edge-blue、--ga-edge-green、--ga-edge-yellow、--ga-edge-red、--ga-edge-purple，light/dark 均保持可读。

- [ ] **Step 4: 写工具栏与 Edge renderer 的失败组件测试**

创建 EdgeToolbar.test.tsx：

~~~tsx
it('emits one constrained partial update per toolbar choice', async () => {
  const onChange = vi.fn();
  const user = userEvent.setup();
  render(<EdgeToolbar presentation={{}} onChange={onChange} onClose={vi.fn()} />);

  await user.click(screen.getByRole('button', { name: '红色连线' }));
  await user.click(screen.getByRole('button', { name: '4 像素' }));
  await user.click(screen.getByRole('button', { name: '点线' }));
  await user.click(screen.getByRole('button', { name: '双向箭头' }));

  expect(onChange).toHaveBeenNthCalledWith(1, { color: 'red' });
  expect(onChange).toHaveBeenNthCalledWith(2, { width: 4 });
  expect(onChange).toHaveBeenNthCalledWith(3, { pattern: 'dotted' });
  expect(onChange).toHaveBeenNthCalledWith(4, { arrows: 'both' });
});
~~~

创建 OrthogonalEdge.test.tsx，传入 markerStart、markerEnd、strokeWidth 和 strokeDasharray，断言 SVG path 有 marker-start、marker-end、stroke-width、stroke-dasharray。

- [ ] **Step 5: 实现 EdgeToolbar、Edge renderer 和学习页复用**

EdgeToolbar 使用 role="toolbar"、aria-label="连线样式" 和四个 fieldset。按钮文案固定为默认色、蓝色连线、绿色连线、黄色连线、红色连线、紫色连线；1 像素到 4 像素；实线、虚线、点线；无箭头、正向箭头、反向箭头、双向箭头。选中项使用 aria-pressed。

OrthogonalEdge 改为：

~~~tsx
export const OrthogonalEdge = memo(function OrthogonalEdge({
  id, data, sourceX, sourceY, targetX, targetY, markerStart, markerEnd, style, label,
}: EdgeProps) {
  const route = (data as OrthogonalEdgeData | undefined)?.route;
  const points = route?.points ?? fallbackPoints(sourceX, sourceY, targetX, targetY);
  const path = orthogonalPath(points);
  return <>
    <BaseEdge id={id} path={path}
      {...(markerStart ? { markerStart } : {})}
      {...(markerEnd ? { markerEnd } : {})}
      {...(style ? { style } : {})}
    />
    {label ? <EdgeLabelRenderer>{/* retain current labelPoint element */}</EdgeLabelRenderer> : null}
  </>;
});
~~~

不要在 OrthogonalEdge 内渲染工具栏；它由 GuideEditor 的 ViewportPortal 定位。

LessonPage 的 toLessonFlowEdges 对业务边调用 resolveEdgeVisuals(edge.presentation)，把 visual fields 与 route 放入 Edge。LessonPage.test.tsx 以 purple、4px、dotted、both 和两端 anchors 的 document 断言 flow edge 含 route、markerStart、markerEnd、strokeDasharray；断言页面没有 role="toolbar"。

- [ ] **Step 6: 运行展示与学习页回归**

Run: pnpm --filter @guideanything/web test -- edge-presentation.test.ts EdgeToolbar.test.tsx OrthogonalEdge.test.tsx LessonPage.test.tsx

Expected: PASS，学习页只展示保存后的线条，不出现编辑控件。

- [ ] **Step 7: 提交展示层任务**

~~~bash
git add apps/web/src/features/editor/edge-presentation.ts apps/web/src/features/editor/edge-presentation.test.ts apps/web/src/features/editor/EdgeToolbar.tsx apps/web/src/features/editor/EdgeToolbar.test.tsx apps/web/src/features/editor/OrthogonalEdge.tsx apps/web/src/features/editor/OrthogonalEdge.test.tsx apps/web/src/features/lesson/LessonPage.tsx apps/web/src/features/lesson/LessonPage.test.tsx apps/web/src/styles.css
git commit -m "feat: render persisted edge presentation"
~~~

### Task 4: 删除阶段与泳道但保留流程图

**Files:**
- Create: apps/web/src/features/editor/HierarchyDeletionDialog.tsx
- Create: apps/web/src/features/editor/HierarchyDeletionDialog.test.tsx
- Modify: apps/web/src/features/editor/HierarchyPanel.tsx
- Modify: apps/web/src/features/editor/HierarchyPanel.test.tsx
- Modify: apps/web/src/features/editor/GuideEditor.tsx
- Modify: apps/web/src/features/editor/GuideEditor.test.tsx
- Modify: apps/web/src/styles.css

**Interfaces:**
- Produces: removeHierarchyItem(document, kind, id) -> CanvasDocument。
- Produces: HierarchyPanel 的 onRequestDeleteStage(stageId) 与 onRequestDeleteLane(laneId)。
- Produces: HierarchyDeletionDialog 的 itemType、title、affectedNodeCount、onConfirm、onCancel。

- [ ] **Step 1: 写失败的 document 转换和 UI 请求测试**

GuideEditor.test.tsx 导入 removeHierarchyItem：

~~~ts
it('removes only a stage and clears membership without dropping graph data', () => {
  const document = hierarchyDocumentWithEdgesAndSteps();
  const next = removeHierarchyItem(document, 'stage', 'prepare');

  expect(next.stages).toEqual([{ id: 'review', title: '复核', order: 0 }]);
  expect(next.nodes).toHaveLength(document.nodes.length);
  expect(next.nodes.find((node) => node.id === 'process-a')).not.toHaveProperty('stageId');
  expect(next.edges).toEqual(document.edges);
  expect(next.steps).toEqual(document.steps);
});

it('removes only a lane and clears membership without dropping edges', () => {
  const next = removeHierarchyItem(hierarchyDocumentWithEdgesAndSteps(), 'lane', 'sales');
  expect(next.lanes).toEqual([{ id: 'erp', title: 'ERP', kind: 'SYSTEM', order: 0 }]);
  expect(next.nodes.find((node) => node.id === 'process-a')).not.toHaveProperty('laneId');
  expect(next.edges).toHaveLength(1);
});
~~~

HierarchyPanel.test.tsx 点击删除阶段 准备、删除泳道 销售，断言 request callback 收到 id；editingLocked 时删除按钮 disabled。

- [ ] **Step 2: 运行失败测试**

Run: pnpm --filter @guideanything/web test -- GuideEditor.test.tsx HierarchyPanel.test.tsx HierarchyDeletionDialog.test.tsx

Expected: FAIL，因为转换、删除按钮与确认对话框不存在。

- [ ] **Step 3: 实现纯删除转换和 commit 路径**

GuideEditor.tsx 导出：

~~~ts
export function removeHierarchyItem(document: CanvasDocument, kind: 'stage' | 'lane', itemId: string): CanvasDocument {
  const property = kind === 'stage' ? 'stageId' : 'laneId';
  const ordered = kind === 'stage' ? document.stages ?? [] : document.lanes ?? [];
  const remaining = ordered
    .filter((item) => item.id !== itemId)
    .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))
    .map((item, order) => ({ ...item, order }));
  return {
    ...document,
    ...(kind === 'stage' ? { stages: remaining } : { lanes: remaining }),
    nodes: document.nodes.map((node) => node[property] === itemId ? { ...node, [property]: undefined } : node),
  };
}
~~~

GuideEditor 维护 pendingHierarchyDeletion。确认时调用 commit(removeHierarchyItem(...))，再清空 pending state。影响数使用 node.stageId 或 node.laneId 的等值计数。

- [ ] **Step 4: 实现确认对话框与面板入口**

HierarchyDeletionDialog 使用 modal-backdrop 和实体表面，role="dialog"、aria-modal="true"。文案固定为：

~~~tsx
<p>将解除 {affectedNodeCount} 个流程节点的归属；节点与连线会保留。</p>
~~~

确认按钮叫确认删除加 title，取消按钮叫取消删除，Escape 等价取消。HierarchyPanel 为阶段和泳道加入 explicit delete callbacks、删除 aria-label 和 layoutPreview disabled 状态；调整 row grid 以容纳删除按钮。

- [ ] **Step 5: 运行目标测试与撤销回归**

Run: pnpm --filter @guideanything/web test -- GuideEditor.test.tsx HierarchyPanel.test.tsx HierarchyDeletionDialog.test.tsx

Expected: PASS，确认只解除归属，现有撤销按钮可恢复删除前层级。

- [ ] **Step 6: 提交层级删除任务**

~~~bash
git add apps/web/src/features/editor/HierarchyDeletionDialog.tsx apps/web/src/features/editor/HierarchyDeletionDialog.test.tsx apps/web/src/features/editor/HierarchyPanel.tsx apps/web/src/features/editor/HierarchyPanel.test.tsx apps/web/src/features/editor/GuideEditor.tsx apps/web/src/features/editor/GuideEditor.test.tsx apps/web/src/styles.css
git commit -m "feat: remove stages and lanes without deleting flow"
~~~

### Task 5: 用实体对话框编辑节点明细，并按需展开

**Files:**
- Create: apps/web/src/features/editor/NodeDetailDialog.tsx
- Create: apps/web/src/features/editor/NodeDetailDialog.test.tsx
- Create: apps/web/src/features/nodes/NodeDetailPresentation.tsx
- Modify: apps/web/src/features/nodes/FlowNode.tsx
- Modify: apps/web/src/features/nodes/NodeChrome.tsx
- Modify: apps/web/src/features/nodes/NodeChrome.test.tsx
- Modify: apps/web/src/features/editor/GuideEditor.tsx
- Modify: apps/web/src/features/editor/GuideEditor.test.tsx
- Modify: apps/web/src/styles.css

**Interfaces:**
- Produces: NodeDetailDialog({ nodeId, title, value, openerRef, onSave, onCancel })。
- Produces: NodeDetailPresentationProvider({ expandedNodeIds, onOpenEditor, onToggleExpanded })。
- Produces: toFlowNodes(nodes, { expandedNodeIds })；展开节点省略固定 height。
- Produces: persistableNodeChanges(changes, expandedNodeIds)，过滤临时展开尺寸。

- [ ] **Step 1: 写失败的对话框和编辑器集成测试**

创建 NodeDetailDialog.test.tsx：

~~~tsx
it('saves multi-line details through Meta+Enter and restores focus to the trigger', async () => {
  const user = userEvent.setup();
  const onSave = vi.fn();
  const opener = document.createElement('button');
  document.body.append(opener);
  render(<NodeDetailDialog nodeId="process-a" title="操作步骤" value="旧明细" openerRef={{ current: opener }} onSave={onSave} onCancel={vi.fn()} />);

  const input = screen.getByRole('textbox', { name: '操作步骤 · 节点明细' });
  await user.clear(input);
  await user.type(input, '第一行\\n第二行');
  await user.keyboard('{Meta>}{Enter}{/Meta}');

  expect(onSave).toHaveBeenCalledWith('第一行\\n第二行');
  expect(opener).toHaveFocus();
});

it('cancels unsaved detail edits with Escape', async () => {
  const user = userEvent.setup();
  const onCancel = vi.fn();
  render(<NodeDetailDialog nodeId="process-a" title="操作步骤" value="旧明细" openerRef={{ current: null }} onSave={vi.fn()} onCancel={onCancel} />);
  await user.type(screen.getByRole('textbox'), ' 不保存');
  await user.keyboard('{Escape}');
  expect(onCancel).toHaveBeenCalledTimes(1);
});
~~~

GuideEditor.test.tsx 增加：双击描述触发器出现 dialog；取消不改 document；保存多行后 flow-description 仅显示第一行；点击详情和收起不改 description 或 node.size。

- [ ] **Step 2: 运行失败测试**

Run: pnpm --filter @guideanything/web test -- NodeDetailDialog.test.tsx NodeChrome.test.tsx GuideEditor.test.tsx

Expected: FAIL，因为 FlowNode 仍把 description 替换为固定节点内的 textarea。

- [ ] **Step 3: 实现实色 NodeDetailDialog**

textarea 永远放在 modal-backdrop 中，不嵌入节点 DOM：

~~~tsx
export function NodeDetailDialog({ nodeId, title, value, openerRef, onSave, onCancel }: Props) {
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const close = (saved: boolean) => {
    if (saved && draft !== value) onSave(draft);
    onCancel();
    requestAnimationFrame(() => openerRef.current?.focus());
  };
  return <div className="modal-backdrop node-detail-backdrop" role="presentation">
    <section className="node-detail-dialog" role="dialog" aria-modal="true" aria-labelledby={'node-detail-' + nodeId}>
      <h2 id={'node-detail-' + nodeId}>编辑节点明细</h2>
      <label>{title} · 节点明细<textarea ref={inputRef} value={draft} onChange={(event) => setDraft(event.target.value)} /></label>
      <div><button type="button" onClick={() => close(false)}>取消</button><button type="button" onClick={() => close(true)}>保存</button></div>
    </section>
  </div>;
}
~~~

打开时聚焦 textarea；Escape 调用 close(false)；Meta/Ctrl + Enter 调用 close(true)；普通 Enter 保留换行；所有控件加 nodrag/nopan/nowheel。

- [ ] **Step 4: 用本地展示上下文替换 FlowNode 的 description 内联编辑**

创建 NodeDetailPresentation.tsx：

~~~ts
type NodeDetailPresentation = {
  expandedNodeIds: ReadonlySet<string>;
  onOpenEditor: (nodeId: string, trigger: HTMLButtonElement) => void;
  onToggleExpanded: (nodeId: string) => void;
};
~~~

FlowNode 对标题保持 InlineNodeTextEditor，对 description 改为：

~~~tsx
<button ref={detailTriggerRef} type="button" className="flow-detail-trigger nodrag nopan nowheel"
  aria-label={'编辑' + label + ' · 节点明细'}
  onDoubleClick={(event) => {
    event.stopPropagation();
    detailPresentation.onOpenEditor(id, event.currentTarget);
  }}>
  {description ? <p className="flow-description">{description.split('\\n')[0]}</p> : <span>双击添加节点明细</span>}
</button>
{description ? <button type="button" className="flow-detail-toggle nodrag nopan nowheel"
  onClick={() => detailPresentation.onToggleExpanded(id)}>{expanded ? '收起' : '详情'}</button> : null}
~~~

展开态显示完整 description 并使用 white-space: pre-wrap，紧凑态只显示第一行。GuideEditor 管理 Set 和 dialog target；保存使用 updateInlineNodeText(document, nodeId, 'description', value) 再 commit。

- [ ] **Step 5: 防止临时高度被持久化**

NodeChrome 新增 expanded prop。expanded 时 className 加 is-detail-expanded，nodeChromeStyle 只返回 width、不返回 height，NodeResizer 的 isVisible 为 Boolean(selected && !expanded)。

toFlowNodes 选项：

~~~ts
export function toFlowNodes(nodes: CanvasNode[], options: { expandedNodeIds?: ReadonlySet<string> } = {}): Node[] {
  return nodes.map((node) => {
    const expanded = options.expandedNodeIds?.has(node.id) ?? false;
    const size = node.size ?? defaultFlowNodeSize(node);
    return {
      id: node.id, type: node.type, position: node.position,
      style: expanded ? { width: size.width } : { width: size.width, height: size.height },
      data: { ...(node.data as Record<string, unknown>), detailExpanded: expanded },
    } as Node;
  });
}
~~~

把 persistableNodeChanges 改为 persistableNodeChanges(changes, expandedNodeIds = new Set())，并排除 id 属于 expandedNodeIds 的 dimensions change。GuideEditor 每次调用传当前 set；收起后重取 document size/default size。

- [ ] **Step 6: 运行详情目标测试**

Run: pnpm --filter @guideanything/web test -- NodeDetailDialog.test.tsx NodeChrome.test.tsx GuideEditor.test.tsx

Expected: PASS，textarea 不再溢出固定节点；保存、取消、详情、收起和尺寸保护均受测。

- [ ] **Step 7: 提交节点详情任务**

~~~bash
git add apps/web/src/features/editor/NodeDetailDialog.tsx apps/web/src/features/editor/NodeDetailDialog.test.tsx apps/web/src/features/nodes/NodeDetailPresentation.tsx apps/web/src/features/nodes/FlowNode.tsx apps/web/src/features/nodes/NodeChrome.tsx apps/web/src/features/nodes/NodeChrome.test.tsx apps/web/src/features/editor/GuideEditor.tsx apps/web/src/features/editor/GuideEditor.test.tsx apps/web/src/styles.css
git commit -m "feat: edit and expand flow node details"
~~~

### Task 6: 保存样式、精确锚点并重连业务边

**Files:**
- Modify: apps/web/src/features/editor/GuideEditor.tsx
- Modify: apps/web/src/features/editor/GuideEditor.test.tsx
- Modify: apps/web/src/features/nodes/NodeChrome.tsx
- Modify: apps/web/src/features/nodes/NodeChrome.test.tsx
- Modify: apps/web/src/styles.css

**Interfaces:**
- Consumes: resolveEdgeVisuals、edgeAnchorFromClientPoint、isEditableBusinessEdge。
- Produces: renderEdge(document, edge) 使用 physical handle ids，data.canvasEdge 保存业务 edge。
- Produces: updateEdgePresentation(edgeId, partial) 与 reconnectBusinessEdge(oldEdge, connection, anchors)。
- Uses: onReconnect(oldEdge, newConnection)、onConnectStart、onConnectEnd、edgesReconnectable。

- [ ] **Step 1: 扩充 React Flow 替身并写失败测试**

GuideEditor.test.tsx 的 mock 记录 onEdgeClick、onConnect、onReconnect、onReconnectStart、onReconnectEnd、edgesReconnectable 和 edges。新增：

~~~ts
it('persists toolbar changes only for a selected business edge', async () => {
  render(<GuideEditor guideId="guide-host" api={createApi({ document: businessEdgeDocument() })} onBack={vi.fn()} />);
  await screen.findByDisplayValue('订单教学');
  act(() => reactFlowCallbacks.onEdgeClick?.({}, reactFlowCallbacks.edges[0]!));
  await userEvent.setup().click(screen.getByRole('button', { name: '紫色连线' }));
  fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));
  expect(savedDocument().edges[0]).toMatchObject({ presentation: { color: 'purple' } });
});

it('reconnects a business edge with semantic handles and exact anchors', () => {
  const oldEdge = reactFlowCallbacks.edges[0]!;
  act(() => reactFlowCallbacks.onReconnect?.(oldEdge, {
    source: 'decision-b', sourceHandle: 'anchor-source-RIGHT',
    target: 'process-c', targetHandle: 'anchor-target-LEFT',
  }));
  expect(savedDraft().edges[0]).toMatchObject({
    source: 'decision-b', target: 'process-c',
    sourceHandle: 'yes', targetHandle: 'in',
    presentation: {
      sourceAnchor: { side: 'RIGHT', offset: 0.5 },
      targetAnchor: { side: 'LEFT', offset: 0.5 },
    },
  });
});

it('does not expose controls for a derived or content attachment edge', () => {
  render(<GuideEditor guideId="guide-host" api={createApi({ document: documentWithDerivedAndContentEdges() })} onBack={vi.fn()} />);
  await screen.findByDisplayValue('订单教学');
  act(() => reactFlowCallbacks.onEdgeClick?.({}, reactFlowCallbacks.edges.find((edge) => edge.id === 'derived')!));
  expect(screen.queryByRole('toolbar', { name: '连线样式' })).not.toBeInTheDocument();
});
~~~

- [ ] **Step 2: 运行失败测试**

Run: pnpm --filter @guideanything/web test -- GuideEditor.test.tsx NodeChrome.test.tsx

Expected: FAIL，因为编辑器没有 selection、工具栏、reconnect persistence 或精确端口。

- [ ] **Step 3: 分离业务语义和物理 handle id**

GuideEditor 新建：

~~~ts
function physicalHandleId(edgeId: string, end: 'source' | 'target'): string {
  return ['edge', edgeId, end].join(':');
}

function renderEdge(document: CanvasDocument, edge: CanvasEdge, routes: Map<string, OrthogonalRoute>): Edge {
  const source = document.nodes.find((node) => node.id === edge.source);
  const route = routes.get(edge.id);
  const visuals = resolveEdgeVisuals(edge.presentation);
  const anchored = Boolean(edge.presentation?.sourceAnchor || edge.presentation?.targetAnchor);
  return {
    id: edge.id, source: edge.source, target: edge.target, label: edge.label,
    sourceHandle: anchored ? physicalHandleId(edge.id, 'source') : edge.sourceHandle ?? (source?.type === 'decision' ? 'yes' : 'out'),
    targetHandle: anchored ? physicalHandleId(edge.id, 'target') : edge.targetHandle ?? 'in',
    type: route ? 'orthogonal' : 'smoothstep',
    ...visuals,
    data: { route, canvasEdge: edge },
  };
}
~~~

onEdgesChange 不把 React Flow sourceHandle/targetHandle 回写 CanvasEdge；它只保留删除、选择、label 等既有非端点行为。新建与重连端点只由专用 callbacks 写入。

- [ ] **Step 4: 渲染连续连接面和精确物理端口**

GuideEditor 为 document.edges 建 NodeAnchorHandle map：

~~~ts
type NodeAnchorHandle = {
  id: string;
  type: 'source' | 'target';
  side: 'TOP' | 'RIGHT' | 'BOTTOM' | 'LEFT';
  offset: number;
};
~~~

NodeChrome 由 NodeAnchorPresentationContext 读取 nodeId 的 map，渲染：

1. 八个连续 hit surface，source/target 乘 TOP/RIGHT/BOTTOM/LEFT，id 为 anchor-source-TOP 到 anchor-target-LEFT；CSS 使边缘占满节点宽或高、透明但 pointer-events: all。
2. 每条已有 anchored edge 的专用端口，id 为 edge:edge-id:source 或 edge:edge-id:target，inline style 把 top/left/right/bottom 放到 offset 的百分比，确保显示端点与保存锚点重合。

现有 in/out/yes/no handle 继续存在，且不变更业务语义。连续面在拖线或 focus 时弱高亮；专用端口为可见 10px 控制点。expanded 节点仍渲染端口，但隐藏 NodeResizer。

- [ ] **Step 5: 保存新建/重连锚点**

GuideEditor 用 ref 保存临时会话数据：

~~~ts
type PendingConnection = {
  sourceId: string;
  sourceSemanticHandle: string | undefined;
  sourceAnchor: EdgeAnchor;
  targetAnchor?: EdgeAnchor;
};
~~~

onConnectStart 从 event.clientX/clientY 或 touches[0] 读取指针，用节点 DOM rect 调 edgeAnchorFromClientPoint。anchor-* handle 一律映射为 decision 的 yes 或其他节点 out；既有 yes/no/out 保留。onConnectEnd 使用 FinalConnectionState.toNode 与 pointer 计算 targetAnchor，只有 isValid、toNode 和业务节点门禁均成立时写 ref。

onConnect 创建：

~~~ts
const presentation = {
  sourceAnchor: pending.sourceAnchor,
  ...(pending.targetAnchor ? { targetAnchor: pending.targetAnchor } : {}),
};
commit({
  ...document,
  edges: [...document.edges, {
    id: uniqueId('edge'), source: pending.sourceId,
    sourceHandle: pending.sourceSemanticHandle,
    target: connection.target!, targetHandle: 'in', presentation,
  }],
});
~~~

onReconnect 读取 oldEdge.data.canvasEdge，拒绝派生/资料边、null endpoint 或无效 target。未拖动端点保留旧 anchor；拖动端点取 start/end pointer anchor。端点改变时，decision 源设为 yes，其他源设为 out，目标设为 in；端点不变则保留旧业务语义。成功时只用 commit 更新 document.edges，不调用 reconnectEdge 写本地边数组。

ReactFlow props 增加：

~~~tsx
onEdgeClick={handleEdgeClick}
onConnect={handleConnect}
onReconnect={handleReconnect}
onReconnectStart={handleReconnectStart}
onReconnectEnd={handleReconnectEnd}
edgesReconnectable={!layoutPreview}
~~~

selectedEdge 为业务边时，ViewportPortal 在 routeLabelPoint(route.points) 放置 EdgeToolbar；onChange 合并 presentation 后 commit。点击 pane、选择非业务边或 layoutPreview 激活时清空 selectedEdge。

- [ ] **Step 6: 运行编辑器目标测试和类型检查**

Run: pnpm --filter @guideanything/web test -- GuideEditor.test.tsx NodeChrome.test.tsx EdgeToolbar.test.tsx && pnpm --filter @guideanything/web typecheck

Expected: PASS，业务边样式、新建锚点、重连端点和语义端口均持久化；派生/资料边不出现编辑 UI。

- [ ] **Step 7: 提交精确连线任务**

~~~bash
git add apps/web/src/features/editor/GuideEditor.tsx apps/web/src/features/editor/GuideEditor.test.tsx apps/web/src/features/nodes/NodeChrome.tsx apps/web/src/features/nodes/NodeChrome.test.tsx apps/web/src/styles.css
git commit -m "feat: edit and reconnect anchored business edges"
~~~

### Task 7: 交叉包回归、构建和浏览器验收

**Files:**
- Modify only if a test exposes a direct defect in Tasks 1–6.

**Interfaces:**
- Verifies: 旧数据兼容，契约到编辑器到学习页的数据闭环，及 5175 worktree stack 上的可见交互。

- [ ] **Step 1: 运行完整静态和单元验证**

Run:

~~~bash
pnpm --filter @guideanything/contracts test
pnpm --filter @guideanything/contracts typecheck
pnpm --filter @guideanything/canvas-core test
pnpm --filter @guideanything/canvas-core typecheck
pnpm --filter @guideanything/web test
pnpm --filter @guideanything/web typecheck
pnpm --filter @guideanything/web build
git diff --check
~~~

Expected: 每个命令退出码为 0；没有 TypeScript、Vitest 或 whitespace error。

- [ ] **Step 2: 浏览器写入式验收**

在 http://127.0.0.1:5175 的当前草稿画布执行并记录 DOM、截图与控制台：

1. 新增阶段和角色泳道，把一级流程节点分配进去；删除阶段后节点进入未分阶段，删除泳道后节点进入未分配责任，节点数、边数、步骤数不变。
2. 双击流程节点明细；确认实体对话框完整覆盖在画布上、没有 textarea 溢出；输入两行并 Meta/Ctrl+Enter 保存，画布只显示第一行；详情展开完整内容，收起恢复紧凑高度。
3. 选中业务边，依次选红色、4 像素、点线、双向箭头；确认工具栏是实体横条且资料挂靠线不出现工具栏。
4. 拖动两端到不同节点、不同边缘位置；确认 source/target 改变、判断分支保留 yes/no、两端不在中点时仍精确显示。
5. 保存并刷新；确认样式、箭头、端点、锚点和详情保留。
6. 打开同一版本学习页；确认线条视觉与落点复现，但无编辑器、端点控制或工具栏。
7. 在桌面和约 390px 窄视口检查无横向裁剪；相关 console warning/error 数为 0。

- [ ] **Step 3: 审阅最终变更并只提交任务文件**

Run:

~~~bash
git status --short
git diff --stat
git diff --check
~~~

确认没有暂存 worktree 预先存在的媒体轻盒/节点删除改动或本设计文档外的用户文件。Task 7 没有修复代码时不创建空 commit；若修复直接缺陷，仅精确 git add 并提交 fix: complete canvas interaction polish verification。

## Self-Review

### Spec coverage

- 阶段/泳道删除且仅解除归属：Task 4。
- 防漏底实体详情编辑、摘要、详情/收起、尺寸不持久化：Task 5。
- 颜色、粗细、线型、箭头的受限持久化与横向工具栏：Tasks 1、3、6。
- 任意边任意落点、端点重连、语义端口隔离：Tasks 2、3、6。
- 派生/资料边不可编辑，学习页只读复现：Tasks 3、6。
- 旧数据、契约、组件、集成、浏览器与窄视口验证：Tasks 1–3、7。

### Placeholder scan

Run:

~~~bash
pattern="TO""DO|TB""D|implement"" later|fill"" in details|Add"" appropriate error handling|Write"" tests for the above|Similar"" to Task"
rg -n "$pattern" docs/superpowers/plans/2026-07-16-canvas-interaction-polish-implementation.md
~~~

Expected: no matches.

### Type consistency

- CanvasEdge.presentation 始终使用 EdgePresentation，不引入第二个 style 字段。
- edgeAnchorFromClientPoint 始终返回 contracts EdgeAnchor 的 TOP/RIGHT/BOTTOM/LEFT 与 offset。
- physicalHandleId 仅用于显示；CanvasEdge.sourceHandle/targetHandle 只保存 yes/no/out/in。
- resolveEdgeVisuals 被 GuideEditor 和 LessonPage 复用；OrthogonalEdge 只绘制接收到的 props。
