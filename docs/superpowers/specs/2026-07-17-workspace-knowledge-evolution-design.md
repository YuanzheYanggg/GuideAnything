# 工作区知识演进与流程提案设计

## 1. 目的与边界

GuideAnything 的工作区承载内部场景知识：具体流程、岗位、系统操作、例外处理、项目资料、复盘与决策。它与 Santexwell Obsidian 的行业文章、研究和通用工艺知识是两个独立领域。

本设计建立一个仅供工作区编辑者使用的知识演进工作台。它把真实问答中暴露的知识缺口、已验证的工作区证据和编辑者整理的经验沉淀为知识卡与流程改进提案；只有编辑者审核、修改并发布流程版本后，内容才成为所有工作区用户可使用的正式流程事实。

Santexwell 只保留为工作区 Agent 的显式可选补充来源。它不拥有、同步、覆盖或组织工作区的内部知识。

本期不做：自动修改流程、让普通用户浏览知识卡、把知识卡自动写入 Santexwell、以隐藏推理作为知识来源、跨工作区共享内部知识。

## 2. 已确认的知识层次

| 层次 | 责任 | 可见性 | 权威性 |
| --- | --- | --- | --- |
| `CanvasDocument` 与已发布 `GuideVersion` | 流程图、节点、边、责任、阶段和挂载资料 | 按现有工作区/指南权限 | 流程结构的唯一权威源 |
| `FlowKnowledgeSnapshotV1` | 从流程 revision 自动编译的语义索引、邻域和安全 locator | 系统内部 | 某一流程 revision 的派生语义快照，禁止人工编辑 |
| 工作区资料 | 原始 SOP、文档、图片、视频和上传材料 | 按工作区权限 | 原始证据 |
| 编辑知识卡 | 缺口、冲突、经验和待审核的改进建议 | 仅 `OWNER` / `EDITOR` | 编辑工作底稿，不是普通问答的正式证据 |
| 流程提案 | 对特定流程 revision 的结构化修改集和证据链 | 仅 `OWNER` / `EDITOR` | 待审核，不能自动应用 |
| Santexwell | 通用行业文章与 canonical 知识 | 仅用户显式开启后供 Agent 补充 | 外部补充，不构成内部流程事实 |

## 3. 用户与权限

### 普通工作区成员

- 可以使用现有工作区 Agent 查询已发布流程、已授权工作区资料和显式启用的 Santexwell 补充来源。
- 不可读取知识卡、问题聚类、原始他人会话、流程提案或编辑审计。
- 不可创建、编辑、合并或发布流程提案。

### 工作区 `EDITOR` 与 `OWNER`

- 可查看本工作区的编辑知识卡、证据链、问题聚类和流程提案。
- 可创建/编辑/归档知识卡，可要求 Agent 只基于已验证工作区证据生成提案草稿。
- 可在画布中预览、修改、接受或拒绝提案。
- 只能先将提案应用到当前流程草稿；仍沿用现有 revision 乐观锁与发布权限，不允许直接改写已发布 GuideVersion。

### 原始问题与隐私

- 默认展示脱敏的、按意图和关联流程节点聚合的问题簇、次数、最近时间、证据缺口和推荐动作。
- 原始问题与必要会话片段只对 `OWNER` 可按需展开，并须经过现有 owner/workspace 边界重新授权。
- 知识卡和提案中不保存模型隐藏推理、凭据、绝对路径或未授权附件内容。

## 4. 编辑知识卡

### 类型

- `QUESTION_GAP`：高频或高价值问题无法由已发布流程和资料充分回答。
- `EVIDENCE_CONFLICT`：流程、资料或已验证证据互相矛盾，需人工裁决。
- `IMPROVEMENT_PROPOSAL`：基于已验证流程和资料提出的具体流程改进。

### 内容

每张卡至少记录：工作区、状态、标题、关联流程/节点、来源问题簇、已验证证据引用、知识缺口或建议、编辑说明、创建/更新者与时间。卡可附带一个或多个流程提案，但不得直接成为普通用户 Agent 的检索证据。

状态为 `DRAFT`、`UNDER_REVIEW`、`ACCEPTED`、`REJECTED` 或 `ARCHIVED`。`ACCEPTED` 表示编辑决策已完成，不代表流程已发布；流程提案成功应用并由编辑者发布后，卡记录对应的流程版本并可归档。

## 5. 问题到流程的演进链路

1. 普通用户在工作区 Agent 提问。
2. 运行时仍按当前规则优先检索流程快照与工作区资料；工作区证据充分时不查询 Santexwell。
3. 若答案是 `NO_EVIDENCE`、`PARTIAL`、存在证据冲突，或编辑者将某一回答标为“需要沉淀”，系统创建或更新编辑可见的问题簇。
4. 编辑者从问题簇创建知识卡，或请求 Agent 生成仅包含已验证证据的草稿。
5. 编辑者将卡转化为 `FLOW_PROPOSAL`。提案必须声明目标 guide、基准草稿 revision、操作列表、涉及节点/边/步骤/资料和每项证据。
6. 画布以可视 diff 展示新增、修改和删除；编辑者可以手动调整。
7. API 仅在目标草稿 revision 匹配时应用提案。revision 过期则拒绝自动应用，要求基于最新草稿重新生成或人工合并。
8. 编辑者保存并按现有流程发布机制发布。新的 `FlowKnowledgeSnapshotV1` 被编译并进入普通工作区 Agent 的正式证据域。

## 6. Agent bundle 与渐进披露

工作区内部问答使用独立的 `guideanything-workspace-query` bundle，不放入 Santexwell，也不依赖 Santexwell skill 同步。该 bundle 与 GuideAnything 的 contracts、权限模型和流程快照 schema 同版本发布。

它的固定能力包括：

- selected context 优先；选中节点、流程或资料时先读该对象。
- 流程命中后才按路线预算扩展一跳或两跳邻域；禁止全图扫描。
- 工作区流程、工作区资料和当前会话显式附件为主来源；每个来源都有候选数和作用域上限。
- 输出只能引用服务端已验证的 evidence ID；流程反馈必须可重新授权并安全跳转到目标节点或资料。
- 只有复杂、歧义或明确要求综合的问题才允许有界 Map-Reduce；Reducer 不具备检索能力。
- 编辑模式可额外生成知识卡或流程提案草稿，但普通问答模式没有写入能力。

Santexwell 使用独立的只读 bundle，来源于其 allowlisted prompt harness 和 canonical 索引。运行时只能在用户显式启用 `santexwell` 后将其作为补充；不得把外部知识伪装为内部流程事实。

## 7. 数据与协议

新增持久实体应独立于现有 `knowledge_sources/documents/fragments`，避免编辑底稿意外进入普通检索：

- `workspace_question_clusters`
- `workspace_question_cluster_examples`
- `workspace_knowledge_cards`
- `workspace_knowledge_card_evidence`
- `workspace_flow_proposals`
- `workspace_flow_proposal_operations`
- `workspace_editorial_audit_events`

所有实体必须带 `workspace_id`、创建者、时间、状态和 revision；所有读取在 SQL `LIMIT` 前按工作区成员关系过滤。原始问题样本另行存储并只允许 Owner 再授权读取。

`FLOW_PROPOSAL` 沿用现有产物协议的类型化、schema 验证与审计思想，但新增“可应用到草稿”的严格操作契约。操作以稳定 node/edge/step ID 定位，并要求声明 `baseRevision`；不允许用自然语言直接修改 `CanvasDocument`。

## 8. UI

在工作区内新增仅编辑者可见的“知识演进”入口，包含：

1. 问题簇队列：问题摘要、频次、关联节点、当前证据状态与建议动作。
2. 知识卡列表/详情：状态、来源、证据、编辑说明和关联提案。
3. 提案审阅：流程画布 diff、操作清单、影响节点、证据、拒绝/接受/应用动作。
4. 审计时间线：谁创建、修改、接受、应用、发布或归档了哪些对象。

普通成员不展示该入口；直达 URL 也必须由 API 与页面路由拒绝。普通 Agent 界面只显示已发布流程、被授权资料和最终引用。

## 9. 失败与安全行为

- 证据、成员关系、流程 snapshot、关联资料或 base revision 任一失效时，提案不可应用并明确提示编辑者重新核对。
- Agent 结构化输出不符合知识卡或流程提案 schema 时，不创建草稿；保留可诊断的失败状态但不泄露隐藏推理。
- 无证据问题只能形成 `QUESTION_GAP`，不能形成可应用的流程修改操作。
- 资料或 Santexwell 证据被撤权/刷新后，卡片与提案显示“证据失效”，直到编辑者重新确认。
- 编辑知识卡禁止成为普通用户问答的隐式知识来源；只有发布后的流程 revision 与现有授权资料进入标准检索。

## 10. 分期与验收

### 第一阶段：编辑知识工作台

- 问题簇、知识卡、证据绑定、权限、审计与编辑者 UI。
- 验收：普通成员无法枚举或读取编辑对象；Owner 可按需查看经过重新授权的原始问题；草稿卡不出现在普通 Agent 引用中。

### 第二阶段：流程提案与安全应用

- 类型化 proposal、画布 diff、revision 保护、应用到草稿和发布后快照再索引。
- 验收：过期 revision 无法应用；编辑者接受的操作正确反映到草稿；发布后 Agent 可定位更新后的流程节点；拒绝提案不会影响流程。

### 第三阶段：工作区 query bundle 与质量闭环

- 将现有渐进检索规则提炼为版本化 `guideanything-workspace-query` bundle，记录 run 使用的 bundle revision；编辑者可从问题簇发起受证据约束的卡片/提案草稿。
- 验收：小问题不越过候选/跳数预算；复杂问题最多三 worker；bundle revision、证据和提案来源可审计；显式开启 Santexwell 前不会访问外部 Vault。

## 11. 验证策略

- 数据库 migration 与 repository 单元测试：身份、状态转换、成员过滤、Owner 原始问题访问、证据失效。
- API route 测试：编辑者/普通成员边界、直接 URL/API 拒绝、proposal revision 冲突、审计记录。
- canvas-core / contracts 测试：proposal 操作 schema、稳定 ID、冲突与序列化。
- Agent integration 测试：question gap 生成、草稿隔离、发布后流程快照重新索引、来源优先级和 Santexwell opt-in。
- Web 测试：编辑工作台、差异审阅、无权限状态和发布后跳转。
