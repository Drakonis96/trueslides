"use client";

import { useAppStore } from "@/lib/store";
import { UI_TEXT } from "@/lib/presets";
import { IconWarning } from "./Icons";

const STEP_LABELS: Record<string, { en: string; es: string }> = {
  uploading: { en: "Processing document", es: "Procesando documento" },
  analyzing: { en: "Generating slides with AI", es: "Generando diapositivas con IA" },
  generating: { en: "Generating slides", es: "Generando diapositivas" },
  "fetching-images": { en: "Fetching images", es: "Buscando imágenes" },
  "building-pptx": { en: "Building PPTX file", es: "Construyendo archivo PPTX" },
};

export default function StatusBar() {
  const { status, statusMessage, progress, error, settings } = useAppStore();
  const lang = settings.language;
  const t = UI_TEXT[lang];

  if (status === "idle" || status === "done") return null;

  if (status === "error") {
    return (
      <div className="bg-[var(--danger)]/10 border border-[var(--danger)]/30 rounded-xl p-4 flex items-center gap-3">
        <span className="text-[var(--danger)]"><IconWarning size={18} /></span>
        <div className="flex-1">
          <p className="text-sm font-medium text-[var(--danger)]">{t.error}</p>
          <p className="text-xs text-[var(--muted)]">{error}</p>
        </div>
      </div>
    );
  }

  const stepLabel = STEP_LABELS[status]?.[lang] || status;
  const detail = statusMessage || stepLabel;

  return (
    <div className="bg-[var(--surface-2)] border border-[var(--border)] rounded-xl p-4 space-y-2.5">
      {/* Top row: spinner + message + percentage */}
      <div className="flex items-center gap-3">
        <div className="w-4 h-4 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin shrink-0" />
        <p className="flex-1 text-sm text-[var(--fg)] truncate">{detail}</p>
        {progress > 0 && (
          <span className="text-xs font-mono text-[var(--muted)] tabular-nums shrink-0">
            {Math.round(progress)}%
          </span>
        )}
      </div>

      {/* Progress bar */}
      <div className="h-1.5 bg-[var(--border)] rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500 ease-out"
          style={{
            width: `${Math.max(progress, 2)}%`,
            background: "linear-gradient(90deg, var(--accent), var(--accent-hover, var(--accent)))",
          }}
        />
      </div>

      {/* Step indicator */}
      <div className="flex gap-1.5">
        {(["analyzing", "fetching-images"] as const).map((step) => {
          // During "generating" status, derive step state from progress percentage
          const isActive =
            status === "generating"
              ? (step === "analyzing" && progress < 50) ||
                (step === "fetching-images" && progress >= 50 && progress < 90)
              : status === step;
          const isDone =
            status === "generating"
              ? (step === "analyzing" && progress >= 50) ||
                (step === "fetching-images" && progress >= 90)
              : (step === "analyzing" && (status === "fetching-images" || status === "building-pptx")) ||
                (step === "fetching-images" && status === "building-pptx");
          return (
            <span
              key={step}
              className={`text-[10px] px-2 py-0.5 rounded-full transition-colors ${
                isActive
                  ? "bg-[var(--accent)]/20 text-[var(--accent)] font-medium"
                  : isDone
                    ? "bg-[var(--success)]/15 text-[var(--success)]"
                    : "bg-[var(--surface)] text-[var(--muted)]"
              }`}
            >
              {isDone ? "✓ " : ""}{STEP_LABELS[step]?.[lang] || step}
            </span>
          );
        })}
      </div>
    </div>
  );
}
