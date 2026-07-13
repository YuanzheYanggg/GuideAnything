# GuideAnything 知识工作台 V1 设计

## 1. 目标

GuideAnything V1 将当前“指南库 + 静态业务分类”升级为真实可用的知识工作台。工作区是业务知识、人员权限和未来智能能力的边界；指南只是工作区中的第一种资源，不再等同于整个产品。

V1 必须交付：

- 工作区可持久化、可进入、可统计，并拥有成员与权限。
- 指南明确归属一个工作区。
- 收藏夹、最近查看、与我共享、回收站使用真实数据库数据。
- 个人视图能够跨工作区聚合资源。
- 工作区内部为资料源、Agent、Ontology、会话与产物预留稳定的模块位置和服务契约。
- 现有指南编辑、发布、搜索、学习和固定版本子指南能力继续工作。

## 2. 非目标

V1 不同步服务器目录、PDF、数据库或第三方知识库，不建立向量索引和自动 Ontology，不启动 Codex CLI，不提供 Agent 对话或命令执行，也不建设插件市场、自由拖拽工作台和实时多人协作。

这些模块拥有明确入口和接口边界，但空状态必须说明“尚未配置”，不得使用虚假的 Agent、资料或咨询结果。

## 3. 方案选择

采用“资源型工作区”：

- 工作区是一级实体。
- 统一资源登记表容纳指南及未来资源。
- 收藏、最近查看和回收站指向统一资源 ID。
- 各模块仍保留独立领域表，不把指南文档塞入通用表。

未采用“只给指南追加个人功能”，因为未来加入 Agent 和资料时会再次重构。也未采用“完全可插拔工作台”，因为插件协议、布局持久化和沙箱安全超出 V1。

## 4. 核心概念

### 4.1 工作区

工作区代表一个有边界的业务知识域，例如财务管理、物料管理、销售与分销、生产计划和人力资源。它负责：

- 描述业务范围和负责人。
- 管理成员及权限。
- 容纳指南和未来知识资源。
- 约束未来 Agent 可以访问的资料与工具。
- 聚合工作区活动和使用情况。

### 4.2 工作区资源

工作区资源是统一登记记录，不直接承载各模块的完整业务数据。V1 支持 GUIDE，并预留：

- SOURCE：文档、目录、数据库或外部知识源。
- AGENT：具备提示词、知识范围和运行时配置的智能体。
- ONTOLOGY：概念、关系、术语和规则集合。
- CONVERSATION：基于工作区知识的咨询会话。
- ARTIFACT：报告、分析、指南草稿或任务产物。

统一资源登记负责工作区归属、通用标题摘要、生命周期和个人视图引用。各模块负责自己的完整数据。

### 4.3 个人视图

- 收藏夹：用户主动保存的高频资源。
- 最近查看：用户实际打开过的资源，按最后查看时间排序。
- 与我共享：别人明确授予当前用户访问或编辑权限的资源。
- 回收站：当前用户有权恢复或永久删除的已移除资源。

个人视图不属于单个工作区，默认跨工作区聚合。

## 5. 信息架构

~~~text
知识工作台
├── 指南库
├── 收藏夹
├── 最近查看
├── 与我共享
├── 回收站
├── 工作区
│   ├── 财务管理
│   ├── 物料管理
│   ├── 销售与分销
│   ├── 生产计划
│   ├── 人力资源
│   └── 查看全部
└── 设置
~~~

进入工作区后：

~~~text
工作区概览
├── 概览
│   ├── 工作区说明与负责人
│   ├── 资源统计
│   ├── 最近更新
│   └── 常用资源
├── 指南
├── 资料源（预留）
├── Agent（预留）
├── Ontology（预留）
├── 会话与产物（预留）
└── 成员与设置
~~~

主要视图使用可复制 URL：

- /library
- /favorites
- /recent
- /shared
- /trash
- /workspaces
- /workspaces/:workspaceId
- /workspaces/:workspaceId/guides
- /workspaces/:workspaceId/sources
- /workspaces/:workspaceId/agents
- /workspaces/:workspaceId/ontology
- /workspaces/:workspaceId/artifacts
- /workspaces/:workspaceId/settings

浏览器刷新必须恢复同一视图。

## 6. 用户旅程

### 6.1 浏览工作区

1. 用户点击侧栏“物料管理”。
2. 页面展示工作区用途、负责人、资源统计和最近更新。
3. 用户进入指南模块并打开指南。
4. 服务端记录这次实际查看。

### 6.2 收藏与恢复上下文

1. 用户在指南操作菜单中点击“收藏”。
2. 收藏写入数据库并立即反映在行状态。
3. 收藏夹跨刷新显示该指南。
4. 用户打开指南后，最近查看更新时间和查看次数，不产生重复记录。

### 6.3 与我共享

1. 指南所有者添加协作者。
2. 协作者在“与我共享”中看到授权人、权限和更新时间。
3. 协作者进入编辑器，但不能转移所有权或永久删除资源。

### 6.4 回收和恢复

1. 所有者确认“移到回收站”。
2. 资源从指南库、搜索、收藏夹和最近查看的默认列表隐藏。
3. 回收站显示删除人、删除时间和原工作区。
4. 恢复后资源回到原工作区。
5. 永久删除只允许指南所有者或工作区所有者操作，并要求再次确认。

已发布且被固定引用的版本快照不能物理删除。永久删除指南时保留不可变版本及引用完整性，移除可变草稿和工作区资源入口。

具体删除语义：

- 从未发布且未被引用的草稿可以物理删除 guides 记录。
- 已发布指南在永久删除时将 guides.status 设为 ARCHIVED，并删除个人状态和工作区资源入口。
- guide_versions 始终保留，确保既有固定版本子指南仍能读取。
- 回收站和搜索均不返回 ARCHIVED 指南。

### 6.5 未来 Agent

未来用户可以选择基于本工作区指南和资料的 Agent。回答必须标明来源，执行动作必须经过授权。V1 只显示模块说明和未配置状态，不显示可发送消息的假输入框。

## 7. 数据模型

新增迁移文件 0002_workspace_v1.sql。

### 7.1 workspaces

| 字段 | 约束 | 说明 |
| --- | --- | --- |
| id | 主键 | UUID |
| slug | 唯一 | URL 稳定标识 |
| name | 非空 | 显示名称 |
| description | 非空 | 业务范围说明 |
| icon_key | 非空 | 受控图标名称 |
| color_key | 非空 | 受控颜色令牌 |
| owner_id | 外键 users | 工作区所有者 |
| status | ACTIVE 或 ARCHIVED | 生命周期 |
| created_at | 非空 | UTC 时间 |
| updated_at | 非空 | UTC 时间 |

### 7.2 workspace_members

主键为 workspace_id 与 user_id，权限为：

- OWNER：管理工作区、成员和所有资源。
- EDIT：创建和编辑有权限的资源。
- VIEW：查看工作区已发布资源。

用户全局角色继续作为能力上限。例如 LEARNER 即使加入工作区，也不能获得创作能力。

### 7.3 workspace_items

| 字段 | 约束 | 说明 |
| --- | --- | --- |
| id | 主键 | 统一资源 ID |
| workspace_id | 外键 workspaces | 所属工作区 |
| kind | 受控枚举 | GUIDE、SOURCE、AGENT、ONTOLOGY、CONVERSATION、ARTIFACT |
| entity_id | 非空 | 模块领域记录 ID |
| title | 非空 | 通用列表标题 |
| summary | 非空 | 通用列表摘要 |
| created_by | 外键 users | 创建者 |
| deleted_at | 可空 | 软删除时间 |
| deleted_by | 可空外键 users | 删除人 |
| created_at | 非空 | 创建时间 |
| updated_at | 非空 | 最近更新时间 |

kind 与 entity_id 组成唯一约束。V1 的领域实体只有 guides。指南标题和摘要更新时，同一事务更新资源登记快照。

### 7.4 user_favorites

主键为 user_id 与 item_id，附带 created_at。收藏前必须验证当前用户仍可访问目标资源。

### 7.5 recent_views

主键为 user_id 与 item_id，包含 last_viewed_at、view_count 和 context_json。context_json 只保存指南版本 ID 或编辑模式等轻量上下文，不保存完整文档。

### 7.6 workspace_activity

记录创建指南、更新指南、发布指南、添加协作者、移到回收站和恢复资源。字段为 id、workspace_id、actor_id、action、item_id、metadata_json 和 created_at。

不记录搜索关键词和私人阅读内容。

## 8. 现有数据迁移

迁移必须保留所有用户、指南 ID、发布版本、画布文档、媒体和子指南引用。

1. 创建五个默认工作区和一个“通用工作区”。
2. 为演示作者写入默认工作区成员关系。
3. 根据指南标题和标签进行一次性归属：
   - 财务、结账、发票 → 财务管理
   - 物料、主数据、供应商 → 物料管理
   - 销售、订单、分销 → 销售与分销
   - 生产、计划、供应 → 生产计划
   - 人力、员工、入职 → 人力资源
   - 其余 → 通用工作区
4. 为每条现有指南创建 GUIDE 类型的工作区资源记录。
5. 不修改 guide_versions 和 CanvasDocument schema。

迁移和 seed 必须幂等，已有数据库升级后不得重复创建记录。

## 9. API 设计

### 9.1 工作区

- GET /api/workspaces
- POST /api/workspaces
- GET /api/workspaces/:id
- PATCH /api/workspaces/:id
- GET /api/workspaces/:id/items?kind=GUIDE&state=active
- GET /api/workspaces/:id/activity
- GET /api/workspaces/:id/members
- POST /api/workspaces/:id/members
- DELETE /api/workspaces/:id/members/:userId

### 9.2 指南归属

- POST /api/guides 增加必填 workspaceId。
- GET /api/guides 支持 workspaceId 和 scope=owned、editable、shared。
- 指南详情返回 workspaceId 和 workspaceItemId。
- 发布、更新和协作者操作写入工作区活动。

### 9.3 个人视图

- GET /api/me/favorites
- PUT /api/me/favorites/:itemId
- DELETE /api/me/favorites/:itemId
- GET /api/me/recent
- PUT /api/me/recent/:itemId
- GET /api/me/shared
- GET /api/me/trash

打开指南详情、编辑器或学习模式成功后，前端调用最近查看接口。搜索结果展示不算查看。

### 9.4 回收站

- POST /api/workspace-items/:itemId/trash
- POST /api/workspace-items/:itemId/restore
- DELETE /api/workspace-items/:itemId

写操作返回更新后的资源摘要。重复收藏、重复记录最近查看、重复移入回收站和重复恢复必须幂等。

## 10. 前端设计

### 10.1 工作台 Shell

保留当前毛玻璃深浅色设计，侧栏按钮改为真实路由，当前激活态由 URL 决定。

工作区列表来自 API。侧栏展示最近使用的五个工作区，其余通过“查看全部”进入工作区目录。

### 10.2 通用资源列表

收藏夹、最近查看、共享和回收站复用 ResourceTable。组件和 DTO 不以 Guide 命名，按资源类型决定图标、主要动作和元数据。

通用行支持：

- 打开资源。
- 收藏或取消收藏。
- 显示所属工作区和资源类型。
- 根据权限显示编辑、移到回收站、恢复或永久删除。

### 10.3 工作区概览

概览展示工作区名称、描述、颜色、负责人、模块数量、最近活动、当前用户收藏的本工作区资源和“新建指南”主要动作。

未实现模块数量为 0，点击后进入明确空状态并说明未来接入方式。

### 10.4 指南库

全局指南库继续跨工作区搜索。每行增加所属工作区、收藏状态和操作菜单。进入工作区后自动过滤；新建指南默认归属于当前工作区。

用户从全局指南库点击“新建指南”时，先选择一个自己拥有 EDIT 或 OWNER 权限的工作区；如果只有一个可编辑工作区则直接使用该工作区。不得静默写入任意默认工作区。

## 11. 权限规则

- 用户只能看到有权访问的工作区和资源。
- AUTHOR + OWNER 可管理工作区及资源生命周期。
- AUTHOR 或 EDITOR + EDIT 可创建和编辑指南。
- 指南所有者可以邀请协作者。
- 显式协作者可在“与我共享”查看并编辑指南，即使不是工作区编辑成员。
- 普通工作区成员关系不进入“与我共享”；该视图只展示显式资源授权，避免与工作区资源列表重复。
- LEARNER 只查看已发布指南，不能查看草稿、回收资源或工作区设置。
- 收藏和最近查看是用户私有数据。
- 永久删除仅允许指南所有者或工作区所有者。

API 必须在服务端执行权限校验，隐藏前端按钮不是授权措施。无权访问返回 404，避免泄露资源存在性。

## 12. 预留智能能力接口

V1 只定义接口边界和能力描述，不提供实现实例。

~~~ts
interface KnowledgeSourceAdapter {
  kind: string;
  validateConfiguration(input: unknown): Promise<void>;
  sync(sourceId: string, signal: AbortSignal): Promise<SyncResult>;
  search(sourceIds: string[], query: string): Promise<KnowledgeHit[]>;
}

interface AgentRuntimeAdapter {
  kind: string;
  capabilities(): Promise<AgentCapability[]>;
  createSession(input: AgentSessionInput): Promise<AgentSession>;
  send(sessionId: string, message: string): Promise<AgentEventStream>;
  cancel(sessionId: string): Promise<void>;
}

interface OntologyProvider {
  rebuild(workspaceId: string, sourceItemIds: string[]): Promise<OntologyBuild>;
  query(workspaceId: string, query: string): Promise<OntologyResult>;
  explain(workspaceId: string, entityId: string): Promise<OntologyExplanation>;
}
~~~

未来 Codex CLI 接入必须遵守：

- 浏览器不能直接启动本地 shell。
- API 通过独立本地 Runtime Bridge 与 Codex CLI 通信。
- Agent 声明可用能力和工作区范围。
- 读取、写入、命令执行分级授权。
- 文件修改和命令执行必须产生审计事件。
- 高风险动作需要用户逐次确认。
- 回答保留指南版本、资料片段或 Ontology 实体引用。

## 13. 错误处理

- 工作区或资源无权访问统一返回 404。
- 收藏目标被删除时返回可恢复错误，并从当前列表移除。
- 最近查看目标失效时保留记录七天但不展示，恢复后可重新出现。
- 删除、恢复和成员变更失败时保留当前页面并显示明确错误。
- 数据迁移失败必须回滚整个迁移事务。
- 已发布版本与固定子指南引用不得因资源回收而失效。

## 14. 测试策略

### 数据库与 API

- 新迁移和旧数据库升级测试。
- 默认工作区及指南归属回填测试。
- 工作区成员权限矩阵测试。
- 收藏幂等与无权收藏测试。
- 最近查看去重、计数和排序测试。
- 与我共享只返回显式协作者资源测试。
- 回收、恢复、永久删除和固定版本引用保护测试。
- 工作区活动写入测试。

### 前端

- 侧栏路由激活态和刷新恢复测试。
- 工作区切换与指南过滤测试。
- 收藏和取消收藏即时更新测试。
- 最近查看、共享和回收站空状态与数据状态测试。
- 操作菜单按权限显示测试。
- 未实现模块不得出现可发送或可执行的假控件。

### 浏览器验收

1. 登录作者账号并进入物料管理工作区。
2. 新建指南并确认归属当前工作区。
3. 收藏指南并在收藏夹看到它。
4. 打开学习模式并在最近查看看到它。
5. 以协作者账号查看“与我共享”。
6. 将草稿移入回收站并恢复。
7. 刷新各路由，当前视图和数据库状态保持。
8. 深色、浅色及移动端布局无阻断性溢出。

## 15. 交付分段

### M1：数据基础

新增工作区、成员、统一资源、收藏、最近查看和活动表，完成现有指南回填。

### M2：工作区与个人 API

完成工作区、收藏、最近查看、共享、回收站和权限接口。

### M3：工作台 Shell

将静态侧栏改为 URL 路由，完成工作区目录、概览和通用资源列表。

### M4：指南整合

指南创建、列表、编辑、学习、搜索和操作菜单接入工作区与个人状态。

### M5：预留模块

完成资料源、Agent、Ontology、会话与产物的真实空状态、模块说明和接口类型，不接入运行时。

## 16. 验收标准

- 五个默认工作区和通用工作区存在于数据库。
- 所有现有指南都有且只有一个工作区归属。
- 收藏、最近查看、共享、回收和恢复跨刷新保持。
- 侧栏所有 V1 入口可进入真实页面，不再是静态按钮。
- 权限不足的用户无法通过直接 API 调用绕过限制。
- 当前指南编辑、发布、搜索、学习和子指南功能无回归。
- 资料源、Agent、Ontology 和产物模块明确标记未配置，并具有稳定扩展边界。
- 全仓测试、类型检查、构建和关键浏览器流程通过。

## 17. 自检

- 没有未决占位符或依赖虚假数据的页面。
- V1 聚焦工作区、个人视图和指南整合；智能能力只预留边界。
- 统一资源模型与现有指南领域模型职责分离，不要求重写 CanvasDocument。
- 数据迁移、权限、删除语义、固定版本引用和错误处理保持一致。
- 每个交付阶段都能独立验证，并共同形成可用的知识工作台纵向链路。
