import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const stylesheet = readFileSync('src/styles.css', 'utf8');

describe('editor layout styles', () => {
  it('keeps the inspector within the workspace and scrollable independently', () => {
    expect(stylesheet).toMatch(/\.editor-page\s*\{[^}]*--editor-header-height:\s*\d+px[^}]*--editor-toolbar-height:\s*\d+px[^}]*height:\s*100vh[^}]*min-height:\s*0[^}]*overflow:\s*hidden[^}]*\}/s);
    expect(stylesheet).toMatch(/\.editor-page-content\s*\{[^}]*min-height:\s*0[^}]*height:\s*100%[^}]*display:\s*grid[^}]*grid-template-rows:\s*var\(--editor-header-height\)\s+var\(--editor-toolbar-height\)\s+minmax\(0,\s*1fr\)[^}]*overflow:\s*hidden[^}]*\}/s);
    expect(stylesheet).toMatch(/\.editor-workspace\s*\{[^}]*min-height:\s*0[^}]*overflow:\s*hidden[^}]*\}/s);
    expect(stylesheet).toMatch(/\.inspector\s*\{[^}]*min-height:\s*0[^}]*overflow-x:\s*hidden[^}]*overflow-y:\s*auto[^}]*\}/s);
  });

  it('contains hierarchy scrolling in its own content area while management drawers may extend beside it', () => {
    expect(stylesheet).toMatch(/\.hierarchy-panel-shell\s*\{[^}]*min-height:\s*0[^}]*height:\s*100%[^}]*overflow:\s*visible[^}]*\}/s);
    expect(stylesheet).toMatch(/\.hierarchy-panel\s*\{[^}]*min-height:\s*0[^}]*height:\s*100%[^}]*display:\s*flex[^}]*flex-direction:\s*column[^}]*overflow:\s*hidden[^}]*\}/s);
    expect(stylesheet).toMatch(/\.hierarchy-panel-scroll\s*\{[^}]*min-height:\s*0[^}]*overflow-x:\s*hidden[^}]*overflow-y:\s*auto[^}]*overscroll-behavior:\s*contain[^}]*\}/s);
    expect(stylesheet).toMatch(/\.hierarchy-manager-drawer\s*\{[^}]*position:\s*absolute[^}]*\}/s);
  });

  it('keeps the compact regression list inside the editor header as an anchored details popover', () => {
    expect(stylesheet).toMatch(/\.flow-regression-panel\s*\{[^}]*position:\s*relative[^}]*\}/s);
    expect(stylesheet).toMatch(/\.flow-regression-panel-body\s*\{[^}]*position:\s*absolute[^}]*z-index:\s*60[^}]*max-height:\s*min\(66vh,\s*620px\)[^}]*overflow:\s*auto[^}]*\}/s);
  });

  it('provides an animated but reduced-motion-safe command header', () => {
    expect(stylesheet).toMatch(/\.editor-header::before,\s*\.editor-header::after\s*\{[^}]*pointer-events:\s*none/s);
    expect(stylesheet).toMatch(/\.editor-action-segment\s*\{[^}]*display:\s*inline-flex/s);
    expect(stylesheet).toMatch(/\.editor-action-button\s*\{[^}]*border:\s*0/s);
    expect(stylesheet).toMatch(/@media \(prefers-reduced-motion:\s*reduce\)[\s\S]*\.editor-header::before/s);
  });

  it('stacks the editor header before its action groups can be compressed into an overflowing row', () => {
    expect(stylesheet).toMatch(/@media \(max-width:\s*1360px\)[\s\S]*\.editor-header\s*\{[^}]*grid-template-columns:\s*auto\s+minmax\(0,\s*1fr\)[^}]*grid-template-rows:\s*auto\s+minmax\(80px,\s*1fr\)\s+auto/s);
    expect(stylesheet).toMatch(/@media \(max-width:\s*1360px\)[\s\S]*\.editor-actions\s*\{[^}]*grid-column:\s*1\s*\/\s*-1[^}]*grid-row:\s*3/s);
  });

  it('keeps wide editor actions inside their cards without wrapping labels', () => {
    expect(stylesheet).toMatch(/\.editor-header\s*\{[^}]*grid-template-columns:[^}]*minmax\(max-content,\s*1\.1fr\)/s);
    expect(stylesheet).toMatch(/\.editor-action-group\s*\{[^}]*flex:\s*0\s+0\s+auto/s);
    expect(stylesheet).toMatch(/\.appearance-toggle button\s*\{[^}]*white-space:\s*nowrap/s);
  });

  it('anchors the manual route toolbar to its route without drag-docking styles', () => {
    expect(stylesheet).toMatch(/\.edge-toolbar-position\s*\{[^}]*position:\s*absolute[^}]*transform:\s*translate\(-50%,\s*calc\(-100%\s*-\s*16px\)\)/s);
    expect(stylesheet).toMatch(/\.edge-toolbar-position--below\s*\{[^}]*transform:\s*translate\(-50%,\s*18px\)/s);
    expect(stylesheet).not.toContain('.edge-toolbar-position.is-route-editing');
    expect(stylesheet).not.toContain('edge-toolbar-drag-handle');
  });

  it('keeps the editor visual closure on shared React Bits surfaces and grouped menus', () => {
    expect(stylesheet).toMatch(/\.canvas-node-surface\s*\{[^}]*display:\s*grid[^}]*background:/s);
    expect(stylesheet).toMatch(/\.canvas-creation-menu--above\s*\{[^}]*transform:/s);
    expect(stylesheet).toMatch(/\.editor-toolbar-group-surface\s*\{[^}]*display:\s*flex[^}]*border:/s);
    expect(stylesheet).toMatch(/\.editor-toolbar-command\s*\{[^}]*display:\s*inline-flex[^}]*transition:/s);
    expect(stylesheet).toMatch(/\.editor-toolbar-action-layout\s*\{[^}]*box-shadow:/s);
    expect(stylesheet).toMatch(/\.animated-list-item\s*\{[^}]*animation:/s);
  });

  it('defines low-contrast vertical editor swimlanes with reduced-transparency support', () => {
    expect(stylesheet).toContain('.canvas-swimlane');
    expect(stylesheet).toContain('.canvas-swimlane--role');
    expect(stylesheet).toContain('.canvas-swimlane--system');
    expect(stylesheet).toContain('pointer-events: none');
    expect(stylesheet).toContain('.canvas-swimlane-heading');
    expect(stylesheet).toContain('@media (prefers-reduced-transparency: reduce)');
  });

  it('reserves a separate, clipped swimlane title row below the stage title row', () => {
    expect(stylesheet).toMatch(/\.canvas-swimlane-heading\s*\{[^}]*position:\s*absolute[^}]*top:\s*26px[^}]*left:\s*8px[^}]*height:\s*13px[^}]*overflow:\s*hidden/s);
    expect(stylesheet).toMatch(/\.canvas-swimlane-heading span\s*\{[^}]*min-width:\s*0[^}]*overflow:\s*hidden[^}]*text-overflow:\s*ellipsis/s);
  });

  it('uses a neutral X action instead of a danger trash action on nodes', () => {
    expect(stylesheet).toMatch(/\.canvas-node-delete\s*\{[^}]*color:\s*var\(--ga-text-secondary\)/s);
    expect(stylesheet).toMatch(/\.canvas-node-delete:hover\s*\{[^}]*color:\s*var\(--ga-accent\)/s);
  });

  it('keeps the auto-layout preview in the right inspector and anchors the edit group at the end', () => {
    expect(stylesheet).toMatch(/\.canvas-layout-preview-panel\s*\{[^}]*position:\s*relative[^}]*min-height:\s*100%/s);
    expect(stylesheet).not.toContain('.canvas-layout-preview-backdrop');
    expect(stylesheet).toMatch(/\.editor-toolbar-group--edit-end\s*\{[^}]*margin-left:\s*auto/s);
    expect(stylesheet).not.toContain('.layout-preview');
  });

  it('uses one React Bits surface contract for secondary dialogs and anchored editors', () => {
    expect(stylesheet).toMatch(/\.editor-dialog-surface\s*\{[^}]*border-color:[^}]*background:[^}]*box-shadow:/s);
    expect(stylesheet).toMatch(/\.editor-dialog-close\s*\{[^}]*display:\s*grid[^}]*place-items:\s*center/s);
    expect(stylesheet).toMatch(/\.edge-label-editor-shell\s*\{[^}]*position:\s*absolute[^}]*pointer-events:\s*all/s);
    expect(stylesheet).toMatch(/\.manual-route-editor__status-shell\s*\{[^}]*border-radius:\s*999px[^}]*pointer-events:\s*none/s);
  });

  it('flows printable guide sections continuously while keeping the cover as a page boundary', () => {
    expect(stylesheet).toMatch(/@media print[\s\S]*\.pdf-export-page\s*\{[^}]*padding:\s*18px 24px[^}]*break-after:\s*auto[^}]*\}/s);
    expect(stylesheet).toMatch(/@media print[\s\S]*\.pdf-export-cover\s*\{[^}]*break-after:\s*page[^}]*\}/s);
    expect(stylesheet).toMatch(/@page\s*\{[^}]*size:\s*A4 landscape;[^}]*margin:\s*0[^}]*\}/s);
    expect(stylesheet).toMatch(/@media print[\s\S]*\.pdf-export-shell\s*\{[^}]*background:\s*var\(--ga-bg\)[^}]*\}/s);
  });
});
