import type { CanvasDocument } from '@guideanything/contracts';

export function layoutGrid(document: CanvasDocument, columns = 3): CanvasDocument {
  const safeColumns = Math.max(1, Math.floor(columns));
  return {
    ...document,
    nodes: document.nodes.map((node, index) => ({
      ...node,
      position: {
        x: 80 + (index % safeColumns) * 380,
        y: 80 + Math.floor(index / safeColumns) * 300,
      },
    })),
  };
}

