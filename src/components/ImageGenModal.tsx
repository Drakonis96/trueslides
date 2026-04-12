"use client";

import { useState } from "react";
import { useAppStore } from "@/lib/store";
import { UI_TEXT } from "@/lib/presets";
import { AIProvider } from "@/lib/types";
import { IconSparkles, IconLoader } from "./Icons";

// ── Available image generation models per provider ──
const IMAGE_GEN_MODELS: Record<string, { id: string; name: string }[]> = {
  gemini: [
    { id: "gemini-2.0-flash-exp", name: "Gemini 2.0 Flash (Experimental)" },
    { id: "imagen-3.0-generate-002", name: "Imagen 3.0" },
  ],
  openai: [
    { id: "gpt-image-1", name: "GPT Image 1" },
  ],
};

type ImageGenProvider = "gemini" | "openai";

interface ImageGenModalProps {
  slotIndex: number;
  slideContext: {
    title: string;
    bullets: string[];
    notes: string;
    section: string;
    presentationTopic: string;
  };
  onGenerate: (opts: {
    provider: ImageGenProvider;
    modelId: string;
    prompt?: string;
    autoPrompt: boolean;
    slideContext: ImageGenModalProps["slideContext"];
  }) => void;
  onClose: () => void;
}

export default function ImageGenModal({
  slotIndex,
  slideContext,
  onGenerate,
  onClose,
}: ImageGenModalProps) {
  const { settings, getEffectiveSelection } = useAppStore();
  const lang = settings.language;
  const t = UI_TEXT[lang];

  // Determine which image-gen providers have API keys
  const availableProviders = (["gemini", "openai"] as ImageGenProvider[]).filter(
    (p) => settings.providers.find((pr) => pr.id === p)?.hasKey
  );

  const [provider, setProvider] = useState<ImageGenProvider>(
    availableProviders[0] || "gemini"
  );
  const [modelId, setModelId] = useState(
    IMAGE_GEN_MODELS[availableProviders[0] || "gemini"]?.[0]?.id || ""
  );
  const [prompt, setPrompt] = useState("");
  const [autoPrompt, setAutoPrompt] = useState(true);

  const models = IMAGE_GEN_MODELS[provider] || [];
  const hasKey = availableProviders.includes(provider);

  const handleProviderChange = (p: ImageGenProvider) => {
    setProvider(p);
    const firstModel = IMAGE_GEN_MODELS[p]?.[0];
    if (firstModel) setModelId(firstModel.id);
  };

  const handleSubmit = () => {
    if (!hasKey) return;
    if (!autoPrompt && !prompt.trim()) return;
    onGenerate({
      provider,
      modelId,
      prompt: autoPrompt ? undefined : prompt.trim(),
      autoPrompt,
      slideContext,
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl shadow-2xl w-full max-w-md mx-4 p-6 space-y-5"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-2">
          <IconSparkles size={20} className="text-[var(--accent)]" />
          <h3 className="text-lg font-bold">{t.aiImageTitle}</h3>
        </div>

        {/* Slot indicator */}
        <p className="text-xs text-[var(--muted)]">
          {t.aiImageSlot} #{slotIndex + 1}
        </p>

        {/* Provider selector */}
        <div>
          <label className="block text-sm font-medium mb-2">
            {t.aiImageProvider}
          </label>
          <div className="flex gap-2">
            {(["gemini", "openai"] as ImageGenProvider[]).map((p) => {
              const providerConfig = settings.providers.find(
                (pr) => pr.id === p
              );
              const pHasKey = providerConfig?.hasKey;
              return (
                <button
                  key={p}
                  onClick={() => pHasKey && handleProviderChange(p)}
                  disabled={!pHasKey}
                  className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                    provider === p && pHasKey
                      ? "bg-[var(--accent)] text-white"
                      : pHasKey
                      ? "bg-[var(--surface-2)] text-[var(--muted)] hover:text-[var(--fg)]"
                      : "bg-[var(--surface-2)] text-[var(--muted)] opacity-50 cursor-not-allowed"
                  }`}
                >
                  {providerConfig?.name || p}
                  {!pHasKey && (
                    <span className="block text-[10px] opacity-70 mt-0.5">
                      {t.aiImageNoKey}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Model selector */}
        <div>
          <label className="block text-sm font-medium mb-2">
            {t.aiImageModel}
          </label>
          <select
            value={modelId}
            onChange={(e) => setModelId(e.target.value)}
            className="w-full bg-[var(--surface-2)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[var(--accent)]"
          >
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </div>

        {/* Auto-prompt toggle */}
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={autoPrompt}
            onChange={(e) => setAutoPrompt(e.target.checked)}
            className="rounded border-[var(--border)] accent-[var(--accent)]"
          />
          <span className="text-sm">{t.aiImageAutoPrompt}</span>
        </label>

        {/* Manual prompt */}
        {!autoPrompt && (
          <div>
            <label className="block text-sm font-medium mb-2">
              {t.aiImagePrompt}
            </label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={
                lang === "en"
                  ? "Describe the image you want to generate..."
                  : "Describe la imagen que quieres generar..."
              }
              rows={3}
              className="w-full bg-[var(--surface-2)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[var(--accent)] resize-none"
            />
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-3 pt-1">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2.5 rounded-lg text-sm font-medium bg-[var(--surface-2)] text-[var(--muted)] hover:text-[var(--fg)] transition-colors"
          >
            {t.cancel}
          </button>
          <button
            onClick={handleSubmit}
            disabled={!hasKey || (!autoPrompt && !prompt.trim())}
            className="flex-1 px-4 py-2.5 rounded-lg text-sm font-medium bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            <IconSparkles size={16} />
            {t.aiImageGenerate}
          </button>
        </div>
      </div>
    </div>
  );
}
