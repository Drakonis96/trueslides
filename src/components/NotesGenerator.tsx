"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAppStore } from "@/lib/store";
import { UI_TEXT, PROMPT_FIELDS } from "@/lib/presets";
import { NotesProject, ParsedPptxSlide, OUTPUT_LANGUAGE_OPTIONS, HistoryEntry } from "@/lib/types";
import ProviderModelSelector from "./ProviderModelSelector";
import {
  IconUpload,
  IconLoader,
  IconRefresh,
  IconDownload,
  IconArrowLeft,
  IconCheck,
  IconWarning,
  IconFileText,
  IconSlides,
} from "./Icons";

function NotesPresetSelector() {
  const { settings, notesPrompt, setNotesPrompt, customPresets } = useAppStore();
  const lang = settings.language;
  const t = UI_TEXT[lang];

  const field = PROMPT_FIELDS.find((f) => f.key === "notes")!;
  const builtInPresets = field.presets[lang];
  const userPresets = customPresets
    .filter((p) => p.field === "notes")
    .map((p) => ({ id: p.id, label: p.label, text: p.text }));
  const allPresets = [...builtInPresets, ...userPresets];
  const activePreset = allPresets.find((p) => p.text === notesPrompt);
  const isCustom = !activePreset && notesPrompt !== "";

  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium">{t.notesPrompt}</label>
      <select
        className="w-full bg-[var(--surface-2)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[var(--accent)]"
        value={isCustom ? "__custom__" : (activePreset?.id ?? "__custom__")}
        onChange={(e) => {
          if (e.target.value === "__custom__") {
            setNotesPrompt(" ");
            return;
          }
          const preset = allPresets.find((p) => p.id === e.target.value);
          if (preset) setNotesPrompt(preset.text);
        }}
      >
        <option value="__custom__">{t.custom}</option>
        {allPresets.map((p) => (
          <option key={p.id} value={p.id}>{p.label}</option>
        ))}
      </select>
    </div>
  );
}

function NotesPromptTextarea() {
  const { settings, notesPrompt, setNotesPrompt } = useAppStore();
  const lang = settings.language;
  const t = UI_TEXT[lang];

  const field = PROMPT_FIELDS.find((f) => f.key === "notes")!;
  const builtInPresets = field.presets[lang];
  const isNone = builtInPresets.some((p) => p.text === "" && p.text === notesPrompt);

  if (isNone) return null;

  return (
    <textarea
      value={notesPrompt}
      onChange={(e) => setNotesPrompt(e.target.value)}
      rows={3}
      className="w-full bg-[var(--surface-2)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:border-[var(--accent)]"
      placeholder={field.label[lang] + "..."}
    />
  );
}

export default function NotesGenerator() {
  const store = useAppStore();
  const lang = store.settings.language;
  const t = UI_TEXT[lang];
  const jobNotFoundGraceMs = 15_000; // Grace period for job registration in dev mode

  const { provider: effectiveProvider, modelId: effectiveModelId } =
    store.getEffectiveSelection();

  // Local upload state
  const [pptxFile, setPptxFile] = useState<File | null>(null);
  const [pptxParsed, setPptxParsed] = useState<ParsedPptxSlide[] | null>(null);
  const [pptxFileName, setPptxFileName] = useState("");
  const [docFile, setDocFile] = useState<File | null>(null);
  const [docText, setDocText] = useState("");
  const [docFileName, setDocFileName] = useState("");
  const [uploading, setUploading] = useState<"pptx" | "doc" | null>(null);
  const [uploadError, setUploadError] = useState("");
  const [regeneratingSlide, setRegeneratingSlide] = useState<number | null>(null);
  const [customInstructions, setCustomInstructions] = useState<Record<number, string>>({});

  const pptxRef = useRef<HTMLInputElement>(null);
  const docRef = useRef<HTMLInputElement>(null);

  // Upload PPTX
  const handlePptxFile = useCallback(async (file: File) => {
    setUploadError("");
    if (!file.name.toLowerCase().endsWith(".pptx")) {
      setUploadError("Only .pptx files are supported");
      return;
    }
    setUploading("pptx");
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/parse-pptx", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) {
        setUploadError(data.error || "Failed to parse PPTX");
        return;
      }
      setPptxFile(file);
      setPptxFileName(data.fileName);
      setPptxParsed(data.slides);
    } catch {
      setUploadError("Failed to upload PPTX");
    } finally {
      setUploading(null);
    }
  }, []);

  // Upload document
  const handleDocFile = useCallback(async (file: File) => {
    setUploadError("");
    const name = file.name.toLowerCase();
    if (!name.endsWith(".pdf") && !name.endsWith(".docx") && !name.endsWith(".txt")) {
      setUploadError(t.unsupportedFile);
      return;
    }
    setUploading("doc");
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/parse", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) {
        setUploadError(data.error || "Upload failed");
        return;
      }
      setDocFile(file);
      setDocText(data.text);
      setDocFileName(data.fileName);
    } catch {
      setUploadError("Failed to upload document");
    } finally {
      setUploading(null);
    }
  }, [t.unsupportedFile]);

  // Generate notes for all slides
  const handleGenerate = useCallback(async () => {
    if (!pptxParsed || !docText || !effectiveModelId) return;

    store.setNotesStatus("generating");
    store.setNotesProgress(5, t.notesGenerating);

    // Create history entry immediately with a job ID
    const historyId = crypto.randomUUID();
    const historyEntry: HistoryEntry = {
      id: historyId,
      title: pptxFileName || (store.settings.language === "es" ? "Generando notas..." : "Generating notes..."),
      createdAt: Date.now(),
      type: "notes",
      status: "running",
      provider: effectiveProvider,
      modelId: effectiveModelId,
      slideCount: pptxParsed.length,
    };
    store.addToHistory(historyEntry);

    try {
      // Start background job — returns immediately
      const res = await fetch("/api/generate-notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobId: historyId,
          provider: effectiveProvider,
          modelId: effectiveModelId,
          outputLanguage: store.notesOutputLanguage,
          notesPrompt: store.notesPrompt,
          docText,
          docDensity: store.notesDocDensity,
          paragraphs: store.notesParagraphs,
          includeExistingNotes: store.notesIncludeExisting,
          useVision: store.notesUseVision,
          slides: pptxParsed.map((s) => ({
            index: s.index,
            texts: s.texts,
            presenterNotes: s.presenterNotes || "",
            imageBase64: store.notesUseVision && s.imageBase64s.length > 0 ? s.imageBase64s[0] : undefined,
          })),
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        store.setNotesError(data.error || "Failed to generate notes");
        store.updateHistoryEntry(historyId, {
          status: "error",
          errorMessage: data.error || "Failed to generate notes",
          completedAt: Date.now(),
        });
        return;
      }

      // Job dispatched — reset status so user can create more jobs
      store.setNotesStatus("idle");
      store.setNotesProgress(0);
    } catch (err) {
      console.error("Notes generation error:", err);
      const errorMsg = err instanceof Error ? err.message : "Failed to generate notes";
      store.setNotesError(errorMsg);
      store.updateHistoryEntry(historyId, {
        status: "error",
        errorMessage: errorMsg,
        completedAt: Date.now(),
      });
    }
  }, [pptxParsed, docText, effectiveProvider, effectiveModelId, pptxFileName, store, t]);

  // Poll for running notes jobs
  const notesPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const notesRunningCount = useAppStore((s) => s.history.filter((e) => e.type === "notes" && e.status === "running").length);

  useEffect(() => {
    if (notesRunningCount === 0) {
      if (notesPollRef.current) {
        clearInterval(notesPollRef.current);
        notesPollRef.current = null;
      }
      return;
    }
    if (notesPollRef.current) return;

    const poll = async () => {
      const s = useAppStore.getState();
      const running = s.history.filter((e) => e.type === "notes" && e.status === "running");
      if (running.length === 0) {
        if (notesPollRef.current) {
          clearInterval(notesPollRef.current);
          notesPollRef.current = null;
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
            s.setNotesError("Generation interrupted (server restarted)");
            s.updateHistoryEntry(entry.id, {
              status: "error",
              errorMessage: "Generation interrupted (server restarted)",
              completedAt: Date.now(),
            });
            continue;
          }
          if (!res.ok) continue;
          const job = await res.json();

          if (job.status === "completed" && job.result) {
            const notes: string[] = job.result.notes || [];
            const project: NotesProject = {
              id: crypto.randomUUID(),
              pptxFileName: pptxFileName,
              docFileName: docFileName,
              docText: docText,
              slides: pptxParsed || [],
              generatedNotes: notes,
              createdAt: Date.now(),
            };
            // Notes completed — result stored in history; user can load from there
            s.updateHistoryEntry(entry.id, {
              title: pptxFileName || entry.title,
              status: "completed",
              notesProject: project,
              slideCount: pptxParsed?.length ?? entry.slideCount,
              completedAt: job.completedAt,
            });
          } else if (job.status === "error" || job.status === "cancelled") {
            s.updateHistoryEntry(entry.id, {
              status: "error",
              errorMessage: job.error || "Generation failed",
              completedAt: job.completedAt,
            });
          } else if (job.status === "running" && job.progress) {
            // Progress tracked in history; no global state update needed
          }
        } catch {
          // ignore
        }
      }
    };

    poll();
    notesPollRef.current = setInterval(poll, 2_000);

    return () => {
      if (notesPollRef.current) {
        clearInterval(notesPollRef.current);
        notesPollRef.current = null;
      }
    };
  }, [notesRunningCount, pptxFileName, docFileName, docText, pptxParsed, t, jobNotFoundGraceMs]);

  // Regenerate a single slide's note
  const handleRegenerateSlide = useCallback(async (slideIndex: number) => {
    if (!store.notesProject || !effectiveModelId) return;
    setRegeneratingSlide(slideIndex);

    try {
      const slide = store.notesProject.slides[slideIndex];
      const res = await fetch("/api/generate-notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: effectiveProvider,
          modelId: effectiveModelId,
          outputLanguage: store.notesOutputLanguage,
          notesPrompt: store.notesPrompt,
          docText: store.notesProject.docText,
          docDensity: store.notesDocDensity,
          paragraphs: store.notesParagraphs,
          includeExistingNotes: store.notesIncludeExisting,
          useVision: store.notesUseVision,
          slides: store.notesProject.slides.map((s) => ({
            index: s.index,
            texts: s.texts,
            presenterNotes: s.presenterNotes || "",
            imageBase64: store.notesUseVision && s.imageBase64s.length > 0 ? s.imageBase64s[0] : undefined,
          })),
          targetSlideIndex: slideIndex,
          customInstruction: customInstructions[slideIndex] || undefined,
          existingNote: store.notesProject.generatedNotes[slideIndex] || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        store.setNotesError(data.error || "Failed to regenerate note");
        return;
      }

      store.updateNote(slideIndex, data.note || "");
      // Clear custom instruction after use
      setCustomInstructions((prev) => {
        const next = { ...prev };
        delete next[slideIndex];
        return next;
      });
    } catch (err) {
      console.error("Note regeneration error:", err);
      store.setNotesError(err instanceof Error ? err.message : "Failed to regenerate note");
    } finally {
      setRegeneratingSlide(null);
    }
  }, [store, effectiveProvider, effectiveModelId, customInstructions]);

  // Export PPTX with notes (download the original with notes injected)
  const handleExportNotes = useCallback(async () => {
    if (!store.notesProject || !pptxFile) return;

    store.setNotesStatus("generating");
    store.setNotesProgress(30, lang === "es" ? "Inyectando notas en el PPTX..." : "Injecting notes into PPTX...");

    try {
      const formData = new FormData();
      formData.append("file", pptxFile);
      formData.append("notes", JSON.stringify(store.notesProject.generatedNotes));

      const res = await fetch("/api/inject-notes", { method: "POST", body: formData });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        store.setNotesError(data.error || "Failed to export PPTX");
        return;
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = pptxFileName.replace(".pptx", "-with-notes.pptx");
      a.click();
      URL.revokeObjectURL(url);
      store.setNotesStatus("done");
    } catch (err) {
      console.error("Export error:", err);
      store.setNotesError("Failed to export PPTX with notes");
    }
  }, [store, pptxFile, pptxFileName, lang]);

  // Drop handlers
  const handleDrop = useCallback((e: React.DragEvent, type: "pptx" | "doc") => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) {
      if (type === "pptx") handlePptxFile(file);
      else handleDocFile(file);
    }
  }, [handlePptxFile, handleDocFile]);

  const canGenerate = pptxParsed && docText && effectiveModelId &&
    store.notesStatus !== "parsing";

  // ── Editor view (sub-tab "edit") ──
  if (store.notesSubTab === "edit") {
    if (!store.notesProject) {
      return (
        <div className="text-center py-20 text-[var(--muted)]">
          <p className="text-sm">{lang === "es" ? "Aún no hay notas. Genera unas desde la pestaña Crear." : "No notes yet. Generate some from the Create tab."}</p>
        </div>
      );
    }
    return (
      <div className="space-y-6">
        {/* Header actions */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold">{store.notesProject.pptxFileName}</h2>
            <p className="text-xs text-[var(--muted)]">
              {store.notesProject.slides.length} {t.historySlides} · {store.notesProject.docFileName}
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleExportNotes}
              className="bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white rounded-xl px-5 py-2.5 text-sm font-semibold transition-colors flex items-center gap-2"
            >
              <IconDownload size={14} />
              {t.notesExportPptx}
            </button>
            <button
              onClick={() => {
                store.setNotesProject(null);
                store.setNotesStatus("idle");
                store.setNotesSubTab("create");
              }}
              className="bg-[var(--surface-2)] hover:bg-[var(--border)] text-[var(--fg)] rounded-xl px-5 py-2.5 text-sm font-medium transition-colors"
            >
              <IconArrowLeft size={14} className="inline -mt-0.5 mr-1" />
              {t.notesBack}
            </button>
          </div>
        </div>

        {/* Error */}
        {store.notesError && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 text-sm text-red-400 flex items-center gap-2">
            <IconWarning size={16} />
            {store.notesError}
          </div>
        )}

        {/* Notes preset + language for regeneration */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <NotesPresetSelector />
          <div>
            <label className="block text-sm font-medium mb-1.5">{t.outputLanguage}</label>
            <select
              value={store.notesOutputLanguage}
              onChange={(e) => store.setNotesOutputLanguage(e.target.value as typeof store.notesOutputLanguage)}
              className="w-full bg-[var(--surface-2)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[var(--accent)]"
            >
              {OUTPUT_LANGUAGE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
        </div>
        <NotesPromptTextarea />

        {/* Slide notes list */}
        <div className="space-y-4">
          {store.notesProject.slides.map((slide, i) => (
            <div
              key={i}
              className="bg-[var(--surface-2)] border border-[var(--border)] rounded-xl overflow-hidden"
            >
              {/* Slide header */}
              <div className="px-4 py-3 border-b border-[var(--border)] flex items-center gap-3">
                <span className="bg-[var(--accent)]/20 text-[var(--accent)] text-xs font-bold px-2.5 py-1 rounded-lg">
                  {t.notesSlide} {i + 1}
                </span>
                <span className="text-sm text-[var(--muted)] truncate flex-1">
                  {slide.texts.slice(0, 3).join(" · ")}
                </span>
              </div>

              {/* Slide images preview (if available) */}
              {slide.imageBase64s.length > 0 && (
                <div className="px-4 py-2 flex gap-2 overflow-x-auto border-b border-[var(--border)]">
                  {slide.imageBase64s.slice(0, 3).map((img, j) => (
                    <img
                      key={j}
                      src={img}
                      alt={`Slide ${i + 1} image ${j + 1}`}
                      className="h-16 rounded-lg object-cover shrink-0"
                    />
                  ))}
                </div>
              )}

              {/* Note content */}
              <div className="px-4 py-3">
                <textarea
                  value={store.notesProject!.generatedNotes[i] || ""}
                  onChange={(e) => store.updateNote(i, e.target.value)}
                  rows={4}
                  className="w-full bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:border-[var(--accent)]"
                />
              </div>

              {/* Regenerate controls */}
              <div className="px-4 py-3 border-t border-[var(--border)] flex flex-col gap-2 sm:flex-row sm:items-center">
                <input
                  type="text"
                  value={customInstructions[i] || ""}
                  onChange={(e) => setCustomInstructions((prev) => ({ ...prev, [i]: e.target.value }))}
                  placeholder={t.notesCustomPromptPlaceholder}
                  className="flex-1 bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-[var(--accent)]"
                />
                <button
                  onClick={() => handleRegenerateSlide(i)}
                  disabled={regeneratingSlide !== null}
                  className="bg-[var(--surface-2)] hover:bg-[var(--border)] border border-[var(--border)] rounded-lg px-3 py-2 text-xs font-medium transition-colors flex items-center gap-1.5 shrink-0 disabled:opacity-40"
                >
                  {regeneratingSlide === i ? (
                    <IconLoader size={12} className="animate-spin" />
                  ) : (
                    <IconRefresh size={12} />
                  )}
                  {t.notesRegenerate}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ── Upload & setup view ──
  return (
    <div className="space-y-6">
      {/* Provider/Model selector */}
      <section>
        <ProviderModelSelector />
      </section>

      {/* Notes preset + Output language */}
      <section className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <NotesPresetSelector />
          <div>
            <label className="block text-sm font-medium mb-1.5">{t.outputLanguage}</label>
            <select
              value={store.notesOutputLanguage}
              onChange={(e) => store.setNotesOutputLanguage(e.target.value as typeof store.notesOutputLanguage)}
              className="w-full bg-[var(--surface-2)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[var(--accent)]"
            >
              {OUTPUT_LANGUAGE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
        </div>
        <NotesPromptTextarea />
      </section>

      {/* Advanced options: existing notes, vision, document density */}
      <section className="space-y-4">
        {/* Checkboxes row */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Include existing notes */}
          <label className="flex items-start gap-3 cursor-pointer group">
            <input
              type="checkbox"
              checked={store.notesIncludeExisting}
              onChange={(e) => store.setNotesIncludeExisting(e.target.checked)}
              className="mt-0.5 accent-[var(--accent)] w-4 h-4 shrink-0"
            />
            <div>
              <span className="text-sm font-medium group-hover:text-[var(--accent)] transition-colors">
                {t.notesIncludeExisting}
              </span>
              <p className="text-xs text-[var(--muted)] mt-0.5">{t.notesIncludeExistingDesc}</p>
              {pptxParsed && pptxParsed.some((s) => s.presenterNotes) && (
                <p className="text-xs text-[var(--success)] mt-0.5">
                  {lang === "es"
                    ? `${pptxParsed.filter((s) => s.presenterNotes).length} diapositiva(s) con notas detectadas`
                    : `${pptxParsed.filter((s) => s.presenterNotes).length} slide(s) with notes detected`}
                </p>
              )}
            </div>
          </label>

          {/* Use vision */}
          <label className="flex items-start gap-3 cursor-pointer group">
            <input
              type="checkbox"
              checked={store.notesUseVision}
              onChange={(e) => store.setNotesUseVision(e.target.checked)}
              className="mt-0.5 accent-[var(--accent)] w-4 h-4 shrink-0"
            />
            <div>
              <span className="text-sm font-medium group-hover:text-[var(--accent)] transition-colors">
                {t.notesUseVision}
              </span>
              <p className="text-xs text-[var(--muted)] mt-0.5">{t.notesUseVisionDesc}</p>
            </div>
          </label>
        </div>

        {/* Document density slider */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm font-medium">{t.notesDocDensity}</label>
            <span className="text-xs font-mono text-[var(--muted)]">{store.notesDocDensity}%</span>
          </div>
          <input
            type="range"
            min={0}
            max={100}
            step={10}
            value={store.notesDocDensity}
            onChange={(e) => store.setNotesDocDensity(Number(e.target.value))}
            className="w-full accent-[var(--accent)]"
          />
          <div className="flex justify-between text-[10px] text-[var(--muted)] mt-1">
            <span>{t.notesDocDensitySlideOnly}</span>
            <span>{t.notesDocDensityFull}</span>
          </div>
        </div>

        {/* Paragraphs per note */}
        <div>
          <label className="text-sm font-medium">{t.notesParagraphs}</label>
          <select
            value={store.notesParagraphs}
            onChange={(e) => store.setNotesParagraphs(Number(e.target.value))}
            className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] px-3 py-2 text-sm"
          >
            <option value={1}>1</option>
            <option value={2}>2</option>
            <option value={3}>3</option>
            <option value={0}>{t.notesParagraphsCustom}</option>
          </select>
        </div>
      </section>
      <section className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* PPTX upload */}
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => handleDrop(e, "pptx")}
          onClick={() => pptxRef.current?.click()}
          className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${
            pptxParsed
              ? "border-[var(--success)] bg-[var(--success)]/5"
              : "border-[var(--border)] hover:border-[var(--accent)]"
          }`}
        >
          <input
            ref={pptxRef}
            type="file"
            accept=".pptx"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && handlePptxFile(e.target.files[0])}
          />
          {uploading === "pptx" ? (
            <IconLoader size={24} className="mx-auto mb-2 animate-spin text-[var(--accent)]" />
          ) : pptxParsed ? (
            <IconCheck size={24} className="mx-auto mb-2 text-[var(--success)]" />
          ) : (
            <IconSlides size={24} className="mx-auto mb-2 text-[var(--muted)]" />
          )}
          <p className="text-sm font-medium">
            {pptxParsed ? pptxFileName : t.notesUploadPptx}
          </p>
          <p className="text-xs text-[var(--muted)] mt-1">
            {pptxParsed
              ? `${pptxParsed.length} ${t.historySlides}`
              : t.notesDragPptx}
          </p>
        </div>

        {/* Document upload */}
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => handleDrop(e, "doc")}
          onClick={() => docRef.current?.click()}
          className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${
            docText
              ? "border-[var(--success)] bg-[var(--success)]/5"
              : "border-[var(--border)] hover:border-[var(--accent)]"
          }`}
        >
          <input
            ref={docRef}
            type="file"
            accept=".pdf,.docx,.txt"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && handleDocFile(e.target.files[0])}
          />
          {uploading === "doc" ? (
            <IconLoader size={24} className="mx-auto mb-2 animate-spin text-[var(--accent)]" />
          ) : docText ? (
            <IconCheck size={24} className="mx-auto mb-2 text-[var(--success)]" />
          ) : (
            <IconFileText size={24} className="mx-auto mb-2 text-[var(--muted)]" />
          )}
          <p className="text-sm font-medium">
            {docText ? docFileName : t.notesUploadDoc}
          </p>
          <p className="text-xs text-[var(--muted)] mt-1">
            {docText
              ? `${docText.length.toLocaleString()} chars`
              : t.notesDragDoc}
          </p>
        </div>
      </section>

      {/* Document truncation warning */}
      {docText && docText.length > 120_000 && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl px-4 py-3 text-sm text-amber-400 flex items-center gap-2">
          <IconWarning size={16} />
          {lang === "es"
            ? `El documento tiene ${docText.length.toLocaleString()} caracteres. Se usarán los primeros 120.000 (~30k tokens) para no exceder los límites del modelo.`
            : `Document has ${docText.length.toLocaleString()} characters. The first 120,000 (~30k tokens) will be used to stay within model limits.`}
        </div>
      )}

      {/* Upload error */}
      {uploadError && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 text-sm text-red-400 flex items-center gap-2">
          <IconWarning size={16} />
          {uploadError}
        </div>
      )}

      {/* Notes error */}
      {store.notesError && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 text-sm text-red-400 flex items-center gap-2">
          <IconWarning size={16} />
          {store.notesError}
        </div>
      )}

      {/* Status/Progress - shown only during parsing */}
      {store.notesStatus === "parsing" && (
        <div className="flex items-center gap-3 text-sm text-[var(--muted)]">
          <IconLoader size={16} className="animate-spin text-[var(--accent)]" />
          <span>{store.notesStatusMessage || t.notesGenerating}</span>
        </div>
      )}

      {/* Generate button */}
      <button
        onClick={handleGenerate}
        disabled={!canGenerate}
        className="w-full bg-[var(--accent)] hover:bg-[var(--accent-hover)] disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-xl px-6 py-3.5 text-sm font-semibold transition-colors"
      >
        {t.notesGenerate}
      </button>

      {/* Empty state hint */}
      {!pptxParsed && !docText && (
        <p className="text-center text-xs text-[var(--muted)] pt-4">
          {t.notesEmpty}
        </p>
      )}
    </div>
  );
}
