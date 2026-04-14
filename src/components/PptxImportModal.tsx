"use client";

import { useCallback, useRef, useState } from "react";
import { useAppStore } from "@/lib/store";
import { IconUpload, IconLoader, IconSlides, IconImage } from "./Icons";
import type { ManualSlide, ManualSlideElement, ManualPresentation, ManualLayoutId } from "@/lib/manual-store";

/* ── Types from parse-pptx response ── */

interface ParsedShape {
  type: "text" | "image" | "table";
  x: number;
  y: number;
  w: number;
  h: number;
  paragraphs?: {
    runs: { text: string; bold?: boolean; fontSize?: number; color?: string; fontFamily?: string }[];
    alignment?: string;
    isBullet?: boolean;
  }[];
  imageBase64?: string;
  fontSize?: number;
  fontWeight?: "normal" | "bold";
  fontFamily?: string;
  color?: string;
  textAlign?: "left" | "center" | "right" | "justify";
}

interface ParsedSlide {
  index: number;
  texts: string[];
  imageBase64s: string[];
  presenterNotes: string;
  shapes: ParsedShape[];
  bgColor?: string;
  slideWidthEmu?: number;
  slideHeightEmu?: number;
}

interface ParsePptxResponse {
  fileName: string;
  slideCount: number;
  slides: ParsedSlide[];
}

/* ── Helpers ── */

/** Convert parsed PPTX slide into ManualSlide with rich shapes (existing import logic). */
function parsedSlideToManualSlide(ps: ParsedSlide, lang: string): ManualSlide {
  const elements: ManualSlideElement[] = [];
  let zIndex = 1;

  if (ps.shapes && ps.shapes.length > 0) {
    for (const shape of ps.shapes) {
      if (shape.type === "image" && shape.imageBase64) {
        elements.push({
          id: crypto.randomUUID(),
          type: "image",
          x: shape.x,
          y: shape.y,
          w: shape.w,
          h: shape.h,
          content: shape.imageBase64,
          fontSize: 14,
          zIndex: zIndex++,
        });
      } else if (shape.type === "text" && shape.paragraphs) {
        const lines = shape.paragraphs.map((p) =>
          p.runs.map((r) => r.text).join("")
        );
        const content = lines.join("\n");
        if (!content.trim()) continue;

        const isBigBold =
          (shape.fontSize && shape.fontSize >= 28) ||
          shape.fontWeight === "bold";
        const hasBullets = shape.paragraphs.some((p) => p.isBullet);
        const isFirstShape =
          elements.filter((e) => e.type !== "image").length === 0;
        let elType: ManualSlideElement["type"] = "text";
        if (isBigBold && isFirstShape && !hasBullets) {
          elType = "title";
        } else if (hasBullets || lines.length > 2) {
          elType = "bullets";
        }

        elements.push({
          id: crypto.randomUUID(),
          type: elType,
          x: shape.x,
          y: shape.y,
          w: shape.w,
          h: shape.h,
          content,
          fontSize: shape.fontSize || (elType === "title" ? 32 : 18),
          fontWeight:
            shape.fontWeight || (elType === "title" ? "bold" : "normal"),
          fontFamily: shape.fontFamily,
          color: shape.color || "FFFFFF",
          textAlign: shape.textAlign,
          zIndex: zIndex++,
        });
      }
    }
  } else {
    // Fallback: flat import
    if (ps.texts.length > 0) {
      elements.push({
        id: crypto.randomUUID(),
        type: "title",
        x: 4,
        y: 4,
        w: 92,
        h: 12,
        content: ps.texts[0],
        fontSize: 32,
        fontWeight: "bold",
        color: "FFFFFF",
        zIndex: zIndex++,
      });
    }
    if (ps.texts.length > 1) {
      elements.push({
        id: crypto.randomUUID(),
        type: "bullets",
        x: 4,
        y: 18,
        w: ps.imageBase64s.length > 0 ? 50 : 92,
        h: 60,
        content: ps.texts.slice(1).join("\n"),
        fontSize: 18,
        zIndex: zIndex++,
      });
    }
    ps.imageBase64s.forEach((imgData, imgIdx) => {
      elements.push({
        id: crypto.randomUUID(),
        type: "image",
        x: ps.texts.length > 1 ? 56 : 10 + imgIdx * 25,
        y: 18,
        w: ps.texts.length > 1 ? 40 : 42,
        h: 60,
        content: imgData,
        fontSize: 14,
        zIndex: zIndex++,
      });
    });
  }

  if (elements.length === 0) {
    elements.push({
      id: crypto.randomUUID(),
      type: "text",
      x: 10,
      y: 40,
      w: 80,
      h: 20,
      content: lang === "en" ? "(empty slide)" : "(diapositiva vacía)",
      fontSize: 18,
      zIndex: 1,
    });
  }

  return {
    id: crypto.randomUUID(),
    layout: "single" as ManualLayoutId,
    elements,
    notes: ps.presenterNotes || "",
    bgColor: ps.bgColor || "1E293B",
    accentColor: "6366F1",
  };
}

/* ── Component ── */

interface PptxImportModalProps {
  open: boolean;
  onClose: () => void;
  onImport: (presentation: ManualPresentation) => void;
}

export default function PptxImportModal({
  open,
  onClose,
  onImport,
}: PptxImportModalProps) {
  const { settings } = useAppStore();
  const lang = settings.language;

  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState("");
  const [parsedData, setParsedData] = useState<ParsePptxResponse | null>(null);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Progress tracking for image conversion
  const [progressStep, setProgressStep] = useState("");
  const [progressPercent, setProgressPercent] = useState(0);
  const [progressCurrentSlide, setProgressCurrentSlide] = useState(0);
  const [progressTotalSlides, setProgressTotalSlides] = useState(0);

  const reset = useCallback(() => {
    setDragging(false);
    setUploading(false);
    setProcessing(false);
    setError("");
    setParsedData(null);
    setUploadedFile(null);
    setProgressStep("");
    setProgressPercent(0);
    setProgressCurrentSlide(0);
    setProgressTotalSlides(0);
  }, []);

  const handleClose = useCallback(() => {
    reset();
    onClose();
  }, [reset, onClose]);

  const handleFile = useCallback(
    async (file: File) => {
      setError("");
      if (!file.name.toLowerCase().endsWith(".pptx")) {
        setError(
          lang === "es"
            ? "Solo se aceptan archivos .pptx"
            : "Only .pptx files are supported"
        );
        return;
      }

      setUploading(true);
      try {
        const formData = new FormData();
        formData.append("file", file);
        const res = await fetch("/api/parse-pptx", {
          method: "POST",
          body: formData,
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error || "Upload failed");
          return;
        }
        setParsedData(data as ParsePptxResponse);
        setUploadedFile(file);
      } catch {
        setError(
          lang === "es"
            ? "Error al subir el archivo"
            : "Failed to upload file"
        );
      } finally {
        setUploading(false);
      }
    },
    [lang]
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  /** Import as PowerPoint (text + elements, each shape preserved) */
  const handleImportAsPresentation = useCallback(() => {
    if (!parsedData) return;
    const slides = parsedData.slides.map((ps) =>
      parsedSlideToManualSlide(ps, lang === "es" ? "es" : "en")
    );
    const title = (parsedData.fileName || "Imported Deck").replace(
      /\.pptx$/i,
      ""
    );
    onImport({ title, slides });
    handleClose();
  }, [parsedData, onImport, handleClose, lang]);

  /** Import as images (each slide → server-side rendered image via LibreOffice, with SSE progress) */
  const handleImportAsImages = useCallback(async () => {
    if (!parsedData || !uploadedFile) return;
    setProcessing(true);
    setError("");
    setProgressStep("extracting_notes");
    setProgressPercent(0);
    setProgressCurrentSlide(0);
    setProgressTotalSlides(0);

    try {
      const formData = new FormData();
      formData.append("file", uploadedFile);
      const res = await fetch("/api/pptx-to-images", {
        method: "POST",
        body: formData,
      });

      // If not SSE (error response), handle as JSON
      const contentType = res.headers.get("content-type") || "";
      if (!contentType.includes("text/event-stream")) {
        const data = await res.json();
        setError(data.error || "Conversion failed");
        return;
      }

      // Parse SSE stream
      const reader = res.body?.getReader();
      if (!reader) {
        setError("Failed to read stream");
        return;
      }

      const decoder = new TextDecoder();
      let buffer = "";
      let resultData: { images: string[]; thumbnails?: string[]; presenterNotes: string[] } | null = null;
      let streamError: string | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Parse complete SSE events from buffer
        const events = buffer.split("\n\n");
        buffer = events.pop() || ""; // Keep incomplete event in buffer

        for (const eventBlock of events) {
          if (!eventBlock.trim()) continue;
          const lines = eventBlock.split("\n");
          let eventType = "";
          let eventData = "";
          for (const line of lines) {
            if (line.startsWith("event: ")) eventType = line.slice(7);
            else if (line.startsWith("data: ")) eventData = line.slice(6);
          }
          if (!eventType || !eventData) continue;

          try {
            const parsed = JSON.parse(eventData);
            if (eventType === "progress") {
              setProgressStep(parsed.step || "");
              setProgressPercent(parsed.percent ?? 0);
              if (parsed.totalSlides !== undefined) setProgressTotalSlides(parsed.totalSlides);
              if (parsed.currentSlide !== undefined) setProgressCurrentSlide(parsed.currentSlide);
            } else if (eventType === "result") {
              resultData = parsed;
            } else if (eventType === "error") {
              streamError = parsed.error || "Conversion failed";
            }
          } catch { /* skip malformed JSON */ }
        }
      }

      if (streamError) {
        setError(streamError);
        return;
      }

      if (!resultData || !resultData.images || resultData.images.length === 0) {
        setError(lang === "es" ? "No se generaron imágenes" : "No images were generated");
        return;
      }

      const { images, thumbnails, presenterNotes } = resultData;

      const slides: ManualSlide[] = images.map((dataUri: string, i: number) => ({
        id: crypto.randomUUID(),
        layout: "single" as ManualLayoutId,
        elements: [
          {
            id: crypto.randomUUID(),
            type: "image" as const,
            x: 0,
            y: 0,
            w: 100,
            h: 100,
            content: dataUri,
            fontSize: 14,
            zIndex: 1,
            thumbnailUrl: thumbnails?.[i] || undefined,
          },
        ],
        notes: presenterNotes?.[i] || parsedData.slides[i]?.presenterNotes || "",
        bgColor: "000000",
        accentColor: "6366F1",
      }));

      const title = (parsedData.fileName || "Imported Deck").replace(
        /\.pptx$/i,
        ""
      );
      onImport({ title, slides });
      handleClose();
    } catch {
      setError(
        lang === "es"
          ? "Error al convertir las diapositivas a imágenes"
          : "Failed to convert slides to images"
      );
    } finally {
      setProcessing(false);
    }
  }, [parsedData, uploadedFile, onImport, handleClose, lang]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={handleClose}
    >
      <div
        className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl shadow-2xl w-full max-w-lg mx-4 p-6 space-y-5"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-2">
          <IconUpload size={20} className="text-[var(--accent)]" />
          <h3 className="text-lg font-bold">
            {lang === "es" ? "Importar PowerPoint" : "Import PowerPoint"}
          </h3>
        </div>

        {!parsedData ? (
          /* ── Upload phase ── */
          <div
            onDragOver={(e) => {
              if (uploading) return;
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              if (uploading) return;
              onDrop(e);
            }}
            onClick={() => !uploading && fileRef.current?.click()}
            className={`border-2 border-dashed rounded-xl p-10 text-center transition-colors ${
              uploading
                ? "border-[var(--border)] opacity-60 cursor-not-allowed"
                : dragging
                ? "border-[var(--accent)] bg-[var(--accent)]/10 cursor-pointer"
                : "border-[var(--border)] hover:border-[var(--muted)] cursor-pointer"
            }`}
          >
            <input
              ref={fileRef}
              type="file"
              accept=".pptx"
              className="hidden"
              disabled={uploading}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFile(file);
              }}
            />
            {uploading ? (
              <>
                <div className="text-[var(--accent)] mb-3 flex justify-center">
                  <IconLoader size={32} className="animate-spin" />
                </div>
                <p className="text-sm text-[var(--muted)] font-medium">
                  {lang === "es"
                    ? "Procesando archivo..."
                    : "Processing file..."}
                </p>
                <div className="mt-3 w-full bg-[var(--border)] rounded-full h-1.5 overflow-hidden">
                  <div
                    className="bg-[var(--accent)] h-full rounded-full animate-pulse"
                    style={{ width: "60%" }}
                  />
                </div>
              </>
            ) : (
              <>
                <div className="text-[var(--muted)] mb-2 flex justify-center">
                  <IconUpload size={32} />
                </div>
                <p className="text-sm text-[var(--muted)]">
                  {lang === "es"
                    ? "Arrastra un archivo .pptx aquí"
                    : "Drag & drop a .pptx file here"}
                </p>
                <button
                  type="button"
                  className="mt-3 text-xs text-[var(--accent)] hover:text-[var(--accent-hover)] font-medium"
                >
                  {lang === "es" ? "Buscar Archivos" : "Browse Files"}
                </button>
              </>
            )}
          </div>
        ) : (
          /* ── Import mode selection ── */
          <>
            <div className="bg-[var(--surface-2)] rounded-xl p-4">
              <p className="text-sm font-medium">{parsedData.fileName}</p>
              <p className="text-xs text-[var(--muted)] mt-1">
                {parsedData.slideCount}{" "}
                {lang === "es" ? "diapositivas" : "slides"}
              </p>
            </div>

            <p className="text-sm text-[var(--muted)]">
              {lang === "es"
                ? "¿Cómo deseas importar esta presentación?"
                : "How would you like to import this presentation?"}
            </p>

            <div className="grid grid-cols-1 gap-3">
              {/* Option 1: As PowerPoint (text + elements) */}
              <button
                onClick={handleImportAsPresentation}
                disabled={processing}
                className="flex items-start gap-4 p-4 rounded-xl border border-[var(--border)] hover:border-[var(--accent)] hover:bg-[var(--accent)]/5 transition-colors text-left disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <div className="mt-0.5 text-[var(--accent)]">
                  <IconSlides size={24} />
                </div>
                <div>
                  <p className="text-sm font-semibold">
                    {lang === "es"
                      ? "Importar como presentación"
                      : "Import as presentation"}
                  </p>
                  <p className="text-xs text-[var(--muted)] mt-1">
                    {lang === "es"
                      ? "Extrae textos, imágenes y notas como elementos separados editables"
                      : "Extracts texts, images, and notes as separate editable elements"}
                  </p>
                </div>
              </button>

              {/* Option 2: As images */}
              <button
                onClick={handleImportAsImages}
                disabled={processing}
                className="flex items-start gap-4 p-4 rounded-xl border border-[var(--border)] hover:border-[var(--accent)] hover:bg-[var(--accent)]/5 transition-colors text-left disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <div className="mt-0.5 text-[var(--accent)]">
                  <IconImage size={24} />
                </div>
                <div>
                  <p className="text-sm font-semibold">
                    {lang === "es"
                      ? "Importar como imágenes"
                      : "Import as images"}
                  </p>
                  <p className="text-xs text-[var(--muted)] mt-1">
                    {lang === "es"
                      ? "Cada diapositiva se convierte en una imagen. Se importan también las notas del presentador"
                      : "Each slide becomes an image. Presenter notes are also imported"}
                  </p>
                </div>
              </button>
            </div>

            {processing && (
              <div className="space-y-3 p-4 bg-[var(--surface-2)] rounded-xl">
                {/* Step label */}
                <div className="flex items-center gap-2 text-sm text-[var(--accent)]">
                  <IconLoader size={16} className="animate-spin flex-shrink-0" />
                  <span className="font-medium">
                    {progressStep === "extracting_notes"
                      ? lang === "es" ? "Extrayendo notas..." : "Extracting notes..."
                      : progressStep === "converting_pdf"
                      ? lang === "es" ? "Convirtiendo PPTX a PDF..." : "Converting PPTX to PDF..."
                      : progressStep === "pdf_done"
                      ? lang === "es" ? "PDF generado, preparando conversión..." : "PDF generated, preparing conversion..."
                      : progressStep === "converting_images"
                      ? progressTotalSlides > 0
                        ? lang === "es"
                          ? `Convirtiendo diapositiva ${progressCurrentSlide} de ${progressTotalSlides}...`
                          : `Converting slide ${progressCurrentSlide} of ${progressTotalSlides}...`
                        : lang === "es"
                          ? "Convirtiendo diapositivas a imágenes..."
                          : "Converting slides to images..."
                      : progressStep === "done"
                      ? lang === "es" ? "¡Conversión completada!" : "Conversion complete!"
                      : lang === "es" ? "Procesando..." : "Processing..."}
                  </span>
                </div>
                {/* Progress bar */}
                <div className="w-full bg-[var(--border)] rounded-full h-2 overflow-hidden">
                  <div
                    className="bg-[var(--accent)] h-full rounded-full transition-all duration-300 ease-out"
                    style={{ width: `${Math.max(progressPercent, 2)}%` }}
                  />
                </div>
                {/* Slide counter */}
                {progressStep === "converting_images" && progressTotalSlides > 0 && (
                  <div className="flex items-center justify-between text-xs text-[var(--muted)]">
                    <span>
                      {lang === "es"
                        ? `${progressCurrentSlide} / ${progressTotalSlides} diapositivas`
                        : `${progressCurrentSlide} / ${progressTotalSlides} slides`}
                    </span>
                    <span>{progressPercent}%</span>
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {error && <p className="text-xs text-[var(--danger)]">{error}</p>}

        {/* Footer */}
        <div className="flex justify-end gap-2 pt-2 border-t border-[var(--border)]">
          {parsedData && !processing && (
            <button
              onClick={reset}
              className="px-3 py-1.5 rounded-lg text-xs font-medium bg-[var(--surface-2)] text-[var(--fg)] hover:bg-[var(--surface)] transition-colors"
            >
              {lang === "es" ? "Cambiar archivo" : "Change file"}
            </button>
          )}
          <button
            onClick={handleClose}
            disabled={processing}
            className="px-3 py-1.5 rounded-lg text-xs font-medium bg-[var(--surface-2)] text-[var(--fg)] hover:bg-[var(--surface)] transition-colors disabled:opacity-50"
          >
            {lang === "es" ? "Cancelar" : "Cancel"}
          </button>
        </div>
      </div>
    </div>
  );
}
