# Canvas Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复图片节点尺寸只放大外框，以及子指南展开后连线不可可靠显示、连接和折叠的问题。

**Architecture:** 图片节点由 React Flow 外层尺寸驱动，节点内容在已知尺寸时填满外层并保持媒体比例。子指南继续保留固定版本快照和引用节点；展开生成“引用 → 入口”与“出口 → 原宿主下游”代理边，原续接边的可见状态持久化在引用节点中，边的来源信息在编辑器往返时保留，任何连接到隐藏展开节点的边随端点隐藏状态同步。

**Tech Stack:** React 19、@xyflow/react 12、TypeScript、Vitest、Zod。

## Global Constraints

- 不修改用户现有业务内容或发布版本；旧草稿在读取时仅恢复缺失的展开边元数据和可见状态。
- 保持固定 `guideVersionId` 引用语义；折叠不得删除节点或边。
- 图片与视频保持等比 `object-fit: contain`，不得拉伸媒体。
- 先写失败测试并运行，再修改生产代码；测试命令使用受管进程组。

---

### Task 1: 子指南展开、折叠与边追踪

**Files:**

- Modify: `packages/canvas-core/src/subguide.ts`
- Test: `packages/canvas-core/src/subguide.test.ts`
- Modify: `apps/web/src/features/editor/GuideEditor.tsx`
- Test: `apps/web/src/features/editor/GuideEditor.test.tsx`

**Interfaces:**

- Produces: `reconcileSubguideEdges(document)`；`expandSubguide` 为每个有效出口和原宿主续接边增加 `derivedExit -> hostTarget` 代理边；`toCanvasEdge(edge)` 保留 `sourceTrace`。

- [x] **Step 1: 编写失败测试**

```ts
expect(expandSubguide(host, reference, snapshot).edges).toContainEqual(
  expect.objectContaining({ source: 'ref:ref-1:source-end', target: 'host-out' }),
);
expect(setSubguideExpanded(withManualCrossEdge, 'ref-1', false).edges.find((edge) => edge.id === 'cross')?.hidden).toBe(true);
expect(toCanvasEdge(edgeWithTrace).sourceTrace).toEqual(trace);
```

- [x] **Step 2: 验证失败**

Run: `pnpm --filter @guideanything/canvas-core test -- subguide.test.ts && pnpm --filter @guideanything/web test -- GuideEditor.test.tsx`

Expected: 缺少出口到宿主下游的代理边、原续接边未在展开时隐藏、跨边界边不会随折叠隐藏、`sourceTrace` 丢失。

- [x] **Step 3: 最小实现**

```ts
const reconciled = reconcileSubguideEdges({ ...document, nodes: updatedNodes });
// 为入口保留 reference -> entry；隐藏原 reference -> hostTarget，
// 并为每个 exit 添加 derivedExit -> hostTarget。
// toCanvasEdge 从 React Flow 边对象保留 sourceTrace。
```

- [x] **Step 4: 验证通过**

Run: `pnpm --filter @guideanything/canvas-core test -- subguide.test.ts && pnpm --filter @guideanything/web test -- GuideEditor.test.tsx`

Expected: 相关测试通过，旧展开草稿在读取后可恢复可见边。

审查补充：续接边删除后必须移除失效出口代理；嵌套引用在父级折叠时也必须隐藏；首次展开持久化快照入口/出口 ID，避免旧数据恢复仅按节点类型猜测。

### Task 2: 响应式图片节点与端口命中

**Files:**

- Modify: `apps/web/src/features/nodes/NodeChrome.tsx`
- Modify: `apps/web/src/features/nodes/{FlowNode,MarkdownNode,ImageNode,VideoNode,SubguideNode}.tsx`
- Modify: `apps/web/src/styles.css`
- Test: `apps/web/src/features/nodes/NodeChrome.test.tsx`

**Interfaces:**

- Produces: `nodeChromeStyle(width, height)`；带 React Flow 明确尺寸的节点内容以 `width:100%; height:100%` 填满外层，未调整节点保留原始最小展示尺寸。

- [x] **Step 1: 编写失败测试**

```ts
expect(nodeChromeStyle(1060, 748)).toEqual({ width: '100%', height: '100%' });
expect(nodeChromeStyle(undefined, undefined)).toEqual({});
```

- [x] **Step 2: 验证失败**

Run: `pnpm --filter @guideanything/web test -- NodeChrome.test.tsx`

Expected: 尺寸辅助函数不存在，测试失败。

- [x] **Step 3: 最小实现**

```tsx
<div className={`canvas-node canvas-node-${tone}`} style={nodeChromeStyle(width, height)}>
```

CSS 让节点内容使用 `box-sizing:border-box`、可见端口和可用高度约束；图片/视频仍用 `object-fit:contain`。

- [x] **Step 4: 验证通过**

Run: `pnpm --filter @guideanything/web test -- NodeChrome.test.tsx`

Expected: 已调整尺寸的节点内容填满外层，默认节点无内联尺寸覆盖。

### Task 3: 端到端回归与交付

**Files:**

- Modify: `docs/PROGRESS.md`
- Modify: `README.md`

- [x] **Step 1: 运行完整验证**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`

Expected: 全部命令退出 0。

- [x] **Step 2: 运行态验收**

在隔离测试指南中验证：调整图片节点后其媒体区域扩展；展开后建立“宿主 -> 子指南入口 -> 子指南出口 -> 原宿主下游”路径；折叠恢复原续接边并隐藏所有触及展开节点的边，再展开恢复。

- [x] **Step 3: 更新中文操作说明与进度证据并提交**

Run: `git add ... && git commit -m "fix: repair canvas resize and subguide connections"`

Expected: 只包含本次修复、测试和文档。
