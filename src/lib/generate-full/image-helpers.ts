import {
  ImageLayout,
  LayoutMode,
  OutputLanguage,
  SLIDE_LAYOUTS,
  SlideLayoutId,
} from "@/lib/types";

interface ImageQuerySlide {
  title: string;
  section?: string;
  imageSearchTerms?: string[];
}

interface MaxImagesOptions {
  requestedLayoutMode?: LayoutMode;
  requestedSlideLayout: SlideLayoutId;
  requestedImageLayout: ImageLayout;
  generatedSlideLayout?: string;
}

interface ResolveSlideLayoutOptions {
  requestedLayoutMode?: LayoutMode;
  requestedSlideLayout: SlideLayoutId;
  generatedSlideLayout?: string;
}

export function buildImageQueryCandidates(slide: ImageQuerySlide): string[] {
  const aiTerms = (slide.imageSearchTerms ?? []).filter((term) => term?.trim());
  const contextTerms = [slide.title || "", slide.section || ""].filter(Boolean);
  return [...aiTerms, ...contextTerms].filter(Boolean).slice(0, 4);
}

export function extractTopicQueries(sourceText: string, outputLanguage?: OutputLanguage): string[] {
  const words = sourceText
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/\s+/)
    .filter((word) => word.length >= 4);

  const stopWords = new Set([
    "this", "that", "with", "from", "have", "were", "they", "about", "into", "between", "through",
    "para", "como", "esta", "este", "desde", "entre", "sobre", "tambien", "cuando", "donde",
  ]);
  const counts = new Map<string, number>();

  for (const word of words) {
    if (stopWords.has(word)) continue;
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }

  const ranked = [...counts.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 3)
    .map(([word]) => word);

  if (ranked.length === 0) {
    return outputLanguage === "es" ? ["historia", "fotografia"] : ["history", "photography"];
  }

  return ranked;
}

export function getMaxImagesForSlide(options: MaxImagesOptions): number {
  const effectiveLayoutId =
    options.requestedLayoutMode === "smart" && options.generatedSlideLayout
      ? options.generatedSlideLayout
      : options.requestedSlideLayout;
  const layoutDef = SLIDE_LAYOUTS.find((layout) => layout.id === effectiveLayoutId);

  if (layoutDef) {
    return layoutDef.imageCount;
  }

  if (options.requestedImageLayout === "full") return 1;
  if (options.requestedImageLayout === "two") return 2;
  if (options.requestedImageLayout === "three") return 3;
  return 4;
}

export function resolveSlideLayout(options: ResolveSlideLayoutOptions): string {
  if (options.requestedLayoutMode === "smart" && options.generatedSlideLayout) {
    return options.generatedSlideLayout;
  }

  return options.requestedSlideLayout;
}