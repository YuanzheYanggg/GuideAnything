# GuideAnything

GuideAnything 是一个前后端分离的多用户、多模态 ERP 在线教学工具。作者先按可命名的业务阶段梳理主流程，再用角色与系统混合泳道明确分工，把 Markdown、图片和视频资料挂靠到对应步骤；学习者从资料库检索已发布指南，并按业务阶段、步骤、责任和资料逐步学习。

当前仓库包含一条可本地演示的完整纵向链路：创建与保存 → 发布不可变版本 → 全文检索 → 插入子指南 → 展开/折叠 → 学习模式。

## 1. 环境要求

- macOS 或 Linux
- Node.js 24.12 或更高版本
- pnpm 10 或更高版本

本项目使用 Node 内置 `node:sqlite`。Node 24.12 会打印一次 `ExperimentalWarning`，不影响功能；Node 24.15 及之后该模块进入 RC 阶段。

## 2. 快速启动

```bash
cp .env.example .env
pnpm install
pnpm db:reset
pnpm dev
```

启动后访问：

- Web：<http://127.0.0.1:5173>
- API 健康检查：<http://127.0.0.1:3001/api/health>
- SQLite：`data/guideanything.sqlite`
- 上传目录：`data/uploads/`

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
# 同时启动 Web 与 API
pnpm dev

# 全量验证
pnpm lint
pnpm typecheck
pnpm test
pnpm build

# 单独验证
pnpm --filter @guideanything/api test
pnpm --filter @guideanything/web test
pnpm --filter @guideanything/canvas-core test

# 数据库
pnpm db:migrate
pnpm db:seed
pnpm db:reset
```

## 5. 目录与边界

```text
apps/
  api/                  Fastify REST API、SQLite、鉴权、搜索、媒体
  web/                  React/Vite 资料库、编辑器、学习模式
packages/
  contracts/            Zod 画布协议与共享 DTO
  canvas-core/          历史栈、复制、布局、子指南展开/折叠纯算法
docs/
  PRD.md                中文产品需求
  ARCHITECTURE.md       架构与性能/安全策略
  DATA_MODEL.md         关系模型与画布协议
  ACCEPTANCE.md         分阶段验收清单
  PROGRESS.md           当前证据与未完成项
data/
  guideanything.sqlite  本地数据库（不提交）
  uploads/              本地媒体（不提交）
```

Web 只通过 `/api` 访问后端；开发时 Vite 代理到 `127.0.0.1:3001`。共享 contracts 在写入 API 和画布保存前都校验数据。

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

## 10. 数据检查

机器安装了 `sqlite3` 时，可直接检查：

```bash
sqlite3 data/guideanything.sqlite \
  "SELECT id,title,status,revision,published_version_id FROM guides ORDER BY updated_at DESC;"

sqlite3 data/guideanything.sqlite \
  "SELECT guide_id,version,title,published_at FROM guide_versions ORDER BY published_at DESC;"

sqlite3 data/guideanything.sqlite \
  "SELECT title FROM guide_search WHERE guide_search MATCH '\"销售订单\"*';"
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
