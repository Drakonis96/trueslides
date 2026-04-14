// ── AI Providers ──
export type AIProvider = "openrouter" | "gemini" | "claude" | "openai";

export interface AIModel {
  id: string;
  name: string;
  provider: AIProvider;
  pinned: boolean;
  inputPrice?: number;  // $/1M tokens
  outputPrice?: number; // $/1M tokens
}

export interface ProviderConfig {
  id: AIProvider;
  name: string;
  models: AIModel[];
  hasKey?: boolean; // server-side status only, never contains the actual key
}

// ── Prompt Presets ──
export interface PromptPreset {
  id: string;
  label: string;
  text: string;
}

export interface CustomPreset {
  id: string;
  field: PromptFieldKey;
  label: string;
  text: string;
}

export type PromptFieldKey = "design" | "text" | "notes";

export interface PromptFieldConfig {
  key: PromptFieldKey;
  label: { en: string; es: string };
  icon: string;
  presets: { en: PromptPreset[]; es: PromptPreset[] };
}

// ── Image adjustment per slot ──
export interface ImageAdjustment {
  /** Zoom level: 1 = fit, >1 = zoom in */
  scale: number;
  /** Horizontal offset in % (-50 to 50) */
  offsetX: number;
  /** Vertical offset in % (-50 to 50) */
  offsetY: number;
  /** Image opacity percentage (0-100) */
  opacity?: number;
  /** Fitting mode: cover (fill/crop), contain (fit whole), fill (stretch), none (original size) */
  objectFit?: "cover" | "contain" | "fill" | "none";
}

// ── Slide ──
export type ShapeKind = "rectangle" | "ellipse" | "line" | "rounded-rect";

export type ConnectorStyle = "straight" | "elbow" | "curved";
export type ArrowHead = "none" | "arrow" | "dot" | "diamond";

export interface ManualElementData {
  type: "title" | "subtitle" | "text" | "image" | "bullets" | "shape" | "youtube" | "connector";
  x: number; // 0-100 %
  y: number;
  w: number;
  h: number;
  content: string;
  fontSize?: number;
  fontWeight?: "normal" | "bold";
  fontFamily?: string;
  textAlign?: "left" | "center" | "right" | "justify";
  lineHeight?: number;
  color?: string; // hex without #
  zIndex?: number;
  locked?: boolean;
  imageAdjustment?: ImageAdjustment;
  groupId?: string;
  shapeKind?: ShapeKind;
  shapeFill?: string; // hex without #
  shapeOpacity?: number; // 0-100
  shapeBorderColor?: string; // hex without #
  shapeBorderWidth?: number; // px
  youtubeUrl?: string; // full YouTube URL for embedded videos
  connectorStyle?: ConnectorStyle;
  arrowStart?: ArrowHead;
  arrowEnd?: ArrowHead;
  connectorColor?: string; // hex without #
  connectorWidth?: number; // px
  rotation?: number; // degrees, 0-360
  thumbnailUrl?: string; // low-res preview for filmstrip (PPTX imports)
}

export interface SlideData {
  id: string;
  index: number;
  title: string;
  bullets: string[];
  notes: string;
  imageUrls: string[];
  section?: string;
  accentColor?: string; // hex without #, e.g. "6366F1"
  imageSearchTerms?: string[];
  slideLayout?: SlideLayoutId;
  imageSources?: string[]; // source name for each image URL, e.g. "Wikimedia Commons"
  imageAdjustments?: ImageAdjustment[]; // per-image crop/zoom/position
  overlayPosition?: { x: number; y: number }; // 0-100 % offset for title overlay on image-only slides
  manualElements?: ManualElementData[]; // when set, use exact element positions instead of layout-based rendering
  bgColor?: string; // hex without #, per-slide background (used by manual slides)
  thumbnailUrl?: string; // low-res preview for filmstrip
}

export interface PresentationData {
  title: string;
  slides: SlideData[];
}

export type HistoryStatus = "running" | "completed" | "error";

export interface HistoryEntry {
  id: string;
  title: string;
  createdAt: number; // Date.now()
  completedAt?: number;
  presentation?: PresentationData;
  notesProject?: NotesProject;
  type: "presentation" | "notes";
  status: HistoryStatus;
  provider?: AIProvider;
  modelId?: string;
  slideCount?: number;
  errorMessage?: string;
  progressPercent?: number;
  progressMessage?: string;
}

// ── Notes Generator Mode ──
export interface ParsedPptxSlide {
  index: number;
  texts: string[];       // extracted text fragments from XML
  imageBase64s: string[]; // embedded images as data: URIs
  presenterNotes: string; // existing presenter notes from the PPTX
}

export interface NotesProject {
  id: string;
  pptxFileName: string;
  docFileName: string;
  docText: string;
  slides: ParsedPptxSlide[];
  generatedNotes: string[];  // one note per slide, indexed by slide index
  createdAt: number;
}

// ── Slide Layouts (15 pre-configured image slot arrangements) ──
export type SlideLayoutId =
  | "single"
  | "two-cards"
  | "three-cards"
  | "four-cards"
  | "grid-2x2"
  | "two-cols"
  | "diagonal"
  | "left-small-right-large"
  | "three-cols"
  | "four-cols"
  | "two-rows"
  | "three-rows"
  | "four-rows"
  | "left-stack-right"
  | "left-right-stack";

export interface SlideLayoutDef {
  id: SlideLayoutId;
  imageCount: number;
  /** Normalised rectangles (0-1 coordinate space) for each image slot */
  slots: { x: number; y: number; w: number; h: number }[];
}

export const SLIDE_LAYOUTS: SlideLayoutDef[] = [
  // Row 1
  { id: "single", imageCount: 1, slots: [{ x: 0, y: 0, w: 1, h: 1 }] },
  {
    id: "two-cards", imageCount: 2, slots: [
      { x: 0.15, y: 0.1, w: 0.3, h: 0.8 },
      { x: 0.55, y: 0.1, w: 0.3, h: 0.8 },
    ],
  },
  {
    id: "three-cards", imageCount: 3, slots: [
      { x: 0.05, y: 0.1, w: 0.27, h: 0.8 },
      { x: 0.365, y: 0.1, w: 0.27, h: 0.8 },
      { x: 0.68, y: 0.1, w: 0.27, h: 0.8 },
    ],
  },
  {
    id: "four-cards", imageCount: 4, slots: [
      { x: 0.03, y: 0.1, w: 0.21, h: 0.8 },
      { x: 0.27, y: 0.1, w: 0.21, h: 0.8 },
      { x: 0.51, y: 0.1, w: 0.21, h: 0.8 },
      { x: 0.75, y: 0.1, w: 0.21, h: 0.8 },
    ],
  },
  // Row 2
  {
    id: "grid-2x2", imageCount: 4, slots: [
      { x: 0.02, y: 0.02, w: 0.47, h: 0.47 },
      { x: 0.51, y: 0.02, w: 0.47, h: 0.47 },
      { x: 0.02, y: 0.51, w: 0.47, h: 0.47 },
      { x: 0.51, y: 0.51, w: 0.47, h: 0.47 },
    ],
  },
  {
    id: "two-cols", imageCount: 2, slots: [
      { x: 0, y: 0, w: 0.49, h: 1 },
      { x: 0.51, y: 0, w: 0.49, h: 1 },
    ],
  },
  {
    id: "diagonal", imageCount: 2, slots: [
      { x: 0, y: 0.35, w: 0.55, h: 0.65 },
      { x: 0.35, y: 0, w: 0.65, h: 0.55 },
    ],
  },
  {
    id: "left-small-right-large", imageCount: 2, slots: [
      { x: 0, y: 0, w: 0.3, h: 1 },
      { x: 0.32, y: 0, w: 0.68, h: 1 },
    ],
  },
  // Row 3
  {
    id: "three-cols", imageCount: 3, slots: [
      { x: 0, y: 0, w: 0.32, h: 1 },
      { x: 0.34, y: 0, w: 0.32, h: 1 },
      { x: 0.68, y: 0, w: 0.32, h: 1 },
    ],
  },
  {
    id: "four-cols", imageCount: 4, slots: [
      { x: 0, y: 0, w: 0.235, h: 1 },
      { x: 0.255, y: 0, w: 0.235, h: 1 },
      { x: 0.51, y: 0, w: 0.235, h: 1 },
      { x: 0.765, y: 0, w: 0.235, h: 1 },
    ],
  },
  {
    id: "two-rows", imageCount: 2, slots: [
      { x: 0, y: 0, w: 1, h: 0.49 },
      { x: 0, y: 0.51, w: 1, h: 0.49 },
    ],
  },
  {
    id: "three-rows", imageCount: 3, slots: [
      { x: 0, y: 0, w: 1, h: 0.32 },
      { x: 0, y: 0.34, w: 1, h: 0.32 },
      { x: 0, y: 0.68, w: 1, h: 0.32 },
    ],
  },
  // Row 4
  {
    id: "four-rows", imageCount: 4, slots: [
      { x: 0, y: 0, w: 1, h: 0.235 },
      { x: 0, y: 0.255, w: 1, h: 0.235 },
      { x: 0, y: 0.51, w: 1, h: 0.235 },
      { x: 0, y: 0.765, w: 1, h: 0.235 },
    ],
  },
  {
    id: "left-stack-right", imageCount: 3, slots: [
      { x: 0, y: 0, w: 0.4, h: 0.49 },
      { x: 0, y: 0.51, w: 0.4, h: 0.49 },
      { x: 0.42, y: 0, w: 0.58, h: 1 },
    ],
  },
  {
    id: "left-right-stack", imageCount: 3, slots: [
      { x: 0, y: 0, w: 0.58, h: 1 },
      { x: 0.6, y: 0, w: 0.4, h: 0.49 },
      { x: 0.6, y: 0.51, w: 0.4, h: 0.49 },
    ],
  },
];

// ── Generation Config ──
export type ImageLayout = "full" | "two" | "three" | "collage" | "combined";
export type LayoutMode = "fixed" | "smart";
export type SlideCountOption = 5 | 10 | 15 | 30 | 50 | 100 | "custom";
export type OutputLanguage = "de" | "en" | "es" | "fr" | "it";

export const OUTPUT_LANGUAGE_OPTIONS: ReadonlyArray<{
  value: OutputLanguage;
  label: string;
}> = [
  { value: "de", label: "Deutsch" },
  { value: "en", label: "English" },
  { value: "es", label: "Español" },
  { value: "fr", label: "Français" },
  { value: "it", label: "Italiano" },
];

export const OUTPUT_LANGUAGE_NAMES: Record<OutputLanguage, string> = {
  de: "German",
  en: "English",
  es: "Spanish",
  fr: "French",
  it: "Italian",
};

export interface GenerationConfig {
  provider: AIProvider;
  modelId: string;
  slideCount: number;
  imageLayout: ImageLayout;
  layoutMode: LayoutMode;
  slideLayout: SlideLayoutId;
  stretchImages: boolean;
  textDensity: number; // percentage 5-100
  overlaySectionFontSize: number;
  overlayTitleFontSize: number;
  overlaySectionColor: string;
  overlayTitleColor: string;
  overlayTextGap: number;
  outputLanguage: OutputLanguage;
  prompts: Record<PromptFieldKey, string>;
  sourceText: string;
  sourceFileName?: string;
}

// ── App Settings ──
export type Language = "en" | "es";

// ── Image Sources ──
export type ImageSourceId = "wikimedia" | "openverse" | "unsplash" | "pexels" | "pixabay" | "flickr" | "loc" | "europeana" | "hispana";

export interface ImageSourceConfig {
  id: ImageSourceId;
  name: string;
  /** Does this source require an API key? */
  needsKey: boolean;
  /** Does this source have a key stored server-side? (client-only status) */
  hasKey?: boolean;
  /** URL for getting a free API key */
  keyUrl: string;
  /** Placeholder text for the key input */
  keyPlaceholder: string;
}

export const IMAGE_SOURCES: ImageSourceConfig[] = [
  {
    id: "wikimedia",
    name: "Wikimedia Commons",
    needsKey: false,
    keyUrl: "",
    keyPlaceholder: "",
  },
  {
    id: "openverse",
    name: "Openverse",
    needsKey: false,
    keyUrl: "",
    keyPlaceholder: "",
  },
  {
    id: "unsplash",
    name: "Unsplash",
    needsKey: true,
    keyUrl: "https://unsplash.com/developers",
    keyPlaceholder: "Access Key",
  },
  {
    id: "pexels",
    name: "Pexels",
    needsKey: true,
    keyUrl: "https://www.pexels.com/api/",
    keyPlaceholder: "API Key",
  },
  {
    id: "pixabay",
    name: "Pixabay",
    needsKey: true,
    keyUrl: "https://pixabay.com/api/docs/",
    keyPlaceholder: "API Key",
  },
  {
    id: "flickr",
    name: "Flickr",
    needsKey: true,
    keyUrl: "https://www.flickr.com/services/api/misc.api_keys.html",
    keyPlaceholder: "API Key",
  },
  {
    id: "loc",
    name: "Library of Congress",
    needsKey: false,
    keyUrl: "",
    keyPlaceholder: "",
  },
  {
    id: "europeana",
    name: "Europeana",
    needsKey: true,
    keyUrl: "https://pro.europeana.eu/pages/get-api",
    keyPlaceholder: "API Key (wskey)",
  },
  {
    id: "hispana",
    name: "Hispana",
    needsKey: true,
    keyUrl: "https://pro.europeana.eu/pages/get-api",
    keyPlaceholder: "Europeana API Key",
  },
];

// ── Image Search Speed Optimizations ──
export interface ImageSearchSpeedOptions {
  /** Cap Phase 2 fallback attempts (0 = disabled, max 2). Default: 2 */
  maxFallbackAttempts: number;
  /** Skip Wikimedia category search (2 sequential API calls per slide). Default: false */
  skipCategorySearch: boolean;
  /** Reduce query candidates from 3 to 2 per slide. Default: false */
  reduceQueryCandidates: boolean;
  /** Lower per-query image fetch limit. Default: false */
  lowerFetchLimit: boolean;
}

export const DEFAULT_SPEED_OPTIONS: ImageSearchSpeedOptions = {
  maxFallbackAttempts: 2,
  skipCategorySearch: false,
  reduceQueryCandidates: false,
  lowerFetchLimit: false,
};

export const DEFAULT_IMAGE_VERIFICATION: ImageVerificationConfig = {
  enabled: false,
  descriptorProvider: "openrouter",
  descriptorModelId: "",
};

export interface AppSettings {
  language: Language;
  outputLanguage: OutputLanguage;
  providers: ProviderConfig[];
  enabledImageSources: ImageSourceId[];
  speedOptions: ImageSearchSpeedOptions;
  /** AI-powered visual verification of images before selection */
  imageVerification: ImageVerificationConfig;
}

export interface ImageVerificationConfig {
  /** Whether the feature is enabled */
  enabled: boolean;
  /** Provider for the cheap vision/descriptor model */
  descriptorProvider: AIProvider;
  /** Model ID for the descriptor (vision) model */
  descriptorModelId: string;
}

// ── Generation status ──
export type GenerationStatus = "idle" | "uploading" | "analyzing" | "generating" | "fetching-images" | "building-pptx" | "done" | "error";
