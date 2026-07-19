# 指南摘要残差连续性设计

## 目标

让同一指南的后续结构化摘要生成能够复用上一次可信摘要的理解，并通过上次摘要基准快照到当前快照的结构化累计 diff 突出真正发生的变化。当前完整快照继续作为唯一事实依据，残差上下文用于提高跨版本一致性，尤其避免未修改业务内容时标签候选不断变细或新增。

## 已确认语义

- “上一次”指同一指南上一次成功生成且仍可信的结构化摘要提案，不是紧邻的指南 revision。
- 上一次摘要可能基于较早的 revision；系统直接比较上次摘要的 base snapshot 与当前 snapshot，不逐个重放中间 revision。
- `DRAFT`、`APPLIED` 和 `STALE` 提案可以作为连续性基线。
- `REJECTED` 表示理解错误或改动错误，绝不能作为基线或提示上下文。
- `FAILED` 没有有效结构化摘要，也绝不能作为基线。
- diff 是相对原有全量快照输入的额外上下文，不增加任何显式 attention 参数，也不声称修改模型内部注意力权重。
- 新功能复用现有不可变 `guide_digest_proposals` 与 `flow_knowledge_snapshots` 历史，不新增摘要历史表。

## 方案选择

每次需要调用模型生成摘要时，服务端仍提供当前完整 `FlowKnowledgeSnapshotV2` 和当前 ID manifest。在存在可信基线时，再提供上一次 `GuideDigestDraftV1` 与两个快照之间的结构化累计 diff。

选择这一方案而不是 residual-only 输入，原因是当前完整快照能够继续承担事实完整性、安全校验和遗漏恢复；选择它而不是单纯重复全量生成，原因是显式 diff 和上一份结构化输出能向模型提供连续上下文，并允许服务端约束无依据的标签漂移。

连续性上下文只是优化层。任何历史读取、兼容性、请求预算或验证问题都必须安全降级到现有全量生成路径，不得阻止本来可以成功的摘要生成。

## 基线选择

生成开始前，从同一 `guide_id` 的提案历史中选择最新的一条符合以下条件的记录：

1. `draft_json` 和 `markdown` 均存在并能通过当前读取契约解析；
2. 状态属于 `DRAFT`、`APPLIED` 或 `STALE`；
3. `base_snapshot_id` 仍能读取为同一指南、同一工作区的不可变 V2 draft snapshot；
4. 该提案不是本次即将复用并直接返回的当前幂等 DRAFT。

候选按 `created_at DESC, id DESC` 选择。查询必须在服务端限定 `guide_id` 和 `workspace_id`，不能跨指南或跨工作区读取历史。

以下记录始终排除：

- `REJECTED`；
- `FAILED`；
- 缺失或无法解析 `draft_json` 的记录；
- 缺失、损坏、作用域不一致或不是 V2 draft 的 base snapshot。

如果没有符合条件的基线，使用现有全量生成路径。

## 结构化累计 diff

新增一个纯函数模块，直接比较基线 `FlowKnowledgeSnapshotV2` 与当前 `FlowKnowledgeSnapshotV2`，输出版本化的 `GuideDigestSnapshotDiffV1`。diff 不依赖中间 revision 是否存在，因此上次摘要基于 revision 181、当前为 revision 186 时，计算的是 `snapshot@181 -> snapshot@186`。

diff 包含：

- `fromSnapshotId`、`fromRevision`、`toSnapshotId`、`toRevision`；
- 标题、摘要和标签的 before/after 元数据变化；
- stages、lanes、nodes、resources、relations、learningPath 的 `added`、`removed`、`updated`；
- IMAGE annotations 与 supplemental images 的增删改；
- VIDEO keypoints 的增删改；
- 每个 updated 项的 before/after 完整结构，不生成难以恢复上下文的文本 patch；
- `affectedSourceIds`，供提示和标签稳定性验证使用。

集合按稳定 ID 比较；数组顺序具有业务语义时，顺序变化也记为 updated。比较前使用现有 V2 schema 解析和 normalize 流程，不接受未校验 JSON。

`affectedSourceIds` 至少包括：

- 所有新增、删除或更新实体自身的 ID；
- 关系变化涉及的 source node、target node 和 resource；
- annotation、supplemental image 或 keypoint 变化涉及的父 resource；
- stage 或 lane 变化直接涉及的节点；
- learning step 变化涉及的 target node。

该闭包让“关联变化”能够触发相关摘要步骤和标签的重新评估，而不是只关注发生文本变化的叶子对象。

## 模型输入

全量模式保持现有输入：

```text
trusted instruction
current snapshot
current idManifest
truncation metadata
```

连续模式增加可选上下文：

```text
trusted instruction
continuity.previousDigest
continuity.snapshotDiff
current snapshot
current idManifest
truncation metadata
```

可信指令明确说明：

- 当前 snapshot 是唯一事实依据；
- previousDigest 是上一次模型输出，不是新的事实来源；
- snapshotDiff 只用于定位相对变化，不得覆盖当前 snapshot；
- 保留未受影响且仍由当前 snapshot 支持的结构化内容；
- 重新评估 added、updated、removed 和 affected 来源；
- 删除当前 snapshot 已不存在的步骤、规则和引用；
- 不得因为未变化内容而制造新的标签候选。

continuity envelope 进入现有序列化字节预算检查。若加入 continuity 后超过安全预算，但当前全量输入本身仍在预算内，则自动丢弃 continuity 并使用全量模式；不能把可降级的 continuity 过大报告成生成失败。

## 标签稳定性

首次没有可信基线时，提示要求模型一次性给出完整、可追溯且粒度一致的高置信标签集合，覆盖适用的 DOMAIN、PROCESS、SYSTEM、OBJECT、ROLE 和 RISK 类别；不要求凑固定数量，也不允许低价值字段堆砌。

存在可信基线时，服务端以标签的 NFKC、trim 和不区分大小写形式比较上一份 `tagSuggestions`、当前已有标签和新输出：

- 上次未接受且所有来源均未受影响的候选必须保持；
- 已经进入当前 `snapshot.tags` 的候选不再作为 suggestion 返回；
- 来源被删除或属于 `affectedSourceIds` 的旧候选允许被修改或移除；
- 新标签如果不在上次候选或当前标签中，至少一个 `sourceId` 必须属于 `affectedSourceIds`；
- 当累计 diff 只有摘要或标签元数据变化、没有业务结构或资料变化时，不能从未变化来源新增标签。

服务端为违反连续性规则的模型输出提供一次有针对性的 schema repair；第二次仍失败时按现有安全失败提案路径处理，不持久化不稳定 DRAFT。

这组规则直接阻止以下现象：第一次建议“原料、打样”，接受后业务内容未变，第二次却从相同节点和标注中突然新增“供应商、机型、版类型、希望日期”等候选。

## 生成、复用与历史状态

- 非 regenerate 请求仍优先复用当前 identity 的幂等 DRAFT，不调用 runtime。
- 显式 regenerate 可以把即将被 supersede 的可信 DRAFT 作为上一份摘要基线。
- 指南 revision 变化后的新生成使用最近可信历史提案及其 base snapshot 计算累计 diff。
- 提案被拒绝后，后续生成跳过该提案，回看更早的最新可信提案；如果没有更早可信提案则走全量模式。
- 新提案仍保存完整 `draft_json`、Markdown、base snapshot identity 和 audit，不把 diff 作为新的事实表持久化。

generation metadata 增加非敏感诊断字段，用于验证和成本分析：

- `continuityMode`: `FULL` 或 `RESIDUAL_CONTEXT`；
- `baselineProposalId`：仅在连续模式存在；
- `baselineRevision`：仅在连续模式存在；
- `changedSourceCount`；
- `continuityFallbackReason`：仅在发生安全降级时存在。

这些字段只记录 identity、数量和安全枚举，不写入快照正文、摘要正文、diff 正文或 runtime 内部标识。

## 安全与正确性边界

- previousDigest 和历史 snapshot 与当前 snapshot 一样作为不可信数据封装，不能改变 trusted instruction。
- 模型输出继续使用 `GuideDigestDraftV1Schema` 做严格结构验证。
- 所有 stage、target、resource 和 source ID 继续对当前 snapshot 的 current ID manifest 校验。
- Markdown 继续由服务端根据已验证 draft 与当前 snapshot 渲染；不接受模型 Markdown。
- continuity 不能放宽现有结构 gaps、资源关联、阶段归属或标签重复校验。
- 当前 snapshot 在生成过程中发生变化时，继续使用现有 snapshot identity 检查拒绝落库。
- 历史作用域错误、损坏或缺失只触发全量回退，不向用户泄露历史内容或内部错误。

## 组件边界

建议新增：

- `apps/api/src/modules/guides/digest-continuity.ts`
  - 基线选择；
  - snapshot direct diff；
  - affected source closure；
  - 标签连续性验证；
  - 无数据库写入的纯逻辑尽量保持为可独立测试函数。

修改：

- `apps/api/src/modules/guides/digest-repository.ts`
  - 提供按 guide/workspace 读取最新可信基线的窄查询。
- `apps/api/src/modules/guides/digest-service.ts`
  - 加载 continuity、选择 full/residual-context 请求、处理预算回退和记录 metadata。
- `apps/api/src/modules/agents/bundles/guide-digest.ts`
  - 扩展输入 envelope 和 trusted instruction，不改变模型输出 schema。
- 对应 API、bundle、renderer/continuity 单元测试。

不修改当前正在开发的草稿历史 UI/API，不复用其面向用户的短文本 `changeSummary` 作为模型 diff。面向模型的 diff 必须保留结构化 before/after、稳定 ID 和关联闭包。

## 错误处理与回退

- 无可信基线：`FULL`。
- 基线 snapshot 缺失、损坏或作用域不一致：`FULL`。
- continuity envelope 超预算但 full envelope 可用：`FULL`，记录安全 fallback reason。
- full envelope 也超预算：维持现有 `GUIDE_DIGEST_INPUT_TOO_LARGE` 行为。
- residual-context 输出未通过来源或连续性验证：使用同一 current snapshot 做一次定向 repair。
- repair 仍失败：保存现有安全 FAILED 提案与允许的 failure code，不保存模型正文。
- 生成期间 current snapshot identity 改变：维持现有拒绝落库行为。

## 验证方案

测试必须覆盖：

1. 基线查询跳过 `REJECTED` 和 `FAILED`，接受最新有效 `DRAFT`、`APPLIED` 或 `STALE`，且不跨 guide/workspace。
2. revision 181 到 186 的 direct diff 不依赖 182 至 185 的 snapshot 是否存在。
3. 每种实体的 added、removed、updated 和 affected source closure 正确。
4. 当前 snapshot 与基线相同或只有已接受标签变化时，不允许从未变化来源新增标签。
5. 变化节点或关联资料能够合法产生引用 affected source 的新标签。
6. 已接受标签从 suggestion 中消失，未受影响且未接受的旧候选保持稳定。
7. `REJECTED` 提案永不进入 prompt；无更早基线时 prompt 不含 continuity。
8. continuity 超预算时全量 prompt 仍能成功发送；full 也超预算时保持现有安全失败。
9. runtime 输出仍对当前 snapshot 做 ID、阶段、资源、结构 gaps 与标签校验。
10. generation metadata 只含安全 identity、枚举和计数。
11. 现有摘要生成、重新生成、接受、拒绝、STALE 和 Markdown 审计测试保持通过。

目标验证包括相关单元测试、API 全量测试、API typecheck/build、contracts 测试（若契约发生变化）以及 `git diff --check`。本次不以 prompt 结构测试代替真实运行时模型质量结论；模型质量和耗时改善需要在真实 Bridge 上用固定样例做前后对比后单独报告。

## 非目标

- 不控制或修改模型内部 attention weight。
- 不新增模型 temperature、seed 或其他采样参数。
- 不新增用户可见的摘要历史浏览界面。
- 不把被拒绝摘要作为负样本、few-shot 或其他提示上下文。
- 不修改画布、检索索引或已发布指南。
- 不承诺单次请求 input token 必然下降；本次首先保证理解连续性、标签稳定性和安全回退。
