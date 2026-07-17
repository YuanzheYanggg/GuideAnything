# Canvas Edge Intelligent and Manual Routing Design

## Status

Draft for user review.

## Goal

让作者在不改变连线起点和终点的前提下，获得两种互补能力：

1. 默认由路由器生成较短、正交、避开节点的合法路径。
2. 作者可以进入手动编辑状态，拖动中间线段或拐点，明确指定路径走向。

手动路径是作者对“怎么走”的覆盖，不改变业务关系、起点节点、终点节点或端点锚点。

## Current context

当前 `CanvasEdge.presentation` 已保存颜色、粗细、线型、箭头、路由模式以及 `sourceAnchor` / `targetAnchor`。`routeCanvasEdges` 根据节点位置、端点锚点和障碍物生成路线，但没有持久化中间拐点，因此作者目前不能只改变线的走向。

## User experience

### Default intelligent routing

- 新建或未手动编辑的连线默认使用自动路由。
- 自动路由继续使用现有的直线、折线、智能避让和最短合法候选选择逻辑。
- 起点和终点端口由现有锚点决定，不因自动选路而被移动。
- 节点位置改变时，自动路线实时重算。

### Manual route editing

- 选中业务连线后，连线工具栏增加“编辑走向”。
- 第一次进入编辑时，以当前智能路线的中间拐点作为初始草稿，不要求作者从空路径开始画。
- 进入编辑状态后只显示中间拐点和可拖动线段；起点和终点端口显示为锁定状态，不可拖动。
- 拖动水平线段只改变其垂直位置，拖动垂直线段只改变其水平位置，始终保持正交路线。
- 拖动拐点可以同时调整相邻的水平、垂直线段。
- 路径吸附到现有画布网格，减少近似对齐造成的细碎拐点。
- 首个版本只编辑智能路线已经生成的中间线段，不引入自由增加或删除拐点的复杂操作；“恢复智能路线”用于回到自动生成的控制点集合。
- `Enter` 或点击“保存走向”提交，`Escape` 取消本次编辑并恢复进入编辑前的路线。
- “恢复智能路线”清除手动路径并回到自动路由。

### Obstacle behavior

- 手动拖动过程中实时检查路径是否穿过节点，冲突路径显示为警告态并禁止提交。
- 起点端口和终点端口的进入、离开段不被误判为碰撞；中间段不能穿过起点、终点或其他节点内部。
- 节点移动后，如果已保存的手动路线仍合法则保持不变。
- 如果节点移动导致手动路线冲突，编辑器先尝试保留端点和手动拐点顺序进行最小修正；无法修正时临时显示自动安全路线，并提示作者“手动路线被节点阻挡”，不静默覆盖已保存的手动意图。

## Data contract

在 `EdgePresentation` 增加可选的路线控制字段，保持旧数据兼容：

```ts
type EdgeRouteMode = 'auto' | 'manual';

interface EdgeWaypoint {
  x: number;
  y: number;
}

interface EdgePresentation {
  // existing visual and automatic routing fields remain unchanged
  routeMode?: EdgeRouteMode;
  waypoints?: EdgeWaypoint[];
}
```

- 缺少 `routeMode` 时按 `auto` 处理。
- `manual` 模式必须有有限数量的 `waypoints`；没有有效拐点时回退到 `auto`。
- `waypoints` 使用画布坐标保存，不使用屏幕坐标，因此缩放、平移和重新打开指南后仍然稳定。
- 端点锚点继续由 `sourceAnchor` / `targetAnchor` 保存；手动路线不复制或替换端点锚点。
- 为避免无限增长，单条连线的手动拐点数量设上限，初始实现使用 32 个。

## Routing and state flow

```text
EdgeToolbar
  -> GuideEditor enters manual-route draft
  -> routeCanvasEdges validates draft waypoints
  -> OrthogonalEdge renders preview
  -> valid submit commits CanvasDocument and history
  -> autosave persists CanvasDocument
```

- `routeCanvasEdges` 新增手动路线分支：`sourcePort -> waypoints -> targetPort`。
- 手动路线先做点压缩、正交化和障碍检查，再返回 `OrthogonalRoute`。
- 编辑中的拐点保存在 `GuideEditor` 本地草稿状态，拖动过程中不直接写入历史栈。
- 提交时一次性 `commit`，因此一次手动编辑可以整体撤销。
- 课程播放页复用相同的路由计算，确保编辑态和学习态的路径一致。

## Scope boundaries

本次不做：

- 改变连线的 source/target 关系。
- 拖动端点并自动重新连接到其他节点。
- 贝塞尔曲线或自由曲线编辑。
- 在首个版本中通过双击任意位置自由增加拐点，或删除任意单个拐点。
- 让手动路线绕过节点后仍然自动悄悄改成另一条完全不同的路线。
- 为每种节点类型单独维护一套路线编辑器。

## Acceptance criteria

1. 新建连线默认自动避障，已有自动路线回归测试不变。
2. 手动编辑时起点、终点和端点锚点保持不变。
3. 拖动中间线段可以改变上绕/下绕/左右绕行方向，并保持正交。
4. 非法路径不能提交，且用户能看到冲突原因。
5. 手动路线可以保存、重新加载、撤销和重做。
6. 节点移动后，合法手动路线保持；冲突时显示安全替代路线和提示。
7. 颜色、线宽、线型、箭头、连线删除和现有自动最短避障行为不受影响。

## Validation

- `packages/canvas-core`：自动路线、手动 waypoints、端点固定、节点碰撞和路径正交性单测。
- `apps/web`：工具栏进入/退出编辑、拖动预览、非法路径阻止提交、保存及撤销测试。
- 浏览器 QA：真实画布中默认智能路线、从下方绕行、端点不变、刷新后路线保持，以及冲突提示。
