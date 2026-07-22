# GuideAnything 远端 main 版本差异报告

> 生成日期：2026-07-17（Asia/Tokyo）<br>
> 比较范围：推送前远端 `main` 的 `ce0b5c5` 至当前远端 `main` 的 `5491f2b`

## 范围与统计

| 项目 | 结果 |
| --- | --- |
| 基线提交 | `ce0b5c57f2d17327d50378477d810fcf16438220` |
| 当前提交 | `5491f2b69d5060c38c6eabc80f2009225bd8af02` |
| 提交数量 | 78 |
| 文件改动 | 220 个文件，`+46,995 / -510` |
| Git tag | 本范围内没有发布 tag；本报告按版本区间整理 |
| 完整提交对比 | [GitHub Compare](https://github.com/YuanzheYanggg/GuideAnything/compare/ce0b5c5...5491f2b) |

提交类型：36 个 `feat`、24 个 `fix`、7 个 `merge`、7 个 `docs`、1 个 `test`，以及 3 个历史格式为 `Merge ...` 的合并提交。

## 面向用户的版本改动

### 1. 画布编辑、连线与教学内容

- 修复自动整理后画布位置与媒体交互丢失的问题，保持最新编辑结果可保存。
- 将连线升级为持久化锚点和正交路由，支持回流、避障、并行通道、标签与样式。
- 支持双击编辑节点内容和连线标注，并完善节点详情、删除和层级操作。
- 新增图片标注编辑、标注关联目标、学习页图片讲解、媒体灯箱与视频/资料预览。
- 新增手动拖拽调整连线段；不改变连线起点、终点即可改变走向。
- Markdown、图片、视频资料改用真实画布边引用，可被多个业务节点重复引用；资料边可选中、删改、重连、调整样式和手动走线。
- 拖线落在已有连线的命中区域时仍可打开“创建下一项”菜单，避免因落点 DOM 不同而表现不一致。

关键提交：`81c8a6b`、`e9d1f40`、`60e5836`、`57d889f`、`09b57cc`、`5491f2b`。

### 2. Santexwell 知识库与 Codex Agent Runtime

- 新增独立 Runtime Bridge，用于与隔离的 Codex runtime 通信，并支持流式 NDJSON 输出、结构化答案和安全关闭。
- 新增知识源、Vault 索引、流程知识快照与证据约束的检索/问答编排。
- 新增 Agent 路由策略、Fast Gate、运行计划、并发 worker、验证、重试、取消与 steer 机制。
- 新增公共/私有会话流、回答草稿、最终答案、引用、产物和精确节点跳转。
- 增强授权、隐私、失败关闭和运行时恢复：工作区权限、owner 隔离、附件过期、重启后的 orphan run 收口等。
- 新增 Santexwell 门户、工作区资料源和相关前端页面。

关键提交：`d05224d`、`7149982`、`26d6709`、`d1bcebd`、`60d764b`、`9960ebe`、`12e27ea`。

### 3. 对话附件、产物与安全引用

- 新增私有会话附件的上传、存储、鉴权与前端控制。
- 新增对话产物保存和查看页面。
- 引用解析改为安全、可授权的资源引用，避免将内部路径或无权限资料暴露给用户。
- 修正引用目标到产品路由的映射，以及运行时重启时的会话状态隔离。

关键提交：`a6d2250`、`5ecc2c2`、`2b6f359`、`8c8865f`、`47a5c8e`、`ba3f095`。

### 4. Workspace 知识演进工作台

- 新增编辑态知识数据模型及数据库迁移。
- 新增问题缺口记录、工作区查询包和编辑专用 API。
- 新增流程提案的类型化操作与持久化。
- 新增 Workspace Knowledge Evolution 工作台，用于汇总、编辑和演进工作区知识。

关键提交：`dcc457f`、`6302cfa`、`732bedb`、`3b8ef87`、`6cbb3ef`、`0b5215f`。

### 5. 数据库、契约、文档与工程基础

- 新增数据库迁移：
  - `0003_santexwell_agent_runtime.sql`
  - `0004_agent_run_steers.sql`
  - `0005_workspace_editorial_knowledge.sql`
- 扩充 `contracts` 与 `canvas-core`：Agent Runtime、Conversation API、Knowledge、Flow Knowledge、Workspace Editorial、手动路由与画布边展示协议。
- 新增 Runtime Bridge package，并更新依赖锁文件、环境示例、README、架构、数据模型、PRD、验收和进度文档。

## 变更影响面

| 区域 | 变更文件数 |
| --- | ---: |
| `apps/api` | 78 |
| `apps/web` | 72 |
| `docs/superpowers` | 17 |
| `apps/runtime-bridge` | 15 |
| `packages/contracts` | 14 |
| `packages/canvas-core` | 14 |

## 主要合并节点

| 提交 | 内容 |
| --- | --- |
| `3db01ad` | 合并画布路由与保存可靠性修复 |
| `b5cf41f` | 合并自动画布布局稳定性修复 |
| `12e27ea` | 合并 Santexwell Agent Runtime |
| `97d4cb6` | 集成画布详情优化 |
| `3197676` | 合并画布连线路由交互优化 |
| `bf9b122` | 合并路由连线重连句柄对齐 |

## 验证与远端状态

- 当前 `origin/main` 已解析为 `5491f2b69d5060c38c6eabc80f2009225bd8af02`，与本地 `main` 一致。
- 本次最后一个画布提交的验证包括：Web 246 项测试、contracts 85 项测试、canvas-core 80 项测试、Web 类型检查与生产构建。
- 本报告仅记录 `ce0b5c5..5491f2b` 的代码历史和推送结果，不替代每个历史提交当时的独立验收记录。
