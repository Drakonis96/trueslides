"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAppStore, useHydration } from "@/lib/store";
import { useManualStore, ManualSlide, ManualSlideElement, ManualPresentation, createSlideFromLayout } from "@/lib/manual-store";
import { UI_TEXT } from "@/lib/presets";
import { AIProvider, PresentationData, HistoryEntry } from "@/lib/types";
import ProviderModelSelector from "@/components/ProviderModelSelector";
import FileUploader from "@/components/FileUploader";
import PromptPanel from "@/components/PromptPanel";
import SettingsPanel from "@/components/SettingsPanel";
import SlideEditor from "@/components/SlideEditor";
import StatusBar from "@/components/StatusBar";
import NotesGenerator from "@/components/NotesGenerator";
import JobProgressModal from "@/components/JobProgressModal";
import ManualCreator from "@/components/ManualCreator";
import PresenterMode from "@/components/PresenterMode";
import { useBroadcastInitReceiver } from "@/components/presenter/useBroadcastSync";
import { IconSettings, IconCheck, IconArrowLeft, IconDownload, IconClock, IconTrash, IconPlus, IconMic, IconSearch, IconLoader, IconWarning, IconStop, IconPencilRuler } from "@/components/Icons";
import { MousePointer2, Sparkles, Home, Presentation } from "lucide-react";
import { SlideData, ManualElementData } from "@/lib/types";

interface LivePreviewSlide {
  title: string;
  bullets: string[];
  notes: string;
  section?: string;
  imageUrls?: string[];
}

// ── Image pre-downloading utility ──

async function downloadImageAsBase64(url: string): Promise<string | null> {
  // If already base64, return as-is
  if (url.startsWith("data:")) return url;

  try {
    // Use our image proxy to avoid Wikimedia 403s
    const proxyUrl = new URL("/api/image-proxy", window.location.origin);
    proxyUrl.searchParams.set("url", url);

    const res = await fetch(proxyUrl.toString());
    if (!res.ok) return null;

    const blob = await res.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  } catch (err) {
    console.warn(`[downloadImageAsBase64] Error:`, err);
    return null;
  }
}

async function preDownloadAllImages(
  presentation: PresentationData
): Promise<PresentationData> {
  const urlsToDl = new Set<string>();
  for (const s of presentation.slides) {
    for (const u of s.imageUrls) {
      if (u && !u.startsWith("data:")) urlsToDl.add(u);
    }
  }

  if (urlsToDl.size === 0) return presentation;

  const map = new Map<string, string>();
  const urls = [...urlsToDl];

  // Download in parallel (small batches to be kind to servers)
  const batchSize = 3;
  for (let i = 0; i < urls.length; i += batchSize) {
    const batch = urls.slice(i, i + batchSize);
    const results = await Promise.all(batch.map(downloadImageAsBase64));
    batch.forEach((u, j) => {
      if (results[j]) map.set(u, results[j]!);
    });
  }

  // Replace URLs with base64 data
  const result: PresentationData = {
    ...presentation,
    slides: presentation.slides.map((s) => ({
      ...s,
      imageUrls: s.imageUrls.map((u) => map.get(u) || u).filter((url) => {
        // Only keep URLs that are either data: or successfully converted
        return url.startsWith("data:");
      }),
    })),
  };

  console.log(
    `[preDownloadAllImages] Converted ${map.size} / ${urlsToDl.size} images to base64`
  );
  return result;
}

// ── PDF download utility (captures real web slide previews) ──

async function waitForPaint(): Promise<void> {
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

const UNSUPPORTED_HTML2CANVAS_COLOR_RE = /(oklab|oklch|color-mix|lab\(|lch\(|color\()/i;

function normalizeColorForCanvas(
  probe: HTMLDivElement,
  property: string,
  value: string,
): string {
  if (!value || !UNSUPPORTED_HTML2CANVAS_COLOR_RE.test(value)) {
    return value;
  }

  probe.style.setProperty(property, value);
  const resolved = getComputedStyle(probe).getPropertyValue(property).trim();
  probe.style.removeProperty(property);

  if (resolved && !UNSUPPORTED_HTML2CANVAS_COLOR_RE.test(resolved)) {
    return resolved;
  }

  if (property === "color" || property === "fill" || property === "stroke") {
    return "rgb(0, 0, 0)";
  }

  return "rgba(0, 0, 0, 0)";
}

function sanitizePreviewCloneForCanvas(
  sourceCard: HTMLElement,
  clonedCard: HTMLElement,
  sandbox: HTMLDivElement,
): void {
  const probe = document.createElement("div");
  probe.style.position = "absolute";
  probe.style.visibility = "hidden";
  probe.style.pointerEvents = "none";
  sandbox.appendChild(probe);

  const sourceNodes = [sourceCard, ...Array.from(sourceCard.querySelectorAll("*"))];
  const cloneNodes = [clonedCard, ...Array.from(clonedCard.querySelectorAll("*"))];
  const nodeCount = Math.min(sourceNodes.length, cloneNodes.length);
  const colorProperties = [
    "color",
    "background-color",
    "border-top-color",
    "border-right-color",
    "border-bottom-color",
    "border-left-color",
    "outline-color",
    "text-decoration-color",
    "fill",
    "stroke",
  ];

  clonedCard.style.width = `${sourceCard.offsetWidth}px`;
  clonedCard.style.height = `${sourceCard.offsetHeight}px`;

  for (let i = 0; i < nodeCount; i++) {
    const sourceNode = sourceNodes[i];
    const cloneNode = cloneNodes[i];

    if (!(sourceNode instanceof Element)) continue;
    if (!(cloneNode instanceof HTMLElement || cloneNode instanceof SVGElement)) continue;

    const computed = getComputedStyle(sourceNode);

    for (const property of colorProperties) {
      const resolved = normalizeColorForCanvas(
        probe,
        property,
        computed.getPropertyValue(property).trim(),
      );
      if (resolved) {
        cloneNode.style.setProperty(property, resolved);
      }
    }

    const backgroundImage = computed.getPropertyValue("background-image").trim();
    cloneNode.style.setProperty(
      "background-image",
      UNSUPPORTED_HTML2CANVAS_COLOR_RE.test(backgroundImage) ? "none" : backgroundImage,
    );
    cloneNode.style.setProperty("box-shadow", "none");
    cloneNode.style.setProperty("text-shadow", "none");
    cloneNode.style.setProperty("filter", "none");
    cloneNode.style.setProperty("backdrop-filter", "none");
    cloneNode.style.setProperty("transition", "none");
    cloneNode.style.setProperty("animation", "none");
  }

  probe.remove();
}

async function renderPreviewCardToCanvas(
  card: HTMLElement,
  html2canvas: typeof import("html2canvas").default,
): Promise<HTMLCanvasElement> {
  const sandbox = document.createElement("div");
  const clonedCard = card.cloneNode(true) as HTMLElement;

  sandbox.style.position = "fixed";
  sandbox.style.left = "-10000px";
  sandbox.style.top = "0";
  sandbox.style.pointerEvents = "none";
  sandbox.style.opacity = "0";
  sandbox.style.width = `${card.offsetWidth}px`;
  sandbox.style.height = `${card.offsetHeight}px`;
  sandbox.style.overflow = "hidden";

  sandbox.appendChild(clonedCard);
  document.body.appendChild(sandbox);

  try {
    sanitizePreviewCloneForCanvas(card, clonedCard, sandbox);
    await waitForPaint();
    return await html2canvas(clonedCard, {
      backgroundColor: "#ffffff",
      scale: Math.max(3, Math.ceil((window.devicePixelRatio || 1) * 2)),
      useCORS: true,
      logging: false,
    });
  } finally {
    sandbox.remove();
  }
}

async function findPreviewCardsWithRetry(maxTries = 8): Promise<HTMLElement[]> {
  for (let i = 0; i < maxTries; i++) {
    const cards = Array.from(
      document.querySelectorAll<HTMLElement>("[data-slide-preview]")
    ).sort((a, b) => {
      const ai = Number(a.dataset.slideIndex ?? 0);
      const bi = Number(b.dataset.slideIndex ?? 0);
      return ai - bi;
    });

    if (cards.length > 0) return cards;
    await waitForPaint();
  }
  return [];
}

async function generatePDFFromWebViews(): Promise<Blob> {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    import("html2canvas"),
    import("jspdf"),
  ]);

  const activeChip = Array.from(
    document.querySelectorAll<HTMLButtonElement>("[data-slide-chip]")
  ).find((btn) => btn.className.includes("bg-[var(--accent)]"));
  const slideChips = Array.from(
    document.querySelectorAll<HTMLButtonElement>("[data-slide-chip]")
  )
    .filter((btn) => btn.dataset.slideChip !== "all")
    .sort(
      (a, b) =>
        Number(a.dataset.slideChip ?? 0) - Number(b.dataset.slideChip ?? 0)
    );

  try {
    if (slideChips.length === 0) {
      throw new Error("No slide previews found in DOM");
    }

    const pdf = new jsPDF({
      orientation: "landscape",
      unit: "px",
      format: [1280, 720],
      compress: true,
    });

    for (let i = 0; i < slideChips.length; i++) {
      slideChips[i].click();
      await waitForPaint();

      const cards = await findPreviewCardsWithRetry(4);
      const card = cards[0];
      if (!card) {
        throw new Error(`Slide preview ${i + 1} not found in DOM`);
      }

      const canvas = await renderPreviewCardToCanvas(card, html2canvas);

      if (i > 0) {
        pdf.addPage([1280, 720], "landscape");
      }

      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      const ratio = Math.min(pageW / canvas.width, pageH / canvas.height);
      const renderW = canvas.width * ratio;
      const renderH = canvas.height * ratio;
      const x = (pageW - renderW) / 2;
      const y = (pageH - renderH) / 2;

      pdf.addImage(
        canvas.toDataURL("image/png"),
        "PNG",
        x,
        y,
        renderW,
        renderH,
        undefined,
        "NONE"
      );
    }

    return pdf.output("blob");
  } finally {
    // Restore previous selected chip if it wasn't "all".
    if (activeChip && activeChip.dataset.slideChip !== "all") {
      activeChip.click();
      await waitForPaint();
    }
  }
}

// ── Notes download utility ──

function generateNotesText(presentation: PresentationData, lang: string): string {
  const title = lang === "es" ? "NOTAS DEL PRESENTADOR" : "PRESENTER NOTES";
  const slideLabel = lang === "es" ? "Diapositiva" : "Slide";

  const lines = [title, "=" + "=".repeat(title.length - 2)];

  for (const slide of presentation.slides) {
    lines.push("");
    lines.push(
      `${slideLabel} ${slide.index + 1}: ${slide.section ? `[${slide.section}] ` : ""}${slide.title}`
    );
    lines.push("-".repeat(60));

    if (slide.notes) {
      lines.push(slide.notes);
    } else {
      lines.push(
        lang === "es"
          ? "(Sin notas para esta diapositiva)"
          : "(No notes for this slide)"
      );
    }
    lines.push("");
  }

  return lines.join("\n");
}

export default function HomePage() {
  const hydrated = useHydration();
  const store = useAppStore();
  const manualStore = useManualStore();
  const lang = store.settings.language;
  const t = UI_TEXT[lang];

  const { provider: effectiveProvider, modelId: effectiveModelId } =
    store.getEffectiveSelection();

  const canGenerate =
    store.sourceText.trim() &&
    effectiveModelId &&
    store.status !== "building-pptx";

  const [historySearch, setHistorySearch] = useState("");
  const [progressModalJobId, setProgressModalJobId] = useState<string | null>(null);
  const [presenterMode, setPresenterMode] = useState(false);
  const [isAudienceWindow, setIsAudienceWindow] = useState(false);
  const [audienceData, setAudienceData] = useState<{ slides: SlideData[]; presentationTitle: string } | null>(null);
  const jobLogsRef = useRef<Record<string, Array<{ timestamp: number; percent: number; message: string }>>>({});
  const tabNavRef = useRef<HTMLElement>(null);
  const manualTabRef = useRef<HTMLButtonElement>(null);
  const creatorTabRef = useRef<HTMLButtonElement>(null);
  const notesTabRef = useRef<HTMLButtonElement>(null);
  const [jobPartialSlides, setJobPartialSlides] = useState<Record<string, LivePreviewSlide[]>>({});
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollFailureCountsRef = useRef<Record<string, number>>({});
  const jobNotFoundGraceMs = 10_000;
  const runningCount = useAppStore((s) => s.history.filter((e) => e.status === "running").length);

  const syncJobPartialSlides = useCallback((jobId: string, slides: LivePreviewSlide[] | undefined) => {
    if (!slides) return;
    setJobPartialSlides((prev) => {
      const current = prev[jobId] || [];
      const unchanged =
        current.length === slides.length &&
        current.every((slide, idx) =>
          slide.title === slides[idx]?.title &&
          slide.section === slides[idx]?.section &&
          slide.bullets.join("\n") === (slides[idx]?.bullets || []).join("\n") &&
          slide.notes === (slides[idx]?.notes || "") &&
          (slide.imageUrls || []).join(",") === (slides[idx]?.imageUrls || []).join(",")
        );
      if (unchanged) return prev;
      return { ...prev, [jobId]: slides };
    });
  }, []);

  // Clean up polling on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  // Detect audience window mode via BroadcastChannel
  const isAudienceQuery = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("audience") === "1";
  const broadcastInitData = useBroadcastInitReceiver();

  useEffect(() => {
    if (isAudienceQuery && broadcastInitData) {
      const data = broadcastInitData as { slides: SlideData[]; presentationTitle: string };
      setAudienceData({ slides: data.slides, presentationTitle: data.presentationTitle });
      setIsAudienceWindow(true);
    }
  }, [isAudienceQuery, broadcastInitData]);

  // Poll for running jobs on mount and when running count changes
  useEffect(() => {
    if (runningCount === 0) {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      return;
    }

    // Start polling if not already
    if (pollRef.current) return;

    const poll = async () => {
      const running = useAppStore.getState().history.filter((e) => e.status === "running");
      if (running.length === 0) {
        pollFailureCountsRef.current = {};
        if (pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
        return;
      }

      for (const entry of running) {
        try {
          const res = await fetch(`/api/jobs/${entry.id}`);
          if (res.status === 404) {
            if (Date.now() - entry.createdAt < jobNotFoundGraceMs) {
              continue;
            }
            delete pollFailureCountsRef.current[entry.id];
            // Job not found — server was restarted, mark as error
            const s = useAppStore.getState();
            s.updateHistoryEntry(entry.id, {
              status: "error",
              errorMessage: lang === "es" ? "Generación interrumpida (servidor reiniciado)" : "Generation interrupted (server restarted)",
              completedAt: Date.now(),
            });
            continue;
          }
          if (!res.ok) {
            // Count non-404 failures to avoid infinite silent spins
            const failures = (pollFailureCountsRef.current[entry.id] || 0) + 1;
            pollFailureCountsRef.current[entry.id] = failures;
            console.warn(`[poll] Job ${entry.id}: HTTP ${res.status} (failure #${failures})`);
            if (failures >= 5) {
              delete pollFailureCountsRef.current[entry.id];
              const s = useAppStore.getState();
              s.updateHistoryEntry(entry.id, {
                status: "error",
                errorMessage: lang === "es" ? "Error del servidor al consultar estado" : "Server error while checking job status",
                completedAt: Date.now(),
              });
            }
            continue;
          }
          pollFailureCountsRef.current[entry.id] = 0;
          const job = await res.json();

          if (job.status === "completed" && job.result) {
            console.log(`[poll] Job ${entry.id}: completed, applying result...`);
            delete pollFailureCountsRef.current[entry.id];
            const s = useAppStore.getState();
            s.updateHistoryEntry(entry.id, {
              title: job.title || job.result.title || entry.title,
              status: "completed",
              ...(entry.type === "presentation" ? { presentation: job.result } : { notesProject: undefined }),
              slideCount: job.result.slides?.length ?? entry.slideCount,
              completedAt: job.completedAt,
            });
            if (job.progressLog) {
              jobLogsRef.current = { ...jobLogsRef.current, [entry.id]: job.progressLog };
            }
            syncJobPartialSlides(entry.id, job.partialSlides);
            // Job completed — result is stored in history; user can load from there
          } else if (job.status === "error" || job.status === "cancelled") {
            delete pollFailureCountsRef.current[entry.id];
            const s = useAppStore.getState();
            s.updateHistoryEntry(entry.id, {
              status: "error",
              errorMessage: job.error || "Generation failed",
              completedAt: job.completedAt,
            });
            if (job.progressLog) {
              jobLogsRef.current = { ...jobLogsRef.current, [entry.id]: job.progressLog };
            }
            syncJobPartialSlides(entry.id, job.partialSlides);
          } else if (job.status === "running" && job.progress) {
            const s = useAppStore.getState();
            s.updateHistoryEntry(entry.id, {
              progressPercent: job.progress.percent,
              progressMessage: job.progress.message,
            });
            // Update live progress logs (non-persisted, for modal display)
            if (job.progressLog) {
              jobLogsRef.current = { ...jobLogsRef.current, [entry.id]: job.progressLog };
            }
            syncJobPartialSlides(entry.id, job.partialSlides);
          }
        } catch {
          const failures = (pollFailureCountsRef.current[entry.id] || 0) + 1;
          pollFailureCountsRef.current[entry.id] = failures;

          if (failures < 3) continue;

          delete pollFailureCountsRef.current[entry.id];
          const s = useAppStore.getState();
          const errorMessage = lang === "es"
            ? "Generación interrumpida (servidor no disponible)"
            : "Generation interrupted (server unavailable)";

          s.updateHistoryEntry(entry.id, {
            status: "error",
            errorMessage,
            completedAt: Date.now(),
          });
          // Error stored in history entry
        }
      }
    };

    poll(); // poll immediately
    pollRef.current = setInterval(poll, 2_000);

    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [runningCount, lang, jobNotFoundGraceMs, syncJobPartialSlides]);

  // Fetch key status from server on mount
  useEffect(() => {
    fetch("/api/keys")
      .then((r) => r.json())
      .then((data) => {
        if (data.status) {
          const state = useAppStore.getState();
          for (const [provider, hasKey] of Object.entries(data.status)) {
            state.setProviderHasKey(provider as AIProvider, hasKey as boolean);
          }
        }
      })
      .catch((err) => console.error("Keys fetch error:", err));
  }, []);

  const handleGenerate = useCallback(async () => {
    const {
      settings,
      slideCount,
      textDensity,
      prompts,
      sourceText,
      imageLayout,
      layoutMode,
      slideLayout,
      slideAccentColor,
      setStatus,
      setProgress,
      setError,
      getEffectiveSelection,
      addToHistory,
      updateHistoryEntry,
    } = store;

    const { provider: selProvider, modelId: selModelId } = getEffectiveSelection();
    const provider = settings.providers.find((p) => p.id === selProvider);
    if (!provider?.hasKey) {
      setError(t.apiError);
      return;
    }
    if (!sourceText.trim()) {
      setError(t.emptyInput);
      return;
    }

    const langEs = settings.language === "es";

    // Create history entry immediately with a deterministic job ID
    const historyId = crypto.randomUUID();
    const historyEntry: HistoryEntry = {
      id: historyId,
      title: langEs ? "Generando..." : "Generating...",
      createdAt: Date.now(),
      type: "presentation",
      status: "running",
      provider: selProvider,
      modelId: selModelId,
      slideCount,
    };
    addToHistory(historyEntry);

    try {
      setStatus("generating");
      setProgress(5, langEs ? "Iniciando generación en servidor..." : "Starting generation on server...");

      // Start background job — returns immediately
      const res = await fetch("/api/generate-full", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobId: historyId,
          provider: selProvider,
          modelId: selModelId,
          slideCount,
          textDensity,
          outputLanguage: settings.outputLanguage,
          prompts,
          sourceText,
          imageLayout,
          layoutMode,
          slideLayout,
          enabledSources: settings.enabledImageSources,
          slideAccentColor,
          speedOptions: settings.speedOptions,
          imageVerification: settings.imageVerification,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || t.apiError);
        updateHistoryEntry(historyId, {
          status: "error",
          errorMessage: data.error || t.apiError,
          completedAt: Date.now(),
        });
        return;
      }

      // Job dispatched — reset status so user can create more jobs
      setStatus("idle");
      setProgress(0);

      // Switch to history tab and open the live progress modal
      store.setActiveTab("history");
      setProgressModalJobId(historyId);
    } catch (err) {
      console.error("Generation error:", err);
      const errorMsg = err instanceof Error ? err.message : t.apiError;
      setError(errorMsg);
      store.updateHistoryEntry(historyId, {
        status: "error",
        errorMessage: errorMsg,
        completedAt: Date.now(),
      });
    }
  }, [store, t]);

  // Convert manual slides to SlideData for presenter mode
  const manualSlidesToSlideData = useCallback((): SlideData[] => {
    return manualStore.presentation.slides.map((ms, i) => ({
      id: ms.id,
      index: i,
      title: ms.elements.find((el) => el.type === "title")?.content || `Slide ${i + 1}`,
      bullets: ms.elements.filter((el) => el.type === "bullets").flatMap((el) => el.content.split("\n").filter(Boolean)),
      notes: ms.notes,
      imageUrls: ms.elements.filter((el) => el.type === "image").map((el) => el.content),
      accentColor: ms.accentColor,
      bgColor: ms.bgColor,
      manualElements: ms.elements.map((el): ManualElementData => ({
        type: el.type,
        x: el.x,
        y: el.y,
        w: el.w,
        h: el.h,
        content: el.content,
        fontSize: el.fontSize,
        fontWeight: el.fontWeight,
        fontFamily: el.fontFamily,
        textAlign: el.textAlign,
        lineHeight: el.lineHeight,
        color: el.color?.replace("#", ""),
        zIndex: el.zIndex,
        locked: el.locked,
        imageAdjustment: el.imageAdjustment,
        groupId: el.groupId,
        shapeKind: el.shapeKind,
        shapeFill: el.shapeFill,
        shapeOpacity: el.shapeOpacity,
        shapeBorderColor: el.shapeBorderColor,
        shapeBorderWidth: el.shapeBorderWidth,
        youtubeUrl: el.youtubeUrl,
        connectorStyle: el.connectorStyle,
        arrowStart: el.arrowStart,
        arrowEnd: el.arrowEnd,
        connectorColor: el.connectorColor,
        connectorWidth: el.connectorWidth,
        rotation: el.rotation,
      })),
    }));
  }, [manualStore.presentation.slides]);

  const handleDownload = useCallback(
    async (format: "pptx" | "pdf" | "notes") => {
      const { presentation, imageLayout, slideLayout, stretchImages, textDensity, slideBgColor, slideAccentColor, headingFontFace, bodyFontFace, overlaySectionFontSize, overlayTitleFontSize, overlaySectionColor, overlayTitleColor, overlayTextGap, setStatus, setProgress, setError, settings } =
        store;
      if (!presentation) return;

      try {
        if (format === "pdf") {
          const langEs = settings.language === "es";
          setStatus("building-pptx");
          setProgress(
            15,
            langEs
              ? "Capturando vistas web para PDF..."
              : "Capturing web previews for PDF..."
          );

          const pdfBlob = await generatePDFFromWebViews();
          const url = URL.createObjectURL(pdfBlob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `${presentation.title || "presentation"}.pdf`;
          a.click();
          URL.revokeObjectURL(url);
          setStatus("done");
          return;
        }

        if (format === "notes") {
          // Notes download as text file
          const notesText = generateNotesText(presentation, settings.language);
          const blob = new Blob([notesText], { type: "text/plain; charset=utf-8" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `${presentation.title || "presentation"}-notes.txt`;
          a.click();
          URL.revokeObjectURL(url);
          setStatus("done");
          return;
        }

        // PPTX download with images
        setStatus("building-pptx");
        const langEs = settings.language === "es";
        setProgress(
          15,
          langEs ? "Descargando imágenes..." : "Downloading images..."
        );

        // Pre-download all images as base64 to avoid server-side Wikimedia 403s
        const presentationWithImages = await preDownloadAllImages(
          presentation
        );

        setProgress(
          40,
          langEs ? "Construyendo PPTX..." : "Building PPTX..."
        );

        const res = await fetch("/api/build-pptx", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            presentation: presentationWithImages,
            imageLayout,
            slideLayout,
            stretchImages,
            textDensity,
            slideBgColor,
            slideAccentColor,
            headingFontFace,
            bodyFontFace,
            overlaySectionFontSize,
            overlayTitleFontSize,
            overlaySectionColor,
            overlayTitleColor,
            overlayTextGap,
          }),
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setError(data.error || "Failed to build PPTX");
          setStatus("done");
          return;
        }

        setProgress(95, langEs ? "Finalizando..." : "Finalizing...");
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${presentation.title || "presentation"}.pptx`;
        a.click();
        URL.revokeObjectURL(url);
        setStatus("done");
      } catch (err) {
        console.error("Download error:", err);
        setError(
          format === "pdf"
            ? "Failed to generate PDF"
            : format === "notes"
              ? "Failed to download notes"
              : "Failed to build PPTX file"
        );
        setStatus("done");
      }
    },
    [store]
  );

  const loadFromHistory = useCallback((entry: HistoryEntry) => {
    if (entry.type === "notes" && entry.notesProject) {
      store.setNotesProject(entry.notesProject);
      store.setNotesStatus("done");
      store.setActiveTab("notes");
      store.setNotesSubTab("edit");
    } else if (entry.presentation) {
      store.setPresentation(entry.presentation);
      store.setStatus("done");
      store.setActiveTab("creator");
      store.setCreatorSubTab("edit");
    }
  }, [store]);

  const deleteFromHistory = useCallback((id: string) => {
    if (confirm(t.historyDeleteConfirm)) {
      store.deleteFromHistory(id);
    }
  }, [store, t]);

  const stopJob = useCallback(async (id: string) => {
    if (!confirm(t.historyStopConfirm)) return;
    try {
      const res = await fetch(`/api/jobs/${id}`, { method: "DELETE" });
      if (res.ok) {
        store.updateHistoryEntry(id, {
          status: "error",
          errorMessage: lang === "es" ? "Cancelado por el usuario" : "Cancelled by user",
          completedAt: Date.now(),
        });
        // Job cancelled — tracked in history
      }
    } catch {
      // ignore
    }
  }, [store, t, lang]);

  const handleDownloadFromHistory = useCallback(
    async (entry: HistoryEntry) => {
      if (entry.type === "notes") {
        // For notes entries, load into notes tab to use the inject-notes export
        if (entry.notesProject) {
          store.setNotesProject(entry.notesProject);
          store.setNotesStatus("done");
          store.setActiveTab("notes");
        }
        return;
      }
      if (!entry.presentation) return;
      const { settings, imageLayout, slideLayout, stretchImages, textDensity, slideBgColor, slideAccentColor, headingFontFace, bodyFontFace, overlaySectionFontSize, overlayTitleFontSize, overlaySectionColor, overlayTitleColor, overlayTextGap, setStatus, setProgress, setError } = store;

      try {
        setStatus("building-pptx");
        const langEs = settings.language === "es";
        setProgress(15, langEs ? "Descargando imágenes..." : "Downloading images...");

        const presentationWithImages = await preDownloadAllImages(entry.presentation);
        setProgress(40, langEs ? "Construyendo PPTX..." : "Building PPTX...");

        const res = await fetch("/api/build-pptx", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            presentation: presentationWithImages,
            imageLayout,
            slideLayout,
            stretchImages,
            textDensity,
            slideBgColor,
            slideAccentColor,
            headingFontFace,
            bodyFontFace,
            overlaySectionFontSize,
            overlayTitleFontSize,
            overlaySectionColor,
            overlayTitleColor,
            overlayTextGap,
          }),
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setError(data.error || "Failed to build PPTX");
          setStatus("done");
          return;
        }

        setProgress(95, langEs ? "Finalizando..." : "Finalizing...");
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${entry.title || "presentation"}.pptx`;
        a.click();
        URL.revokeObjectURL(url);
        setStatus("done");
      } catch (err) {
        console.error("Download error:", err);
        setError("Failed to build PPTX file");
        setStatus("done");
      }
    },
    [store]
  );

  const importToManualCreator = useCallback(
    (entry: HistoryEntry) => {
      if (!entry.presentation) return;
      const pres = entry.presentation;
      const manualSlides: ManualSlide[] = pres.slides.map((slide) => {
        // If the slide already has manualElements, reuse them directly
        if (slide.manualElements && slide.manualElements.length > 0) {
          return {
            id: crypto.randomUUID(),
            layout: slide.slideLayout || "single",
            notes: slide.notes || "",
            bgColor: slide.bgColor || "FFFFFF",
            accentColor: slide.accentColor || "6366F1",
            elements: slide.manualElements.map((el) => ({
              ...el,
              id: crypto.randomUUID(),
            })) as ManualSlideElement[],
          };
        }
        // Otherwise, build manual elements from structured slide data
        const layout = slide.slideLayout || "single";
        const accent = slide.accentColor || "6366F1";
        const base = createSlideFromLayout(layout, accent);
        const elements: ManualSlideElement[] = [];
        let zIdx = 1;
        const hasImages = slide.imageUrls.length > 0;
        const hasBullets = slide.bullets && slide.bullets.length > 0;

        // Images from the layout template with actual URLs (added first, lower zIndex)
        const imageSlots = base.elements.filter((el) => el.type === "image");
        slide.imageUrls.forEach((url, i) => {
          if (imageSlots[i]) {
            elements.push({
              ...imageSlots[i],
              id: crypto.randomUUID(),
              content: url,
              imageSource: slide.imageSources?.[i] || "",
              imageAdjustment: slide.imageAdjustments?.[i],
              zIndex: zIdx++,
            });
          } else {
            // Extra images beyond layout slots
            elements.push({
              id: crypto.randomUUID(),
              type: "image",
              x: 55, y: 18 + i * 25, w: 40, h: 24,
              content: url,
              imageSource: slide.imageSources?.[i] || "",
              imageAdjustment: slide.imageAdjustments?.[i],
              zIndex: zIdx++,
            });
          }
        });

        if (hasImages) {
          // Gradient overlay for readability (like SlideRenderer's bottom gradient)
          elements.push({
            id: crypto.randomUUID(),
            type: "shape",
            x: 0, y: 50, w: 100, h: 50,
            content: "",
            shapeKind: "rectangle",
            shapeFill: "000000",
            shapeOpacity: 50,
            zIndex: zIdx++,
          });
        }

        // Title — positioned at bottom-left over images, or top-left if no images
        if (slide.title) {
          elements.push({
            id: crypto.randomUUID(),
            type: "title",
            x: hasImages ? 2 : 5,
            y: hasImages ? (hasBullets ? 68 : 82) : 4,
            w: hasImages ? 96 : 90,
            h: hasImages ? 12 : 10,
            content: slide.title,
            fontSize: 28,
            fontWeight: "bold",
            color: hasImages ? "FFFFFF" : "1E293B",
            zIndex: zIdx++,
          });
        }

        // Bullets — below title at bottom, or standard position if no images
        if (hasBullets) {
          elements.push({
            id: crypto.randomUUID(),
            type: "bullets",
            x: hasImages ? 2 : 5,
            y: hasImages ? 80 : 18,
            w: hasImages ? 96 : 90,
            h: hasImages ? 18 : 70,
            content: slide.bullets.join("\n"),
            fontSize: hasImages ? 14 : 16,
            color: hasImages ? "E2E8F0" : "334155",
            zIndex: zIdx++,
          });
        }

        return {
          id: crypto.randomUUID(),
          layout,
          notes: slide.notes || "",
          bgColor: slide.bgColor || "FFFFFF",
          accentColor: accent,
          elements,
        };
      });

      const manualPres: ManualPresentation = {
        title: pres.title,
        slides: manualSlides,
      };

      manualStore.importCreation(manualPres);
      store.setActiveTab("manual");
      store.setManualSubTab("editor");
    },
    [store, manualStore]
  );

  // Don't render until persisted state is loaded
  if (!hydrated) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // Audience window mode — render only the audience view
  if (isAudienceWindow && audienceData) {
    return (
      <PresenterMode
        slides={audienceData.slides}
        presentationTitle={audienceData.presentationTitle}
        isAudienceWindow
        onExit={() => window.close()}
      />
    );
  }

  // Presenter mode — render presenter dashboard over the main UI
  if (presenterMode) {
    const isManualTab = store.activeTab === "manual";
    const slides = isManualTab ? manualSlidesToSlideData() : (store.presentation?.slides || []);
    const title = isManualTab ? manualStore.presentation.title : (store.presentation?.title || "Presentation");
    return (
      <PresenterMode
        slides={slides}
        presentationTitle={title}
        onExit={() => setPresenterMode(false)}
      />
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="border-b border-[var(--border)] px-6 py-4 grid grid-cols-[1fr_auto_1fr] items-center gap-4">
        <div aria-hidden="true" className="justify-self-start" />

        <button
          type="button"
          onClick={() => store.setActiveTab("home")}
          className="justify-self-center"
          title={t.appName}
        >
          <img src="/header_logo.png" alt={`${t.appName} header logo`} className="h-12 w-auto max-w-[260px] object-contain" />
        </button>

        <div className="flex items-center shrink-0 justify-self-end">
          <button
            onClick={() => store.setShowSettings(true)}
            className="p-2 rounded-lg hover:bg-[var(--surface-2)] transition-colors text-[var(--muted)] hover:text-[var(--fg)]"
            title={t.settings}
          >
            <IconSettings size={20} />
          </button>
        </div>
      </header>

      {/* Tabs */}
      <div className="border-b border-[var(--border)] px-6">
        <nav ref={tabNavRef} className="max-w-5xl mx-auto w-full flex justify-center gap-1">
          <button
            onClick={() => store.setActiveTab("home")}
            className={`px-5 py-3 text-sm font-medium border-b-2 transition-colors ${
              store.activeTab === "home"
                ? "border-[var(--accent)] text-[var(--accent)]"
                : "border-transparent text-[var(--muted)] hover:text-[var(--fg)]"
            }`}
          >
            <Home size={14} className="inline -mt-0.5 mr-1.5" />
            {t.tabHome}
          </button>
          <button
            ref={manualTabRef}
            onClick={() => store.setActiveTab("manual")}
            className={`px-5 py-3 text-sm font-medium border-b-2 transition-colors ${
              store.activeTab === "manual"
                ? "border-[var(--accent)] text-[var(--accent)]"
                : "border-transparent text-[var(--muted)] hover:text-[var(--fg)]"
            }`}
          >
            <MousePointer2 size={14} className="inline -mt-0.5 mr-1.5" />
            {t.tabManual}
          </button>
          <button
            ref={creatorTabRef}
            onClick={() => store.setActiveTab("creator")}
            className={`px-5 py-3 text-sm font-medium border-b-2 transition-colors ${
              store.activeTab === "creator"
                ? "border-[var(--accent)] text-[var(--accent)]"
                : "border-transparent text-[var(--muted)] hover:text-[var(--fg)]"
            }`}
          >
            <Sparkles size={14} className="inline -mt-0.5 mr-1.5" />
            {t.tabCreator}
          </button>
          <button
            ref={notesTabRef}
            onClick={() => store.setActiveTab("notes")}
            className={`px-5 py-3 text-sm font-medium border-b-2 transition-colors ${
              store.activeTab === "notes"
                ? "border-[var(--accent)] text-[var(--accent)]"
                : "border-transparent text-[var(--muted)] hover:text-[var(--fg)]"
            }`}
          >
            <IconMic size={14} className="inline -mt-0.5 mr-1.5" />
            {t.tabNotes}
          </button>
          <button
            onClick={() => store.setActiveTab("history")}
            className={`px-5 py-3 text-sm font-medium border-b-2 transition-colors ${
              store.activeTab === "history"
                ? "border-[var(--accent)] text-[var(--accent)]"
                : "border-transparent text-[var(--muted)] hover:text-[var(--fg)]"
            }`}
          >
            <IconClock size={14} className="inline -mt-0.5 mr-1.5" />
            {t.tabHistory}
            {store.history.length > 0 && (
              <span className="ml-1.5 text-xs bg-[var(--surface-2)] rounded-full px-2 py-0.5">
                {store.history.length}
              </span>
            )}
          </button>
        </nav>
      </div>

      {/* Sub-tabs for Creator / Notes / Manual */}
      {(store.activeTab === "creator" || store.activeTab === "notes" || store.activeTab === "manual") && (() => {
        const parentRef = store.activeTab === "manual" ? manualTabRef : store.activeTab === "creator" ? creatorTabRef : notesTabRef;
        const offsetLeft = parentRef.current && tabNavRef.current
          ? parentRef.current.offsetLeft - tabNavRef.current.offsetLeft
          : 0;
        return (
        <div className="border-b border-[var(--border)] px-6 bg-[var(--surface-2)]/30">
          <nav className="max-w-5xl mx-auto w-full flex gap-1" style={{ paddingLeft: offsetLeft }}>
            {store.activeTab === "manual" ? (
              <>
                <button
                  onClick={() => store.setManualSubTab("list")}
                  className={`px-4 py-2 text-xs font-medium border-b-2 transition-colors ${
                    store.manualSubTab === "list"
                      ? "border-[var(--accent)] text-[var(--accent)]"
                      : "border-transparent text-[var(--muted)] hover:text-[var(--fg)]"
                  }`}
                >
                  {t.manualSubTabList}
                  {manualStore.creations.length > 0 && (
                    <span className="ml-1.5 text-xs bg-[var(--surface-2)] rounded-full px-2 py-0.5">
                      {manualStore.creations.length}
                    </span>
                  )}
                </button>
                <button
                  onClick={() => { if (manualStore.activeCreationId) store.setManualSubTab("editor"); }}
                  disabled={!manualStore.activeCreationId}
                  className={`px-4 py-2 text-xs font-medium border-b-2 transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${
                    store.manualSubTab === "editor"
                      ? "border-[var(--accent)] text-[var(--accent)]"
                      : "border-transparent text-[var(--muted)] hover:text-[var(--fg)]"
                  }`}
                >
                  {t.manualSubTabEditor}
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => {
                    if (store.activeTab === "creator") store.setCreatorSubTab("create");
                    else store.setNotesSubTab("create");
                  }}
                  className={`px-4 py-2 text-xs font-medium border-b-2 transition-colors ${
                    (store.activeTab === "creator" ? store.creatorSubTab : store.notesSubTab) === "create"
                      ? "border-[var(--accent)] text-[var(--accent)]"
                      : "border-transparent text-[var(--muted)] hover:text-[var(--fg)]"
                  }`}
                >
                  {t.subTabCreate}
                </button>
                <button
                  onClick={() => {
                    if (store.activeTab === "creator") {
                      if (store.presentation) store.setCreatorSubTab("edit");
                    } else {
                      if (store.notesProject) store.setNotesSubTab("edit");
                    }
                  }}
                  disabled={store.activeTab === "creator" ? !store.presentation : !store.notesProject}
                  className={`px-4 py-2 text-xs font-medium border-b-2 transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${
                    (store.activeTab === "creator" ? store.creatorSubTab : store.notesSubTab) === "edit"
                      ? "border-[var(--accent)] text-[var(--accent)]"
                      : "border-transparent text-[var(--muted)] hover:text-[var(--fg)]"
                  }`}
                >
                  {t.subTabEdit}
                </button>
              </>
            )}
          </nav>
        </div>
        );
      })()}

      {/* Main content */}
      <main className={`flex-1 mx-auto w-full space-y-8 ${store.activeTab === "manual" ? "max-w-7xl px-4 py-6" : "max-w-5xl px-6 py-8"}`}>
        {store.activeTab === "home" ? (
          <div className="space-y-10">
            {/* Hero */}
            <div className="text-center space-y-3 pt-4">
              <h2 className="text-3xl font-bold">{lang === "en" ? "Welcome to TrueSlides" : "Bienvenido a TrueSlides"}</h2>
              <p className="text-[var(--muted)] max-w-xl mx-auto">
                {lang === "en"
                  ? "Create professional presentations effortlessly. Choose between manual design or AI-powered generation."
                  : "Crea presentaciones profesionales sin esfuerzo. Elige entre diseño manual o generación con IA."}
              </p>
            </div>

            {/* Mode cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              {/* Manual Creator */}
              <button
                onClick={() => store.setActiveTab("manual")}
                className="text-left rounded-xl border border-[var(--border)] p-5 space-y-3 hover:border-[var(--accent)]/50 hover:shadow-lg transition-all group"
              >
                <div className="w-10 h-10 rounded-lg bg-[var(--accent)]/10 flex items-center justify-center text-[var(--accent)]">
                  <MousePointer2 size={20} />
                </div>
                <h3 className="text-base font-semibold group-hover:text-[var(--accent)] transition-colors">{t.tabManual}</h3>
                <p className="text-xs text-[var(--muted)] leading-relaxed">
                  {lang === "en"
                    ? "Design slides from scratch. Drag & drop elements, add images, customize backgrounds, and export to PowerPoint."
                    : "Diseña diapositivas desde cero. Arrastra elementos, añade imágenes, personaliza fondos y exporta a PowerPoint."}
                </p>
              </button>

              {/* AI Creator */}
              <button
                onClick={() => store.setActiveTab("creator")}
                className="text-left rounded-xl border border-[var(--border)] p-5 space-y-3 hover:border-[var(--accent)]/50 hover:shadow-lg transition-all group"
              >
                <div className="w-10 h-10 rounded-lg bg-purple-500/10 flex items-center justify-center text-purple-400">
                  <Sparkles size={20} />
                </div>
                <h3 className="text-base font-semibold group-hover:text-purple-400 transition-colors">{t.tabCreator}</h3>
                <p className="text-xs text-[var(--muted)] leading-relaxed">
                  {lang === "en"
                    ? "Upload a document or paste text, and let AI generate a complete presentation with images, layouts, and speaker notes."
                    : "Sube un documento o pega texto, y deja que la IA genere una presentación completa con imágenes, diseños y notas de orador."}
                </p>
              </button>

              {/* Notes Generator */}
              <button
                onClick={() => store.setActiveTab("notes")}
                className="text-left rounded-xl border border-[var(--border)] p-5 space-y-3 hover:border-[var(--accent)]/50 hover:shadow-lg transition-all group"
              >
                <div className="w-10 h-10 rounded-lg bg-emerald-500/10 flex items-center justify-center text-emerald-400">
                  <IconMic size={20} />
                </div>
                <h3 className="text-base font-semibold group-hover:text-emerald-400 transition-colors">{t.tabNotes}</h3>
                <p className="text-xs text-[var(--muted)] leading-relaxed">
                  {lang === "en"
                    ? "Upload an existing PowerPoint and a reference document. AI will generate presenter notes for each slide."
                    : "Sube un PowerPoint existente y un documento de referencia. La IA generará notas de orador para cada diapositiva."}
                </p>
              </button>
            </div>

            {/* Quick instructions */}
            <div className="rounded-xl border border-[var(--border)] p-6 space-y-4 bg-[var(--surface-2)]/30">
              <h3 className="text-sm font-semibold">{lang === "en" ? "Getting Started" : "Primeros Pasos"}</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs text-[var(--muted)] leading-relaxed">
                <div className="space-y-2">
                  <p><strong className="text-[var(--fg)]">1. {lang === "en" ? "Set up API keys" : "Configura las claves API"}</strong><br />
                    {lang === "en"
                      ? "Open Settings (gear icon) and add your API key for at least one AI provider (OpenRouter, Gemini, Claude, or OpenAI)."
                      : "Abre Ajustes (icono de engranaje) y añade tu clave API para al menos un proveedor (OpenRouter, Gemini, Claude u OpenAI)."}
                  </p>
                  <p><strong className="text-[var(--fg)]">2. {lang === "en" ? "Choose a mode" : "Elige un modo"}</strong><br />
                    {lang === "en"
                      ? "Use Manual Creator for full control, or AI Creator to auto-generate from your content."
                      : "Usa Creador Manual para control total, o Creador IA para generar automáticamente a partir de tu contenido."}
                  </p>
                </div>
                <div className="space-y-2">
                  <p><strong className="text-[var(--fg)]">3. {lang === "en" ? "Customize & export" : "Personaliza y exporta"}</strong><br />
                    {lang === "en"
                      ? "Edit slides, adjust images, pick themes and layouts. Download as .pptx when ready."
                      : "Edita diapositivas, ajusta imágenes, elige temas y diseños. Descarga como .pptx cuando estés listo."}
                  </p>
                  <p><strong className="text-[var(--fg)]">4. {lang === "en" ? "History & iterations" : "Historial e iteraciones"}</strong><br />
                    {lang === "en"
                      ? "All AI-generated presentations are saved in History. Re-open, edit, and re-export at any time."
                      : "Todas las presentaciones generadas por IA se guardan en el Historial. Reabre, edita y reexporta en cualquier momento."}
                  </p>
                </div>
              </div>
            </div>
          </div>
        ) : store.activeTab === "manual" ? (
          <div className="flex flex-col h-full">
            <ManualCreator onPresent={manualStore.presentation.slides.length > 0 ? () => setPresenterMode(true) : undefined} />
          </div>
        ) : store.activeTab === "creator" ? (
          <>
            {store.creatorSubTab === "create" ? (
              <>
                {/* Provider/Model selector in body */}
                <section>
                  <ProviderModelSelector />
                </section>

                {/* Source input section */}
                <section className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <FileUploader />
                  <div>
                    <label className="block text-sm font-medium mb-2">
                      {t.pasteText}
                    </label>
                    <textarea
                      value={store.sourceText}
                      onChange={(e) => store.setSourceText(e.target.value)}
                      rows={8}
                      className="w-full bg-[var(--surface-2)] border border-[var(--border)] rounded-xl px-4 py-3 text-sm resize-none focus:outline-none focus:border-[var(--accent)]"
                      placeholder={t.pasteText + "..."}
                    />
                    {store.sourceFileName && (
                      <p className="text-xs text-[var(--success)] mt-1 flex items-center gap-1">
                        <IconCheck size={12} /> {store.sourceFileName}
                      </p>
                    )}
                  </div>
                </section>

                {/* Prompt configuration */}
                <section>
                  <PromptPanel />
                </section>

                {/* Status */}
                <StatusBar />

                {/* Generate button */}
                <div className="flex gap-3">
                  <button
                    onClick={handleGenerate}
                    disabled={!canGenerate}
                    className="flex-1 bg-[var(--accent)] hover:bg-[var(--accent-hover)] disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-xl px-6 py-3.5 text-sm font-semibold transition-colors"
                  >
                    {t.generate}
                  </button>
                </div>
              </>
            ) : (
              <>
                {/* Edit sub-tab — Post-generation view */}
                {store.presentation ? (
                  <>
                    <StatusBar />

                    {/* Action buttons */}
                    <div className="flex gap-3">
                       <div className="flex flex-col gap-2 sm:flex-row sm:gap-3">
                         <button
                           onClick={() => handleDownload("pptx")}
                           className="bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white rounded-xl px-6 py-3 text-sm font-semibold transition-colors"
                         >
                           {t.download}
                         </button>
                         <button
                           onClick={() => handleDownload("pdf")}
                           className="bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white rounded-xl px-6 py-3 text-sm font-semibold transition-colors"
                         >
                           {t.downloadPdf}
                         </button>
                         <button
                           onClick={() => handleDownload("notes")}
                           className="bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white rounded-xl px-6 py-3 text-sm font-semibold transition-colors"
                         >
                           {t.downloadNotes}
                         </button>
                         <button
                           onClick={() => setPresenterMode(true)}
                           className="bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl px-6 py-3 text-sm font-semibold transition-colors flex items-center gap-2"
                           title={lang === "es" ? "Presentar" : "Present"}
                         >
                           <Presentation size={16} />
                         </button>
                       </div>
                      <button
                         onClick={() => {
                          store.setPresentation(null);
                          store.setStatus("idle");
                          store.setCreatorSubTab("create");
                        }}
                        className="bg-[var(--surface-2)] hover:bg-[var(--border)] text-[var(--fg)] rounded-xl px-6 py-3 text-sm font-medium transition-colors"
                      >
                        <IconArrowLeft size={14} className="inline -mt-0.5" /> {t.generate}
                      </button>
                    </div>

                    {/* Slide Editor */}
                    <SlideEditor />
                  </>
                ) : (
                  <div className="text-center py-20 text-[var(--muted)]">
                    <p className="text-sm">{lang === "es" ? "Aún no hay presentación. Genera una desde la pestaña Crear." : "No presentation yet. Generate one from the Create tab."}</p>
                  </div>
                )}
              </>
            )}
          </>
        ) : store.activeTab === "notes" ? (
          /* ── Notes Tab ── */
          <NotesGenerator />
        ) : (
          /* ── History Tab ── */
          <section>
            {store.history.length === 0 ? (
              <div className="text-center py-20 text-[var(--muted)]">
                <IconClock size={48} className="mx-auto mb-4 opacity-30" />
                <p className="text-sm">{t.historyEmpty}</p>
              </div>
            ) : (() => {
              const query = historySearch.toLowerCase().trim();
              const filtered = query
                ? store.history.filter(
                    (e) =>
                      e.title.toLowerCase().includes(query) ||
                      (e.provider && e.provider.toLowerCase().includes(query)) ||
                      (e.modelId && e.modelId.toLowerCase().includes(query)) ||
                      e.type.toLowerCase().includes(query)
                  )
                : store.history;

              const running = filtered.filter((e) => e.status === "running");
              const completed = filtered.filter((e) => e.status !== "running");

              const dateOpts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" };
              const locale = lang === "es" ? "es-ES" : "en-US";

              const statusBadge = (entry: HistoryEntry) => {
                if (entry.status === "running") {
                  const pct = entry.progressPercent ?? 0;
                  const msg = entry.progressMessage || t.historyStatusRunning;
                  return (
                    <button
                      onClick={() => setProgressModalJobId(entry.id)}
                      className="group w-full min-w-[140px] text-left cursor-pointer"
                      title={lang === "es" ? "Clic para ver detalles en vivo" : "Click to view live details"}
                    >
                      <div className="flex items-center gap-1.5 mb-1">
                        <IconLoader size={11} className="animate-spin text-blue-400 shrink-0" />
                        <span className="text-[10px] font-medium text-blue-400 truncate">{msg}</span>
                        <span className="text-[10px] font-semibold text-blue-300 ml-auto shrink-0">{pct}%</span>
                      </div>
                      <div className="relative h-1.5 w-full rounded-full bg-blue-500/15 overflow-hidden">
                        <div
                          className="absolute inset-y-0 left-0 rounded-full bg-blue-500 transition-all duration-500 ease-out group-hover:bg-blue-400"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </button>
                  );
                }
                if (entry.status === "error") {
                  return (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-red-500/15 text-red-400" title={entry.errorMessage}>
                      <IconWarning size={12} />
                      {t.historyStatusError}
                    </span>
                  );
                }
                return (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-emerald-500/15 text-emerald-400">
                    <IconCheck size={12} />
                    {t.historyStatusCompleted}
                  </span>
                );
              };

              const renderRow = (entry: HistoryEntry) => (
                <tr key={entry.id} className="border-b border-[var(--border)] last:border-b-0 hover:bg-[var(--surface-2)]/50 transition-colors">
                  <td className="px-4 py-3 text-sm">
                    <div className="max-w-[220px] truncate font-medium" title={entry.title}>
                      {entry.title}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs text-[var(--muted)]">
                    {entry.type === "presentation" ? t.historyTypePresentation : t.historyTypeNotes}
                  </td>
                  <td className="px-4 py-3">{statusBadge(entry)}</td>
                  <td className="px-4 py-3 text-xs text-[var(--muted)] capitalize">{entry.provider || "—"}</td>
                  <td className="px-4 py-3 text-xs text-[var(--muted)] text-center">
                    {entry.slideCount != null ? entry.slideCount : "—"}
                  </td>
                  <td className="px-4 py-3 text-xs text-[var(--muted)] whitespace-nowrap">
                    {new Date(entry.createdAt).toLocaleDateString(locale, dateOpts)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      {entry.status === "completed" && (
                        <>
                          <button
                            onClick={() => loadFromHistory(entry)}
                            className="px-2.5 py-1 text-xs font-medium rounded-lg bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white transition-colors"
                            title={t.historyEdit}
                          >
                            {t.historyEdit}
                          </button>
                          <button
                            onClick={() => handleDownloadFromHistory(entry)}
                            className="p-1.5 rounded-lg hover:bg-[var(--border)] transition-colors text-[var(--muted)] hover:text-[var(--fg)]"
                            title={t.download}
                          >
                            <IconDownload size={14} />
                          </button>
                          {entry.type === "presentation" && entry.presentation && (
                            <button
                              onClick={() => importToManualCreator(entry)}
                              className="p-1.5 rounded-lg hover:bg-[var(--border)] transition-colors text-[var(--muted)] hover:text-[var(--fg)]"
                              title={t.historyImportManual}
                            >
                              <IconPencilRuler size={14} />
                            </button>
                          )}
                        </>
                      )}
                      {entry.status === "running" && (
                        <button
                          onClick={() => stopJob(entry.id)}
                          className="p-1.5 rounded-lg hover:bg-red-500/10 transition-colors text-[var(--muted)] hover:text-red-400"
                          title={t.historyStop}
                        >
                          <IconStop size={14} />
                        </button>
                      )}
                      <button
                        onClick={() => deleteFromHistory(entry.id)}
                        className="p-1.5 rounded-lg hover:bg-red-500/10 transition-colors text-[var(--muted)] hover:text-red-400"
                        title={t.historyDelete}
                      >
                        <IconTrash size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              );

              return (
                <div className="space-y-6">
                  {/* Search bar */}
                  <div className="relative">
                    <IconSearch size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
                    <input
                      type="text"
                      value={historySearch}
                      onChange={(e) => setHistorySearch(e.target.value)}
                      placeholder={t.historySearch}
                      className="w-full bg-[var(--surface-2)] border border-[var(--border)] rounded-xl pl-10 pr-4 py-2.5 text-sm focus:outline-none focus:border-[var(--accent)] placeholder:text-[var(--muted)]"
                    />
                  </div>

                  {filtered.length === 0 ? (
                    <div className="text-center py-12 text-[var(--muted)]">
                      <p className="text-sm">{lang === "es" ? "Sin resultados" : "No results"}</p>
                    </div>
                  ) : (
                    <div className="space-y-6">
                      {/* In-progress section */}
                      {running.length > 0 && (
                        <div>
                          <h3 className="text-xs font-semibold text-[var(--muted)] uppercase tracking-wider mb-3 flex items-center gap-2">
                            <IconLoader size={14} className="animate-spin text-blue-400" />
                            {t.historyInProgress} ({running.length})
                          </h3>
                          <div className="bg-[var(--surface-2)] border border-blue-500/20 rounded-xl overflow-hidden">
                            <table className="w-full text-left">
                              <thead>
                                <tr className="border-b border-[var(--border)] text-xs text-[var(--muted)] uppercase tracking-wider">
                                  <th className="px-4 py-2.5 font-medium">{t.historyColTitle}</th>
                                  <th className="px-4 py-2.5 font-medium">{t.historyColType}</th>
                                  <th className="px-4 py-2.5 font-medium">{t.historyColStatus}</th>
                                  <th className="px-4 py-2.5 font-medium">{t.historyColProvider}</th>
                                  <th className="px-4 py-2.5 font-medium text-center">{t.historyColSlides}</th>
                                  <th className="px-4 py-2.5 font-medium">{t.historyColDate}</th>
                                  <th className="px-4 py-2.5 font-medium">{t.historyColActions}</th>
                                </tr>
                              </thead>
                              <tbody>
                                {running.map(renderRow)}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}

                      {/* Completed section */}
                      {completed.length > 0 && (
                        <div>
                          {running.length > 0 && (
                            <h3 className="text-xs font-semibold text-[var(--muted)] uppercase tracking-wider mb-3 flex items-center gap-2">
                              <IconCheck size={14} className="text-emerald-400" />
                              {t.historyCompleted} ({completed.length})
                            </h3>
                          )}
                          <div className="bg-[var(--surface-2)] border border-[var(--border)] rounded-xl overflow-hidden">
                            <table className="w-full text-left">
                              <thead>
                                <tr className="border-b border-[var(--border)] text-xs text-[var(--muted)] uppercase tracking-wider">
                                  <th className="px-4 py-2.5 font-medium">{t.historyColTitle}</th>
                                  <th className="px-4 py-2.5 font-medium">{t.historyColType}</th>
                                  <th className="px-4 py-2.5 font-medium">{t.historyColStatus}</th>
                                  <th className="px-4 py-2.5 font-medium">{t.historyColProvider}</th>
                                  <th className="px-4 py-2.5 font-medium text-center">{t.historyColSlides}</th>
                                  <th className="px-4 py-2.5 font-medium">{t.historyColDate}</th>
                                  <th className="px-4 py-2.5 font-medium">{t.historyColActions}</th>
                                </tr>
                              </thead>
                              <tbody>
                                {completed.map(renderRow)}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })()}
          </section>
        )}
      </main>

      {/* Settings Modal */}
      <SettingsPanel />

      {/* Job Progress Modal */}
      {progressModalJobId && (() => {
        const entry = store.history.find((e) => e.id === progressModalJobId);
        if (!entry) return null;
        const previewSlides =
          jobPartialSlides[entry.id] ||
          entry.presentation?.slides?.map((slide) => ({
            title: slide.title,
            bullets: slide.bullets,
            notes: slide.notes,
            section: slide.section,
            imageUrls: slide.imageUrls,
          })) ||
          [];
        return (
          <JobProgressModal
            jobId={entry.id}
            title={entry.title}
            status={entry.status === "running" ? "running" : entry.status === "error" ? "error" : "completed"}
            percent={entry.progressPercent ?? (entry.status === "completed" ? 100 : 0)}
            message={entry.progressMessage ?? (entry.status === "completed" ? "Done" : "")}
            progressLog={jobLogsRef.current[entry.id] || []}
            previewSlides={previewSlides}
            expectedSlides={entry.slideCount}
            onClose={() => setProgressModalJobId(null)}
            onStop={stopJob}
            onCompleted={(completedJobId) => {
              setProgressModalJobId(null);
              const completedEntry = store.history.find((e) => e.id === completedJobId);
              if (completedEntry) {
                loadFromHistory(completedEntry);
              }
            }}
            lang={lang}
          />
        );
      })()}
    </div>
  );
}
