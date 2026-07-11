# GuideAnything 数据模型

## 1. 关系模型

| 表 | 主键与关键字段 | 说明 |
| --- | --- | --- |
| `users` | `id`, `email UNIQUE`, `password_hash`, `display_name`, `role` | 本地演示用户；角色为 `AUTHOR/EDITOR/LEARNER` |
| `guides` | `id`, `owner_id`, `title`, `summary`, `status`, `visibility`, `revision`, `draft_document`, `published_version_id` | 可变工作副本；`revision` 乐观锁 |
| `guide_collaborators` | `(guide_id,user_id)`, `permission` | 首版 permission 为 `EDIT` |
| `guide_versions` | `id`, `guide_id`, `version`, `title`, `summary`, `tags_json`, `document_json`, `search_text`, `published_by`, `published_at` | 不可变发布快照，`UNIQUE(guide_id,version)` |
| `guide_search` | FTS5 `version_id`, `title`, `summary`, `tags`, `content` | 仅索引当前发布版本 |
| `media_assets` | `id`, `owner_id`, `kind`, `mime_type`, `size`, `storage_path`, `original_name`, `created_at` | 图片/视频上传元数据 |

所有 ID 使用 UUID。时间存 ISO-8601 UTC 文本。JSON 写入前必须通过共享 schema 校验。

## 2. 画布文档协议

```ts
type NodeKind =
  | 'start' | 'end' | 'process' | 'decision' | 'data'
  | 'markdown' | 'image' | 'video' | 'subguide';

interface CanvasNode<TData = NodeData> {
  id: string;
  type: NodeKind;
  position: { x: number; y: number };
  size?: { width: number; height: number };
  zIndex: number;
  hidden?: boolean;
  data: TData;
  source?: SourceTrace;
}

interface CanvasEdge {
  id: string;
  source: string;
  sourceHandle?: string;
  target: string;
  targetHandle?: string;
  label?: string;
  hidden?: boolean;
  sourceTrace?: SourceTrace;
}

interface LessonStep {
  id: string;
  order: number;
  title: string;
  body?: string;
  nodeId: string;
  keypointId?: string;
}

interface CanvasDocument {
  schemaVersion: 1;
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  viewport: { x: number; y: number; zoom: number };
  steps: LessonStep[];
  entryNodeId?: string;
  exitNodeIds: string[];
}
```

## 3. 节点私有数据

- 流程类：`{ label, description?, shape, branchLabels? }`
- Markdown：`{ markdown }`
- 图片：`{ assetId, url, caption?, alt }`
- 视频：`{ assetId?, url, caption?, keypoints: [{ id,title,timeSeconds,stepId?,targetNodeId? }] }`
- 子指南：`{ guideId, guideVersionId, title, version, expanded, sourceEntryNodeId?, sourceExitNodeIds?, expandedContinuationEdges?: [{ id, hidden }] }`。首次展开会固化快照入口/出口 ID；`expandedContinuationEdges` 记录展开前“引用 → 宿主下游”连线及原可见状态，供折叠可靠还原。

`SourceTrace` 固定为 `{ referenceNodeId, sourceGuideId, sourceVersionId, sourceElementId }`。未知节点类型不进入数据库；未来扩展时提高 `schemaVersion` 并提供迁移函数。

## 4. 关键一致性规则

- 发布事务：校验工作副本 -> 插入版本 -> 更新指南状态/当前版本 -> 重建该指南 FTS 行。
- 删除指南首版为归档，不删除已被引用的版本快照。
- 固定版本引用只允许指向 `PUBLISHED` 产生的版本。
- 媒体删除前检查草稿和已发布快照引用；首版不提供物理删除 API。
- 工作副本更新条件必须包含客户端 `revision`；成功后原子自增。
