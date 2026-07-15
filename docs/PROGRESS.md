# GuideAnything 进度

> 最后更新：2026-07-15（Asia/Shanghai）

## 已完成

- 建立持续目标，完成空仓库检查与 Node/pnpm 工具链确认。
- 确定 React Flow + React/Vite + Fastify + SQLite 的前后端分离方案。
- 完成 PRD、架构、数据模型和分阶段验收基线。
- 完成共享画布协议、跨字段校验、有界历史栈和子指南展开/折叠纯算法；6 项测试与类型检查通过。
- 完成 SQLite 幂等迁移、scrypt 密码验证、JWT 登录/会话校验；API 5 项测试与类型检查通过。
- 完成指南创建/保存/发布、固定旧版本、FTS 检索、资源级协作权限与幂等 ERP 示例；API 累计 11 项测试通过。
- 磁盘 SQLite 已用 `pnpm db:reset && pnpm db:seed` 实际初始化：3 用户、2 指南、2 发布版本。
- 完成媒体流式限额、MIME 白名单、文件签名校验、UUID 存储与鉴权读取；API 累计 14 项测试通过。
- 完成 Web 登录/会话恢复、资料库搜索、草稿列表、角色化操作与加载/空/错误状态；4 项组件测试及生产构建通过。
- 完成 React Flow 无限画布、多模态节点、属性编辑、复制/撤销、对齐/层级、媒体上传、显式/防抖保存、发布及固定子指南插入展开；Web 累计 9 项测试通过。
- 修复 React Flow 受控 props 引用不稳定造成的最大更新深度循环；编辑器已拆分为懒加载 chunk。
- 完成响应式学习模式、只读流程概览、步骤聚焦与视频关键点跳转；2 项学习组件测试通过。
- Playwright 真实浏览器已完成作者创建多模态指南、端口连线、4 步教学、保存发布、搜索、宿主引用展开/折叠、学习者登录检索与视频跳转。
- 浏览器验收中发现并修复宽节点默认重叠：新增 380px 网格布局纯算法与自动布局按钮；1000 节点展开/折叠耗时 6ms。
- 最终浏览器用真实 Pointer 事件创建 3 条方向连线并发布 v2；SQLite 断言 v2 为 4 节点、3 连线、4 步骤，FTS 当前版本仅 1 行。
- 冷启动浏览器控制台：0 errors / 0 warnings；Web `127.0.0.1:5174`、API `127.0.0.1:3001` 当前运行中。
- 本地自审发现并修复“只打开编辑器也会自动保存”的 revision 漂移，新增回归测试证明未修改指南 1.6 秒后不会调用保存 API。
- 子指南选择器现在打开即加载全部已发布指南；后端使用每页 50 条的偏移分页，前端依次载入所有页面，输入后 180ms 防抖即时筛选。草稿仍不会进入发布索引；关闭弹窗会清除加载状态。
- 修复图片/视频节点缩放只扩大外框的问题：节点内容现在随 React Flow 尺寸填满可用区域、保持等比，并限制极扁尺寸时的媒体溢出；端口可见且命中区域扩大。浏览器实际确认图片卡片和媒体宽度与外框同步。
- 修复子指南展开的边恢复与接续语义：React Flow 往返保留 `sourceTrace`，首次展开固化快照入口/出口，旧草稿按 `expanded` 归一化派生节点/边；展开时隐藏原“引用 → 下游”边，创建“出口 → 原下游”代理，折叠后恢复原状态，不再产生入口回路。删除续接边会清理旧代理，嵌套子指南会随父级折叠隐藏；核心算法覆盖新展开、旧数据修复、手动跨边、折叠恢复和无环接续。
- 对本地真实“ERP 销售订单创建”草稿的纯状态断言：展开 `sales-subguide` 后原 `s-e7` 为隐藏状态，`material-end → sales-decision` 代理边可见，不存在旧 `material-end → sales-subguide` 回边；Web `127.0.0.1:5174` 与 API `127.0.0.1:3001` 持续运行，未留下测试进程。
- 完成以业务流程为一级结构的画布体验：阶段、一级主流程与 Markdown/图片/视频资料挂靠均保持旧文档和固定子指南快照兼容；自动整理采用可取消预览，应用后可撤销。
- 完成作者结构树、资料改挂靠/脱离、阶段泳道与学习者阶段分组/步骤资料聚合；展开子指南产物不会进入宿主流程层或资料层。
- 真实 Playwright 验收（种子“ERP 销售订单创建”）：作者创建 2 个业务阶段，将“收到客户下单需求”和“物料可销售？”分别归入阶段；选中前者新增 Markdown 后结构树显示“业务阶段 1 → 收到客户下单需求 → 操作说明”。资料脱离时“未挂靠资料”从 3 变为 4，重新挂靠后恢复；预览自动整理后取消仍为“已保存”，再次预览后应用并撤销成功。
- 同一浏览器会话发布 v2；学习者搜索到 v2，步骤列表显示“业务阶段 2”和“业务阶段 1”，第 7 步展示“本步骤资料 / 操作说明”，第 3 步点击 `00:02` 视频关键点成功。浏览器控制台 error 为 0；开发态 React Flow warnings 存在，未作为无 warning 结论。
- 收口层级体验：判断节点同 rank 分支会按 `branchLabels` 和 `是/yes → 否/no` 稳定排序；预览状态显式显示主流程、阶段、资料、孤立和循环诊断及“入口 → 阶段泳道 → 资料”规则。展开子指南产物只作为引用节点下的“子指南内容”呈现，学习步骤从 `source.referenceNodeId` 继承引用子指南阶段，仍不进入宿主资料聚合或自动布局输入。
- 真实 Playwright（本 worktree `127.0.0.1:5173` / API `127.0.0.1:3001`）以作者打开种子“ERP 销售订单创建”，预览显示 `主流程 5 / 阶段 2 / 已挂靠资料 1 / 未挂靠资料 3 / 孤立节点 4 / 循环 2` 及规则说明；点击结构树远端“记录销售订单号”后，画布实际聚焦并选中该节点。预览期间浏览器快照确认新增节点、阶段、保存/发布、连线编辑及属性编辑均被禁用，而树选择仍可用。为避免改写共享种子草稿，未在此浏览器会话展开引用或发布新版本；该树与学习阶段路径由组件回归覆盖。未将开发态 React Flow warnings 作为“无 warning”结论。
- 总审 P1 收口：同 rank 中混入无关节点时，判断分支先按来源判断节点分组，再按 `branchLabels`/是-否顺序落入稳定槽位，避免比较器非传递性；预览期间 `onMoveEnd` 不再写入 viewport，标题、摘要、标签以及保存/发布、快捷键保存和自动保存均被守卫，取消预览后草稿保持未变。
- 总审协议收口：带 `source` 的 Markdown、图片或视频即使 `contentParentId` 指向源自由宿主主流程也会被 schema 拒绝；源自由资料仍可正常挂靠，派生节点不带挂靠字段则保持兼容。
- 完成业务流程二维表达：业务阶段可命名、排序并按时间自上而下展示；责任泳道可混合角色与系统，一级主流程按“阶段 × 泳道”归属，资料与展开子指南产物只继承展示语境。未配置泳道的旧文档继续使用原有布局。
- 完成直接画布创作：主流程端口拖到空白画布可直接创建下一流程节点或自动挂靠资料；双击真实业务连线可新增、修改和清空标注；流程节点明细在画布显示两行概览并在属性面板完整编辑。
- 完成学习者责任提示：当前教学步骤显示“责任 · 名称”或“系统 · 名称”；无泳道旧版本不显示提示，展开子指南步骤仅从引用节点解析阶段与责任。

## 2026-07-15 画布走线与图片讲解

- 自动整理升级为阶段优先的混合布局：阶段从上到下，阶段内按真实连接从左到右；连续连接的 Markdown/图片/视频参与原流程排名，显式挂靠资料仍进入所属步骤详情区。判断的主分支保持主线、次分支向下、回流走外侧通道。
- 新增确定性正交路由、节点避障、并行通道错位、回流/避障诊断和自定义圆角边。路由只作为展示派生数据；未持久化到 `CanvasDocument`。修复未测量媒体节点与布局默认尺寸不一致、非判断节点错误显示分支端口、自动整理预览未适配完整流程的问题。
- 图片节点新增编号点/矩形标注、排序、文案、关联目标与保存镜头；学习模式新增图片预览、编号/前后/自动播放、缩放镜头和资料预览栈。标注坐标绑定实际图片内容边界，关联资料返回后恢复原标注。
- 在独立 QA SQLite 与 `127.0.0.1:5175` Web / `127.0.0.1:3002` API 完成写入式浏览器验收：作者创建“订单类型字段”标注、关联“场景说明”、保存并发布 v2；学习模式打开图片讲解、应用 2.5 倍镜头、进入关联 Markdown，再返回原标注。旧边缺少显式 handle 的展示映射修复后，编辑与学习画布 console warning/error 均为 0；没有改写共享开发数据库。
- 1000 节点/999 连线正交路由性能回归通过；全量测试为 42 个文件、235 项。

## 2026-07-15 Santexwell 与只读 Agent Runtime

- 新增全局 `/knowledge/santexwell` 门户：状态、overview、canonical 搜索、文档片段和 owner 私有问答。
- 新增工作区资料、流程语义快照、Agent 会话、会话附件、产物页和不透明引用解析；Ontology 页面/导航未进入本阶段。
- 建立统一知识索引和 FTS5：Vault canonical allowlist、工作区 Markdown/TXT/PDF/DOCX、短期附件，以及草稿/发布版 `FlowKnowledgeSnapshotV1`。
- 真实 Vault smoke 建立 READY generation：760 documents、13,893 fragments；“花式纱”返回 5 个命中，公共 JSON 未出现 `/Users/` 或 `file:`。
- Agent 编排完成严格 no-evidence 问候/帮助 Fast Gate、medium reasoning Router、条件 high Deep Router、DIRECT/FOCUSED/COMPOSITE/OPEN_RESEARCH 预算、工作区优先、最多三个并行 worker、Reducer 禁止检索、schema 单次修复、partial/gap、cancel/steer/planVersion/stale 和 graceful shutdown。所有领域自然语言都进入 reasoning Router，不以关键词走无证据捷径。
- Santexwell Prompt Harness 只来自索引器验证的 allowlist，并只注入实际 Vault worker；新 Harness 仅在对应 generation 完整发布成功后提升为 last-good，缺失或刷新失败明确 fail closed/保留旧代。
- Runtime Bridge 完成 localhost bearer、非公开 token 校验、独立 CODEX_HOME 所有权 marker、个人 home 拒绝、最小 config、auth link、空 workdir、ephemeral thread、read-only/never approval、工具/沙箱网络/插件/个人 skill 全关闭、模型角色和 NDJSON ownership 校验。Codex provider transport 仍需网络；同一隔离 home 连续两次真实 Codex app-server 启动均为 READY。
- 前端完成认证 SSE 续传、公开计划/任务/草稿/最终答案、来源开关、附件竞态保护、cancel/steer、引用/产物展示，以及引用跳回编辑器/学习页 exact node。答案草稿只来自 final `ANSWER` 结构化 JSON 顶层 `conclusion` decoder，不公开 raw JSON、commentary、reasoning 或 locator；切换到无事件会话会清空旧 timeline/draft。
- 端到端 API 集成测试证明 `消息 → fake Router → FlowSnapshot 多片段检索 → SSE → committed answer → Markdown 资源引用 → exact node 跳转`；由该测试发现并修复公开搜索“按文档去重”误用于内部节点检索、资源节点引用被错误判 stale 两个问题。
- 所有会话、附件、答案、引用和产物按 owner 私有；工作区权限、run planVersion、source/document/fragment、attachment expiry、草稿 revision/发布版本在检索和提交/打开引用阶段重新授权。FTS scope/owner/membership/流程可见性过滤在 SQL `LIMIT` 前执行；`FORBIDDEN` 引用只返回通用文案。
- API 启动会恢复 `QUEUED` run，并将遗留 `ROUTING/RUNNING/VALIDATING` orphan run 收口为可重试 `RUNTIME_RESTARTED` 终态；关闭时 abort/等待 Vault refresh 与 Agent child。Bridge HTTP app 与 Codex runtime 并发关闭，减少继续接单窗口。

## 历史画布阶段验证快照

```text
pnpm --filter @guideanything/contracts test -- canvas.test.ts                              1 文件、11 项通过
pnpm --filter @guideanything/canvas-core test -- hierarchy.test.ts performance.test.ts    6 文件、27 项通过
pnpm --filter @guideanything/web test -- GuideEditor.test.tsx HierarchyPanel.test.tsx LessonPage.test.tsx CanvasCreationMenu.test.tsx EdgeLabelEditor.test.tsx
                                                                               11 文件、35 项通过
pnpm lint                                                                   退出 0（当时与现在均仅为空 hook，不作为实质门禁）
pnpm typecheck                                                              4 个 workspace 包退出 0
pnpm test                                                                   25 个测试文件、87 项通过
pnpm build                                                                  API 类型构建与 Web Vite 生产构建退出 0
git diff --check                                                            退出 0
```

测试分布：contracts 11、canvas-core 27、API 14、Web 35。

2026-07-15 画布阶段当时的最新验证：`pnpm lint`、`pnpm test`（contracts 28、canvas-core 44、API 41、Web 122）、`pnpm typecheck`、`pnpm build`、`git diff --check` 均退出 0；共 42 个测试文件、235 项通过。其中 `pnpm lint` 仅表示空 hook 退出，不构成代码质量证据。

本轮未对正在使用的共享 SQLite 种子数据执行写入式浏览器验收，因此没有将“重命名阶段、添加泳道、发布”标为新的浏览器事实；这些写路径由上述组件、协议与布局回归覆盖。

## 本轮 Agent Runtime 最终验证

2026-07-15 所有并行改动汇合后的 fresh 门禁：

- `pnpm typecheck`：5 个 workspace package 全部通过。
- `pnpm test`：87 个测试文件、663 项全部通过；分布为 contracts 79、canvas-core 60、Runtime Bridge 89、API 251、Web 184。
- `pnpm build`：API、Runtime Bridge 类型构建与 Web Vite 生产构建全部通过；仅保留现有的 Web 主 chunk 超过 500 kB 警告。
- `git diff --check`：通过。
- `pnpm lint`：退出 0，但当前没有任何 package lint 脚本，只是空 hook，不作为实质质量证据。

本轮用户明确要求不使用浏览器，因此 Agent 新页面只使用组件测试、API/Bridge 集成测试、生产构建和无浏览器 HTTP smoke 验收，不新增桌面视觉或 console 的浏览器通过结论；上方历史浏览器事实仍保持原样。

## 当前状态

- Agent Runtime 代码、文档与自动化门禁已经收口；Ontology 不在本期范围。

## 下一步

1. 在独立功能分支完成最终 diff 审阅与本地提交；是否合并、推送或创建 PR 由用户后续确认。

## 阻塞

- 无。
