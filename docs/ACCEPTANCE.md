# GuideAnything 验收清单

## 1. 自动化门禁

提交前必须在仓库根目录通过：

```bash
pnpm test
pnpm typecheck
pnpm build
git diff --check
```

覆盖范围包括 SQLite 迁移/seed、API 权限与生命周期、知识索引、Agent 编排/恢复、SSE、Runtime Bridge 隔离、前端路由与交互、Canvas/流程语义纯算法和共享 DTO。

`pnpm lint` 当前只是根目录 `--if-present` hook；各 workspace 尚无实质 lint 脚本。可以执行它检查未来 hook，但其退出 0 不计为本版质量证据，也不能替代上述门禁。

## 2. 桌面浏览器基线

- 视口：`1440 × 1024` CSS px。
- 外观：深色与浅色各执行一遍 Shell 和关键页面检查。
- 数据：使用真实 API/SQLite 演示账号，不注入前端假数据。
- 质量：每个旅程无阻断性溢出，浏览器 console 无 error。
- 范围覆盖：本版验收为 desktop-only，不将移动端布局列为发布门禁。
- [x] 平移缩放、适配、点阵、MiniMap、节点/边增删改选拖、方向端口通过浏览器验收。
- [x] 多选、复制粘贴、层级、吸附/左对齐/自动布局、撤销重做和键盘快捷键具有纯算法/组件覆盖；关键操作通过浏览器验收。
- [x] Markdown 安全预览、图片上传/说明、视频播放/关键点编辑和跳转具有组件/API 覆盖；关键路径通过浏览器验收。
- [x] 调整图片节点后，媒体内容会随 React Flow 外框扩展并保持等比；端口不再被节点裁切，浏览器验收通过。
- [x] 显式保存与 1.5 秒防抖保存会持久化节点、边、视口和步骤；SQLite 证明发布 v2 为 4 节点、3 连线、4 步骤。
- [x] 业务阶段、一级主流程与资料挂靠均由共享协议校验；无阶段的旧文档、已发布版本和子指南快照仍兼容。
- [x] 作者可按“阶段 → 主流程 → 资料”检查结构，改挂靠或脱离资料；展开子指南产物不会混入宿主的主流程和资料层。
- [x] 自动整理按业务主流程稳定生成阶段泳道、详情资料轨道和诊断；1000 节点性能回归通过，循环与孤立流程保持确定性。
- [x] 自动整理先预览；取消不保存也不写入撤销历史，应用后可撤销。
- [x] 判断节点的同 rank 分支按 `branchLabels` 和 `是/yes → 否/no` 稳定排序；无匹配分支继续按原画布坐标稳定回退。
- [x] 预览状态显示主流程、阶段、已挂靠/未挂靠资料、孤立和循环计数及“入口 → 阶段泳道 → 资料”规则；结构树点击远端节点会聚焦画布，预览期间所有画布编辑控件均冻结。
- [x] 展开的子指南产物只在引用子指南下以“子指南内容”显示，不进入宿主阶段、未挂靠资料、自动布局或诊断；其显式学习步骤继承引用节点的阶段。
- [x] 作者可命名、排序业务阶段与角色/系统混合责任泳道；一级主流程只能指向存在的阶段和泳道，资料与展开子指南产物仅继承展示语境。
- [x] 责任泳道继续保存角色/系统归属并显示在结构面板、节点与学习步骤中；自动整理优先保持业务拓扑，不再用固定责任列迫使连线交叉。
- [x] 作者可从主流程端口拖线到空白处创建下一流程节点或自动挂靠资料，双击真实业务连线编辑标注，并在节点标题下配置画布两行概览的节点明细。
- [x] 自动整理按阶段纵向、阶段内横向保持真实连接顺序；连续资料链不会被误判为孤立节点，判断主分支/次分支/回流使用固定正交语法，节点尺寸与路由几何一致，预览自动适配完整流程。
- [x] 正交路由仅派生展示数据，避让非端点节点、错开并行通道并忽略隐藏/来源边；1000 节点、999 连线的路由性能回归通过。
- [x] 作者可在原图有效边界内创建编号点或矩形标注，编辑文案、排序、删除、保存镜头和关联目标；Escape 关闭前提交当前输入，标注进入撤销/保存/发布链路。
- [x] 学习者可从图片步骤打开标注播放器，按编号/前后/自动播放切换镜头，打开关联 Markdown 后返回原标注；标注覆盖层在不同图片宽高比下与实际图片边界一致。

## 3. 十条端到端旅程

### 3.1 工作区导航与刷新恢复
- [x] 草稿发布生成不可变递增版本；搜索只返回已发布指南。
- [x] 搜索结果能插入为固定版本子指南节点。
- [x] 展开无 ID 冲突、坐标正确、入口/出口接续和来源追踪；原“引用 → 下游”边在展开时隐藏并由“出口 → 原下游”代理，折叠可靠还原；删除原续接边会清理旧代理，嵌套引用随父级折叠隐藏，旧展开草稿可恢复缺失桥接边。
- [x] 上游再发布不会改变已有引用，且测试覆盖。
- [x] 学习者可搜索进入并按步骤浏览，点击视频关键点会跳转。
- [x] 学习者步骤按业务阶段分组，并聚合显示当前步骤挂靠的 Markdown、图片和视频资料；引用子指南的展开步骤继承该引用的阶段。
- [x] 学习者当前步骤显示角色或系统责任提示；无泳道的旧版本不显示提示，展开子指南步骤从引用节点继承责任语境。

1. 作者登录，打开 `/workspaces/workspace-materials`。
2. 确认显示物料管理的说明、负责人、权限、真实资源数和活动。
3. 刷新浏览器，URL 与当前工作区视图保持。

### 3.2 工作区内创建指南

1. 在物料管理概览点击“新建指南”。
2. 创建草稿后进入编辑器。
3. 返回 `/workspaces/workspace-materials/guides`，确认草稿归属当前工作区，而非静默落入默认工作区。

### 3.3 收藏持久化

1. 作者收藏新建指南。
2. 打开 `/favorites`，确认资源、所属工作区和类型正确。
3. 刷新页面，收藏仍存在；取消收藏后列表即时更新。

### 3.4 最近查看去重

1. 从列表打开指南编辑器或已发布版本的学习模式。
2. 返回 `/recent`，确认只有一条资源记录；刷新后该记录仍存在。
3. 使用该行已渲染的“编辑”或“学习”操作恢复工作。`last_viewed_at` 更新、`view_count` 自增、排序和去重由 API/数据库自动化测试断言，因为当前 UI 不渲染这些字段。

### 3.5 显式共享与权限

1. 使用 seed/API 前置建立一个已显式授权的指南；API 自动化测试断言“只有工作区成员资格”不会进入共享列表，显式 collaborator 可保存草稿但不能发布。添加 collaborator 不是本条浏览器旅程中的 UI 操作。
2. 编辑者登录并打开 `/shared`，确认上述已显式共享的指南出现，而普通工作区成员资源不出现。
3. 确认页面只提供当前已渲染的打开/收藏操作，且不显示资源生命周期菜单；不将未存在的所有权转移或 collaborator 管理 UI 写成浏览器验收步骤。

### 3.6 回收与恢复

1. 作者将一个未发布草稿移到回收站并确认二次对话框。
2. 确认它从默认指南、搜索、收藏和最近列表隐藏，并出现在 `/trash`。
3. 在回收站恢复，确认资源回到原物料管理工作区。

### 3.7 Santexwell 门户与工作区资料

1. 打开 `/knowledge/santexwell`，索引未完成时显示真实状态；READY 后可浏览 overview、搜索并打开 exact document/fragment。
2. 在 `/workspaces/workspace-materials/sources` 上传 `.md/.txt/.pdf/.docx`，确认 `READY/FAILED` 状态来自后端；跨工作区、伪装类型、超限和不安全文档被拒绝。
3. 检查 API/页面 JSON 不包含 Vault 绝对路径、`file:` URL、上传 storage key 或 Prompt Harness 内容。
4. 修改/删除 source 或 fragment 后，旧引用返回明确失效状态，不跳到近似资料。

自动化证据：真实 Vault smoke 已覆盖 canonical allowlist/atomic generation；knowledge、extractor、source 权限和 path sanitization 由 API 测试覆盖。

### 3.8 流式 Agent、路由和恢复

1. 无 selected context/附件时发送严格白名单内的问候或帮助请求，确认 Fast Gate 使用 `DIRECT` 且不检索；再发送一个很短的领域问题，确认仍进入 medium reasoning Router。工作区 Agent 只启用流程时，聚焦问题的公开计划最多一个 worker，答案引用精确流程或资源节点。
2. 明确要求综合分析并启用多个来源；只有复杂度/歧义满足策略时才进行 high Deep Router 复核，最多三个 worker 并行，Reducer 只汇总 findings，不再次检索。
3. 同时勾选 Santexwell 时先检索工作区；工作区证据充分则显示跳过 Vault，证据不足才运行 Vault worker。
4. 流中依次出现路线、计划、任务进度、草稿、验证、引用和最终答案；公开草稿只由 final `ANSWER` 结构化 JSON 顶层 `conclusion` decoder 产生，不能出现 raw JSON、evidence locator、commentary 或 reasoning。刷新/断线通过 `Last-Event-ID` 不重复续传。
5. steer 后 `planVersion` 自增，旧 provisional 事件 stale；cancel 形成唯一 committed terminal event。
6. Bridge/模型/Prompt Harness 不可用时显示安全失败码，不回退为无约束文件读取。
7. 强制终止一个处于 `ROUTING/RUNNING/VALIDATING` 的进程并重启 API，确认 orphan run 追加唯一、可重试的 `RUNTIME_RESTARTED` terminal failure；`QUEUED` run 仍按顺序恢复。
8. Vault 新 Harness 或文档解析失败时不提升 last-good；已有 generation/Harness 继续可读。关闭服务时 Vault refresh 被 abort 并等待，Bridge 停止接受新请求且与 Codex runtime 完成收口。

自动化证据：端到端集成测试覆盖 `消息 → fake Router → FlowSnapshot 检索 → conclusion 增量 → SSE → 答案 → 引用跳转`；结构化 preview decoder、Fast Gate、orphan recovery、shutdown 和 Harness promotion 由 API/Bridge 单元与集成测试覆盖。真实 Bridge 的同一隔离 home 连续启动、模型健康和协议边界由 Bridge 测试/本机 smoke 覆盖。

### 3.9 私有附件、引用与产物

1. 用户 A 的全局/工作区会话、附件、答案和产物对用户 B 返回 404；共享工作区成员关系不改变会话 owner 隔离。
2. 新会话上传期间切换会话，旧请求不能把附件或消息写入新会话 UI；没有 READY 附件时来源开关不可启用。
3. 只有本轮显式附件 ID 进入检索；过期/失败/跨会话附件在执行和引用两个阶段都被拒绝。
4. 打开流程引用可聚焦业务、Markdown、图片或视频节点；打开资料引用定位 source/document/fragment；Santexwell 引用定位 canonical fragment。
5. `REPORT/DIAGRAM/FLOW_PROPOSAL/REFERENCE_COLLECTION` 只在当前 owner 的产物页出现；`FLOW_PROPOSAL` 不修改指南。
6. 构造大量无权候选并把有权命中排在其后，确认 scope/owner/membership/流程可见性在 SQL `LIMIT` 前生效；权限撤销后的 `FORBIDDEN` 引用只显示通用 title/excerpt，不回显已保存的受保护文案。

### 3.10 深浅色桌面外壳与 console

1. 在 `1440 × 1024` 下检查 `/library`、个人视图、工作区概览、Santexwell、资料、Agent 和产物页。
2. 切换深色与浅色，确认文字、表格、弹层、焦点和选中态可读，并无阻断性溢出。
3. 完成其他九条旅程后确认 browser console 为 0 errors。

## 4. 权限与生命周期证据

- 请求者没有基础可见性、必须隐藏工作区/资源存在性时，直接 API 访问返回 404。
- 工作区/资源已对请求者可见或可读，但请求者缺少所请的创建、编辑、发布、设置或生命周期权限时，API 返回 403。
- 工作区 `EDIT` 只授权在该工作区创建指南，不授权编辑他人指南；指南 owner/collaborator 决定草稿编辑权，只有指南 owner 能发布。
- 工作区 `OWNER` 可管理设置、成员和资源生命周期，但不自动获得他人指南的内容编辑或发布权。
- `LEARNER` 不能查看草稿、回收资源或创建/编辑指南。
- 只有指南所有者或工作区所有者能永久移除。
- 未发布草稿可物理删除；已发布指南转为 `ARCHIVED` 并保留全部 `guide_versions`。
- 固定版本子指南在上游回收或归档后仍可读取。

## 5. 范围否定

验收不得使用“页面能打开”替代数据持久化、版本或权限断言。当前阶段不构建 Ontology，不允许网页 Agent 写回 Vault/指南/外部系统，不开放 Bridge 到非 localhost，不展示隐藏推理，也不把 fake runtime 当作生产能力。
- [x] API 覆盖真实知识适配器、会话/附件隔离、Router/worker/reducer 策略、SSE 重放、引用重授权、产物和完整本地 fake runtime 纵向链路。
- [x] Runtime Bridge 覆盖 bearer、localhost、严格 CODEX_HOME、auth/config/skills 重启校验、模型角色和 Codex JSON-RPC/NDJSON 协议。
- [x] Bridge 拒绝缺失、短值和公开 sentinel token；生产 API 拒绝缺失、短值和已知示例 `JWT_SECRET`。模型工具、沙箱网络和 Web 搜索保持禁用，但真实 Codex provider transport 仍需网络，不以“完全离线”作为验收结论。
- [x] 每次模型调用使用 ephemeral thread；公开流只接收 final `ANSWER` conclusion decoder 的安全增量，不接收 raw JSON、commentary 或 reasoning。
- [x] Web 组件覆盖来源开关、附件竞态、跨会话流状态 reset、计划版本、引用/产物展示和精确 query locator。
- [x] 1000 节点展开/折叠纯算法本机耗时 6ms；媒体懒加载、受保护 Blob URL 与折叠可见区渲染已实现。
- [x] 加载/空/错误/冲突状态、响应式布局、键盘可达与必要 aria-label 已检查。
- [ ] 本轮 Agent 新页面的真实桌面视觉/console 复验未执行；按当前任务约束不使用浏览器，自动化组件测试与生产构建是本轮界面证据。旧指南浏览器事实仍保留在 `PROGRESS.md`。
- [x] 中文 README 包含启动、迁移、示例账号、测试、目录、API、数据库检查和验收说明。
