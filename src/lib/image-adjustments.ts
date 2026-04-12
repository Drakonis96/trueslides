import type { CSSProperties } from "react";
import type { ImageAdjustment, SlideData } from "./types";

export const DEFAULT_IMAGE_ADJUSTMENT: ImageAdjustment = {
  scale: 1,
  offsetX: 0,
  offsetY: 0,
  opacity: 100,
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function getMaxImageOffset(_scale?: number): number {
  // Offset range is always ±50, mapping to object-position 0%–100%
  return 50;
}

export function clampImageAdjustment(adjustment?: Partial<ImageAdjustment> | null): ImageAdjustment {
  const scale = Math.max(1, Number(adjustment?.scale) || 1);
  const maxOffset = getMaxImageOffset(scale);

  return {
    scale,
    offsetX: clamp(Number(adjustment?.offsetX) || 0, -maxOffset, maxOffset),
    offsetY: clamp(Number(adjustment?.offsetY) || 0, -maxOffset, maxOffset),
    opacity: clamp(Number(adjustment?.opacity) || 100, 0, 100),
  };
}

export function getImageAdjustmentStyle(adjustment?: Partial<ImageAdjustment> | null): CSSProperties {
  const adj = clampImageAdjustment(adjustment);

  const style: CSSProperties = {
    objectFit: "cover",
    objectPosition: `${50 - adj.offsetX}% ${50 - adj.offsetY}%`,
    opacity: (adj.opacity ?? 100) / 100,
  };

  if (adj.scale > 1) {
    style.transform = `scale(${adj.scale})`;
    style.transformOrigin = "center center";
  }

  return style;
}

export function setSlideImageAdjustment(
  slide: SlideData,
  slotIndex: number,
  adjustment?: Partial<ImageAdjustment> | null,
): ImageAdjustment[] {
  const next = [...(slide.imageAdjustments || [])];
  while (next.length <= slotIndex) next.push({ ...DEFAULT_IMAGE_ADJUSTMENT });
  next[slotIndex] = clampImageAdjustment(adjustment);
  return next;
}