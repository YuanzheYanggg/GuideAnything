# GuideAnything

GuideAnything 是一个前后端分离的多用户、多模态流程教学与只读知识问答工作台。作者先按可命名的业务阶段梳理主流程，再用角色与系统混合泳道明确分工，把 Markdown、图片和视频资料挂靠到对应步骤；网页用户既可学习已发布指南，也可在全局 Santexwell 门户或工作区 Agent 中通过服务端 Codex 查询流程、资料、临时附件和 Obsidian 知识库。

当前仓库包含两条完整纵向链路：`创建与保存 → 发布不可变版本 → 全文检索 → 子指南复用 → 学习模式`，以及 `消息 → 难度路由 → 有界检索/并行子任务 → 流式回答 → 引用/产物 → 安全跳转`。Ontology 不在本阶段产品范围内。

## 1. 环境要求

- macOS 或 Linux
- Node.js 24.12 或更高版本
- pnpm 10 或更高版本

本项目使用 Node 内置 `node:sqlite`。Node 24.12 会打印一次 `ExperimentalWarning`，不影响功能；Node 24.15 及之后该模块进入 RC 阶段。

## 2. 快速启动

```bash
cp .env.example .env
```

`.env.example` 故意不提供可直接复用的认证密钥。至少为 `JWT_SECRET` 生成一个随机值；启动真实 Bridge 时，再为 `AGENT_BRIDGE_TOKEN` 独立生成另一个不同的随机值。例如可分别运行两次 `openssl rand -hex 32`，把输出填入 `.env`。生产模式会拒绝缺失、少于 32 字符或仓库已知示例值的 `JWT_SECRET`；Bridge 模式在所有环境都会同样拒绝不安全的 `AGENT_BRIDGE_TOKEN`。

先用不调用 Codex 的确定性开发运行时验证 Web/API、流程检索和流式界面：

```bash
pnpm install
AGENT_RUNTIME_MODE=fake pnpm db:reset
pnpm dev:fake
```

要运行真实 Santexwell/Codex 链路，在 `.env` 中至少配置：

```dotenv
JWT_SECRET=
AGENT_BRIDGE_TOKEN=
SANTEXWELL_VAULT_PATH="/absolute/path/to/santexwell"
CODEX_RUNTIME_AUTH_FILE="/absolute/path/to/codex/auth.json"
AGENT_MODEL_ROUTER=<available-model-id>
AGENT_MODEL_DEEP_ROUTER=<available-model-id>
AGENT_MODEL_FOCUSED_WORKER=<available-model-id>
AGENT_MODEL_DEEP_WORKER=<available-model-id>
AGENT_MODEL_REDUCER=<available-model-id>
```

然后启动 Web、API 与仅监听 localhost 的 Runtime Bridge：

```bash
pnpm dev
```

模型角色可以使用同一个高推理模型，也可以分别配置；系统不会静默选择或硬编码模型。`CODEX_RUNTIME_AUTH_FILE` 只会被链接进隔离的运行时 home，不会被读取、复制或提交。也可以提前在 `CODEX_RUNTIME_HOME` 放置普通文件 `auth.json`，此时可不填写该项。Runtime 会禁用工具、沙箱网络和 Web 搜索，但 Codex app-server 仍需通过模型 provider transport 访问已配置模型，因此真实链路不是完全离线运行。

启动后访问：

- Web：<http://127.0.0.1:5173>
- API 健康检查：<http://127.0.0.1:3001/api/health>
- Runtime Bridge 健康检查：<http://127.0.0.1:3010/health>
- SQLite：`data/guideanything.sqlite`
- 上传目录：`data/uploads/`

Vault 首次索引和每 5 分钟增量刷新在 API 监听后后台运行；慢速 iCloud hydration 不会阻塞 `/api/health`。刷新失败时保留上一代原子发布的索引；首次尚未建立可信 Harness 时，Santexwell worker 会明确失败并提示稍后重试，不会绕过规则直接读取文件。

`pnpm db:reset` 会删除本地 GuideAnything SQLite 数据并重新写入演示数据，只应在本地初始化或明确重置时使用。日常增量初始化使用：

```bash
pnpm db:migrate
pnpm db:seed
```

## 3. 演示账号

三个账号的密码均为 `Guide123!`。

| 角色 | 邮箱 | 可验证路径 |
| --- | --- | --- |
| 作者 | `author@guide.local` | 创建、编辑、上传、保存、发布、管理协作者 |
| 编辑者 | `editor@guide.local` | 编辑被授权的“ERP 销售订单创建”，不能发布 |
| 学习者 | `learner@guide.local` | 搜索和阅读已发布版本，不能读取草稿或写入 |

种子数据包含“物料主数据检查”和“ERP 销售订单创建”两个已发布指南，覆盖 Markdown、图片、视频关键点、判断分支、教学步骤和固定版本子指南。

## 4. 常用命令

```bash
# 同时启动 Web、API 与真实 Runtime Bridge
pnpm dev

# 只启动 Web/API，并使用确定性只读开发运行时
pnpm dev:fake

# 全量验证
pnpm typecheck
pnpm test
pnpm build
git diff --check

# 单独验证
pnpm --filter @guideanything/api test
pnpm --filter @guideanything/web test
pnpm --filter @guideanything/canvas-core test

# 数据库
pnpm db:migrate
pnpm db:seed
pnpm db:reset
```

根命令 `pnpm lint` 目前只是 `--if-present` 的 workspace hook；各 package 尚未配置实质 lint 脚本，因此它退出 0 不能替代上述类型、测试、构建和 diff 门禁。

数据库 CLI 会加载同一份运行配置。若本机只使用 fake runtime 且没有配置 Bridge token，请同样加前缀，例如 `AGENT_RUNTIME_MODE=fake pnpm db:migrate`；真实 Bridge 配置完整后可直接使用表中的数据库命令。

## 5. 目录与边界

```text
apps/
  api/                  Fastify、SQLite/FTS、知识索引、Agent 编排、鉴权
  runtime-bridge/       localhost Codex app-server 隔离桥
  web/                  React/Vite 工作台、Santexwell、Agent、编辑/学习
packages/
  contracts/            Zod 画布、知识、会话、事件、引用与产物协议
  canvas-core/          画布算法与 FlowKnowledgeSnapshot 语义投影
docs/
  PRD.md                中文产品需求
  ARCHITECTURE.md       架构与性能/安全策略
  DATA_MODEL.md         关系模型与画布协议
  ACCEPTANCE.md         分阶段验收清单
  PROGRESS.md           当前证据与未完成项
data/
  guideanything.sqlite  本地数据库（不提交）
  uploads/              本地媒体（不提交）
  runtime-bridge/       隔离 CODEX_HOME 与空工作目录（不提交）
```

Web 只通过 `/api` 访问后端；开发时 Vite 代理到 `127.0.0.1:3001`。浏览器永远不接触 Vault 路径、Bridge token、Codex auth 或内部 locator。API 与 Bridge 之间使用 bearer token；Bridge 只绑定 `127.0.0.1`。

## 6. 产品操作

### 作者

1. 登录作者账号，在资料库选择“新建指南”。
2. 可从顶部工具栏添加开始、流程、判断、数据或子指南；也可从主流程节点的连接点拖到空白画布，在“创建下一项”菜单中直接创建流程、判断、数据或结束并自动连线。选择说明、图片或视频会自动挂靠到起点，不会误建业务连线。
3. 双击真实业务连线可写入或清空“是 / 否”“提交审核”等连线标注；资料虚线和展开子指南来源连线不能编辑。
4. 在“流程结构”面板新增、命名并排序业务阶段与责任泳道。泳道可混合“角色”和“系统”；主流程节点在右侧选择所属阶段和责任泳道，并可在标题下填写“节点明细”。画布只显示两行明细概览，完整内容仍在属性面板编辑。
5. 选中一个主流程节点后新增 Markdown、图片或视频，资料会自动挂靠到该步骤。也可在右侧属性面板改挂靠目标，或将资料脱离为未归类资料。
6. 从左侧“流程结构”检查“阶段 → 主流程 → 资料”的层级，并优先处理面板标出的未归类资料。
7. 使用“自动整理”先生成预览：阶段从上到下、阶段内按真实连线从左到右；判断的否分支向下展开，回流进入外侧通道，连接中的 Markdown、图片和视频保留原业务顺序。责任泳道作为节点责任提示，不再强迫拓扑落入固定列。选择“应用”后写入草稿；选择“取消”不会写入草稿或历史记录，应用后仍可用撤销恢复。
8. 使用多选、复制/粘贴、左对齐、置顶/置底、删除、撤销/重做继续编辑；选中节点后可“加入教学步骤”。
9. 草稿在修改停止 1.5 秒后自动保存，也可 `Ctrl/Cmd+S` 显式保存。服务端用 `revision` 乐观锁拒绝静默覆盖。
10. 发布后产生递增的不可变版本。

选中图片或视频节点后，拖动外框四角或边缘的蓝色缩放控件即可调整节点大小。节点内容会随外框扩展，图片和视频始终保持原始比例，不会被拉伸。

选中图片节点后可打开“编辑图片标注”：点击创建编号点、拖动创建矩形区域，为标注填写标题和说明、保存缩放镜头并关联同一指南中的说明、图片、视频、流程或子指南。标注修改进入同一撤销/保存/发布链路。

### 子指南复用

1. 在另一个画布选择“插入子指南”；弹窗会载入全部已发布指南，输入标题、标签或内容关键词会即时筛选。
2. 引用固定记录 `guideVersionId`；上游再次发布不会改变现有下游。
3. “展开子指南”按确定性命名空间复制节点、连线与步骤，处理坐标和来源追踪，并补齐“引用 → 子指南入口”和“子指南出口 → 原宿主下游”的桥接边。展开时原有“引用 → 下游”连线会暂时隐藏，折叠后按原状态恢复；再次展开幂等。
4. 展开后的内部节点可像普通节点一样连接到宿主画布。折叠时会隐藏引用产生的节点、连线，以及所有触及这些节点的自定义连线；再次展开会恢复它们，不删除数据。

### 学习者

1. 登录学习者账号，按标题、摘要、标签或节点内容检索。
2. 选择“开始学习”，使用按业务阶段分组的步骤列表，或上一步/下一步导航。
3. 当前步骤会聚焦流程节点，显示其“责任 / 系统”提示，并汇总展示该步骤挂靠的 Markdown、图片和视频资料；视频关键点按钮会跳转到对应时间。图片可放大后按编号逐项讲解、手动或自动播放保存的镜头，并从标注打开关联资料；返回会恢复原标注与镜头。未配置泳道的旧版本不会显示责任提示；展开子指南内容仅展示引用节点的责任语境。

### Santexwell 与工作区 Agent

1. `/knowledge/santexwell` 提供全局只读知识门户：查看索引状态、知识入口、搜索 canonical 页面、打开文档片段并建立私有会话。
2. `/workspaces/:workspaceId/sources` 可上传 `.md/.txt`（5 MiB）或 `.pdf/.docx`（20 MiB）资料；列表显示解析状态，引用可重新定位到精确资料和片段。
3. `/workspaces/:workspaceId/agents` 默认优先启用工作区流程与资料，并可选择 Santexwell。Fast Gate 只对严格白名单内、没有 selected context/附件且明确不需要证据的问候、致谢或帮助请求走 `DIRECT`；所有领域自然语言都进入 medium reasoning Router。聚焦问题只安排一个 worker；明确的综合问题最多拆成三个并行 worker，再由不具备检索能力的 Reducer 汇总。
4. 本轮私有附件只属于当前用户、工作区和会话，最多 20 MiB，默认 7 天到期；只有显式勾选的 `READY` 附件能进入本轮上下文。
5. SSE 会先显示公开计划、任务状态和答案草稿，再提交最终答案、引用与产物。草稿只来自 final `ANSWER` 结构化 JSON 顶层 `conclusion` 的增量 decoder；API 不会把 raw JSON、evidence locator、commentary 或 reasoning 转发到公开 SSE。断线通过 `Last-Event-ID` 从持久化事件续传。用户可取消或 steer，旧 `planVersion` 的临时事件会标记 stale 而不会污染新答案。
6. 流程引用覆盖业务节点以及 Markdown、图片、视频资源节点。打开引用时后端重新校验工作区权限、草稿 revision 或发布版本，再返回编辑器/学习页可定位的 `nodeId`；失效引用只返回安全原因，不泄露内部路径。

所有网页角色（包括 `AUTHOR`）对 Agent 都是只读消费者：Agent 不修改指南、Vault、附件、数据库之外的业务数据或外部系统。`FLOW_PROPOSAL` 只是可审阅产物，不会自动应用到画布。

## 7. 键盘与可访问性

- `Ctrl/Cmd+S`：保存
- `Ctrl/Cmd+Z`：撤销
- `Ctrl/Cmd+Shift+Z`：重做
- `Ctrl/Cmd+C`、`Ctrl/Cmd+V`：复制、粘贴选中节点
- `Delete` / `Backspace`：删除选中项（输入框聚焦时不会触发）
- `Ctrl/Cmd` + 点击：多选

主要按钮、端口、搜索、媒体和教学进度提供可访问名称；加载、空、错误、保存和发布状态有明确反馈。窄屏学习模式优先展示当前步骤内容。

## 8. 安全与媒体

- 密码使用随机盐 `scrypt` 哈希，登录签发 8 小时 JWT。
- API 每次读取数据库身份与资源授权；旧 token 不能访问已删除身份。
- Markdown 使用 `react-markdown + remark-gfm + rehype-sanitize`，不执行 HTML/script。
- 图片允许 JPEG/PNG/WebP/GIF，最大 10 MiB；视频允许 MP4/WebM，最大 200 MiB。
- 上传同时校验 MIME 和文件头签名，使用服务端 UUID 文件名；媒体读取需要登录，并返回 `X-Content-Type-Options: nosniff`。
- 不支持 SVG 上传，避免活动内容风险。
- Vault 只索引 allowlist 下的 canonical Markdown；路径必须位于真实 Vault 根目录内，拒绝 symlink、`..`、绝对路径和不稳定读取。Prompt Harness 只来自固定 allowlist，并限制文件数、字节数与行数。
- Runtime Bridge 使用专属 `CODEX_HOME` 所有权标记、精确最小配置、空工作目录、ephemeral thread、`approval_policy=never`、`sandbox_mode=read-only`，禁用 shell、工具/沙箱网络、Web 搜索、MCP、插件、浏览器、计算机控制、图片生成、多 Agent 和个人 skills/memories。Codex app-server 到已配置模型 provider 的传输仍是必需网络边界。
- Router/worker 输出必须通过共享 schema；答案只能引用服务端已检索并在提交前再次授权的 evidence。只有 final `ANSWER` 的结构化输出增量可进入私有 decoder，公开草稿仅包含顶层 `conclusion`；模型生成的路径、raw JSON、引用或 locator 没有权限效力，也不会向前端暴露 commentary/reasoning。
- 会话、运行、附件、引用和产物均按 owner 隔离；跨用户读取统一隐藏为 404。知识 FTS 在 SQL `LIMIT` 前应用 scope、owner、工作区成员及流程可见性过滤；工作区证据还会在检索、提交引用和打开引用三个阶段重新校验成员资格与版本。`FORBIDDEN` 引用只返回通用标题/摘要，不回显此前保存的受保护内容。
- Vault generation 与 Prompt Harness 只有在完整索引发布成功后才一起提升为 last-good；刷新失败保留上一代。API 启动会把重启时遗留在 `ROUTING/RUNNING/VALIDATING` 的运行收口为可重试 `RUNTIME_RESTARTED`，而不是让 SSE 永久悬挂。
- 关闭时 API 会停止派发、取消/等待 Agent 与 Vault refresh，再关闭数据库；Bridge 会先进入拒绝新请求状态，并发关闭 HTTP app 与 Codex runtime，避免关闭窗口继续接收新运行。

## 9. API 概览

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `POST` | `/api/auth/login` | 登录 |
| `GET` | `/api/auth/me` | 恢复会话 |
| `GET/POST` | `/api/guides` | 工作区列表 / 创建指南 |
| `GET/PATCH` | `/api/guides/:id` | 读取 / 乐观锁保存草稿 |
| `POST` | `/api/guides/:id/publish` | 发布不可变版本 |
| `POST` | `/api/guides/:id/collaborators` | 作者授予编辑权限 |
| `GET` | `/api/versions/:id` | 读取发布快照 |
| `GET` | `/api/search?q=` | SQLite FTS5 检索当前发布版本 |
| `POST/GET` | `/api/media`、`/api/media/:id` | 上传 / 鉴权读取媒体 |
| `GET` | `/api/knowledge/santexwell/status`、`overview`、`search`、`documents/:id` | Vault 状态、入口、检索与页面 |
| `GET/POST` | `/api/workspaces/:id/sources` | 工作区资料列表 / 上传并索引 |
| `GET` | `/api/workspaces/:id/flow-snapshots` | 当前可读流程语义快照 |
| `GET/POST` | `/api/knowledge/santexwell/conversations` | 全局私有只读会话 |
| `GET/POST` | `/api/workspaces/:id/conversations` | 工作区私有 Agent 会话 |
| `POST` | `/api/workspaces/:id/conversations/:conversationId/attachments` | 上传 7 天私有附件 |
| `GET` | `/api/agent-runs/:id/events` | 可续传 SSE 事件流 |
| `POST` | `/api/agent-runs/:id/cancel`、`steer` | 取消 / 新计划版本调整方向 |
| `GET` | `/api/workspaces/:id/artifacts` | 当前用户的工作区产物 |
| `GET` | `/api/references/:referenceId` | 重新授权并解析不透明引用 |

## 10. 数据检查

机器安装了 `sqlite3` 时，可直接检查：

```bash
sqlite3 data/guideanything.sqlite \
  "SELECT id,title,status,revision,published_version_id FROM guides ORDER BY updated_at DESC;"

sqlite3 data/guideanything.sqlite \
  "SELECT guide_id,version,title,published_at FROM guide_versions ORDER BY published_at DESC;"

sqlite3 data/guideanything.sqlite \
  "SELECT title FROM guide_search WHERE guide_search MATCH '\"销售订单\"*';"

sqlite3 data/guideanything.sqlite \
  "SELECT scope,kind,status,revision,updated_at FROM knowledge_sources ORDER BY updated_at DESC;"

sqlite3 data/guideanything.sqlite \
  "SELECT id,conversation_id,route,status,plan_version,error_code FROM agent_runs ORDER BY created_at DESC LIMIT 20;"

sqlite3 data/guideanything.sqlite \
  "SELECT run_id,sequence,plan_version,phase,type,stale FROM agent_run_events ORDER BY rowid DESC LIMIT 50;"

sqlite3 data/guideanything.sqlite \
  "SELECT kind,title,run_id,created_at FROM artifacts ORDER BY created_at DESC LIMIT 20;"

sqlite3 data/guideanything.sqlite \
  "SELECT original_name,status,expires_at FROM conversation_attachments ORDER BY created_at DESC LIMIT 20;"
```

没有 `sqlite3` CLI 时可运行 `pnpm db:seed`，命令会打印用户、指南和版本数量。

## 11. 设计与验收资料

- [产品体验原则](PRODUCT.md)
- [视觉设计系统](DESIGN.md)
- [产品需求](docs/PRD.md)
- [架构说明](docs/ARCHITECTURE.md)
- [数据模型](docs/DATA_MODEL.md)
- [验收清单](docs/ACCEPTANCE.md)
- [实施计划](docs/superpowers/plans/2026-07-11-guideanything.md)
