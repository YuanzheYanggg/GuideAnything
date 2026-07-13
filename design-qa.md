# GuideAnything 知识工作台 V1 设计 QA

## 最终产品表面

V1 已从单一指南库扩展为桌面知识工作台。当前 Shell 提供真实 URL 和 API 数据：

- 全局：`/library`、`/favorites`、`/recent`、`/shared`、`/trash`、`/workspaces`。
- 工作区：`/workspaces/:workspaceId`、`/guides`、`/sources`、`/agents`、`/ontology`、`/artifacts`。
- 指南：`/guides/:guideId/edit` 和 `/versions/:versionId/learn`，可携带安全的工作区 `returnTo` 上下文。

当前只有 GUIDE 是已实现领域资源。资料源、Agent、Ontology 和会话与产物页显示“尚未配置/建立/产生”，并明确声明不连接运行时、不同步资料、不生成模拟数据。

## 视觉基线与证据

- 验收视口：`1440 × 1024` CSS px（desktop-only）。
- 深色证据：`.playwright-cli/task-9-shared-dark-1440x1024.png`。
- 浅色证据：`.playwright-cli/task-9-shared-light-1440x1024.png`。
- 宽度检查：深色和浅色下 `body.scrollWidth = window.innerWidth = 1440`，无水平阻断性溢出。

深浅色都保留现有的 CSS 彩色渐变、毛玻璃顶栏/侧栏、蓝色交互强调和工作区领域色。通用资源表的标题、工作区、类型、更新时间和操作层级在两种外观下均可读。

## 真实交互验收

Playwright CLI 使用独立的本地 QA 数据库和真实 Web/API 完成以下操作：

1. 作者从 `/workspaces/workspace-materials` 查看物料管理概览和真实活动。
2. 作者在物料管理工作区内新建指南，进入编辑器，再返回工作区限定的指南库；新草稿显示归属“物料管理”。
3. 收藏新草稿后在 `/favorites` 可见，刷新后仍保留。
4. 打开该草稿后 `/recent` 显示一条统一资源记录，没有重复行。
5. 将草稿移入 `/trash` 后，收藏/最近的默认列表不再显示；恢复后回收站归零，工作区活动显示回收与恢复事件。
6. 编辑者账号的 `/shared` 只显示显式协作的“ERP 销售订单创建”，可学习/收藏，不显示资源生命周期菜单。
7. 实际打开 Source、Agent、Ontology 和 Artifact 四个预留页，均只有解释性空状态和返回链接，没有聊天框、同步按钮或假结果。
8. 在编辑者共享列表切换深色/浅色并采集最终截图；浏览器 console 统计为 `Errors: 0, Warnings: 0`。

## 权限与边界 QA

- 工作区概览按成员权限决定是否显示“新建指南”。
- 个人视图操作使用 API 返回的 `permission`/`canManageLifecycle`，实际授权仍由服务端执行。
- 从工作区创建时保留 `workspaceId`；从编辑器/学习页返回时只接受站内绝对路径。
- 共享、收藏、最近和回收均使用真实持久化数据，而不是前端 fixture。
- Adapter 仅是共享契约；本轮 QA 没有启动 Codex CLI、执行命令、同步资料或构建 Ontology。

## 环境说明与最终结果

默认 `3001` 在验收时属于另一个 FactoryWeb 进程；本次没有终止或复用它，而是将 GuideAnything API 隔离在 `3002`，Web 仍使用 `5173`。QA 结束后两个 GuideAnything 临时进程均已停止，临时 Vite proxy 调整已撤回。

final result: passed
