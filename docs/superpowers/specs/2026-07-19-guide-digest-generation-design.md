# 指南快照总览生成设计

## 1. 目的

GuideAnything 应允许拥有当前指南 `OWNER` 或协作者 `EDIT` 访问权的编辑者，从当前指南草稿的一份可验证流程快照生成：

- 一句话指南摘要；
- 可审核的标签建议；
- 结构稳定、可导出的 Markdown 指南总览；
- 流程缺口和快照诊断说明。

生成结果必须先成为与画布事实分离的“指南总览提案”。模型不能直接覆盖 `CanvasDocument`、指南摘要、标签或已发布版本。编辑者审核后，才能把选中的摘要和标签写入当前草稿，并接受该 revision 对应的 Markdown 总览。

本设计坚持“快照优先”：`CanvasDocument` 与不可变 `GuideVersion` 仍是流程事实源；`FlowKnowledgeSnapshot` 是确定性、不可人工编辑的 Agent 语义投影；Markdown 总览是从快照生成的人类可读投影，不反向成为模型下一次生成的事实输入。

## 2. 当前问题与实施前置条件

当前 main 已有流程快照、Runtime Bridge、结构化 Agent 输出、工作区知识演进和 revision 保护，但还不能可靠生成指南总览。

以本机“打样提案流程”为现状样本：

- 当前草稿 revision 为 `180`，最新流程快照仍停在 revision `65`；
- 没有成功生成的发布版流程快照；
- 对应流程知识源状态为 `FAILED`；
- 当前草稿编译会因阶段的画布 `position` 被直接传入严格的语义阶段协议而失败；
- 当前画布使用真实边表达业务节点对 Markdown、图片和视频的引用，但 V1 编译器仍主要按旧的 `contentParentId` 识别资料挂靠；
- V1 快照不表达完整教学步骤顺序，也不能自然表达一个资料被多个业务节点引用。

因此实施顺序不能从“调用模型”开始。必须先让当前 revision 的快照可靠、可诊断、可表达真实关联；快照不就绪时，生成入口必须阻断。

## 3. 产品边界

### 本期包含

- 修复当前 V1 快照编译失败和静默失败状态。
- 新增规范化的 `FlowKnowledgeSnapshotV2`。
- 新增应用内、版本化的 `guideanything-guide-digest` 生成 bundle。
- 新增严格的总览生成请求、输出和持久化协议。
- 在指南编辑器中提供按需生成、差异预览、标签选择、接受和拒绝流程。
- 接受后更新草稿摘要与选中标签，保存 revision 对应的 Markdown 总览。
- 记录 `baseRevision`、`baseSnapshotId`、bundle revision、操作者和审计事件。

### 本期不包含

- 每次自动保存都调用模型。
- 模型直接修改画布节点、边、教学步骤或发布版本。
- 把生成 Markdown 自动创建成普通画布 Markdown 节点。
- 把生成 Markdown 加入普通 Agent 检索，或让下一次生成读取上一次生成结果。
- 从图片像素或视频音轨自动推断内容；本期只使用已有 alt、caption、图片标注和视频关键点。
- 安装或暴露个人 `~/.codex/skills` 给 Runtime Bridge。

## 4. 用户旅程

### 4.1 生成

1. 编辑者在右侧 `GUIDE DETAILS` 区域点击“生成指南总览”。
2. 若当前页面有未保存修改，前端先按现有乐观锁保存草稿。
3. API 确认当前 revision 已存在状态为 `READY` 的 V2 快照。
4. 若快照缺失、失败或落后，API 不调用 Runtime Bridge，并返回可操作的快照错误。
5. API 将当前 V2 快照和固定生成协议交给 Runtime Bridge。
6. Bridge 使用单次 `FOCUSED_WORKER` 结构化生成；不经过通用 Router，不访问工作区其他资料或 Santexwell。
7. API 校验输出、确定性渲染 Markdown，并创建 `DRAFT` 总览提案。

### 4.2 审核

编辑器打开总览提案面板，分为四部分：

1. **摘要差异**：当前摘要与建议摘要并排显示，可选择是否采用。
2. **标签建议**：保留现有标签；新建议以可勾选 chips 展示，每个标签可展开查看来源节点或资料。
3. **Markdown 预览**：使用现有安全 Markdown 渲染器显示固定结构的指南总览。
4. **缺口与诊断**：明确显示空阶段、缺少入口/出口、未连接节点、未引用资料或快照诊断，不把缺口伪装成已完成流程。

编辑者可以应用、拒绝或重新生成。重新生成会创建新提案，旧提案保留审计状态，不被覆盖。

### 4.3 应用

1. 编辑者选择是否应用摘要、哪些标签以及是否接受 Markdown，并点击“接受并应用到草稿”。
2. API 再次校验当前草稿 revision 与 `baseRevision`，以及当前快照与 `baseSnapshotId`。
3. 任一不匹配时，将提案标记为 `STALE` 并返回 `409`，不修改指南。
4. 匹配时，在一个事务中：
   - 更新选中的草稿摘要；
   - 保留现有标签并加入选中的新标签；
   - 在提案上记录接受的 Markdown 总览与来源信息；
   - 更新提案状态和审计；
   - 生成新的草稿 revision 历史记录。
5. 事务提交后，按新 revision 重新生成流程快照。
6. 发布仍使用现有作者专属发布流程。

## 5. FlowKnowledgeSnapshotV2

### 5.1 目标

V2 使用规范化图结构表达一次 revision，避免 V1 把资料嵌在单一业务节点下而无法支持共享引用。

```ts
interface FlowKnowledgeSnapshotV2 {
  schemaVersion: 2;
  snapshotId: string;
  workspaceId: string;
  workspaceItemId: string;
  guideId: string;
  title: string;
  summary: string;
  tags: string[];
  origin:
    | { kind: 'DRAFT'; revision: number }
    | { kind: 'PUBLISHED'; versionId: string; version: number };
  stages: FlowKnowledgeStageV2[];
  lanes: FlowKnowledgeLaneV2[];
  nodes: FlowKnowledgeNodeV2[];
  resources: FlowKnowledgeResourceV2[];
  relations: FlowKnowledgeRelationV2[];
  learningPath: FlowKnowledgeLearningStepV2[];
  entryNodeId?: string;
  exitNodeIds: string[];
  diagnostics: FlowKnowledgeDiagnosticsV2;
}
```

### 5.2 投影规则

- 阶段和泳道只投影语义字段；画布 `position`、尺寸、viewport、zIndex 和路由控制点不进入语义对象。
- `nodes` 只保存业务节点及其业务描述、阶段、责任、入口/出口和安全 locator。
- `resources` 每个 Markdown、图片或视频只保存一次。
- `relations` 明确区分：
  - `FLOW`：业务节点之间的流程关系；
  - `USES_RESOURCE`：业务节点对资料的引用，可保留边标签；
  - `RESOURCE_REFERENCE`：图片标注或视频关键点指向另一个节点/资料的关系。
- 一个资料可被多个业务节点通过不同 `USES_RESOURCE` relation 引用。
- `learningPath` 投影现有 `document.steps` 的稳定顺序和目标 ID。
- 图片只投影 alt、caption、标注标题、正文、区域、镜头、补充图安全元数据和目标 locator；不包含媒体 URL。
- 视频只投影 caption、关键点标题、秒数和目标 locator；不包含媒体 URL。
- 所有 locator 仅使用 `guideId/snapshotId/nodeId` 或后端签发的不透明引用，不包含本机路径、storage key 或 token。

### 5.3 兼容与迁移

- 现有 V1 行保持不可变，不批量改写。
- 读取层支持 V1 与 V2；新草稿保存和新发布只生成 V2。
- V1 通过只读 adapter 映射到统一检索视图；缺失的教学顺序或共享资料关系保持显式未知，不猜测。
- `knowledge_fragments` 的 materializer 改为从 V2 的 nodes、resources 和 relations 生成检索片段。
- 当前摘要加入流程片段 `search_text`；标签继续加入检索文本。

## 6. 指南总览生成协议

### 6.1 模型输出

模型不直接输出最终 Markdown，而是输出严格的结构化 `GuideDigestDraftV1`：

```ts
interface GuideDigestDraftV1 {
  schemaVersion: 1;
  shortSummary: string;
  scope: {
    audiences: string[];
    businessObjects: string[];
    systems: string[];
  };
  stageSections: Array<{
    stageId: string;
    title: string;
    overview: string;
    steps: Array<{
      targetId: string;
      title: string;
      description: string;
      inputs: string[];
      actions: string[];
      outputs: string[];
      resourceIds: string[];
    }>;
  }>;
  keyRules: Array<{
    statement: string;
    sourceIds: string[];
  }>;
  tagSuggestions: Array<{
    label: string;
    category: 'DOMAIN' | 'PROCESS' | 'SYSTEM' | 'OBJECT' | 'ROLE' | 'RISK';
    sourceIds: string[];
  }>;
  gaps: Array<{
    code: 'EMPTY_STAGE' | 'MISSING_ENTRY' | 'MISSING_EXIT' | 'UNCONNECTED_NODE' |
      'UNREFERENCED_RESOURCE' | 'INCOMPLETE_DESCRIPTION' | 'SNAPSHOT_DIAGNOSTIC';
    message: string;
    sourceIds: string[];
  }>;
}
```

所有 `stageId`、`targetId`、`resourceIds` 和 `sourceIds` 必须存在于输入快照；服务端拒绝无法回溯到快照的规则、标签和步骤。

### 6.2 确定性 Markdown 渲染

服务端从通过验证的结构化输出渲染固定模板：

1. YAML frontmatter：schema、guide、snapshot、base revision、标签和审核状态；
2. 流程摘要；
3. 适用范围；
4. 按阶段排列的流程步骤；
5. 关键规则；
6. 关联资料索引；
7. 图片标注与视频关键点索引；
8. 待完善项；
9. 可追溯引用。

固定 renderer 负责标题层级、表格、列表、转义和长度上限。模型不能改变 frontmatter 字段、章节顺序或插入 HTML。

### 6.3 标签规则

- 保留全部现有标签，模型只能提出新增建议。
- 最终标签仍服从现有协议：最多 20 个，每个不超过 50 字符。
- 建议标签必须是简短名词或名词短语，不能是完整句子。
- 去重使用 Unicode 规范化、大小写折叠和首尾空白清理；展示保留规范写法。
- 没有来源引用的标签不进入提案。
- 不为了数量补齐标签；建议目标为 4–8 个总标签。

## 7. 应用内 Skill 设计

网页能力使用应用拥有的版本化 bundle，而不是个人 Codex Skill：

- 名称：`guideanything-guide-digest`；
- 位置：`apps/api/src/modules/agents/bundles/guide-digest.ts`；
- 输入：单个已授权、当前且 `READY` 的 V2 快照；
- 输出：`GuideDigestDraftV1`；
- 执行：单次 `FOCUSED_WORKER`，默认 `MEDIUM` effort；
- 审计：每次提案记录 bundle revision、模型角色、schema version 和 base snapshot；
- 权限：只允许 `getGuideAccess` 返回指南 `OWNER/EDIT` 的用户请求，不把普通工作区 `EDIT` 自动扩张为所有指南的协作者；
- 网络与文件：不允许额外检索、文件读取、工作区扫描或 Santexwell 查询。

bundle 的低自由度规则包括：

- 只根据快照显式内容生成；
- 不补写不存在的步骤、责任、输入、输出或异常处理；
- 空阶段和缺少入口/出口必须进入 `gaps`；
- 业务规则必须引用节点、Markdown、图片标注或视频关键点；
- 图片标注和视频关键点属于资料证据，不等同于指南标签；
- 不输出隐藏推理，只输出协议字段。

如以后需要给开发者在普通 Codex 会话中离线生成同类文档，可另建一个便携 `guide-flow-digest` Codex Skill，复用同一 schema 与示例；它不是网页运行链路的依赖，本期不创建，避免出现双份规则漂移。

## 8. 持久化与 API

新增 `guide_digest_proposals`：

- `id`
- `workspace_id`
- `guide_id`
- `base_revision`
- `base_snapshot_id`
- `status`: `DRAFT | REJECTED | APPLIED | STALE | FAILED`
- `draft_json`
- `markdown`
- `bundle_revision`
- `summary_applied`
- `accepted_tags_json`
- `markdown_accepted`
- `created_by`
- `created_at`
- `updated_at`
- `applied_revision`
- `supersedes_proposal_id`

新增 `guide_digest_audit_events`，记录生成、验证失败、拒绝、过期和应用事件；payload 只记录安全元数据，不保存隐藏推理或完整 prompt。

新增 API：

- `POST /api/guides/:guideId/digest-proposals`：基于当前 revision 生成或返回当前有效提案；
- `GET /api/guides/:guideId/digest-proposals`：列出该指南的提案历史；
- `GET /api/guides/:guideId/digest-proposals/:proposalId`：读取提案；
- `PATCH /api/guides/:guideId/digest-proposals/:proposalId/status`：拒绝提案；
- `POST /api/guides/:guideId/digest-proposals/:proposalId/apply`：在一次显式审核动作中应用选中的摘要和标签，并按选择接受 Markdown 总览。

apply 请求只接收选择结果，不接收客户端改写后的模型 JSON：

```ts
interface ApplyGuideDigestProposalV1 {
  applySummary: boolean;
  acceptedTagLabels: string[];
  acceptMarkdown: boolean;
}
```

如编辑者希望修改摘要或 Markdown，先在现有人工字段或后续专用编辑能力中修改；本期不把自由文本编辑混入提案 apply 协议。被接受的 Markdown 仍保存在不可变提案记录中，标注其 `baseRevision/baseSnapshotId`，不作为“永远最新”的流程事实。

## 9. 编辑器界面

### GUIDE DETAILS

- 在摘要与标签上方新增“生成指南总览”按钮。
- 显示当前快照状态：`已同步`、`正在同步`、`已过期` 或 `生成失败`。
- 只有编辑权限且快照与当前 revision 对齐时按钮可用。
- 生成期间保留当前画布和字段，不锁住正常阅读；防止重复提交。

### 总览提案面板

- 使用大尺寸 modal 或独立 drawer，不挤入当前窄属性栏。
- 顶部展示 base revision、生成时间和是否仍为当前版本。
- 摘要、标签、Markdown、缺口分别为可浏览区域。
- 标签默认保留现有值；新标签默认不自动全选，编辑者逐项确认。
- “接受并应用到草稿”按钮明确说明只更新草稿，不发布指南。
- 过期提案保留可读，但禁用应用并提供“基于最新版重新生成”。

## 10. 失败与安全行为

- **快照失败**：阻止模型调用，显示具体安全错误码和“重新同步快照”；不显示成功假象。
- **revision 变化**：生成中或审核中 revision 改变，将提案标为 `STALE`。
- **Bridge 不可用**：返回可重试失败，保留草稿和当前摘要/标签不变。
- **结构输出无效**：允许一次只针对 schema 的修复重试；仍失败则记录 `FAILED`，不保存不完整 Markdown。
- **来源引用无效**：服务端拒绝整个提案，不删除无效引用后继续应用。
- **无足够内容**：可以生成缺口报告，但不能用常识补全空阶段；摘要必须明确当前覆盖范围有限。
- **权限变化**：每次读取、生成、接受和应用都重新检查工作区和指南权限。
- **Markdown 安全**：继续使用现有 sanitize renderer；禁止 HTML、脚本、远程媒体和本机路径。
- **递归污染**：接受的 Markdown 不进入下一次 digest 输入，也不进入普通流程检索。

## 11. 成本与性能

- 流程快照是确定性本地编译，可随每次成功保存生成。
- 模型生成只在编辑者点击时发生，不随 autosave 自动调用。
- 同一 `baseSnapshotId + bundleRevision` 的未过期提案默认复用；“重新生成”才创建新调用。
- 单快照、单 worker、无 Router、无外部检索，避免 Map-Reduce 和多角色成本。
- 输入超过预算时，服务端按确定性顺序保留阶段、节点、关系和诊断；资源正文按上限截断并显式记录截断，不由模型自行抽样。

## 12. 实施分期

### 阶段一：快照可靠性

- 修复阶段/泳道语义投影，不透传画布字段。
- 将索引失败从 best-effort 静默状态升级为可读取的 readiness。
- 为当前“打样提案流程”生成与 revision 对齐的快照。
- 增加 V2 contracts、编译器、V1 adapter 和 materializer。

### 阶段二：总览生成后端

- 增加 digest schema、确定性 Markdown renderer、bundle 和 Runtime Bridge output kind。
- 增加 proposal migration、repository、service、routes 和审计。
- 增加 stale、权限、结构修复和幂等复用。

### 阶段三：编辑器审核体验

- 增加快照状态、生成按钮、提案面板、摘要差异和标签选择。
- 增加接受、拒绝、重新生成和 stale 恢复。
- 使用“打样提案流程”进行真实 Runtime Bridge 和浏览器验收。

## 13. 验证策略

### Contracts 与 canvas-core

- V2 严格拒绝画布位置、URL 和本机路径。
- 同一资料可被多个节点引用且只保存一个资源对象。
- 教学步骤顺序、入口/出口、分支标签和资源关系稳定序列化。
- 图片 8 个标注和视频关键点完整投影。
- V1 历史快照仍可读取。

### API 与数据库

- 当前 revision 没有 `READY` 快照时不调用 Bridge。
- 指南 `OWNER/EDIT` 可生成；只有工作区权限但不是指南协作者的用户、`VIEW` 和无成员用户不可生成或读取。
- 相同快照默认复用提案；显式重新生成保留 supersedes 链。
- apply 在 revision 或 snapshot 变化时返回 `409` 并标记 `STALE`。
- 摘要、标签、总览、提案状态和审计原子更新。
- Bridge、schema 或索引失败不修改当前指南。

### Runtime Bridge

- 新 output kind 只接受严格 `GuideDigestDraftV1`。
- bundle 明确禁止额外检索和无来源补写。
- 非法 source ID、超长内容、HTML 和额外字段被拒绝。
- 一次结构修复后仍无效时稳定失败。

### Web

- 快照未同步时生成按钮禁用并说明原因。
- 生成、成功、失败、过期、拒绝和应用状态可访问且可恢复。
- 标签选择默认不删除现有标签。
- 应用后明确显示“草稿已更新，尚未发布”。

### 真实验收

在隔离测试数据库和真实 Runtime Bridge 上打开“打样提案流程”：

1. 确认草稿 revision 与 V2 快照一致；
2. 确认三阶段、两业务节点、Markdown、图片、视频、8 个标注、2 个视频关键点和真实资料边都进入快照；
3. 生成总览并验证空阶段、缺少出口和未完成内容被列为缺口；
4. 选择摘要和部分标签应用，确认草稿 revision 增加且没有发布；
5. 在旧提案生成后修改草稿，确认旧提案变为 `STALE` 且无法覆盖；
6. 检查浏览器 console、API 日志、快照 readiness、Runtime Bridge 健康和最终数据库状态。

## 14. 成功标准

- 编辑者能从当前、可验证的流程快照按需生成稳定 Markdown 总览、摘要和有来源的标签建议。
- 模型无法直接修改或发布流程；所有应用由编辑者明确选择并受 revision/snapshot 双重保护。
- 当前“打样提案流程”不再使用 revision `65` 的陈旧快照回答 revision `180` 的内容。
- Markdown、摘要、标签、流程快照和画布事实的权威边界清楚，没有递归索引或生成内容自我强化。
- 生成失败、快照失败、权限变化和过期提案都有明确、可恢复、可审计的结果。
