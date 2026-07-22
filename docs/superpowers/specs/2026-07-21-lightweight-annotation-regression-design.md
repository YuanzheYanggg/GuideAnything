# 轻量图片标注回归与精确引用设计

> 日期：2026-07-21
>
> 状态：方案已确认，待实现前审阅
> 范围：图片标注的精确引用、可审计检索诊断，以及低维护成本的流程回归题

## 1. 目标与非目标

GuideAnything 已将图片标注投影为可检索的流程知识叶子。下一步的目标不是建立一套需要人工维护的大型测试题库，而是让每一个标注自动具备健康检查，并让编辑者能把少量真实、高价值的问题一键固定为长期回归题。

本设计达成四件事：

1. Agent 的流程引用可以定位到具体图片标注，而不只定位到整张图片资源。
2. 每个图片标注在保存、发布或索引重建后都自动接受结构与检索健康检查。
3. `OWNER` / `EDIT` 可以把一次真实问答中的单个标注引用一键固定为回归题，无需填写标准答案或维护测试脚本。
4. 只有失败、部分回答、手动诊断或固定回归题时才保存精简检索 trace；不记录模型隐藏推理，也不为每次正常问答积累调试数据。

本期不做：

- 不要求作者为每个节点或标注人工编写问题。
- 不引入 embedding、向量库、无限 Top-K 或全图扫描。
- 不在每次保存时调用真实模型。
- 不把 QA 数据写入 `CanvasDocument`、`FlowKnowledgeSnapshotV2` 或普通 `knowledge_*` 检索表。
- 不保存模型思维链、未授权原始会话内容或完整证据正文到诊断表。
- 不建设独立的大型 QA 管理后台。

## 2. 已确认的边界

`CanvasDocument` 与 `GuideVersion` 仍是流程事实的唯一权威源；`FlowKnowledgeSnapshotV2` 是某个 revision 的不可编辑派生事实图。图片标注、图片资源、`USES_RESOURCE`、`RESOURCE_REFERENCE` 与学习路径均由快照表达。

本设计新增的是两个独立的派生/审计域：

```text
CanvasDocument / GuideVersion
  -> FlowKnowledgeSnapshotV2
     -> knowledge_fragments（概览、节点、资源、标注叶子）
     -> 自动健康检查（不持久化题库）

OWNER / EDIT 显式固定的真实问题
  -> workspace_flow_regression_cases（不进入普通检索）
  -> 可选 retrieval trace（不含隐藏推理）
```

Snapshot 不保存 Golden Questions；回归题也不成为 Agent 的事实来源。这样测试资产不会污染流程事实或普通问答检索。

## 3. 方案选择

| 方案 | 维护方式 | 问题 |
| --- | --- | --- |
| 每个节点/标注人工维护多条题目 | 作者维护题库与预期回答 | 成本随标注数量增长，内容改动后极易失效 |
| 完全自动生成题目 | 系统只生成字段标题检索 | 只能证明结构和字面召回，覆盖不了真实口语、组合条件与真实缺口 |
| 自动健康检查 + 一键固定真实问题 | 系统覆盖全部对象；编辑者只固定少数真实问题 | 兼顾覆盖与维护成本；本设计采用 |

## 4. 稳定身份与精确引用

### 4.1 标注目标

图片标注的稳定目标由以下组合表示：

```ts
type FlowAnnotationTarget = {
  guideId: string;
  resourceNodeId: string;
  annotationId: string;
};
```

`resourceNodeId` 是流程快照中图片资源的 locator node ID；`annotationId` 是该图片内的标注 ID。不能只使用标题，因为同一流程中可以存在多个“备注”“说明”等重名标注。

### 4.2 公共引用

`WORKSPACE_FLOW` locator 增加可选的、安全的 `annotationId`。服务端只会在以下条件同时成立时输出它：

- 当前证据片段是 `IMAGE_ANNOTATION`；
- 图片资源、标注和当前 snapshot 的关系可由服务端重新验证；
- 当前用户仍有读取该 draft 或 published snapshot 的权限。

引用解析继续以不透明 `referenceId` 为入口。解析后的页面地址带受服务端验证的查询参数：

```text
.../learn?nodeId=<image-resource-id>&annotationId=<annotation-id>
```

学习页或编辑页收到该参数后打开对应图片、聚焦并高亮该标注。未知、已删除或不属于该图片的 `annotationId` 不得被接受或回显。

这让一条引用、一个回归题和一个索引叶子共享同一业务身份：

```text
annotationId
  ├─ 索引叶子身份
  ├─ 精确引用导航
  ├─ 自动健康检查目标
  └─ 固定回归题目标
```

## 5. 自动健康检查：覆盖全部对象，零人工维护

自动检查不是用户可见的题库。每个当前、可读的流程 snapshot 完成索引后，系统在进程内生成短暂的检查项，不保存这些合成问题。

### 5.1 每个图片标注的检查

每个标注必须满足：

1. 存在一个 `IMAGE_ANNOTATION` fragment，且其内部 locator 的 `annotationId` 与资源 ID 匹配。
2. 叶子文本包含标注标题、资料标题和可解析的所属节点语境。
3. 标注的合成查询能够在既定候选预算内拿到该叶子，且该叶子优先于泛化的流程概览或图片摘要。
4. 叶子闭包能够补足所属节点和流程结构索引，不跨越当前 snapshot 或权限边界。
5. 若引用被创建，引用解析能返回该标注的安全深链接。

合成查询按标题是否在同一 guide 内重复而定：

```text
唯一标题：<标注标题> 怎么设置？
重名标题：<所属节点标题> 中的 <标注标题> 是什么？
```

这些检查只验证确定性的索引与检索行为，不调用真实模型。

### 5.2 每个流程节点的检查

每个节点继续使用现有的 snapshot / relation / revision / authorization 校验。新增的标注检查不把资源当成业务节点，也不允许资源摘要触发全图扩展。

### 5.3 结果

自动检查只有异常时才形成可见诊断，例如：

- `ANNOTATION_LEAF_MISSING`
- `ANNOTATION_TARGET_MISMATCH`
- `ANNOTATION_NOT_RANKED`
- `ANNOTATION_CONTEXT_MISSING`
- `ANNOTATION_REFERENCE_INVALID`

正常通过不新增数据库记录，不给作者增加待办。

## 6. 一键固定真实回归题

### 6.1 创建入口与权限

只有 `OWNER` / `EDIT` 可以使用“固定为回归题”。入口放在已验证的图片标注引用附近，而不是普通聊天输入框中。

点击后使用当前问题和当前选中的标注引用预填；编辑者只需确认，不需要撰写预期答案。若同一回答引用多个标注，入口位于每条引用旁，因此一次固定一个明确目标。

### 6.2 最小持久化模型

新增独立表 `workspace_flow_regression_cases`，其概念字段为：

```ts
type WorkspaceFlowRegressionCase = {
  id: string;
  workspaceId: string;
  guideId: string;
  resourceNodeId: string;
  annotationId: string;
  question: string;
  expectedAgentStatus: 'SUPPORTED' | 'PARTIAL';
  status: 'ACTIVE' | 'NEEDS_REVIEW' | 'ARCHIVED';
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  lastVerifiedSnapshotId?: string;
  lastRetrievalVerification?: 'PASS' | 'FAIL' | 'NEEDS_REVIEW';
  lastAgentVerification?: 'PASS' | 'FAIL' | 'NEEDS_REVIEW';
};
```

不存储：模型标准答案、模型隐藏推理、当前 fragment ID、整个证据正文或用户未明确固定的原始问题。

回归题绑定 `resourceNodeId + annotationId`，而不是 `fragmentId`。索引重建和 snapshot version 改变可以更换 fragment ID；若标注被删除、移到另一图片或不再属于当前 guide，则 case 自动转为 `NEEDS_REVIEW`。

### 6.3 预期语义

回归题只断言可审计行为：

- 回答必须引用目标标注；
- 目标标注必须出现在确定性候选证据中；
- 目标标注的所属节点与受限结构闭包必须可用；
- 最终状态必须与 `SUPPORTED` 或 `PARTIAL` 匹配；
- 不能用无关流程概览替代目标叶子。

不比较模型的逐字回复。确定性复跑只验证目标叶子、闭包和引用是否存在；它不会假装能够判断模型的最终状态。`expectedAgentStatus` 只在编辑者显式发起“真实试跑”时检查。若现有证据只能回答一部分，`PARTIAL` 是正确结果；只有完全没有授权证据时才应为 `INSUFFICIENT`，该类缺口题暂不作为第一版可固定目标。

### 6.4 轻量维护规则

- 不设“每个标注必须固定几题”的要求。
- 一个重要流程建议先固定约 4–8 个真实问题；这是建议而不是数据库限制。
- 新问题优先来自真实聊天，而不是人工臆造。
- 标注更新后，系统重新跑确定性检查；只有目标丢失、召回退化或证据状态变化才提示编辑者复核。
- 初版在 Guide 编辑页提供小型“回归题（N）”列表，仅显示问题、目标标注、最近结果、复跑和归档；不新增独立 QA 后台。

## 7. 精简 retrieval trace

### 7.1 触发条件

诊断只在以下条件创建：

1. Agent 最终状态为 `PARTIAL`、`INSUFFICIENT` 或 `CONFLICTING`；
2. 编辑者主动点击“为什么没答出来”；
3. 编辑者固定或复跑一个回归题。

完全正常、未固定的成功问答不持久化 trace。

### 7.2 内容与隐私

新增独立的 `agent_retrieval_diagnostics` 记录。每条记录只保存确定性、最小信息：

- run / task / workspace / guide 标识；
- 查询规范化指纹，而不是额外复制原问题全文；
- 目标 annotation ID（若有）；
- 候选 fragment ID、投影类型、排序位置、是否被预算或权限排除；
- 叶子闭包追加的资源、节点和关系类型；
- 失败分类与时间。

不保存模型隐藏推理、模型原始 token 流、凭据、绝对路径或额外的原始证据正文。诊断默认保留 30 天，由插入时的惰性清理删除过期项。需要查看原问题时，仍通过既有会话权限读取原会话，而不是从诊断表回放。

### 7.3 失败分类

诊断原因使用有限枚举，便于聚合：

- `NO_TARGET_LEAF`
- `TARGET_NOT_RANKED`
- `CONTEXT_NOT_CLOSED`
- `BUDGET_EXHAUSTED`
- `REFERENCE_NOT_RESOLVABLE`
- `MODEL_STATUS_MISMATCH`
- `TARGET_REMOVED`

## 8. 执行与成本控制

| 动作 | 触发时机 | 是否调用模型 | 成本 |
| --- | --- | ---: | --- |
| 全量标注结构检查 | 保存、发布、索引重建 | 否 | 与标注数量线性，轻量 |
| 已固定题的确定性检索复跑 | 目标 guide 更新或手动复跑 | 否 | 仅少量固定题 |
| 已固定题的真实 Agent 试跑 | 编辑者显式点击“真实试跑” | 是 | 显式、可控 |

真实模型试跑不阻塞保存或发布，也不作为普通文档编辑的硬门槛。确定性检查发现结构断裂时，可以阻止错误索引被标记为健康，但不自动修改流程内容。

## 9. UI 交互

### 9.1 引用深链接

用户点击 Agent 回答中的图片标注引用后：

1. 服务端验证引用、snapshot、当前权限和 `annotationId`。
2. 前端打开对应 published learn 页或有权限的 draft edit 页。
3. 图片自动进入可见区域并高亮目标标注。
4. 若标注已失效，展示安全的“引用已失效”状态，不猜测替代标注。

### 9.2 固定回归题

对 `OWNER` / `EDIT`：

1. 在图片标注引用旁点击“固定为回归题”。
2. 弹出一行确认：问题、目标标注、当前证据状态。
3. 确认后写入 case，并立刻运行一次确定性验证。
4. 在 Guide 编辑页的“回归题（N）”小列表中显示结果；可复跑或归档。

普通成员看不到固定与列表入口，但仍可正常使用引用深链接。

## 10. 错误与安全行为

- 任一 citation / locator / annotation 关系不再可由当前 snapshot 验证时，引用必须失效，不可跳转到同名标注。
- draft revision 变化、published version 失效、工作区权限撤销时，回归题和引用都按现有授权规则重新验证。
- 删除目标标注不会删除回归题；case 标记为 `NEEDS_REVIEW`，由编辑者归档或重新固定。
- 回归题与 trace 不进入 `knowledge_sources`、`knowledge_documents`、`knowledge_fragments`，因此不会成为普通 Agent 的隐式事实。
- 编辑者只能固定自己有权读取的当前回答及其证据；固定操作须记录创建者和时间。

## 11. 验收与验证

### 自动结构验证

- 每个图片标注都生成独立 leaf；leaf 与 `resourceNodeId + annotationId` 一一对应。
- 合成标题查询优先命中目标 leaf，并在预算内得到所属节点和结构概览。
- 旧 snapshot、重名标注、删除标注、断开资源、权限撤销和 revision 变化都不能产生错误定位。

### 回归题验证

- `OWNER` / `EDIT` 能从一个图片标注引用创建 case；普通成员不能创建或枚举 case。
- case 不存 fragment ID 和答案全文；索引重建后仍能用稳定 target 重跑。
- 删除目标时 case 变为 `NEEDS_REVIEW`；不自动绑定同名新标注。
- 确定性复跑验证 target evidence 与上下文闭包；显式真实试跑才验证预期 Agent 状态，二者都不比较自由文本答案。

### 引用与前端验证

- 精确标注引用解析为合法、安全的深链接。
- 打开链接后目标标注可见、高亮，且不会因错误参数定位到其他标注。
- draft / published、权限撤销和引用过期均展示受控失效状态。

### 真实运行验收

以“版类型”为首个固定题：真实 Bridge 回答必须引用其图片标注叶子并给出 `SUPPORTED`。以“紧急度等级”为首个缺口观察题：若流程事实没有等级枚举，结果必须是范围明确的 `PARTIAL` 或 `INSUFFICIENT`，不能编造等级。
