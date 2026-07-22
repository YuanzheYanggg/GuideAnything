# Flow Structure Sidebar Design

## Goal

Make the editor's flow-structure sidebar navigable at any viewport height, move stage/lane administration into an on-demand secondary drawer, and present the business hierarchy and derived learning order as one coherent authoring view.

## User stories

- As a flow author, I can scroll the structure tree without scrolling or clipping the canvas workspace.
- As a flow author, I can open **业务阶段** or **责任泳道** only when I need to manage it, rename items, add/delete items, and drag an item to a new order.
- As a flow author, I can see the global lesson order inside the tree without maintaining or reading a duplicate lesson list in the inspector.
- As a flow author, I can visually distinguish a primary flow node from its attached appendix resources while still selecting any node to focus the canvas.

## Product decisions

1. Business stages, lanes, node outline order, and attachments remain the only persisted authoring model. The learning path is derived from that model; there is no second editable lesson ordering surface.
2. The editor merges learning-path information into the tree, not into the persistence layer. The learner page remains a separate read-only learning experience.
3. Every displayed tree item receives its existing globally continuous semantic position. Visual nesting groups resources below their owner but does not create a second numbering system.
4. The current full `LESSON PATH` list is removed from the right inspector. The left tree header reports the derived step count instead.

## Interaction design

### Main sidebar

The sidebar has a fixed header and a scrollable body. The body starts with two compact management triggers:

- `业务阶段 · N`
- `责任泳道 · N`

They replace the always-expanded stage/lane forms. The structure tree remains directly below them.

### Secondary management drawer

Clicking either trigger opens one secondary drawer beside the sidebar, over the canvas rather than consuming permanent canvas width. It contains only the selected collection's management controls:

- drag grip for pointer-driven ordering;
- inline title editing;
- lane-kind badge where applicable;
- delete action;
- creation actions.

The drag handle supports `Alt+ArrowUp` and `Alt+ArrowDown` as a keyboard fallback. In edit-locked preview state, inputs, drag grips, creation, and deletion are disabled.

### Tree hierarchy

Each stage is a collapsible root. Primary flow nodes render as the stage's visual spine. Attached resources render in an owner-local `资料附录 · N` disclosure group, styled lighter than primary nodes. Expanded subguide artifacts retain their existing nested group. Selecting any item still calls the existing canvas focus callback.

## Technical design

- Add `apps/web/src/features/editor/hierarchy-order.ts` with a pure `reorderHierarchyItems` helper that removes one ordered item, inserts it before/after a target, and normalizes every `order` value.
- `HierarchyPanel` owns only presentation state: open drawer, drag source, target/placement, collapsed stages, and collapsed appendix groups. It receives reorder callbacks from `GuideEditor`.
- `GuideEditor` commits stage/lane reorder results to the existing document. No contract, API, migration, or persistence-schema change is needed.
- The sidebar shell receives a constrained height and `min-height: 0`; the panel's internal scroll viewport owns `overflow-y: auto`. The secondary drawer gets independent scrolling.
- The existing `deriveSemanticFlow(document)` remains the source of tree numbering and step count.

## Failure behavior and accessibility

- Drops onto the same item, invalid targets, or locked state are ignored.
- A drawer never changes document state until a valid reorder, rename, add, or delete action is made.
- Drawer triggers expose `aria-expanded` and `aria-controls`.
- Draggable grips have explicit labels and keyboard reordering instructions.
- Stage and appendix collapse controls use buttons with stateful accessible labels.

## Validation

- Unit test order normalization and no-op behavior.
- Component tests for compact triggers, drawer opening, drag-drop callback, keyboard fallback, and appendix disclosure.
- Static CSS regression test for the actual scrolling ownership boundary.
- Existing editor test updated to verify saved stage/lane ordering through the new interaction.
- Targeted Vitest, web typecheck, full web test suite, and a real browser check for scrolling, drawer appearance, drag order, and tree/lesson mapping.
