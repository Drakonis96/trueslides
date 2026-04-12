import { useEffect, useState } from "react";
import { create } from "zustand";
import {
  AIProvider,
  AIModel,
  AppSettings,
  CustomPreset,
  DEFAULT_IMAGE_VERIFICATION,
  DEFAULT_SPEED_OPTIONS,
  GenerationConfig,
  GenerationStatus,
  HistoryEntry,
  ImageLayout,
  ImageVerificationConfig,
  LayoutMode,
  ImageSearchSpeedOptions,
  ImageSourceId,
  Language,
  NotesProject,
  OutputLanguage,
  PresentationData,
  PromptFieldKey,
  ProviderConfig,
  SlideLayoutId,
} from "./types";
import { DEFAULT_PROVIDERS } from "./presets";
import { DEFAULT_THEME_PACK_ID, getThemeById, ThemePackId } from "./themes";

interface AppState {
  // Settings
  settings: AppSettings;
  setLanguage: (lang: Language) => void;
  setOutputLanguage: (lang: OutputLanguage) => void;
  setProviderHasKey: (provider: AIProvider, hasKey: boolean) => void;
  setProviderModels: (provider: AIProvider, models: AIModel[]) => void;
  toggleModelPin: (provider: AIProvider, modelId: string) => void;
  toggleImageSource: (sourceId: ImageSourceId) => void;
  setImageSourceHasKey: (sourceId: ImageSourceId, hasKey: boolean) => void;
  setSpeedOption: <K extends keyof ImageSearchSpeedOptions>(key: K, value: ImageSearchSpeedOptions[K]) => void;
  setImageVerification: <K extends keyof ImageVerificationConfig>(key: K, value: ImageVerificationConfig[K]) => void;

  // Generation config
  selectedProvider: AIProvider;
  selectedModelId: string;
  slideCount: number;
  customSlideCount: boolean;
  imageLayout: ImageLayout;
  layoutMode: LayoutMode;
  slideLayout: SlideLayoutId;
  stretchImages: boolean;
  slideBgColor: string;
  slideAccentColor: string;
  selectedTheme: ThemePackId;
  headingFontFamily: string;
  bodyFontFamily: string;
  headingFontFace: string;
  bodyFontFace: string;
  overlaySectionFontSize: number;
  overlayTitleFontSize: number;
  overlaySectionColor: string;
  overlayTitleColor: string;
  overlayTextGap: number;
  textDensity: number;
  customTextDensity: boolean;
  prompts: Record<PromptFieldKey, string>;
  sourceText: string;
  sourceFileName: string;
  showImageSource: boolean;
  imageSourceFontColor: string;

  setSelectedProvider: (p: AIProvider) => void;
  setSelectedModelId: (id: string) => void;
  setSlideCount: (n: number) => void;
  setCustomSlideCount: (v: boolean) => void;
  setImageLayout: (l: ImageLayout) => void;
  setLayoutMode: (m: LayoutMode) => void;
  setSlideLayout: (l: SlideLayoutId) => void;
  setStretchImages: (v: boolean) => void;
  setSlideBgColor: (c: string) => void;
  setSlideAccentColor: (c: string) => void;
  setSelectedTheme: (id: ThemePackId) => void;
  applyThemePack: (id: ThemePackId) => void;
  setOverlaySectionFontSize: (n: number) => void;
  setOverlayTitleFontSize: (n: number) => void;
  setOverlaySectionColor: (c: string) => void;
  setOverlayTitleColor: (c: string) => void;
  setOverlayTextGap: (n: number) => void;
  setTextDensity: (n: number) => void;
  setCustomTextDensity: (v: boolean) => void;
  setPrompt: (field: PromptFieldKey, text: string) => void;
  setSourceText: (t: string) => void;
  setSourceFileName: (n: string) => void;
  setShowImageSource: (v: boolean) => void;
  setImageSourceFontColor: (c: string) => void;

  // Generation state
  status: GenerationStatus;
  statusMessage: string;
  progress: number; // 0-100
  presentation: PresentationData | null;
  error: string;

  setStatus: (s: GenerationStatus, msg?: string) => void;
  setProgress: (pct: number, msg?: string) => void;
  setPresentation: (p: PresentationData | null) => void;
  setError: (e: string) => void;
  updateSlide: (index: number, data: Partial<PresentationData["slides"][number]>) => void;
  updateAllSlidesAccent: (color: string) => void;

  // UI state
  showSettings: boolean;
  settingsTab: "general" | "ai" | "images" | "prompts" | "danger";
  selectedSlideIndex: number | "all";
  editorInstruction: string;

  setShowSettings: (v: boolean) => void;
  setSettingsTab: (t: "general" | "ai" | "images" | "prompts" | "danger") => void;
  setSelectedSlideIndex: (i: number | "all") => void;
  setEditorInstruction: (s: string) => void;

  // Custom presets
  customPresets: CustomPreset[];
  addCustomPreset: (preset: CustomPreset) => void;
  updateCustomPreset: (id: string, label: string, text: string) => void;
  deleteCustomPreset: (id: string) => void;

  // History
  history: HistoryEntry[];
  addToHistory: (entry: HistoryEntry) => void;
  updateHistoryEntry: (id: string, updates: Partial<HistoryEntry>) => void;
  deleteFromHistory: (id: string) => void;

  // Active tab
  activeTab: "home" | "creator" | "history" | "notes" | "manual";
  setActiveTab: (tab: "home" | "creator" | "history" | "notes" | "manual") => void;
  creatorSubTab: "create" | "edit";
  notesSubTab: "create" | "edit";
  manualSubTab: "list" | "editor";
  setCreatorSubTab: (tab: "create" | "edit") => void;
  setNotesSubTab: (tab: "create" | "edit") => void;
  setManualSubTab: (tab: "list" | "editor") => void;

  // Notes generator
  notesProject: NotesProject | null;
  notesStatus: "idle" | "parsing" | "generating" | "done" | "error";
  notesStatusMessage: string;
  notesProgress: number;
  notesError: string;
  notesPrompt: string;
  notesOutputLanguage: OutputLanguage;
  notesIncludeExisting: boolean;
  notesUseVision: boolean;
  notesDocDensity: number; // 0-100 in steps of 10
  notesParagraphs: number; // 1, 2, 3, or 0 for custom (no constraint)

  setNotesProject: (p: NotesProject | null) => void;
  setNotesStatus: (s: "idle" | "parsing" | "generating" | "done" | "error", msg?: string) => void;
  setNotesProgress: (pct: number, msg?: string) => void;
  setNotesError: (e: string) => void;
  setNotesPrompt: (p: string) => void;
  setNotesOutputLanguage: (l: OutputLanguage) => void;
  setNotesIncludeExisting: (v: boolean) => void;
  setNotesUseVision: (v: boolean) => void;
  setNotesDocDensity: (v: number) => void;
  setNotesParagraphs: (v: number) => void;
  updateNote: (slideIndex: number, note: string) => void;

  // Helpers
  getPinnedModels: (provider?: AIProvider) => AIModel[];
  getActiveProvider: () => ProviderConfig | undefined;
  getEffectiveSelection: () => { provider: AIProvider; modelId: string };
  getGenerationConfig: () => GenerationConfig;

  // Server sync
  _serverLoaded: boolean;
  _loadFromServer: () => Promise<void>;
  _saveToServer: (immediate?: boolean) => void;
}

// ── Debounced server save ──

let _saveTimer: ReturnType<typeof setTimeout> | null = null;
const SAVE_DEBOUNCE_MS = 1_000;

function getPartialState(state: AppState): Record<string, unknown> {
  return {
    settings: state.settings,
    selectedProvider: state.selectedProvider,
    selectedModelId: state.selectedModelId,
    layoutMode: state.layoutMode,
    customPresets: state.customPresets,
    slideBgColor: state.slideBgColor,
    slideAccentColor: state.slideAccentColor,
    selectedTheme: state.selectedTheme,
    headingFontFamily: state.headingFontFamily,
    bodyFontFamily: state.bodyFontFamily,
    headingFontFace: state.headingFontFace,
    bodyFontFace: state.bodyFontFace,
    overlaySectionFontSize: state.overlaySectionFontSize,
    overlayTitleFontSize: state.overlayTitleFontSize,
    overlaySectionColor: state.overlaySectionColor,
    overlayTitleColor: state.overlayTitleColor,
    overlayTextGap: state.overlayTextGap,
    history: state.history,
    notesOutputLanguage: state.notesOutputLanguage,
    showImageSource: state.showImageSource,
    imageSourceFontColor: state.imageSourceFontColor,
  };
}

function migrateServerState(raw: Record<string, unknown>): Record<string, unknown> {
  const state = { ...raw };

  if (state.settings && typeof state.settings === "object") {
    const s = state.settings as Record<string, unknown>;
    if (!s.outputLanguage) s.outputLanguage = "en";
    if (!Array.isArray(s.enabledImageSources)) {
      s.enabledImageSources = ["wikimedia", "openverse", "loc"];
    }
    // Clean up old provider schema that had apiKey field
    if (Array.isArray(s.providers)) {
      s.providers = (s.providers as Record<string, unknown>[]).map((p) => {
        const { apiKey, ...rest } = p as Record<string, unknown> & { apiKey?: unknown };
        return rest;
      });
    }
    // Backfill speedOptions for existing state
    if (!s.speedOptions || typeof s.speedOptions !== "object") {
      s.speedOptions = { ...DEFAULT_SPEED_OPTIONS };
    } else {
      s.speedOptions = { ...DEFAULT_SPEED_OPTIONS, ...(s.speedOptions as Record<string, unknown>) };
    }
    // Backfill imageVerification for existing state
    if (!s.imageVerification || typeof s.imageVerification !== "object") {
      s.imageVerification = { ...DEFAULT_IMAGE_VERIFICATION };
    } else {
      s.imageVerification = { ...DEFAULT_IMAGE_VERIFICATION, ...(s.imageVerification as Record<string, unknown>) };
    }
  }

  if (!state.overlaySectionFontSize) state.overlaySectionFontSize = 16;
  if (!state.overlayTitleFontSize) state.overlayTitleFontSize = 20;
  if (!state.overlaySectionColor) state.overlaySectionColor = "D1D5DB";
  if (!state.overlayTitleColor) state.overlayTitleColor = "FFFFFF";
  if (!state.overlayTextGap) state.overlayTextGap = 0.2;
  if (!state.selectedTheme) state.selectedTheme = DEFAULT_THEME_PACK_ID;
  if (!state.headingFontFamily) state.headingFontFamily = "'Inter', 'Helvetica Neue', Arial, sans-serif";
  if (!state.bodyFontFamily) state.bodyFontFamily = "'Inter', 'Helvetica Neue', Arial, sans-serif";
  if (!state.headingFontFace) state.headingFontFace = "Aptos Display";
  if (!state.bodyFontFace) state.bodyFontFace = "Aptos";
  if (!state.layoutMode) state.layoutMode = "fixed";
  if (!Array.isArray(state.history)) state.history = [];

  // Backfill history entries missing fields
  if (Array.isArray(state.history)) {
    state.history = (state.history as Record<string, unknown>[]).map((e) => {
      if (!e.type) e.type = "presentation";
      if (!e.status) e.status = "completed";
      // "running" entries are real server-side jobs — leave them for polling to verify
      return e;
    });
  }

  if (!state.notesOutputLanguage) state.notesOutputLanguage = "en";

  if (typeof state.showImageSource !== "boolean") state.showImageSource = false;
  if (!state.imageSourceFontColor) state.imageSourceFontColor = "FFFFFF";

  return state;
}

export const useAppStore = create<AppState>()(
    (set, get) => ({
      // ── Settings ──
      settings: {
        language: "en",
        outputLanguage: "en",
        providers: DEFAULT_PROVIDERS,
        enabledImageSources: ["wikimedia", "openverse", "loc"],
        speedOptions: { ...DEFAULT_SPEED_OPTIONS },
        imageVerification: { ...DEFAULT_IMAGE_VERIFICATION },
      },

      setLanguage: (lang) =>
        set((s) => ({ settings: { ...s.settings, language: lang } })),

      setOutputLanguage: (lang) =>
        set((s) => ({ settings: { ...s.settings, outputLanguage: lang } })),

      setProviderHasKey: (provider, hasKey) =>
        set((s) => ({
          settings: {
            ...s.settings,
            providers: s.settings.providers.map((p) =>
              p.id === provider ? { ...p, hasKey } : p
            ),
          },
        })),

      setProviderModels: (provider, models) =>
        set((s) => ({
          settings: {
            ...s.settings,
            providers: s.settings.providers.map((p) =>
              p.id === provider ? { ...p, models } : p
            ),
          },
        })),

      toggleModelPin: (provider, modelId) =>
        set((s) => ({
          settings: {
            ...s.settings,
            providers: s.settings.providers.map((p) =>
              p.id === provider
                ? {
                    ...p,
                    models: p.models.map((m) =>
                      m.id === modelId ? { ...m, pinned: !m.pinned } : m
                    ),
                  }
                : p
            ),
          },
        })),

      toggleImageSource: (sourceId) =>
        set((s) => {
          const current = s.settings.enabledImageSources;
          const enabled = current.includes(sourceId)
            ? current.filter((id) => id !== sourceId)
            : [...current, sourceId];
          return { settings: { ...s.settings, enabledImageSources: enabled } };
        }),

      setImageSourceHasKey: () => {
        // Image source key status is fetched from server — no local state needed
        // This is a no-op kept for API symmetry
      },

      setSpeedOption: (key, value) =>
        set((s) => ({
          settings: {
            ...s.settings,
            speedOptions: { ...s.settings.speedOptions, [key]: value },
          },
        })),

      setImageVerification: (key, value) =>
        set((s) => ({
          settings: {
            ...s.settings,
            imageVerification: { ...s.settings.imageVerification, [key]: value },
          },
        })),

      // ── Generation Config ──
      selectedProvider: "openrouter",
      selectedModelId: "",
      slideCount: 10,
      customSlideCount: false,
      imageLayout: "full",
      layoutMode: "fixed",
      slideLayout: "single",
      stretchImages: false,
      slideBgColor: "FFFFFF",
      slideAccentColor: "B30333",
      selectedTheme: DEFAULT_THEME_PACK_ID,
      headingFontFamily: "'Inter', 'Helvetica Neue', Arial, sans-serif",
      bodyFontFamily: "'Inter', 'Helvetica Neue', Arial, sans-serif",
      headingFontFace: "Aptos Display",
      bodyFontFace: "Aptos",
      overlaySectionFontSize: 16,
      overlayTitleFontSize: 20,
      overlaySectionColor: "D1D5DB",
      overlayTitleColor: "FFFFFF",
      overlayTextGap: 0.2,
      textDensity: 0,
      customTextDensity: false,
      prompts: {
        design: "Ultra-clean minimalist design. Black and white with one accent color (teal). Generous white space. Thin sans-serif fonts. No borders or unnecessary decorations. Content-first approach with simple, elegant layouts.",
        text: "",
        notes: "Write detailed presenter notes as a full spoken script. Include transitions between slides, key talking points expanded into paragraphs, timing cues, and audience engagement prompts. The presenter should be able to read these notes verbatim.",
      },
      sourceText: "",
      sourceFileName: "",
      showImageSource: false,
      imageSourceFontColor: "FFFFFF",

      setSelectedProvider: (p) => {
        const state = get();
        const prov = state.settings.providers.find((pr) => pr.id === p);
        const firstPinned = prov?.models.find((m) => m.pinned);
        set({ selectedProvider: p, selectedModelId: firstPinned?.id ?? "" });
      },
      setSelectedModelId: (id) => set({ selectedModelId: id }),
      setSlideCount: (n) => set({ slideCount: n }),
      setCustomSlideCount: (v) => set({ customSlideCount: v }),
      setImageLayout: (l) => set({ imageLayout: l }),
      setLayoutMode: (m) =>
        set((s) => {
          // When switching to fixed mode, clear per-slide overrides so all slides
          // reliably follow the selected global layout.
          const normalizedPresentation =
            m === "fixed" && s.presentation
              ? {
                  ...s.presentation,
                  slides: s.presentation.slides.map((sl) => ({
                    ...sl,
                    slideLayout: undefined,
                  })),
                }
              : s.presentation;

          return {
            layoutMode: m,
            presentation: normalizedPresentation,
          };
        }),
      setSlideLayout: (l) => set({ slideLayout: l }),
      setStretchImages: (v) => set({ stretchImages: v }),
      setSlideBgColor: (c) => set({ slideBgColor: c }),
      setSlideAccentColor: (c) => set({ slideAccentColor: c }),
      setSelectedTheme: (id) => set({ selectedTheme: id }),
      applyThemePack: (id) => {
        const state = get();
        const theme = getThemeById(id);
        const lang = state.settings.language;
        set({
          selectedTheme: id,
          slideBgColor: theme.palette.background,
          slideAccentColor: theme.palette.accent,
          overlaySectionColor: theme.palette.sectionText,
          overlayTitleColor: theme.palette.titleText,
          headingFontFamily: theme.fonts.heading,
          bodyFontFamily: theme.fonts.body,
          headingFontFace: theme.fonts.pptHeading,
          bodyFontFace: theme.fonts.pptBody,
          layoutMode: theme.layout.mode,
          slideLayout: theme.layout.slideLayout,
          stretchImages: theme.layout.stretchImages,
          prompts: {
            ...state.prompts,
            design: theme.designPrompt[lang],
          },
          presentation:
            theme.layout.mode === "fixed" && state.presentation
              ? {
                  ...state.presentation,
                  slides: state.presentation.slides.map((sl) => ({
                    ...sl,
                    slideLayout: undefined,
                  })),
                }
              : state.presentation,
        });
      },
      setOverlaySectionFontSize: (n) => set({ overlaySectionFontSize: Math.max(8, Math.min(48, n)) }),
      setOverlayTitleFontSize: (n) => set({ overlayTitleFontSize: Math.max(10, Math.min(72, n)) }),
      setOverlaySectionColor: (c) => set({ overlaySectionColor: c }),
      setOverlayTitleColor: (c) => set({ overlayTitleColor: c }),
      setOverlayTextGap: (n) => set({ overlayTextGap: Math.max(0.05, Math.min(0.6, n)) }),
      setTextDensity: (n) => set({ textDensity: n }),
      setCustomTextDensity: (v) => set({ customTextDensity: v }),
      setPrompt: (field, text) =>
        set((s) => ({ prompts: { ...s.prompts, [field]: text } })),
      setSourceText: (t) => set({ sourceText: t }),
      setSourceFileName: (n) => set({ sourceFileName: n }),
      setShowImageSource: (v) => set({ showImageSource: v }),
      setImageSourceFontColor: (c) => set({ imageSourceFontColor: c }),

      // ── Generation State ──
      status: "idle",
      statusMessage: "",
      progress: 0,
      presentation: null,
      error: "",

      setStatus: (s, msg) => set({ status: s, statusMessage: msg || "", progress: 0 }),
      setProgress: (pct, msg) => set((prev) => ({ progress: Math.max(prev.progress, Math.min(100, pct)), statusMessage: msg ?? prev.statusMessage })),
      setPresentation: (p) => set({ presentation: p }),
      setError: (e) => set({ error: e, status: "error" }),

      updateSlide: (index, data) =>
        set((s) => {
          if (!s.presentation) return {};
          const slides = s.presentation.slides.map((sl) =>
            sl.index === index ? { ...sl, ...data } : sl
          );
          return { presentation: { ...s.presentation, slides } };
        }),

      updateAllSlidesAccent: (color) =>
        set((s) => {
          if (!s.presentation) return {};
          const slides = s.presentation.slides.map((sl) => ({
            ...sl,
            accentColor: color,
          }));
          return { presentation: { ...s.presentation, slides } };
        }),

      // ── UI State ──
      showSettings: false,
      settingsTab: "general",
      selectedSlideIndex: "all",
      editorInstruction: "",

      setShowSettings: (v) => set({ showSettings: v }),
      setSettingsTab: (t) => set({ settingsTab: t }),
      setSelectedSlideIndex: (i) => set({ selectedSlideIndex: i }),
      setEditorInstruction: (s) => set({ editorInstruction: s }),

      // ── Custom Presets ──
      customPresets: [],
      addCustomPreset: (preset) =>
        set((s) => ({ customPresets: [...s.customPresets, preset] })),
      updateCustomPreset: (id, label, text) =>
        set((s) => ({
          customPresets: s.customPresets.map((p) =>
            p.id === id ? { ...p, label, text } : p
          ),
        })),
      deleteCustomPreset: (id) =>
        set((s) => ({
          customPresets: s.customPresets.filter((p) => p.id !== id),
        })),

      // ── History ──
      history: [],
      addToHistory: (entry) => {
        set((s) => ({ history: [entry, ...s.history] }));
        // Flush immediately so history survives HMR / page reloads
        get()._saveToServer(true);
      },
      updateHistoryEntry: (id, updates) => {
        set((s) => ({
          history: s.history.map((h) =>
            h.id === id ? { ...h, ...updates } : h
          ),
        }));
        // Flush immediately for critical status transitions
        if (updates.status) get()._saveToServer(true);
      },
      deleteFromHistory: (id) =>
        set((s) => ({ history: s.history.filter((h) => h.id !== id) })),

      // ── Active Tab ──
      activeTab: "home",
      setActiveTab: (tab) => set({ activeTab: tab }),
      creatorSubTab: "create",
      notesSubTab: "create",
      manualSubTab: "list",
      setCreatorSubTab: (tab) => set({ creatorSubTab: tab }),
      setNotesSubTab: (tab) => set({ notesSubTab: tab }),
      setManualSubTab: (tab) => set({ manualSubTab: tab }),

      // ── Notes Generator ──
      notesProject: null,
      notesStatus: "idle",
      notesStatusMessage: "",
      notesProgress: 0,
      notesError: "",
      notesPrompt: "",
      notesOutputLanguage: "en",
      notesIncludeExisting: true,
      notesUseVision: false,
      notesDocDensity: 70,
      notesParagraphs: 2,

      setNotesProject: (p) => set({ notesProject: p }),
      setNotesStatus: (s, msg) => set({ notesStatus: s, notesStatusMessage: msg || "", notesProgress: 0, ...(s === "error" ? {} : { notesError: "" }) }),
      setNotesProgress: (pct, msg) => set((prev) => ({ notesProgress: Math.min(100, pct), notesStatusMessage: msg ?? prev.notesStatusMessage })),
      setNotesError: (e) => set({ notesError: e, notesStatus: "error" }),
      setNotesPrompt: (p) => set({ notesPrompt: p }),
      setNotesOutputLanguage: (l) => set({ notesOutputLanguage: l }),
      setNotesIncludeExisting: (v) => set({ notesIncludeExisting: v }),
      setNotesUseVision: (v) => set({ notesUseVision: v }),
      setNotesDocDensity: (v) => set({ notesDocDensity: v }),
      setNotesParagraphs: (v) => set({ notesParagraphs: v }),
      updateNote: (slideIndex, note) =>
        set((s) => {
          if (!s.notesProject) return {};
          const notes = [...s.notesProject.generatedNotes];
          notes[slideIndex] = note;
          return { notesProject: { ...s.notesProject, generatedNotes: notes } };
        }),

      // ── Helpers ──
      getPinnedModels: (provider) => {
        const state = get();
        const targetProvider = provider || state.selectedProvider;
        const prov = state.settings.providers.find((p) => p.id === targetProvider);
        return prov ? prov.models.filter((m) => m.pinned) : [];
      },

      getActiveProvider: () => {
        const state = get();
        return state.settings.providers.find(
          (p) => p.id === state.selectedProvider
        );
      },

      getEffectiveSelection: () => {
        const state = get();
        const pinnedProviders = state.settings.providers.filter(
          (p) => p.hasKey && p.models.some((m) => m.pinned)
        );
        const effectiveProvider =
          pinnedProviders.find((p) => p.id === state.selectedProvider) ??
          pinnedProviders[0];
        const pinnedModels = effectiveProvider
          ? effectiveProvider.models.filter((m) => m.pinned)
          : [];
        const effectiveModelId =
          pinnedModels.find((m) => m.id === state.selectedModelId)?.id ??
          pinnedModels[0]?.id ??
          "";
        return {
          provider: effectiveProvider?.id ?? state.selectedProvider,
          modelId: effectiveModelId,
        };
      },

      getGenerationConfig: () => {
        const state = get();
        return {
          provider: state.selectedProvider,
          modelId: state.selectedModelId,
          slideCount: state.slideCount,
          imageLayout: state.imageLayout,
          layoutMode: state.layoutMode,
          slideLayout: state.slideLayout,
          stretchImages: state.stretchImages,
          textDensity: state.textDensity,
          overlaySectionFontSize: state.overlaySectionFontSize,
          overlayTitleFontSize: state.overlayTitleFontSize,
          overlaySectionColor: state.overlaySectionColor,
          overlayTitleColor: state.overlayTitleColor,
          headingFontFace: state.headingFontFace,
          bodyFontFace: state.bodyFontFace,
          overlayTextGap: state.overlayTextGap,
          outputLanguage: state.settings.outputLanguage,
          prompts: state.prompts,
          sourceText: state.sourceText,
          sourceFileName: state.sourceFileName,
        };
      },

      // ── Server Sync ──
      _serverLoaded: false,

      _loadFromServer: async () => {
        try {
          const res = await fetch("/api/state");
          if (!res.ok) {
            set({ _serverLoaded: true });
            return;
          }
          const { state: serverState } = await res.json();
          if (serverState && typeof serverState === "object") {
            const migrated = migrateServerState(serverState);
            set({ ...migrated, _serverLoaded: true } as Partial<AppState>);
          } else {
            set({ _serverLoaded: true });
          }
        } catch (err) {
          console.warn("Failed to load state from server:", err);
          set({ _serverLoaded: true });
        }
      },

      _saveToServer: (immediate?: boolean) => {
        if (_saveTimer) clearTimeout(_saveTimer);
        const doSave = () => {
          const state = get();
          const partial = getPartialState(state);
          fetch("/api/state", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ state: partial }),
          }).catch((err) => console.warn("Failed to save state to server:", err));
        };
        if (immediate) {
          doSave();
        } else {
          _saveTimer = setTimeout(doSave, SAVE_DEBOUNCE_MS);
        }
      },
    })
);

// Subscribe to state changes and auto-save persistable fields to server
let _prevPartial: string | null = null;
useAppStore.subscribe((state) => {
  if (!state._serverLoaded) return;
  const partial = JSON.stringify(getPartialState(state));
  if (partial !== _prevPartial) {
    _prevPartial = partial;
    state._saveToServer();
  }
});

export function useHydration() {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    const state = useAppStore.getState();
    if (state._serverLoaded) {
      setHydrated(true);
      return;
    }
    state._loadFromServer().then(() => setHydrated(true));
  }, []);
  return hydrated;
}
