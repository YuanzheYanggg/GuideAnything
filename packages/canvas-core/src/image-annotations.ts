import type { CanvasDocument, CanvasNode, ImageAnnotation } from '@guideanything/contracts';

export interface AnnotationCamera {
  centerX: number;
  centerY: number;
  zoom: number;
}

export function normalizeAnnotationOrder(annotations: ImageAnnotation[]): ImageAnnotation[] {
  return annotations
    .map((annotation, index) => ({ annotation, index }))
    .sort((left, right) => left.annotation.order - right.annotation.order || left.index - right.index)
    .map(({ annotation }, order) => ({ ...annotation, order }));
}

export function resolveAnnotationTarget(
  document: CanvasDocument,
  imageNodeId: string,
  targetNodeId?: string,
): CanvasNode | null {
  if (!targetNodeId || targetNodeId === imageNodeId) return null;
  return document.nodes.find((node) => node.id === targetNodeId) ?? null;
}

export function cameraForAnnotation(annotation: ImageAnnotation): AnnotationCamera {
  if (annotation.camera) return { ...annotation.camera };
  const { x, y, width, height } = annotation.region;
  if (annotation.shape === 'RECT' && width !== undefined && height !== undefined) {
    return {
      centerX: x + width / 2,
      centerY: y + height / 2,
      zoom: clamp(Math.min(1 / width, 1 / height) * 0.75, 1, 8),
    };
  }
  return { centerX: x, centerY: y, zoom: 2.5 };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
