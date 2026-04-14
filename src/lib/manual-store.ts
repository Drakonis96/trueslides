import { create } from "zustand";
import { ImageAdjustment, ConnectorStyle, ArrowHead, ShapeKind, SLIDE_LAYOUTS, SlideLayoutId } from "./types";

// ── Layout presets for manual slides ──
export type ManualLayoutId = SlideLayoutId;

export interface ManualSlideElement {
  id: string;
  type: "title" | "subtitle" | "text" | "image" | "bullets" | "shape" | "youtube" | "connector";
  x: number; // % from left (0-100)
  y: number; // % from top (0-100)
  w: number; // % width (0-100)
  h: number; // % height (0-100)
  content: string; // text content or image URL
  fontSize?: number; // px
  fontWeight?: "normal" | "bold";
  fontFamily?: string; // Google Fonts family name
  textAlign?: "left" | "center" | "right" | "justify";
  lineHeight?: number; // multiplier, e.g. 1.2, 1.5, 2
  color?: string; // hex
  zIndex?: number;
  locked?: boolean; // prevent move/resize/edit
  imageSource?: string;
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

export interface ManualSlide {
  id: string;
  layout: ManualLayoutId;
  elements: ManualSlideElement[];
  notes: string;
  bgColor: string; // hex without #
  accentColor: string; // hex without #
}

export interface ManualPresentation {
  title: string;
  slides: ManualSlide[];
}

export interface ManualCreation {
  id: string;
  title: string;
  presentation: ManualPresentation;
  createdAt: number;
  updatedAt: number;
}

// ── Layout templates ──
function createId(): string {
  return crypto.randomUUID();
}

function makeElement(
  type: ManualSlideElement["type"],
  x: number, y: number, w: number, h: number,
  content: string,
  extra?: Partial<ManualSlideElement>
): ManualSlideElement {
  return { id: createId(), type, x, y, w, h, content, zIndex: 1, ...extra };
}

export function createSlideFromLayout(layout: ManualLayoutId, accent = "6366F1"): ManualSlide {
  const base: Omit<ManualSlide, "elements"> = {
    id: createId(),
    layout,
    notes: "",
    bgColor: "FFFFFF",
    accentColor: accent,
  };
  const layoutDef = SLIDE_LAYOUTS.find((item) => item.id === layout) || SLIDE_LAYOUTS[0];
  const imageElements = layoutDef.slots.map((slot, index) =>
    makeElement(
      "image",
      Math.round(slot.x * 1000) / 10,
      Math.round(slot.y * 1000) / 10,
      Math.round(slot.w * 1000) / 10,
      Math.round(slot.h * 1000) / 10,
      "",
      { fontSize: 14, zIndex: index + 1 },
    )
  );

  return {
    ...base,
    elements: imageElements,
  };
}

// ── Predefined slide templates ──
export type PredefinedTemplateId = "cover" | "closing" | "comparison" | "timeline";

export interface PredefinedTemplate {
  id: PredefinedTemplateId;
  label: { en: string; es: string };
  icon: string;
}

export const PREDEFINED_TEMPLATES: PredefinedTemplate[] = [
  { id: "cover", label: { en: "Cover", es: "Portada" }, icon: "🎬" },
  { id: "closing", label: { en: "Closing", es: "Cierre" }, icon: "🎯" },
  { id: "comparison", label: { en: "Comparison", es: "Comparativa" }, icon: "⚖️" },
  { id: "timeline", label: { en: "Timeline", es: "Línea de tiempo" }, icon: "📅" },
];

export function createSlideFromTemplate(templateId: PredefinedTemplateId, accent = "6366F1"): ManualSlide {
  const base: Omit<ManualSlide, "elements"> = {
    id: createId(),
    layout: "single",
    notes: "",
    bgColor: "1E293B",
    accentColor: accent,
  };

  switch (templateId) {
    case "cover":
      return {
        ...base,
        bgColor: "0F172A",
        elements: [
          makeElement("image", 0, 0, 100, 100, "", { zIndex: 1, imageAdjustment: { scale: 1, offsetX: 0, offsetY: 0, opacity: 40 } }),
          makeElement("title", 8, 32, 84, 16, "Presentation Title", { fontSize: 42, fontWeight: "bold", color: "FFFFFF", zIndex: 3, textAlign: "center" }),
          makeElement("subtitle", 15, 52, 70, 10, "Your subtitle goes here", { fontSize: 20, color: "94A3B8", zIndex: 3, textAlign: "center" }),
          makeElement("shape", 35, 49, 30, 0.6, "", { zIndex: 2, shapeKind: "rectangle", shapeFill: accent, shapeOpacity: 80 }),
        ],
      };

    case "closing":
      return {
        ...base,
        bgColor: "0F172A",
        elements: [
          makeElement("title", 10, 28, 80, 16, "Thank You!", { fontSize: 48, fontWeight: "bold", color: "FFFFFF", zIndex: 2, textAlign: "center" }),
          makeElement("subtitle", 15, 48, 70, 8, "Questions & Discussion", { fontSize: 22, color: "94A3B8", zIndex: 2, textAlign: "center" }),
          makeElement("text", 25, 62, 50, 8, "email@example.com", { fontSize: 16, color: "64748B", zIndex: 2, textAlign: "center" }),
          makeElement("shape", 35, 45, 30, 0.6, "", { zIndex: 1, shapeKind: "rectangle", shapeFill: accent, shapeOpacity: 80 }),
        ],
      };

    case "comparison":
      return {
        ...base,
        bgColor: "FFFFFF",
        elements: [
          makeElement("title", 5, 4, 90, 10, "Comparison", { fontSize: 32, fontWeight: "bold", color: "1E293B", zIndex: 2, textAlign: "center" }),
          // Left column
          makeElement("shape", 3, 18, 45, 76, "", { zIndex: 1, shapeKind: "rounded-rect", shapeFill: "F1F5F9", shapeOpacity: 100, shapeBorderColor: "E2E8F0", shapeBorderWidth: 1 }),
          makeElement("subtitle", 5, 20, 41, 8, "Option A", { fontSize: 22, fontWeight: "bold", color: accent, zIndex: 2, textAlign: "center" }),
          makeElement("bullets", 7, 32, 37, 58, "Feature one\nFeature two\nFeature three", { fontSize: 16, color: "334155", zIndex: 2 }),
          // Right column
          makeElement("shape", 52, 18, 45, 76, "", { zIndex: 1, shapeKind: "rounded-rect", shapeFill: "F1F5F9", shapeOpacity: 100, shapeBorderColor: "E2E8F0", shapeBorderWidth: 1 }),
          makeElement("subtitle", 54, 20, 41, 8, "Option B", { fontSize: 22, fontWeight: "bold", color: accent, zIndex: 2, textAlign: "center" }),
          makeElement("bullets", 56, 32, 37, 58, "Feature one\nFeature two\nFeature three", { fontSize: 16, color: "334155", zIndex: 2 }),
          // VS divider
          makeElement("shape", 46.5, 42, 7, 7, "", { zIndex: 3, shapeKind: "ellipse", shapeFill: accent, shapeOpacity: 100 }),
          makeElement("text", 46.5, 43, 7, 5, "VS", { fontSize: 14, fontWeight: "bold", color: "FFFFFF", zIndex: 4, textAlign: "center" }),
        ],
      };

    case "timeline":
      return {
        ...base,
        bgColor: "FFFFFF",
        elements: [
          makeElement("title", 5, 4, 90, 10, "Timeline", { fontSize: 32, fontWeight: "bold", color: "1E293B", zIndex: 2, textAlign: "center" }),
          // Horizontal line
          makeElement("shape", 8, 48, 84, 0.8, "", { zIndex: 1, shapeKind: "rectangle", shapeFill: "CBD5E1" }),
          // Step 1
          makeElement("shape", 14, 44, 3, 9, "", { zIndex: 2, shapeKind: "ellipse", shapeFill: accent }),
          makeElement("text", 7, 28, 17, 14, "**Step 1**\nDescription", { fontSize: 13, color: "334155", zIndex: 2, textAlign: "center" }),
          // Step 2
          makeElement("shape", 35, 44, 3, 9, "", { zIndex: 2, shapeKind: "ellipse", shapeFill: accent }),
          makeElement("text", 28, 55, 17, 14, "**Step 2**\nDescription", { fontSize: 13, color: "334155", zIndex: 2, textAlign: "center" }),
          // Step 3
          makeElement("shape", 56, 44, 3, 9, "", { zIndex: 2, shapeKind: "ellipse", shapeFill: accent }),
          makeElement("text", 49, 28, 17, 14, "**Step 3**\nDescription", { fontSize: 13, color: "334155", zIndex: 2, textAlign: "center" }),
          // Step 4
          makeElement("shape", 77, 44, 3, 9, "", { zIndex: 2, shapeKind: "ellipse", shapeFill: accent }),
          makeElement("text", 70, 55, 17, 14, "**Step 4**\nDescription", { fontSize: 13, color: "334155", zIndex: 2, textAlign: "center" }),
        ],
      };
  }
}

// ── Undo/redo history ──
interface HistoryState {
  slides: ManualSlide[];
  selectedSlideIndex: number;
}

interface ManualStoreState {
  // Manual creations
  creations: ManualCreation[];
  activeCreationId: string | null;
  isLoaded: boolean;
  lastSavedAt: number | null;

  // Presentation data
  presentation: ManualPresentation;
  selectedSlideIndex: number;
  selectedElementId: string | null;
  isFullscreen: boolean;
  showImageSearch: boolean;
  imageSearchTargetElementId: string | null;

  // Undo/Redo
  undoStack: HistoryState[];
  redoStack: HistoryState[];

  // Actions
  loadCreations: () => void;
  createCreation: () => void;
  selectCreation: (creationId: string) => void;
  renameCreation: (creationId: string, title: string) => void;
  deleteCreation: (creationId: string) => void;
  saveActiveCreation: () => void;
  setTitle: (title: string) => void;
  addSlide: (layout: ManualLayoutId, count?: number) => void;
  insertSlideAt: (index: number, layout: ManualLayoutId) => void;
  addSlideFromTemplate: (templateId: PredefinedTemplateId, count?: number) => void;
  duplicateSlide: (index: number) => void;
  deleteSlide: (index: number) => void;
  deleteSlides: (indices: number[]) => void;
  moveSlide: (fromIndex: number, toIndex: number) => void;
  selectSlide: (index: number) => void;
  selectElement: (id: string | null) => void;

  // Element editing (pushes undo)
  updateElement: (slideIndex: number, elementId: string, updates: Partial<ManualSlideElement>) => void;
  updateElements: (slideIndex: number, updates: Array<{ elementId: string; updates: Partial<ManualSlideElement> }>) => void;
  addElement: (slideIndex: number, element: ManualSlideElement) => void;
  removeElement: (slideIndex: number, elementId: string) => void;

  // Slide editing
  updateSlideNotes: (index: number, notes: string) => void;
  updateSlideBgColor: (index: number, color: string) => void;
  applyBgColorToAll: (color: string) => void;
  updateSlideAccentColor: (index: number, color: string) => void;
  updateSlideLayout: (index: number, layout: ManualLayoutId) => void;

  // Undo/redo
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;

  // Import
  importCreation: (presentation: ManualPresentation) => string;

  // UI
  setFullscreen: (v: boolean) => void;
  setShowImageSearch: (v: boolean, targetElementId?: string | null) => void;

  // Reset
  reset: () => void;
}

const MAX_UNDO = 20;
const MANUAL_CREATIONS_API = "/api/manual-creations";
const LEGACY_STORAGE_KEY = "trueslides.manual.creations.v1";
const SAVE_DEBOUNCE_MS = 800;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Clone slides using structuredClone (modern API) for efficiency.
 * Falls back to JSON.parse/stringify for older browsers.
 * structuredClone is ~50x faster and avoids creating large intermediate strings.
 */
function cloneSlides(slides: ManualSlide[]): ManualSlide[] {
  // Check if structuredClone is available (modern browsers)
  if (typeof globalThis !== "undefined" && typeof (globalThis as any).structuredClone === "function") {
    return (globalThis as any).structuredClone(slides);
  }
  // Fallback for older environments
  return JSON.parse(JSON.stringify(slides));
}

const initialPresentation: ManualPresentation = {
  title: "Untitled Manual Deck",
  slides: [],
};

/**
 * Clone presentation using structuredClone (modern API) for efficiency.
 * Falls back to JSON.parse/stringify for older browsers.
 * Avoids allocating giant intermediate JSON strings during deep copies.
 */
function clonePresentation(presentation: ManualPresentation): ManualPresentation {
  // Check if structuredClone is available (modern browsers)
  if (typeof globalThis !== "undefined" && typeof (globalThis as any).structuredClone === "function") {
    return (globalThis as any).structuredClone(presentation);
  }
  // Fallback for older environments
  return JSON.parse(JSON.stringify(presentation));
}

function toCreation(title: string): ManualCreation {
  const now = Date.now();
  return {
    id: createId(),
    title,
    presentation: { title, slides: [] },
    createdAt: now,
    updatedAt: now,
  };
}

function normalizePersistedCreations(data: unknown): { creations: ManualCreation[]; activeCreationId: string | null } {
  if (!data || typeof data !== "object") {
    return { creations: [], activeCreationId: null };
  }
  const parsed = data as { creations?: ManualCreation[]; activeCreationId?: string | null };
  const creations = Array.isArray(parsed.creations)
    ? parsed.creations.map((creation) => ({
        ...creation,
        presentation: creation.presentation || { title: creation.title || "Untitled Manual Deck", slides: [] },
      }))
    : [];
  return {
    creations,
    activeCreationId: parsed.activeCreationId || creations[0]?.id || null,
  };
}

async function fetchPersistedCreations(): Promise<{ creations: ManualCreation[]; activeCreationId: string | null }> {
  if (typeof window === "undefined") return { creations: [], activeCreationId: null };
  try {
    const res = await fetch(MANUAL_CREATIONS_API, { method: "GET" });
    if (!res.ok) return { creations: [], activeCreationId: null };
    const body = await res.json() as { state?: unknown };
    return normalizePersistedCreations(body.state);
  } catch {
    return { creations: [], activeCreationId: null };
  }
}

function readLegacyLocalCreations(): { creations: ManualCreation[]; activeCreationId: string | null } {
  if (typeof window === "undefined") return { creations: [], activeCreationId: null };
  try {
    const raw = window.localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return { creations: [], activeCreationId: null };
    return normalizePersistedCreations(JSON.parse(raw));
  } catch {
    return { creations: [], activeCreationId: null };
  }
}

function mergeCreations(
  primary: { creations: ManualCreation[]; activeCreationId: string | null },
  fallback: { creations: ManualCreation[]; activeCreationId: string | null },
): { creations: ManualCreation[]; activeCreationId: string | null } {
  const byId = new Map<string, ManualCreation>();

  for (const creation of primary.creations) {
    byId.set(creation.id, creation);
  }
  for (const creation of fallback.creations) {
    const existing = byId.get(creation.id);
    if (!existing || (creation.updatedAt || 0) > (existing.updatedAt || 0)) {
      byId.set(creation.id, creation);
    }
  }

  const creations = Array.from(byId.values()).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  const activeCreationId =
    primary.activeCreationId && byId.has(primary.activeCreationId)
      ? primary.activeCreationId
      : fallback.activeCreationId && byId.has(fallback.activeCreationId)
        ? fallback.activeCreationId
        : creations[0]?.id || null;

  return { creations, activeCreationId };
}

function persistCreations(creations: ManualCreation[], activeCreationId: string | null, immediate = false) {
  if (typeof window === "undefined") return;
  const payload = { state: { creations, activeCreationId } };
  const doSave = () => {
    fetch(MANUAL_CREATIONS_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).catch((error) => {
      console.warn("Failed to persist manual creations to server", error);
    });
  };

  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }

  if (immediate) {
    doSave();
    return;
  }
  saveTimer = setTimeout(doSave, SAVE_DEBOUNCE_MS);
}

function syncActiveCreation(
  creations: ManualCreation[],
  activeCreationId: string | null,
  presentation: ManualPresentation,
): ManualCreation[] {
  if (!activeCreationId) return creations;
  const now = Date.now();
  return creations.map((creation) =>
    creation.id === activeCreationId
      ? {
          ...creation,
          title: presentation.title,
          presentation: clonePresentation(presentation),
          updatedAt: now,
        }
      : creation
  );
}

function withHistory(state: ManualStoreState) {
  return {
    undoStack: [
      ...state.undoStack.slice(-MAX_UNDO + 1),
      {
        slides: cloneSlides(state.presentation.slides),
        selectedSlideIndex: state.selectedSlideIndex,
      },
    ],
    redoStack: [],
  };
}

export const useManualStore = create<ManualStoreState>()((set, get) => ({
  creations: [],
  activeCreationId: null,
  isLoaded: false,
  lastSavedAt: null,
  presentation: initialPresentation,
  selectedSlideIndex: 0,
  selectedElementId: null,
  isFullscreen: false,
  showImageSearch: false,
  imageSearchTargetElementId: null,
  undoStack: [],
  redoStack: [],

  loadCreations: () => {
    void (async () => {
      const serverState = await fetchPersistedCreations();
      const legacyState = readLegacyLocalCreations();
      const merged = mergeCreations(serverState, legacyState);

      if (
        merged.creations.length > 0
        && (serverState.creations.length !== merged.creations.length || serverState.activeCreationId !== merged.activeCreationId)
      ) {
        // One-time recovery/backfill to ensure legacy browser creations are not lost after migration.
        persistCreations(merged.creations, merged.activeCreationId, true);
      }

      const active = merged.creations.find((creation) => creation.id === merged.activeCreationId) || null;
      set({
        creations: merged.creations,
        activeCreationId: active?.id || null,
        presentation: active ? clonePresentation(active.presentation) : { ...initialPresentation },
        selectedSlideIndex: 0,
        selectedElementId: null,
        undoStack: [],
        redoStack: [],
        isLoaded: true,
      });
    })();
  },

  createCreation: () => {
    const state = get();
    const baseTitle = "Untitled Manual Deck";
    const nextCount = state.creations.filter((creation) => creation.title.startsWith(baseTitle)).length + 1;
    const title = nextCount > 1 ? `${baseTitle} ${nextCount}` : baseTitle;
    const creation = toCreation(title);
    const creations = [...state.creations, creation];
    persistCreations(creations, creation.id);
    set({
      creations,
      activeCreationId: creation.id,
      presentation: clonePresentation(creation.presentation),
      selectedSlideIndex: 0,
      selectedElementId: null,
      undoStack: [],
      redoStack: [],
      lastSavedAt: Date.now(),
    });
  },

  importCreation: (incoming: ManualPresentation) => {
    const now = Date.now();
    const creation: ManualCreation = {
      id: createId(),
      title: incoming.title || "Imported Deck",
      presentation: clonePresentation(incoming),
      createdAt: now,
      updatedAt: now,
    };
    const state = get();
    const creations = [...state.creations, creation];
    persistCreations(creations, creation.id);
    set({
      creations,
      activeCreationId: creation.id,
      presentation: clonePresentation(creation.presentation),
      selectedSlideIndex: 0,
      selectedElementId: null,
      undoStack: [],
      redoStack: [],
      lastSavedAt: now,
    });
    return creation.id;
  },

  selectCreation: (creationId) => {
    const state = get();
    const creation = state.creations.find((item) => item.id === creationId);
    if (!creation) return;
    persistCreations(state.creations, creationId);
    set({
      activeCreationId: creationId,
      presentation: clonePresentation(creation.presentation),
      selectedSlideIndex: 0,
      selectedElementId: null,
      undoStack: [],
      redoStack: [],
    });
  },

  renameCreation: (creationId, title) => {
    const state = get();
    const nextTitle = title.trim() || "Untitled Manual Deck";
    const now = Date.now();
    const creations = state.creations.map((creation) =>
      creation.id === creationId
        ? {
            ...creation,
            title: nextTitle,
            presentation: { ...creation.presentation, title: nextTitle },
            updatedAt: now,
          }
        : creation
    );
    const presentation =
      state.activeCreationId === creationId
        ? { ...state.presentation, title: nextTitle }
        : state.presentation;
    persistCreations(creations, state.activeCreationId, true);
    set({ creations, presentation, lastSavedAt: now });
  },

  deleteCreation: (creationId) => {
    const state = get();
    const creations = state.creations.filter((creation) => creation.id !== creationId);
    let activeCreationId = state.activeCreationId;
    let presentation = state.presentation;
    if (state.activeCreationId === creationId) {
      const nextActive = creations[0] || null;
      activeCreationId = nextActive?.id || null;
      presentation = nextActive ? clonePresentation(nextActive.presentation) : { ...initialPresentation };
    }
    persistCreations(creations, activeCreationId);
    set({
      creations,
      activeCreationId,
      presentation,
      selectedSlideIndex: 0,
      selectedElementId: null,
      undoStack: [],
      redoStack: [],
      lastSavedAt: Date.now(),
    });
  },

  saveActiveCreation: () => {
    const state = get();
    const creations = syncActiveCreation(state.creations, state.activeCreationId, state.presentation);
    persistCreations(creations, state.activeCreationId, true);
    set({ creations, lastSavedAt: Date.now() });
  },

  setTitle: (title) =>
    set((state) => {
      if (state.presentation.title === title) return state;
      const presentation = { ...state.presentation, title };
      const creations = syncActiveCreation(state.creations, state.activeCreationId, presentation);
      persistCreations(creations, state.activeCreationId);
      return {
        ...withHistory(state),
        presentation,
        creations,
        lastSavedAt: Date.now(),
      };
    }),

  addSlide: (layout, count = 1) => {
    const state = get();
    if (!state.activeCreationId) return;
    const accent = state.presentation.slides[0]?.accentColor || "6366F1";
    const newSlides = Array.from({ length: Math.max(1, count) }, () => createSlideFromLayout(layout, accent));
    const slides = [...state.presentation.slides, ...newSlides];
    const presentation = { ...state.presentation, slides };
    const creations = syncActiveCreation(state.creations, state.activeCreationId, presentation);
    persistCreations(creations, state.activeCreationId, true);
    set({
      undoStack: [...state.undoStack.slice(-MAX_UNDO + 1), { slides: cloneSlides(state.presentation.slides), selectedSlideIndex: state.selectedSlideIndex }],
      redoStack: [],
      presentation,
      creations,
      selectedSlideIndex: slides.length - 1,
      selectedElementId: null,
      lastSavedAt: Date.now(),
    });
  },

  insertSlideAt: (index, layout) => {
    const state = get();
    if (!state.activeCreationId) return;
    const accent = state.presentation.slides[0]?.accentColor || "6366F1";
    const newSlide = createSlideFromLayout(layout, accent);
    const slides = [...state.presentation.slides];
    slides.splice(index, 0, newSlide);
    const presentation = { ...state.presentation, slides };
    const creations = syncActiveCreation(state.creations, state.activeCreationId, presentation);
    persistCreations(creations, state.activeCreationId, true);
    set({
      undoStack: [...state.undoStack.slice(-MAX_UNDO + 1), { slides: cloneSlides(state.presentation.slides), selectedSlideIndex: state.selectedSlideIndex }],
      redoStack: [],
      presentation,
      creations,
      selectedSlideIndex: index,
      selectedElementId: null,
      lastSavedAt: Date.now(),
    });
  },

  addSlideFromTemplate: (templateId, count = 1) => {
    const state = get();
    if (!state.activeCreationId) return;
    const accent = state.presentation.slides[0]?.accentColor || "6366F1";
    const newSlides = Array.from({ length: Math.max(1, count) }, () => createSlideFromTemplate(templateId, accent));
    const slides = [...state.presentation.slides, ...newSlides];
    const presentation = { ...state.presentation, slides };
    const creations = syncActiveCreation(state.creations, state.activeCreationId, presentation);
    persistCreations(creations, state.activeCreationId, true);
    set({
      undoStack: [...state.undoStack.slice(-MAX_UNDO + 1), { slides: cloneSlides(state.presentation.slides), selectedSlideIndex: state.selectedSlideIndex }],
      redoStack: [],
      presentation,
      creations,
      selectedSlideIndex: slides.length - 1,
      selectedElementId: null,
      lastSavedAt: Date.now(),
    });
  },

  duplicateSlide: (index) => {
    const state = get();
    if (!state.activeCreationId) return;
    const slide = state.presentation.slides[index];
    if (!slide) return;
    const dup: ManualSlide = {
      ...JSON.parse(JSON.stringify(slide)),
      id: createId(),
      elements: slide.elements.map((el) => ({ ...JSON.parse(JSON.stringify(el)), id: createId() })),
    };
    const slides = [...state.presentation.slides];
    slides.splice(index + 1, 0, dup);
    const presentation = { ...state.presentation, slides };
    const creations = syncActiveCreation(state.creations, state.activeCreationId, presentation);
    persistCreations(creations, state.activeCreationId, true);
    set({
      undoStack: [...state.undoStack.slice(-MAX_UNDO + 1), { slides: cloneSlides(state.presentation.slides), selectedSlideIndex: state.selectedSlideIndex }],
      redoStack: [],
      presentation,
      creations,
      selectedSlideIndex: index + 1,
      lastSavedAt: Date.now(),
    });
  },

  deleteSlide: (index) => {
    const state = get();
    if (!state.activeCreationId) return;
    if (state.presentation.slides.length <= 0) return;
    const slides = state.presentation.slides.filter((_, i) => i !== index);
    const newIndex = Math.min(state.selectedSlideIndex, Math.max(0, slides.length - 1));
    const presentation = { ...state.presentation, slides };
    const creations = syncActiveCreation(state.creations, state.activeCreationId, presentation);
    persistCreations(creations, state.activeCreationId);
    set({
      undoStack: [...state.undoStack.slice(-MAX_UNDO + 1), { slides: cloneSlides(state.presentation.slides), selectedSlideIndex: state.selectedSlideIndex }],
      redoStack: [],
      presentation,
      creations,
      selectedSlideIndex: newIndex,
      selectedElementId: null,
      lastSavedAt: Date.now(),
    });
  },

  deleteSlides: (indices) => {
    const state = get();
    if (!state.activeCreationId) return;
    if (indices.length === 0) return;
    const toDelete = new Set(indices);
    const slides = state.presentation.slides.filter((_, i) => !toDelete.has(i));
    const newIndex = Math.min(state.selectedSlideIndex, Math.max(0, slides.length - 1));
    const presentation = { ...state.presentation, slides };
    const creations = syncActiveCreation(state.creations, state.activeCreationId, presentation);
    persistCreations(creations, state.activeCreationId);
    set({
      undoStack: [...state.undoStack.slice(-MAX_UNDO + 1), { slides: cloneSlides(state.presentation.slides), selectedSlideIndex: state.selectedSlideIndex }],
      redoStack: [],
      presentation,
      creations,
      selectedSlideIndex: newIndex,
      selectedElementId: null,
      lastSavedAt: Date.now(),
    });
  },

  moveSlide: (fromIndex, toIndex) => {
    const state = get();
    if (!state.activeCreationId) return;
    const slides = [...state.presentation.slides];
    const [moved] = slides.splice(fromIndex, 1);
    slides.splice(toIndex, 0, moved);
    const presentation = { ...state.presentation, slides };
    const creations = syncActiveCreation(state.creations, state.activeCreationId, presentation);
    persistCreations(creations, state.activeCreationId);
    set({
      undoStack: [...state.undoStack.slice(-MAX_UNDO + 1), { slides: cloneSlides(state.presentation.slides), selectedSlideIndex: state.selectedSlideIndex }],
      redoStack: [],
      presentation,
      creations,
      selectedSlideIndex: toIndex,
      lastSavedAt: Date.now(),
    });
  },

  selectSlide: (index) => set({ selectedSlideIndex: index, selectedElementId: null }),
  selectElement: (id) => set({ selectedElementId: id }),

  updateElement: (slideIndex, elementId, updates) => {
    const state = get();
    if (!state.activeCreationId) return;
    const slides = cloneSlides(state.presentation.slides);
    const slide = slides[slideIndex];
    if (!slide) return;
    slide.elements = slide.elements.map((el) =>
      el.id === elementId ? { ...el, ...updates } : el
    );
    const presentation = { ...state.presentation, slides };
    const creations = syncActiveCreation(state.creations, state.activeCreationId, presentation);
    persistCreations(creations, state.activeCreationId);
    set({
      undoStack: [...state.undoStack.slice(-MAX_UNDO + 1), { slides: cloneSlides(state.presentation.slides), selectedSlideIndex: state.selectedSlideIndex }],
      redoStack: [],
      presentation,
      creations,
      lastSavedAt: Date.now(),
    });
  },

  updateElements: (slideIndex, updatesList) => {
    const state = get();
    if (!state.activeCreationId || updatesList.length === 0) return;
    const slides = cloneSlides(state.presentation.slides);
    const slide = slides[slideIndex];
    if (!slide) return;
    const updatesMap = new Map(updatesList.map((item) => [item.elementId, item.updates]));
    slide.elements = slide.elements.map((el) => {
      const updates = updatesMap.get(el.id);
      return updates ? { ...el, ...updates } : el;
    });
    const presentation = { ...state.presentation, slides };
    const creations = syncActiveCreation(state.creations, state.activeCreationId, presentation);
    persistCreations(creations, state.activeCreationId);
    set({
      undoStack: [...state.undoStack.slice(-MAX_UNDO + 1), { slides: cloneSlides(state.presentation.slides), selectedSlideIndex: state.selectedSlideIndex }],
      redoStack: [],
      presentation,
      creations,
      lastSavedAt: Date.now(),
    });
  },

  addElement: (slideIndex, element) => {
    const state = get();
    if (!state.activeCreationId) return;
    const slides = cloneSlides(state.presentation.slides);
    const slide = slides[slideIndex];
    if (!slide) return;
    slide.elements.push(element);
    const presentation = { ...state.presentation, slides };
    const creations = syncActiveCreation(state.creations, state.activeCreationId, presentation);
    persistCreations(creations, state.activeCreationId);
    set({
      undoStack: [...state.undoStack.slice(-MAX_UNDO + 1), { slides: cloneSlides(state.presentation.slides), selectedSlideIndex: state.selectedSlideIndex }],
      redoStack: [],
      presentation,
      creations,
      lastSavedAt: Date.now(),
    });
  },

  removeElement: (slideIndex, elementId) => {
    const state = get();
    if (!state.activeCreationId) return;
    const slides = cloneSlides(state.presentation.slides);
    const slide = slides[slideIndex];
    if (!slide) return;
    slide.elements = slide.elements.filter((el) => el.id !== elementId);
    const presentation = { ...state.presentation, slides };
    const creations = syncActiveCreation(state.creations, state.activeCreationId, presentation);
    persistCreations(creations, state.activeCreationId);
    set({
      undoStack: [...state.undoStack.slice(-MAX_UNDO + 1), { slides: cloneSlides(state.presentation.slides), selectedSlideIndex: state.selectedSlideIndex }],
      redoStack: [],
      presentation,
      creations,
      selectedElementId: null,
      lastSavedAt: Date.now(),
    });
  },

  updateSlideNotes: (index, notes) => {
    const state = get();
    if (!state.activeCreationId) return;
    const slides = cloneSlides(state.presentation.slides);
    if (!slides[index] || slides[index].notes === notes) return;
    slides[index].notes = notes;
    const presentation = { ...state.presentation, slides };
    const creations = syncActiveCreation(state.creations, state.activeCreationId, presentation);
    persistCreations(creations, state.activeCreationId);
    set({
      ...withHistory(state),
      presentation,
      creations,
      lastSavedAt: Date.now(),
    });
  },

  updateSlideBgColor: (index, color) => {
    const state = get();
    if (!state.activeCreationId) return;
    const slides = cloneSlides(state.presentation.slides);
    if (!slides[index]) return;
    slides[index].bgColor = color;
    const presentation = { ...state.presentation, slides };
    const creations = syncActiveCreation(state.creations, state.activeCreationId, presentation);
    persistCreations(creations, state.activeCreationId);
    set({
      undoStack: [...state.undoStack.slice(-MAX_UNDO + 1), { slides: cloneSlides(state.presentation.slides), selectedSlideIndex: state.selectedSlideIndex }],
      redoStack: [],
      presentation,
      creations,
      lastSavedAt: Date.now(),
    });
  },

  applyBgColorToAll: (color) => {
    const state = get();
    if (!state.activeCreationId) return;
    const slides = cloneSlides(state.presentation.slides);
    if (slides.length === 0) return;
    for (const slide of slides) slide.bgColor = color;
    const presentation = { ...state.presentation, slides };
    const creations = syncActiveCreation(state.creations, state.activeCreationId, presentation);
    persistCreations(creations, state.activeCreationId);
    set({
      undoStack: [...state.undoStack.slice(-MAX_UNDO + 1), { slides: cloneSlides(state.presentation.slides), selectedSlideIndex: state.selectedSlideIndex }],
      redoStack: [],
      presentation,
      creations,
      lastSavedAt: Date.now(),
    });
  },

  updateSlideAccentColor: (index, color) => {
    const state = get();
    if (!state.activeCreationId) return;
    const slides = cloneSlides(state.presentation.slides);
    if (!slides[index]) return;
    slides[index].accentColor = color;
    const presentation = { ...state.presentation, slides };
    const creations = syncActiveCreation(state.creations, state.activeCreationId, presentation);
    persistCreations(creations, state.activeCreationId);
    set({
      undoStack: [...state.undoStack.slice(-MAX_UNDO + 1), { slides: cloneSlides(state.presentation.slides), selectedSlideIndex: state.selectedSlideIndex }],
      redoStack: [],
      presentation,
      creations,
      lastSavedAt: Date.now(),
    });
  },

  updateSlideLayout: (index, layout) => {
    const state = get();
    if (!state.activeCreationId) return;
    const accent = state.presentation.slides[index]?.accentColor || "6366F1";
    const newSlide = createSlideFromLayout(layout, accent);
    const slides = cloneSlides(state.presentation.slides);
    if (!slides[index]) return;
    // Keep notes and bg from old slide
    newSlide.id = slides[index].id;
    newSlide.notes = slides[index].notes;
    newSlide.bgColor = slides[index].bgColor;
    newSlide.accentColor = slides[index].accentColor;
    slides[index] = newSlide;
    const presentation = { ...state.presentation, slides };
    const creations = syncActiveCreation(state.creations, state.activeCreationId, presentation);
    persistCreations(creations, state.activeCreationId);
    set({
      undoStack: [...state.undoStack.slice(-MAX_UNDO + 1), { slides: cloneSlides(state.presentation.slides), selectedSlideIndex: state.selectedSlideIndex }],
      redoStack: [],
      presentation,
      creations,
      selectedElementId: null,
      lastSavedAt: Date.now(),
    });
  },

  undo: () => {
    const state = get();
    if (!state.activeCreationId) return;
    if (state.undoStack.length === 0) return;
    const prev = state.undoStack[state.undoStack.length - 1];
    const presentation = { ...state.presentation, slides: prev.slides };
    const creations = syncActiveCreation(state.creations, state.activeCreationId, presentation);
    persistCreations(creations, state.activeCreationId);
    set({
      redoStack: [...state.redoStack, { slides: cloneSlides(state.presentation.slides), selectedSlideIndex: state.selectedSlideIndex }],
      undoStack: state.undoStack.slice(0, -1),
      presentation,
      creations,
      selectedSlideIndex: prev.selectedSlideIndex,
      selectedElementId: null,
      lastSavedAt: Date.now(),
    });
  },

  redo: () => {
    const state = get();
    if (!state.activeCreationId) return;
    if (state.redoStack.length === 0) return;
    const next = state.redoStack[state.redoStack.length - 1];
    const presentation = { ...state.presentation, slides: next.slides };
    const creations = syncActiveCreation(state.creations, state.activeCreationId, presentation);
    persistCreations(creations, state.activeCreationId);
    set({
      undoStack: [...state.undoStack, { slides: cloneSlides(state.presentation.slides), selectedSlideIndex: state.selectedSlideIndex }],
      redoStack: state.redoStack.slice(0, -1),
      presentation,
      creations,
      selectedSlideIndex: next.selectedSlideIndex,
      selectedElementId: null,
      lastSavedAt: Date.now(),
    });
  },

  canUndo: () => get().undoStack.length > 0,
  canRedo: () => get().redoStack.length > 0,

  setFullscreen: (v) => set({ isFullscreen: v }),
  setShowImageSearch: (v, targetElementId) => set({ showImageSearch: v, imageSearchTargetElementId: targetElementId ?? null }),

  reset: () => set({
    creations: [],
    activeCreationId: null,
    presentation: { title: "Untitled Manual Deck", slides: [] },
    selectedSlideIndex: 0,
    selectedElementId: null,
    undoStack: [],
    redoStack: [],
    isFullscreen: false,
    lastSavedAt: null,
  }),
}));
