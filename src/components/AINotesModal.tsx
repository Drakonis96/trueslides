"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAppStore } from "@/lib/store";
import { AIProvider } from "@/lib/types";
import { IconSparkles, IconLoader, IconCheck, IconWarning } from "./Icons";
import { X } from "lucide-react";

interface AINotesModalProps {
  slideContent: string;
  slideTitle: string;
  existingNotes: string;
  lang: "en" | "es";
  onSave: (notes: string) => void;
  onClose: () => void;
}

const DEFAULT_PROMPT: Record<"en" | "es", string> = {
  en: "Convert the following context into detailed presenter notes that the presenter can read verbatim during the presentation. The notes should sound natural, conversational, and professional — as if the presenter is speaking directly to the audience.",
  es: "Convierte el siguiente contexto en notas detalladas de presentador que el presentador pueda leer textualmente durante la presentación. Las notas deben sonar naturales, conversacionales y profesionales — como si el presentador estuviera hablando directamente a la audiencia.",
};

const LABELS = {
  en: {
    title: "Generate Notes with AI",
    promptLabel: "Prompt (instructions for the AI)",
    contextLabel: "Context (source material)",
    contextPlaceholder: "Paste the text, bullet points, or content you want converted into presenter notes...",
    generate: "Generate",
    generating: "Generating...",
    resultLabel: "Generated Notes",
    resultPlaceholder: "AI-generated notes will appear here...",
    save: "Save to Slide Notes",
    cancel: "Cancel",
    error: "Error",
    noProvider: "Please configure an AI provider and model in Settings first.",
    provider: "Provider",
    model: "Model",
    noModels: "No pinned models",
  },
  es: {
    title: "Generar Notas con IA",
    promptLabel: "Prompt (instrucciones para la IA)",
    contextLabel: "Contexto (material fuente)",
    contextPlaceholder: "Pega el texto, puntos clave o contenido que quieras convertir en notas de presentador...",
    generate: "Generar",
    generating: "Generando...",
    resultLabel: "Notas Generadas",
    resultPlaceholder: "Las notas generadas por IA aparecerán aquí...",
    save: "Guardar en Notas de la Diapositiva",
    cancel: "Cancelar",
    error: "Error",
    noProvider: "Por favor configura un proveedor de IA y modelo en Ajustes primero.",
    provider: "Proveedor",
    model: "Modelo",
    noModels: "Sin modelos fijados",
  },
};

export default function AINotesModal({
  slideContent,
  slideTitle,
  existingNotes,
  lang,
  onSave,
  onClose,
}: AINotesModalProps) {
  const appStore = useAppStore();
  const t = LABELS[lang];

  // Local provider/model selection (initialized from global)
  const pinnedProviders = appStore.settings.providers.filter(
    (p) => p.hasKey && p.models.some((m) => m.pinned)
  );
  const globalSelection = appStore.getEffectiveSelection();
  const [localProvider, setLocalProvider] = useState<AIProvider>(globalSelection.provider);
  const [localModelId, setLocalModelId] = useState(globalSelection.modelId);

  const effectiveProviderConfig = pinnedProviders.find((p) => p.id === localProvider) ?? pinnedProviders[0];
  const pinnedModels = effectiveProviderConfig?.models.filter((m) => m.pinned) ?? [];
  const effectiveModelId = pinnedModels.find((m) => m.id === localModelId)?.id ?? pinnedModels[0]?.id ?? "";

  const handleProviderChange = useCallback((newProvider: AIProvider) => {
    setLocalProvider(newProvider);
    const prov = appStore.settings.providers.find((p) => p.id === newProvider);
    const firstPinned = prov?.models.find((m) => m.pinned);
    setLocalModelId(firstPinned?.id ?? "");
  }, [appStore.settings.providers]);

  const [prompt, setPrompt] = useState(DEFAULT_PROMPT[lang]);
  const [context, setContext] = useState(() => {
    // Pre-fill context with slide content if available
    let initial = "";
    if (slideTitle) initial += `Slide Title: ${slideTitle}\n\n`;
    if (slideContent) initial += slideContent;
    return initial;
  });
  const [result, setResult] = useState(existingNotes || "");
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const resultRef = useRef<HTMLTextAreaElement>(null);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !generating) onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose, generating]);

  // Cleanup abort on unmount
  useEffect(() => {
    return () => { abortRef.current?.abort(); };
  }, []);

  const handleGenerate = useCallback(async () => {
    if (!effectiveProviderConfig?.hasKey || !effectiveModelId) {
      setError(t.noProvider);
      return;
    }

    setGenerating(true);
    setError("");
    setResult("");

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/generate-notes-stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: effectiveProviderConfig.id,
          modelId: effectiveModelId,
          prompt,
          context,
          outputLanguage: appStore.settings.outputLanguage,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: "Request failed" }));
        setError(data.error || "Request failed");
        setGenerating(false);
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) {
        setError("No response stream");
        setGenerating(false);
        return;
      }

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const payload = JSON.parse(line.slice(6));
            if (payload.type === "chunk") {
              setResult((prev) => prev + payload.content);
              // Auto-scroll to bottom
              if (resultRef.current) {
                resultRef.current.scrollTop = resultRef.current.scrollHeight;
              }
            } else if (payload.type === "error") {
              setError(payload.content);
            }
          } catch {
            // ignore parse errors
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setError((err as Error).message || "Generation failed");
      }
    } finally {
      setGenerating(false);
      abortRef.current = null;
    }
  }, [appStore, effectiveProviderConfig, effectiveModelId, prompt, context, t.noProvider]);

  const handleSave = useCallback(() => {
    onSave(result);
    onClose();
  }, [result, onSave, onClose]);

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl shadow-2xl w-[90vw] max-w-4xl max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border)]">
          <div className="flex items-center gap-2">
            <IconSparkles size={18} className="text-[var(--accent)]" />
            <h2 className="text-base font-semibold">{t.title}</h2>
          </div>
          <button
            onClick={onClose}
            disabled={generating}
            className="p-1.5 rounded-lg hover:bg-[var(--surface-2)] transition-colors disabled:opacity-50"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {/* Provider / Model selector */}
          <div className="flex gap-3 items-end">
            <div className="flex-1">
              <label className="block text-xs text-[var(--muted)] mb-1">{t.provider}</label>
              <select
                value={effectiveProviderConfig?.id ?? ""}
                onChange={(e) => handleProviderChange(e.target.value as AIProvider)}
                disabled={generating}
                className="w-full bg-[var(--surface-2)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[var(--accent)] disabled:opacity-50"
              >
                {pinnedProviders.length === 0 && (
                  <option value="">{t.noProvider}</option>
                )}
                {pinnedProviders.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
            <div className="flex-1">
              <label className="block text-xs text-[var(--muted)] mb-1">{t.model}</label>
              <select
                value={effectiveModelId}
                onChange={(e) => setLocalModelId(e.target.value)}
                disabled={generating}
                className="w-full bg-[var(--surface-2)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[var(--accent)] disabled:opacity-50"
              >
                {pinnedModels.length === 0 && (
                  <option value="">{t.noModels}</option>
                )}
                {pinnedModels.map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Two-column: Prompt + Context */}
          <div className="grid grid-cols-2 gap-4">
            {/* Prompt */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-[var(--muted)]">{t.promptLabel}</label>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={6}
                disabled={generating}
                className="w-full bg-[var(--surface-2)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:border-[var(--accent)] disabled:opacity-50"
              />
            </div>

            {/* Context */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-[var(--muted)]">{t.contextLabel}</label>
              <textarea
                value={context}
                onChange={(e) => setContext(e.target.value)}
                rows={6}
                disabled={generating}
                placeholder={t.contextPlaceholder}
                className="w-full bg-[var(--surface-2)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:border-[var(--accent)] disabled:opacity-50"
              />
            </div>
          </div>

          {/* Generate button */}
          <div className="flex items-center gap-3">
            <button
              onClick={generating ? handleStop : handleGenerate}
              disabled={!prompt.trim() || !context.trim()}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                generating
                  ? "bg-red-500/20 text-red-400 hover:bg-red-500/30"
                  : "bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)]"
              }`}
            >
              {generating ? (
                <>
                  <IconLoader size={14} className="animate-spin" />
                  {lang === "en" ? "Stop" : "Detener"}
                </>
              ) : (
                <>
                  <IconSparkles size={14} />
                  {t.generate}
                </>
              )}
            </button>
            {error && (
              <div className="flex items-center gap-1.5 text-xs text-red-400">
                <IconWarning size={14} />
                {error}
              </div>
            )}
          </div>

          {/* Result */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-[var(--muted)]">{t.resultLabel}</label>
            <textarea
              ref={resultRef}
              value={result}
              onChange={(e) => setResult(e.target.value)}
              rows={8}
              placeholder={t.resultPlaceholder}
              className="w-full bg-[var(--surface-2)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:border-[var(--accent)]"
              style={{ textAlign: "justify" }}
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-[var(--border)]">
          <button
            onClick={onClose}
            disabled={generating}
            className="px-4 py-2 rounded-lg text-sm bg-[var(--surface-2)] hover:bg-[var(--border)] transition-colors disabled:opacity-50"
          >
            {t.cancel}
          </button>
          <button
            onClick={handleSave}
            disabled={!result.trim() || generating}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <IconCheck size={14} />
            {t.save}
          </button>
        </div>
      </div>
    </div>
  );
}
