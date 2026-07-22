# 自动整理预览与编辑器工具栏设计说明

## 目标

修复自动整理预览挤压 header 和工具栏的显示问题，同时把工具栏重组为更清晰的作者工作流：子指南作为节点创建入口，编辑动作固定在最右侧，层级动作从界面移除，自动整理结果在右侧 Inspector 内审阅。所有次级编辑弹窗和画布编辑浮层统一使用 React Bits 风格外壳。

## 设计判断

这是一个面向流程作者的深色 B2B 编辑器保守重塑。视觉语言保持现有的深色、蓝色强调和 React Bits 风格，但降低重复卡片和横向信息密度。

- DESIGN_VARIANCE: 5
- MOTION_INTENSITY: 3
- VISUAL_DENSITY: 6
- 角半径规则：工具栏分组使用 12px，弹窗使用 18px，操作按钮使用 9px，状态胶囊使用全圆角。
- 动效只表达状态变化和交互反馈，自动整理预览尊重 `prefers-reduced-motion`。

## 已确认的根因

当前 `layoutPreview` 被渲染在 `.editor-toolbar-group--reference` 内部。真实浏览器 1280px 视口下，`.editor-header` 的 `scrollWidth` 达到 2168px，`.layout-preview` 的垂直范围为 `y=83..185`，而工具栏从 `y=104` 到 `y=152`，因此预览同时侵入 header 和工具栏并被容器裁切。

## 方案

### 工具栏信息架构

工具栏按作者频率和语义重新组织：

1. `节点`：开始、流程、判断、数据、Markdown、图片、视频、子指南。
2. `编辑`：撤销、重做、复制、粘贴、左对齐、删除、自动整理；通过 `margin-left: auto` 固定在最右侧。
3. `层级` 组从 DOM 中移除。置顶和置底不再提供，删除保留在编辑组中，键盘删除和节点自身删除按钮不变。

子指南按钮继续打开已发布指南搜索并创建 `subguide` 节点，只改变入口分组和显示文案，不改变插入、固定版本、展开和保存逻辑。

### 右侧 Inspector 自动整理预览面板

点击自动整理后，工具栏只进入禁用状态，`layoutPreview` 仍然保存预览文档，但不再渲染 inline 面板。`CanvasLayoutPreviewDialog` 作为 `.inspector` 的内容分支渲染，预览面板占据右侧 Inspector 的可用高度，主画布仍然可见，header、工具栏和左侧层级面板不受遮挡。

面板结构：

- 顶部：`Sparkle` 图标、`LAYOUT PREVIEW` eyebrow、标题“自动整理预览”和说明“预览只改变画布位置，确认后才写入草稿”。
- 规则卡：显示“阶段从上到下”和“子节点向右展开”两条规则。
- 核心统计：主流程、阶段、泳道、资料四个统计卡。
- 诊断统计：孤立节点、循环、回流、避障在同一行显示；非零状态使用警示色。
- 底部操作：取消自动整理为次要按钮，应用自动整理为主按钮。
- 关闭：右上角 `X`，Escape 关闭；弹窗型内容继续保留原有焦点循环，Inspector 内的自动整理面板不捕获画布焦点。

面板使用现有 `BorderGlow`、`SpotlightCard` 和 Phosphor 图标，不新增第三方依赖。次级弹窗通过 `EditorDialogSurface` 复用 `BorderGlow`、统一关闭 X 和深色渐变表面。

## 数据与交互约束

- `previewLayout` 仍然由 `layoutFlowHierarchy(renumberSemanticFlow(...))` 生成。
- 取消、Escape、右上角关闭只清理预览，不触发保存。
- 应用继续调用现有 `commit(layoutPreview.document)`，由 `commit` 清理预览并将结果推入一次撤销历史。
- 预览状态下节点、边和 header 元数据继续禁用；右侧 Inspector 改为显示自动整理预览面板。
- 自动整理算法、泳道和阶段数据结构不变。

## 验收标准

- 1280px 桌面视口下，header 和工具栏的 `scrollWidth` 不超过 `clientWidth`。
- 预览状态下不再存在 `.layout-preview` inline 工具栏节点，不存在 `.canvas-layout-preview-backdrop`，面板位于 `.inspector` 内。
- 工具栏不再有“层级与删除”分组；“删除选中项”仍可从编辑组访问。
- “插入子指南”位于“添加节点”组，并仍能打开搜索、创建和保存 `subguide` 节点。
- 自动整理弹窗的打开、取消、Escape、应用、焦点循环均有测试覆盖。
- Web 相关测试、类型检查、生产构建和浏览器截图全部通过。

## 次级 React Bits 表面

`EditorDialogSurface` 是编辑器内确认弹窗和编辑浮层的共享基座。它只负责表面层和关闭按钮，不接管业务状态。各调用方继续负责自己的 Escape、焦点循环、异步禁用、取消和提交逻辑，因此视觉统一不会改变数据流。

已覆盖的次级表面包括：子指南搜索、图片确认弹窗、层级删除确认、图片标注编辑、连线标注编辑、手动路线冲突状态、回归题菜单、草稿历史、指南摘要、指南总览和节点明细。
