# GuideAnything 产品需求文档

> 版本：0.2.0
> 日期：2026-07-15
> 状态：执行中

## 1. 产品定义

GuideAnything 是面向流程培训与企业知识访问的多用户、多模态工作台。作者在无限画布中以业务流程为骨架，组织 Markdown、图片和视频资料；网页用户既可学习已发布指南，也可通过只读 Agent 查询工作区流程/资料和 Santexwell Obsidian canonical 知识库。产品只实现内部访问，不包含公网部署、付费资源或外部通知。

## 2. 角色与权限

| 角色 | 能力 | 后端边界 |
| --- | --- | --- |
| 作者 `AUTHOR` | 创建、编辑、保存、发布、归档自己的指南 | 只能修改本人创建且未归档的指南，可授予编辑权限 |
| 编辑者 `EDITOR` | 编辑被授权指南、保存新草稿版本 | 必须存在 `guide_collaborators` 授权；不能转移所有权 |
| 学习者 `LEARNER` | 搜索、预览、阅读已发布指南 | 只能读取 `PUBLISHED` 版本，不得写入 |

演示环境提供三个预置账号；认证采用本地账号密码与短期 JWT。所有写操作以及未发布内容读取均由 API 校验，而不是仅由界面隐藏。

## 3. 核心用户路径

1. 作者登录并创建 ERP 教学指南。
2. 在无限画布添加并连接业务主流程，将主流程归入可命名阶段和角色/系统混合泳道；Markdown、图片和视频作为资料挂靠到对应主流程，再建立教学步骤。
3. 保存草稿；刷新页面后恢复节点、连线和视口。
4. 发布产生不可变版本快照，并填写标题、摘要、标签、入口/出口。
5. 学习者按关键词、摘要或标签检索并预览已发布指南。
6. 作者把搜索结果作为子指南节点加入另一个画布。
7. 展开子指南时，从所引用版本快照复制节点和边，完成 ID 命名空间隔离、坐标平移、入口/出口接线和来源记录；折叠时只隐藏该次展开产生的元素。
8. 学习者按教学步骤阅读，点击视频关键点后跳转到对应时间。
9. 用户在全局 Santexwell 门户或工作区 Agent 提问；严格 no-evidence 问候/帮助可直接回答，领域问题由 reasoning Router 按难度选择聚焦回答或最多三个并行子任务，并流式返回计划、进度、安全结论预览、引用和产物。
10. 用户从引用安全跳回 canonical 知识片段、工作区资料或流程中的业务/Markdown/图片/视频节点。

## 4. 功能需求

### 4.1 无限画布与流程图

- 平移、缩放、适配视口、定位选中项、点阵背景、缩略图和缩放控件。
- 节点/连线创建、编辑、删除、选择、多选、拖拽、缩放、复制粘贴、前移/后移、网格吸附和基础对齐。
- 撤销/重做至少覆盖节点与连线的创建、删除、移动、内容修改和子指南展开/折叠。
- 支持开始/结束、流程、判断、数据、Markdown、图片、视频、子指南八类节点；端口表达输入、输出和分支方向。作者可从主流程端口拖到空白处，直接创建下一流程节点或自动挂靠资料；双击真实业务连线可编辑持久化标注。
- 业务阶段是画布的一级结构，按作者定义顺序从上到下显示，支持命名与排序；责任泳道混合支持角色与系统，作为节点责任元数据与视觉提示，不以固定列破坏业务拓扑。一级主流程仅包含无来源追踪的开始、结束、流程、判断、数据和子指南节点。旧画布未设置阶段或泳道时仍可编辑和发布。
- 流程、判断、数据、开始和结束节点支持节点标题与节点明细；画布显示两行明细概览，完整文本在属性面板编辑。
- Markdown、图片、视频是资料层，只能挂靠一级主流程或保持未归类；展开子指南产生的带来源追踪节点保持原引用边界，不能被宿主流程重排或误挂靠。
- “自动整理”按入口和真实连接关系计算布局：阶段从上到下、阶段内从左到右，判断主分支保持主线、次分支向下展开、回流走外侧通道；连续连接的资料节点保留在原流程顺序，显式挂靠资料进入所属步骤详情区。正交路由避让节点并为并行边分配稳定通道。预览给出阶段、泳道、未归类资料、孤立流程、循环、回流和避障诊断；预览不保存、不进入撤销历史，应用后可撤销。
- 保存 `nodes + edges + viewport + steps + optional stages + optional lanes`。资料通过 `contentParentId` 继承阶段与泳道语境；展开子指南产物仅在展示时继承引用节点语境，不能写入宿主阶段/泳道。编辑器只订阅必要状态，节点组件记忆化；折叠内容使用 `hidden`，图片与视频使用懒加载。

### 4.2 多模态节点

- Markdown：作者编辑、学习者安全预览；支持标题、列表、表格、代码、链接和强调；过滤 HTML/XSS。
- 图片：本地上传、说明文字、等比适配；支持编号点与矩形区域标注、标注排序、标题/说明、可选缩放镜头和指南内关联目标；仅允许 JPEG/PNG/WebP/GIF，最大 10 MiB。
- 视频：本地上传或 HTTP(S) 引用、播放控制、说明文字；关键点包含标题、秒数、可选教学步骤 ID 和可选目标节点 ID。
- 节点协议统一包含 `id/type/position/size/zIndex/data/source`，类型私有数据使用带判别字段的 JSON，便于增加附件、网页和表格。

### 4.3 发布、搜索与引用

- 指南状态为 `DRAFT | PUBLISHED | ARCHIVED`；元数据含标题、摘要、标签、作者、版本、可见性、更新时间。
- 每次发布创建递增、不可变的 `guide_versions` 快照；编辑继续作用于工作副本。
- 搜索范围为已发布版本的标题、摘要、标签和节点可检索文本，首版用 SQLite FTS5，结果返回摘要和匹配信息。
- 子指南首版采用“固定发布版本”策略：引用创建时记录 `guideVersionId`，上游再次发布不会改变下游；作者可显式升级引用版本。
- 展开产物 ID 采用 `ref:<referenceNodeId>:<sourceId>`，记录 `sourceGuideId/sourceVersionId/sourceElementId/referenceNodeId`；算法必须幂等并可折叠恢复。

### 4.4 在线教学

- 作者为节点编排有序步骤，可写步骤标题、说明、注意事项并关联节点/视频关键点。
- 学习者从搜索结果进入只读播放页，步骤列表按业务阶段分组；当前步骤除聚焦主流程外，还展示对应角色/系统责任提示，并聚合展示该步骤挂靠的 Markdown、图片和视频资料。未配置泳道的旧版本不显示责任提示；展开子指南步骤展示引用节点的责任语境。
- 学习者使用上一步/下一步导航；视频关键点可跳转。图片标注可按编号手动或自动播放镜头，从讲解卡打开关联资料，并通过预览栈返回原标注位置；资料展示不改变发布版本内容。
- 示例数据覆盖 ERP 销售订单创建、物料主数据检查、缺失物料分支、图片、视频关键点、子指南固定版本引用及检索。

### 4.5 Santexwell 与只读 Agent

- `/knowledge/santexwell` 提供索引状态、知识概览、canonical 搜索/文档和 owner 私有会话；Vault 的更新与 iCloud/服务器同步不由 GuideAnything 负责。
- 工作区资料支持 `.md/.txt/.pdf/.docx` 上传与确定性解析；流程图编译为包含阶段、责任、邻域、资源和安全 locator 的 `FlowKnowledgeSnapshotV1`。
- 工作区 Agent 每轮显式保存 `workspaceFlows/workspaceDocuments/sessionAttachments/santexwell` 开关，优先检索工作区；Santexwell 为可选补充来源。
- Fast Gate 只允许严格白名单内、无 selected context/附件且不需要证据的问候、致谢或帮助请求走 `DIRECT`；所有领域自然语言都必须进入 medium reasoning Router。聚焦问题使用 `FOCUSED` 小预算；复杂、歧义或明确综合问题才进入 high Deep Router 复核和有界 Map-Reduce，并行 worker 不超过三个。Deep Router 只能收紧路线，Reducer 不允许检索。
- Santexwell worker 必须加载服务端 allowlist/last-good Prompt Harness；Router、Reducer 和不访问 Vault 的 worker 不注入整套 Vault skill。新 Harness 只有在对应 Vault generation 完整发布成功后才能提升为 last-good。
- 运行通过持久化 SSE 流式返回；支持 Last-Event-ID、cancel、steer、planVersion 和 stale provisional event。答案草稿只解码 final `ANSWER` 结构化 JSON 顶层 `conclusion`，不能公开 raw JSON、commentary、reasoning 或内部 locator。最终答案、引用和产物只在 schema/权限/revision 校验成功后提交。
- 本轮附件只属于 owner + workspace + conversation，默认 7 天到期；只有本轮显式选择的 READY 附件可检索。
- 所有网页用户对 Agent 都是只读。允许生成 `REPORT/DIAGRAM/FLOW_PROPOSAL/REFERENCE_COLLECTION`，但不得自动修改指南/Vault、执行 shell、通过工具/沙箱访问网络或写入外部系统。
- Runtime Bridge 只监听 localhost，用非公开、至少 32 字符的 bearer token、隔离 Codex home 和 ephemeral thread；五个模型角色显式配置，缺失/未知模型时 fail closed。工具/沙箱网络与 Web 搜索被禁用，但 Codex app-server 到已配置模型 provider 的传输仍需网络。生产 API 必须显式配置非示例 `JWT_SECRET`。
- 知识检索必须在 SQL 候选 `LIMIT` 前应用 scope、owner、membership 和流程可见性过滤；引用权限失效为 `FORBIDDEN` 时只显示通用文案，不回显历史受保护 title/excerpt。
- Ontology 不在 0.2.0 页面、导航、数据生产和运行时范围内。

### 4.6 工作区知识演进（编辑专属）

- `CanvasDocument` 与发布版 `GuideVersion` 是工作区流程事实源；`FlowKnowledgeSnapshotV1` 只是可定位、可检索的派生索引。知识卡、问题聚类和流程提案不属于普通索引，不能被 Agent 或普通用户当成流程事实读取。
- 工作区运行在内部来源已启用且最终证据状态为 `PARTIAL / INSUFFICIENT / CONFLICTING` 时，可在答案提交事务内记录一个脱敏问题聚类。聚类列表只展示摘要和计数；问题原文仅工作区 `OWNER` 可见，`EDIT` 只能看聚合信息。
- 只有工作区 `OWNER / EDIT` 可以进入“知识演进”工作台，创建/审核知识卡、审核流程提案。`VIEW` 无入口且直接 API 访问返回 `403`。
- 流程提案必须包含目标指南、基准草稿 revision、可验证证据和严格 Canvas 操作。编辑者先接受，再显式“应用到草稿”；服务端先验证操作拓扑和 revision。revision 已变化时提案标记为 `STALE`，不得覆盖新草稿。
- 应用提案会留下编辑审计并触发新的草稿流程快照。发布仍使用现有作者发布流程；Agent 只可提出建议、产物或聚类信号，绝不自动修改流程、工作区资料或 Vault。
- 工作区流程/资料/附件 worker 使用版本化 `guideanything-workspace-query` bundle，以选中上下文优先、服务端预算限跳和证据 locator 约束来避免小问题扩大检索范围；它与外部 Vault Harness 独立。

## 5. 非功能要求

- 本地开发：Node.js 24+、pnpm 10+；`pnpm dev` 启动 Web/API/Bridge，`pnpm dev:fake` 提供不调用 Codex 的确定性纵向验证；SQLite、上传、Vault 和 Runtime home 均可配置。
- 安全：请求 schema 校验、密码哈希、JWT、资源级授权、Markdown 清洗、上传 MIME/扩展名/大小约束、CORS 白名单、统一错误响应。
- 可用性：加载、空、错误和保存状态；常用操作有键盘入口和 aria-label；宽屏为编辑器布局，小屏降级为工具栏抽屉与只读步骤优先。
- 可靠性：保存使用 `revision` 乐观锁；发布与版本快照处于同一事务；知识 generation/Harness 原子提升；Agent 事件先持久化后推送，并可恢复 `QUEUED` run。重启时遗留的 `ROUTING/RUNNING/VALIDATING` run 收口为可重试 `RUNTIME_RESTARTED`；关闭时 abort/等待 Vault refresh 和 Agent child，再关闭数据库与 Runtime。

## 6. 明确不做

- 实时多人协同、评论、外部分享、SSO、云对象存储、OCR、Agent 自动写回/执行、Ontology、生产级全文搜索集群和公网部署。
- 不复制 TapNow 的代码、视觉资产、商标或专有交互细节。
