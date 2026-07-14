# GuideAnything 业务流程层级体验 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** 让业务流程成为画布与学习模式的一级结构，Markdown、图片和视频成为可挂靠资料，并以可预览的层级布局替代固定网格。

**Architecture:** CanvasDocument 保持 schemaVersion 1，仅增加可选阶段与资料归属字段。canvas-core 计算主流程 rank、资料轨道、阶段边界和诊断；编辑器只在作者应用预览后写入历史栈；学习模式按同一语义分组步骤并聚合资料。

**Tech Stack:** TypeScript 5.9、Zod 4、React 19、React Flow 12、Vitest 4。

## Global Constraints

- 所有新增文档字段可选；旧草稿、已发布版本与子指南快照必须继续通过校验。
- 一级主流程是无 source 的 start、end、process、decision、data、subguide；仅 markdown、image、video 能拥有 contentParentId。
- 自动整理不得删改连线、步骤、入口/出口、隐藏状态或固定子指南引用；预览不进入历史栈也不触发保存。
- 不增加运行时依赖；算法保持 O(V + E)，并覆盖 1000 节点性能回归。
- 每个行为变更按 TDD 执行：先写失败测试、运行并确认错误，再写最小实现、运行通过。

---

### Task 1: 扩展兼容的层级文档协议

**Files:**
- Modify: packages/contracts/src/canvas.ts
- Modify: packages/contracts/src/canvas.test.ts

**Interfaces:**
- Produces: FlowStage、CanvasNode.stageId?、CanvasNode.contentParentId?、CanvasDocument.stages?。
- Consumes: CanvasNodeSchema、CanvasDocumentSchema、SourceTrace。
- Guarantees: 资料只能挂靠一级主流程；仅一级主流程可标记阶段。

- [ ] **Step 1: 写失败测试**

在 canvas.test.ts 新增：

    function hierarchyDocument(overrides: Record<string, unknown> = {}) {
      return {
        schemaVersion: 1,
        stages: [{ id: 'prepare', title: '准备', order: 0 }],
        nodes: [
          { id: 'start', type: 'start', position: { x: 0, y: 0 }, zIndex: 0, stageId: 'prepare', data: { label: '开始', shape: 'start' } },
          { id: 'note', type: 'markdown', position: { x: 0, y: 160 }, zIndex: 1, contentParentId: 'start', data: { markdown: '核对前置条件' } },
        ],
        edges: [], viewport: { x: 0, y: 0, zoom: 1 }, steps: [], entryNodeId: 'start', exitNodeIds: ['start'],
        ...overrides,
      };
    }

    it('accepts stages and a resource attached to a primary flow node', () => {
      expect(CanvasDocumentSchema.safeParse(hierarchyDocument()).success).toBe(true);
    });

    it('rejects invalid hierarchy references', () => {
      const nested = hierarchyDocument({ nodes: [
        ...hierarchyDocument().nodes.slice(0, 2),
        { id: 'image', type: 'image', position: { x: 0, y: 280 }, zIndex: 2, contentParentId: 'note', data: { url: 'https://example.com/a.png', alt: 'A' } },
      ] });
      const unknownStage = hierarchyDocument({ nodes: [{ ...hierarchyDocument().nodes[0], stageId: 'missing' }] });
      expect(CanvasDocumentSchema.safeParse(nested).success).toBe(false);
      expect(CanvasDocumentSchema.safeParse(unknownStage).success).toBe(false);
    });

再添加派生 process 作为 contentParentId 的测试，派生节点带 source，断言 safeParse 为 false。

- [ ] **Step 2: 运行失败测试**

Run: pnpm --filter @guideanything/contracts test -- canvas.test.ts
Expected: FAIL，因为当前 schema 不接受 stages、stageId、contentParentId。

- [ ] **Step 3: 最小协议实现**

在 canvas.ts 定义并导出：

    export const FlowStageSchema = z.object({
      id: IdSchema,
      title: z.string().min(1).max(120),
      order: z.number().int().min(0).max(10_000),
      description: z.string().max(1_000).optional(),
    });
    export type FlowStage = z.infer<typeof FlowStageSchema>;

给 NodeBaseSchema 添加：

    stageId: IdSchema.optional(),
    contentParentId: IdSchema.optional(),

给 CanvasDocumentSchema object 添加：

    stages: z.array(FlowStageSchema).max(200).optional(),

在 superRefine 建立 nodeIds 后，增加 stage ID 去重与层级校验：

    const primaryTypes = new Set(['start', 'end', 'process', 'decision', 'data', 'subguide']);
    const contentTypes = new Set(['markdown', 'image', 'video']);
    const stageIds = new Set(document.stages?.map((stage) => stage.id) ?? []);

    document.nodes.forEach((node, index) => {
      const primary = primaryTypes.has(node.type) && !node.source;
      if (node.stageId && (!primary || !stageIds.has(node.stageId))) {
        context.addIssue({ code: 'custom', path: ['nodes', index, 'stageId'], message: '阶段只能标记存在的一级主流程节点' });
      }
      if (!node.contentParentId) return;
      const parent = document.nodes.find((candidate) => candidate.id === node.contentParentId);
      if (!contentTypes.has(node.type) || !parent || !primaryTypes.has(parent.type) || parent.source) {
        context.addIssue({ code: 'custom', path: ['nodes', index, 'contentParentId'], message: '资料必须挂靠到一级主流程节点' });
      }
    });

阶段数组还必须拒绝重复 ID；沿用现有自定义 issue 风格。

- [ ] **Step 4: 验证与提交**

Run: pnpm --filter @guideanything/contracts test -- canvas.test.ts
Expected: PASS；已有多模态与子指南 continuation 测试仍通过。

    git add packages/contracts/src/canvas.ts packages/contracts/src/canvas.test.ts
    git commit -m 'feat: add canvas hierarchy metadata'

---

### Task 2: 实现确定性的主流程层级布局

**Files:**
- Create: packages/canvas-core/src/hierarchy.ts
- Create: packages/canvas-core/src/hierarchy.test.ts
- Modify: packages/canvas-core/src/index.ts
- Modify: packages/canvas-core/src/performance.test.ts

**Interfaces:**
- Produces: isPrimaryFlowNode(node)、isContentNode(node)、getStageBounds(document)、layoutFlowHierarchy(document)。
- Produces: HierarchyLayoutResult，含 document、report 与 stageBounds。
- Guarantees: 主流程按入口从左到右；资料放入所属主节点详情轨道；循环和孤立节点稳定保留。

- [ ] **Step 1: 写失败测试**

在 hierarchy.test.ts 使用小型构造器，并先覆盖主流程、资料、阶段：

    const base = { position: { x: 0, y: 0 }, zIndex: 0 };
    const start = (id: string, stageId?: string) => ({ ...base, id, type: 'start' as const, ...(stageId ? { stageId } : {}), data: { label: '开始', shape: 'start' as const } });
    const process = (id: string, stageId?: string) => ({ ...base, id, type: 'process' as const, ...(stageId ? { stageId } : {}), data: { label: id, shape: 'process' as const } });
    const end = (id: string, stageId?: string) => ({ ...base, id, type: 'end' as const, ...(stageId ? { stageId } : {}), data: { label: '结束', shape: 'end' as const } });
    const markdown = (id: string, contentParentId?: string) => ({ ...base, id, type: 'markdown' as const, ...(contentParentId ? { contentParentId } : {}), data: { markdown: id } });
    const image = (id: string, contentParentId?: string) => ({ ...base, id, type: 'image' as const, ...(contentParentId ? { contentParentId } : {}), data: { url: 'https://example.com/a.png', alt: id } });
    const edge = (id: string, source: string, target: string) => ({ id, source, target });
    const makeDocument = (overrides: Partial<CanvasDocument>): CanvasDocument => ({ schemaVersion: 1, nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 }, steps: [], exitNodeIds: [], ...overrides });

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
    expect(byId.get('screen')!.position.y).toBeGreaterThan(byId.get('note')!.position.y);
    expect(result.report.unassignedContentIds).toEqual(['loose']);
    expect(result.stageBounds.map((bound) => bound.title)).toEqual(['准备', '录入', '未分阶段']);

增加循环 a -> b -> a 与孤立 orphan 的双次运行断言：坐标完全一致、cycleNodeIds 为 a/b、unconnectedPrimaryIds 为 orphan。

- [ ] **Step 2: 运行失败测试**

Run: pnpm --filter @guideanything/canvas-core test -- hierarchy.test.ts
Expected: FAIL，缺少 hierarchy 模块及 layoutFlowHierarchy 导出。

- [ ] **Step 3: 实现纯算法**

在 hierarchy.ts 定义：

    export interface HierarchyLayoutReport {
      primaryNodeIds: string[];
      attachedContentIds: string[];
      unassignedContentIds: string[];
      unconnectedPrimaryIds: string[];
      cycleNodeIds: string[];
      stageCount: number;
    }
    export interface StageBounds {
      stageId: string | null;
      title: string;
      x: number; y: number; width: number; height: number;
    }
    export interface HierarchyLayoutResult {
      document: CanvasDocument;
      report: HierarchyLayoutReport;
      stageBounds: StageBounds[];
    }

    const BASE_RANK_GAP = 72;
    const NODE_GAP_Y = 32;
    const STAGE_GAP_Y = 96;
    const CONTENT_GAP_X = 32;
    const CONTENT_GAP_Y = 24;

    export function isPrimaryFlowNode(node: CanvasNode): boolean {
      return ['start', 'end', 'process', 'decision', 'data', 'subguide'].includes(node.type) && !node.source;
    }
    export function isContentNode(node: CanvasNode): boolean {
      return ['markdown', 'image', 'video'].includes(node.type) && !node.source;
    }

    export function layoutFlowHierarchy(document: CanvasDocument): HierarchyLayoutResult {
      const visible = document.nodes.filter((node) => !node.hidden);
      const primary = visible.filter(isPrimaryFlowNode).sort(compareNodes);
      const graph = buildPrimaryGraph(document.edges, new Set(primary.map((node) => node.id)));
      const ranked = rankFromEntry(document.entryNodeId, primary, graph);
      const content = visible.filter(isContentNode);
      const rankX = calculateRankX(primary, content, ranked.rankById);
      const positioned = placePrimary(primary, ranked.rankById, rankX, document.stages ?? []);
      const withContent = placeContent(content, positioned, document.stages ?? []);
      const byId = new Map(withContent.map((node) => [node.id, node]));
      const next = { ...document, nodes: document.nodes.map((node) => byId.get(node.id) ?? node) };
      return { document: next, report: reportFor(primary, visible.filter(isContentNode), ranked, document.stages), stageBounds: getStageBounds(next) };
    }

compareNodes 必须按旧 position.y、position.x、id 排序。buildPrimaryGraph 只接受未 hidden 且两端都是一级主流程的普通边。rankFromEntry 先用 entryNodeId，缺失时用入度 0 的节点；以 Kahn 队列赋最大前驱 rank。剩余节点按 compareNodes 填入后续 rank 并标记 cycleNodeIds；没有从 roots 到达的节点记录为 unconnectedPrimaryIds。isContentNode 必须排除带 source 的展开产物：它们以 source.referenceNodeId 归入子指南内容，不得作为宿主画布资料布局。实现 nodeSize(node)：优先 node.size，未设置时流程节点为 240x104、Markdown 为 300x180、图片/视频为 320x260、子指南为 240x120。calculateRankX 必须为每个 rank 预留该列最大主流程宽度和该列所有挂靠资料的最大宽度，再用 CONTENT_GAP_X 与 BASE_RANK_GAP 累加列起点；因此资料轨道不会覆盖下一 rank。placePrimary 将 stage.order 决定为从上到下泳道，使用 nodeSize 高度和 NODE_GAP_Y 堆叠同格节点。placeContent 仅认定位于 positioned primary map 的 contentParentId，位置为 parent.x + nodeSize(parent).width + CONTENT_GAP_X，Y 坐标使用每条资料的 nodeSize 高度加 CONTENT_GAP_Y 稳定累加；未挂靠资料放在最后泳道。getStageBounds 按 stageId（资料继承父主节点）聚合可见节点，按 nodeSize 扩展右/下边界并在四周扩 40px，只在有节点时输出未分阶段。

- [ ] **Step 4: 加入性能测试、运行并提交**

在 performance.test.ts 加入：

    const hierarchyNodes: CanvasDocument['nodes'] = Array.from({ length: 1_000 }, (_, index) => ({
      id: 'node-' + index, type: 'process' as const, position: { x: index * 20, y: 0 }, zIndex: index,
      data: { label: '步骤 ' + index, shape: 'process' as const },
    }));
    const thousandNodeDocument: CanvasDocument = {
      schemaVersion: 1, nodes: hierarchyNodes,
      edges: hierarchyNodes.slice(1).map((node, index) => ({ id: 'edge-' + index, source: hierarchyNodes[index]!.id, target: node.id })),
      viewport: { x: 0, y: 0, zoom: 1 }, steps: [], entryNodeId: 'node-0', exitNodeIds: ['node-999'],
    };

    it('lays out a 1000-node hierarchy within the local budget', () => {
      const started = performance.now();
      expect(layoutFlowHierarchy(thousandNodeDocument).document.nodes).toHaveLength(1_000);
      expect(performance.now() - started).toBeLessThan(200);
    });

在 index.ts 添加：

    export * from './hierarchy';

Run: pnpm --filter @guideanything/canvas-core test -- hierarchy.test.ts performance.test.ts
Expected: PASS。

    git add packages/canvas-core/src/hierarchy.ts packages/canvas-core/src/hierarchy.test.ts packages/canvas-core/src/performance.test.ts packages/canvas-core/src/index.ts
    git commit -m 'feat: add flow hierarchy layout'

---

### Task 3: 让作者挂靠资料、查看结构并应用布局预览

**Files:**
- Create: apps/web/src/features/editor/HierarchyPanel.tsx
- Create: apps/web/src/features/editor/HierarchyPanel.test.tsx
- Modify: apps/web/src/features/editor/GuideEditor.tsx
- Modify: apps/web/src/features/editor/GuideEditor.test.tsx
- Modify: apps/web/src/styles.css

**Interfaces:**
- Consumes: FlowStage、layoutFlowHierarchy、getStageBounds、isContentNode、isPrimaryFlowNode。
- Produces: HierarchyPanel、hierarchyPresentationEdges(document)、preview/apply/cancel 生命周期。
- Guarantees: 新资料默认挂靠选中主流程；预览不保存；应用布局是一次可撤销 commit。

- [ ] **Step 1: 写失败测试**

在 HierarchyPanel.test.tsx：

    render(<HierarchyPanel document={hierarchyDocument} selectedIds={[]} onSelect={vi.fn()} onAddStage={vi.fn()} />);
    expect(screen.getByRole('tree', { name: '流程结构' })).toBeVisible();
    expect(screen.getByRole('button', { name: '选择流程节点 录入订单' })).toBeVisible();
    expect(screen.getByRole('button', { name: '选择资料 未归类说明' })).toBeVisible();

在 GuideEditor.test.tsx 使用带 process/stage 的 document，新增：

    function createApi(overrides: { document?: CanvasDocument } = {}) {
      const guide = { ...structuredClone(emptyGuide), document: overrides.document ?? structuredClone(emptyGuide.document) };
      return {
        getGuide: vi.fn().mockResolvedValue(guide),
        saveGuide: vi.fn().mockResolvedValue({ ...guide, revision: 1 }),
        publishGuide: vi.fn().mockResolvedValue(sourceVersion),
        search: vi.fn().mockResolvedValue({ items: [{ versionId: 'version-source', guideId: 'guide-source', title: '物料主数据检查', summary: '', tags: ['物料'], version: 1, authorName: '王作者' }], nextOffset: null }),
        getVersion: vi.fn().mockResolvedValue(sourceVersion),
        uploadMedia: vi.fn(),
      };
    }

并让 documentWithProcessAndStage() 返回 start、id 为 enter-order 的 process、一个 stage 和空资料数组。新增交互断言：

    await user.click(screen.getByRole('button', { name: '选择流程节点 录入订单' }));
    await user.click(screen.getByRole('button', { name: '添加 Markdown 节点' }));
    await user.click(screen.getByRole('button', { name: '保存草稿' }));
    expect(api.saveGuide).toHaveBeenLastCalledWith('guide-host', 0, expect.objectContaining({
      document: expect.objectContaining({ nodes: expect.arrayContaining([
        expect.objectContaining({ type: 'markdown', contentParentId: 'enter-order' }),
      ]) }),
    }));

    await user.click(screen.getByRole('button', { name: '预览自动整理' }));
    expect(screen.getByText('已按入口从左到右整理')).toBeVisible();
    expect(api.saveGuide).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: '应用自动整理' }));
    await user.click(screen.getByRole('button', { name: '撤销' }));

- [ ] **Step 2: 运行失败测试**

Run: pnpm --filter @guideanything/web test -- GuideEditor.test.tsx HierarchyPanel.test.tsx
Expected: FAIL，缺少结构面板、可访问树和预览按钮。

- [ ] **Step 3: 实现结构面板和属性编辑**

创建 HierarchyPanel，按 stages.order 渲染树；未分阶段与未挂靠资料必须独立列出：

    export function HierarchyPanel({ document, selectedIds, onSelect, onAddStage }: HierarchyPanelProps) {
      const primary = document.nodes.filter(isPrimaryFlowNode);
      const content = document.nodes.filter(isContentNode);
      const stages = [...(document.stages ?? [])].sort((a, b) => a.order - b.order);
      return <aside className='hierarchy-panel' aria-label='流程结构'>
        <div className='hierarchy-heading'><span className='eyebrow'>FLOW STRUCTURE</span><button type='button' onClick={onAddStage}>添加阶段</button></div>
        <div role='tree' aria-label='流程结构'>
          {stages.map((stage) => <HierarchyStage key={stage.id} stage={stage} primary={primary.filter((node) => node.stageId === stage.id)} content={content} selectedIds={selectedIds} onSelect={onSelect} />)}
          <HierarchyStage stage={{ id: '__none__', title: '未分阶段', order: Number.MAX_SAFE_INTEGER }} primary={primary.filter((node) => !node.stageId)} content={content} selectedIds={selectedIds} onSelect={onSelect} />
          <LooseContent content={content.filter((node) => !node.contentParentId)} selectedIds={selectedIds} onSelect={onSelect} />
        </div>
      </aside>;
    }

在 GuideEditor 中添加 layoutPreview state。preview 只调用 layoutFlowHierarchy(document)；Apply 只调用一次 commit(layoutPreview.document)；Cancel 清空 state；所有新增/编辑动作开始时 setLayoutPreview(null)。

修改 addNode：

    const selectedPrimary = document.nodes.find((node) => node.id === selectedIds[0] && isPrimaryFlowNode(node));
    const created = createNode(id, type, document.nodes.length);
    const node = isContentNode(created) && selectedPrimary ? { ...created, contentParentId: selectedPrimary.id } : created;
    commit({ ...document, nodes: [...document.nodes, node] });

新增 addStage，使用 uniqueId('stage')、业务阶段 N、当前 stages.length 作为 order，然后 commit 新 stages 数组。

扩展 NodeInspector 参数为 primaryNodes 与 stages。一级主流程显示所属业务阶段 select；资料显示挂靠到流程节点 select。两者只更新 node 的 stageId 或 contentParentId，选空值时写 undefined。

添加展示边但不持久化：

    function hierarchyPresentationEdges(document: CanvasDocument): Edge[] {
      return document.nodes.filter((node) => isContentNode(node) && node.contentParentId && !node.hidden).map((node) => ({
        id: 'hierarchy:' + node.id, source: node.contentParentId!, target: node.id, type: 'smoothstep',
        selectable: false, style: { stroke: '#9a6a42', strokeDasharray: '5 5', strokeWidth: 1.5 },
      }));
    }

ReactFlow edges 为 document.edges 加 presentation edges；onEdgesChange 必须过滤 id 以 hierarchy: 开头的变化。toFlowNodes 用 node.contentParentId 设置 className 为 context-node，否则 primary-node。导入 ViewportPortal，并在 ReactFlow 子元素中渲染 stage-lane，保证阶段框随平移和缩放对齐：

    <ViewportPortal>
      {getStageBounds(renderedDocument).map((bound) => <div key={bound.stageId ?? 'none'} className='stage-lane' style={{ left: bound.x, top: bound.y, width: bound.width, height: bound.height }}><span>{bound.title}</span></div>)}
    </ViewportPortal>

- [ ] **Step 4: 添加样式与通过测试**

在 styles.css 添加：

    .editor-workspace { grid-template-columns: 248px minmax(0, 1fr) 320px; }
    .hierarchy-panel { overflow: auto; padding: 1rem .8rem; background: #f7f8f4; border-right: 1px solid #d1d7d1; }
    .hierarchy-resource { margin-left: 1.2rem; color: #637067; font-size: .78rem; }
    .stage-lane { position: absolute; z-index: 0; border: 1px solid #cbd8ce; border-radius: 18px; background: #dfe9e133; pointer-events: none; }
    .react-flow__node.context-node .canvas-node { border-style: dashed; box-shadow: 0 6px 18px #2a3c3116; }
    .layout-preview { display: flex; align-items: center; gap: .5rem; padding: .35rem .8rem; color: #315642; background: #eef4ef; }

在现有 max-width 900px 规则中把 hierarchy-panel 变为左侧绝对抽屉，避免三列压缩窄屏。

Run: pnpm --filter @guideanything/web test -- GuideEditor.test.tsx HierarchyPanel.test.tsx
Expected: PASS。

    git add apps/web/src/features/editor/HierarchyPanel.tsx apps/web/src/features/editor/HierarchyPanel.test.tsx apps/web/src/features/editor/GuideEditor.tsx apps/web/src/features/editor/GuideEditor.test.tsx apps/web/src/styles.css
    git commit -m 'feat: organize guides around business flow'

---

### Task 4: 让学习模式显示阶段与当前资料

**Files:**
- Modify: apps/web/src/features/lesson/LessonPage.tsx
- Modify: apps/web/src/features/lesson/LessonPage.test.tsx
- Modify: apps/web/src/styles.css

**Interfaces:**
- Produces: resolveStepStage(document, nodeId) 与 resourcesForStep(document, nodeId)。
- Guarantees: 旧版本视觉与步骤顺序不变；显式资料步骤继续按 steps.order 导航。

- [ ] **Step 1: 写失败测试**

给 lesson fixture 添加 stages、intro.stageId = prepare 和 video.contentParentId = intro：

    it('groups learner steps and shows resources attached to the current flow node', async () => {
      const api = { getVersion: vi.fn().mockResolvedValue(hierarchyVersion) };
      render(<LessonPage versionId='hierarchy' api={api} onBack={vi.fn()} />);
      expect(await screen.findByText('准备')).toBeVisible();
      expect(screen.getByRole('heading', { name: '本步骤资料' })).toBeVisible();
      expect(screen.getByLabelText('VA01 操作演示')).toBeVisible();
    });

- [ ] **Step 2: 运行失败测试**

Run: pnpm --filter @guideanything/web test -- LessonPage.test.tsx
Expected: FAIL，当前页没有阶段标题和本步骤资料。

- [ ] **Step 3: 最小学习模式实现**

在 LessonPage.tsx 导出：

    export function resolveStepStage(document: CanvasDocument, nodeId: string): FlowStage | null {
      const node = document.nodes.find((item) => item.id === nodeId);
      const owner = document.nodes.find((item) => item.id === (node?.contentParentId ?? nodeId));
      return document.stages?.find((stage) => stage.id === owner?.stageId) ?? null;
    }
    export function resourcesForStep(document: CanvasDocument, nodeId: string): CanvasNode[] {
      return document.nodes.filter((node) => !node.hidden && node.contentParentId === nodeId);
    }

构造 steps.map(step => ({ step, stage: resolveStepStage(version.document, step.nodeId) }))；在阶段变化时渲染非交互 lesson-stage-heading，按钮索引与 onClick 继续使用原 currentIndex。当前主流程节点存在挂靠资料时，在 lesson-navigation 前渲染：

    <section className='lesson-resources' aria-labelledby='lesson-resources-title'>
      <span className='eyebrow'>STEP RESOURCES</span>
      <h3 id='lesson-resources-title'>本步骤资料</h3>
      {resourcesForStep(version.document, currentNode.id).map((node) => <CurrentNodeContent key={node.id} node={node} />)}
    </section>

不要过滤显式资料步骤；CurrentNodeContent 继续保证已有视频关键点跳转。

- [ ] **Step 4: 样式、验证和提交**

在 styles.css 添加：

    .lesson-stage-heading { margin: 1rem .55rem .35rem; color: #9b5428; font-size: .68rem; font-weight: 850; letter-spacing: .1em; }
    .lesson-resources { display: grid; gap: .8rem; margin-top: 1.5rem; padding-top: 1.25rem; border-top: 1px solid #dbe1dc; }
    .lesson-resources h3 { margin: 0; font-family: Georgia, serif; font-size: 1.15rem; }

Run: pnpm --filter @guideanything/web test -- LessonPage.test.tsx
Expected: PASS，包括原有视频关键点测试。

    git add apps/web/src/features/lesson/LessonPage.tsx apps/web/src/features/lesson/LessonPage.test.tsx apps/web/src/styles.css
    git commit -m 'feat: show stage context in learning mode'

---

### Task 5: 文档、全量验证与浏览器验收

**Files:**
- Modify: README.md
- Modify: docs/PRD.md
- Modify: docs/ACCEPTANCE.md
- Modify: docs/PROGRESS.md

- [ ] **Step 1: 更新中文操作说明**

README 作者路径必须说明：先连接主流程；选中主流程新增资料会自动挂靠；可从属性面板改挂靠；从左侧流程结构检查未归类资料；自动整理先预览再应用或取消。PRD 4.1/4.4 写入阶段、资料层与学习者资料聚合；ACCEPTANCE 增加旧文档兼容、预览不保存、算法稳定、学习者资料聚合。PROGRESS 只在本任务最终验证后记录实测命令和浏览器证据。

- [ ] **Step 2: 分层与全量验证**

Run:

    pnpm --filter @guideanything/contracts test -- canvas.test.ts
    pnpm --filter @guideanything/canvas-core test -- hierarchy.test.ts performance.test.ts
    pnpm --filter @guideanything/web test -- GuideEditor.test.tsx HierarchyPanel.test.tsx LessonPage.test.tsx
    pnpm lint && pnpm typecheck && pnpm test && pnpm build

Expected: 所有命令退出 0。

- [ ] **Step 3: 真实浏览器验收**

使用种子 ERP 销售订单创建完成：添加两个业务阶段；选中流程后新增一条资料；检查结构树显示阶段到流程到资料；将一条资料脱离；预览自动整理后取消并确认不保存；重新预览后应用并撤销；以学习者身份读取发布版本并检查阶段标题、本步骤资料、视频关键点跳转和控制台无新增 error。

- [ ] **Step 4: 提交交付证据**

    git add README.md docs/PRD.md docs/ACCEPTANCE.md docs/PROGRESS.md
    git commit -m 'docs: document flow hierarchy workflow'
    git status --short

Expected: 仅存在本次功能提交；不提交 SQLite、上传媒体、测试报告或浏览器截图。

---

### Task 6: 收口总审发现的流程可解释性与定位缺口

**Files:**
- Modify: packages/canvas-core/src/hierarchy.ts
- Modify: packages/canvas-core/src/hierarchy.test.ts
- Modify: apps/web/src/features/editor/GuideEditor.tsx
- Modify: apps/web/src/features/editor/GuideEditor.test.tsx
- Modify: apps/web/src/features/editor/HierarchyPanel.tsx
- Modify: apps/web/src/features/editor/HierarchyPanel.test.tsx
- Modify: apps/web/src/features/lesson/LessonPage.tsx
- Modify: apps/web/src/features/lesson/LessonPage.test.tsx
- Modify: apps/web/src/styles.css
- Modify: docs/ACCEPTANCE.md
- Modify: docs/PROGRESS.md

**Interfaces:**
- Produces: `isDecisionBranch`-aware deterministic sibling ordering、可读的 `HierarchyLayoutReport` 预览摘要、`focusCanvasNode`、以及仅展示用途的引用子指南上下文。
- Guarantees: 引用产物绝不成为宿主流程或自动布局输入；它们只在引用节点下以“子指南内容”呈现，并继承该引用节点的阶段上下文。

- [ ] **Step 1: 写四组失败回归测试**

1. 在 `hierarchy.test.ts` 构造一个判断节点，令初始 `否` 分支的 y 坐标在 `是` 之前，并给两条边 `label/sourceHandle` 为 `是/yes` 与 `否/no`；自动整理后必须稳定地令 `是` 分支位于 `否` 分支之前。若边没有显式 label，按判断节点 `branchLabels` 的顺序匹配 handle；未匹配的分支仍落回原有稳定排序。
2. 在 `GuideEditor.test.tsx` 打开自动整理预览，断言状态区同时给出主流程数、阶段数、已挂靠/未挂靠资料数、孤立节点数、循环数，以及“入口→阶段泳道→资料”的规则说明；结构树点击离屏节点时，断言 `ReactFlowInstance.fitView` 被调用到该节点。
3. 在 `HierarchyPanel.test.tsx` 加入展开子指南及其 `source.referenceNodeId` 产物，断言它们只在该引用节点下的“子指南内容”分组中出现，且不会作为阶段一级流程或“未挂靠资料”重复出现。
4. 在 `LessonPage.test.tsx` 让展开产物成为一个教学步骤，断言它继承引用子指南的阶段标题；保留 source-free 主流程/资料规则与旧版本行为。

- [ ] **Step 2: 最小实现**

`hierarchy.ts` 在同 rank 的判断分支并列时，把边 label 优先匹配到来源判断节点的 `branchLabels`（并识别 `是/yes` 在 `否/no` 之前）；其余节点继续使用 y、x、id 的稳定回退。不得改变 rank、循环、孤立节点或引用产物隔离。

编辑器把 `layoutPreview.report` 渲染为可扫描的摘要和一行规则说明。保存 `ReactFlow` 实例；结构树选择通过单一 `selectAndFocus` 回调更新选择，并用 `fitView({ nodes: [{ id }], ... })` 将该节点带到视野中。预览期间选择/聚焦可以发生，但任何画布编辑仍必须保持冻结。

结构面板仍用 source-free 节点决定阶段和资料归属；对每一个可见展开子指南，将 `source.referenceNodeId === subguide.id` 的可见产物按原画布稳定顺序缩进到该引用节点下，使用“子指南内容”标题与独立可访问名称。它们不能进入宿主布局、阶段 bounds、自动布局 report 或“未挂靠资料”。

学习模式中，source 节点将其阶段解析到 `source.referenceNodeId` 指向的 source-free 子指南；它仍不参与 `resourcesForStep` 的宿主挂靠聚合。显式 source 步骤继续按既有 steps.order 导航。

补足对应样式，保持窄屏树与预览摘要可读。

- [ ] **Step 3: 验证、文档证据与提交**

Run:

    pnpm --filter @guideanything/canvas-core test -- hierarchy.test.ts
    pnpm --filter @guideanything/web test -- GuideEditor.test.tsx HierarchyPanel.test.tsx LessonPage.test.tsx
    pnpm lint && pnpm typecheck && pnpm test && pnpm build

浏览器复验：对销售订单流程的判断节点确认 `是` 位于 `否` 前；预览报告各计数可见；从结构树点选离屏节点画布聚焦；展开子指南后作者树与学习步骤均显示它继承的阶段上下文。将实际新测试总数与浏览器事实更新到 `ACCEPTANCE.md`/`PROGRESS.md`，不得声称没有开发态 React Flow warnings。

    git add packages/canvas-core/src/hierarchy.ts packages/canvas-core/src/hierarchy.test.ts apps/web/src/features/editor/GuideEditor.tsx apps/web/src/features/editor/GuideEditor.test.tsx apps/web/src/features/editor/HierarchyPanel.tsx apps/web/src/features/editor/HierarchyPanel.test.tsx apps/web/src/features/lesson/LessonPage.tsx apps/web/src/features/lesson/LessonPage.test.tsx apps/web/src/styles.css docs/ACCEPTANCE.md docs/PROGRESS.md
    git commit -m 'fix: complete hierarchy workflow clarity'
