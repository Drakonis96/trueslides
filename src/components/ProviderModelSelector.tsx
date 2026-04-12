"use client";

import { useEffect, useRef, useState } from "react";
import { useAppStore } from "@/lib/store";
import { UI_TEXT } from "@/lib/presets";
import { AIModel, AIProvider } from "@/lib/types";
import { IconCheck } from "./Icons";

function formatPrice(price?: number): string | null {
  if (price === undefined) {
    return null;
  }
  return `$${price.toFixed(2)}`;
}

function ModelPriceTags({
  model,
  t,
}: {
  model: AIModel;
  t: (typeof UI_TEXT)[keyof typeof UI_TEXT];
}) {
  const inputPrice = formatPrice(model.inputPrice);
  const outputPrice = formatPrice(model.outputPrice);

  if (!inputPrice && !outputPrice) {
    return null;
  }

  return (
    <div className="mt-1 flex flex-wrap gap-1.5">
      {inputPrice && (
        <span className="inline-flex items-center rounded-full border border-[var(--border)] bg-[var(--surface)] px-2 py-0.5 text-[10px] text-[var(--muted)]">
          {t.inputPrice}: {inputPrice}
        </span>
      )}
      {outputPrice && (
        <span className="inline-flex items-center rounded-full border border-[var(--border)] bg-[var(--surface)] px-2 py-0.5 text-[10px] text-[var(--muted)]">
          {t.outputPrice}: {outputPrice} {t.perMillion}
        </span>
      )}
    </div>
  );
}

function ModelDropdown({
  models,
  selectedModelId,
  onChange,
  placeholder,
  showPricing,
  t,
}: {
  models: AIModel[];
  selectedModelId: string;
  onChange: (modelId: string) => void;
  placeholder: string;
  showPricing: boolean;
  t: (typeof UI_TEXT)[keyof typeof UI_TEXT];
}) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedModel =
    models.find((model) => model.id === selectedModelId) ?? models[0];

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (models.length === 0) {
      setIsOpen(false);
    }
  }, [models.length]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => {
          if (models.length > 0) {
            setIsOpen((open) => !open);
          }
        }}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-left focus:outline-none focus:border-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-60"
        disabled={models.length === 0}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm">
              {selectedModel?.name ?? placeholder}
            </p>
            {showPricing && selectedModel && <ModelPriceTags model={selectedModel} t={t} />}
          </div>
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={`mt-1 shrink-0 text-[var(--muted)] transition-transform ${isOpen ? "rotate-180" : ""}`}
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </div>
      </button>

      {isOpen && models.length > 0 && (
        <div className="absolute left-0 right-0 z-20 mt-2 max-h-72 overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--surface-2)] shadow-xl">
          {models.map((model, index) => (
            <button
              key={model.id}
              type="button"
              role="option"
              aria-selected={model.id === selectedModelId}
              onClick={() => {
                onChange(model.id);
                setIsOpen(false);
              }}
              className={`flex w-full items-start justify-between gap-3 px-3 py-2.5 text-left transition-colors hover:bg-[var(--surface)] ${
                index < models.length - 1 ? "border-b border-[var(--border)]" : ""
              }`}
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">{model.name}</p>
                {showPricing && <ModelPriceTags model={model} t={t} />}
              </div>
              {model.id === selectedModelId && (
                <IconCheck size={14} className="mt-0.5 shrink-0 text-[var(--accent)]" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function ProviderModelSelector() {
  const {
    settings,
    selectedProvider,
    selectedModelId,
  } = useAppStore();

  const lang = settings.language;
  const t = UI_TEXT[lang];

  // Only providers that have a key AND at least one pinned model appear in dropdown
  const pinnedProviders = settings.providers.filter(
    (p) => p.hasKey && p.models.some((m) => m.pinned)
  );

  // Current provider, falling back to first pinned if current is invalid
  const effectiveProvider =
    pinnedProviders.find((p) => p.id === selectedProvider) ?? pinnedProviders[0];

  // Only pinned models from the effective provider
  const pinnedModels = effectiveProvider
    ? effectiveProvider.models.filter((m) => m.pinned)
    : [];

  // Effective model, falling back to first pinned model
  const effectiveModelId =
    pinnedModels.find((m) => m.id === selectedModelId)?.id ??
    pinnedModels[0]?.id ??
    "";

  const handleProviderChange = (newProvider: AIProvider) => {
    const prov = settings.providers.find((p) => p.id === newProvider);
    const firstPinned = prov?.models.find((m) => m.pinned);
    // Set both at once to avoid intermediate states
    useAppStore.setState({
      selectedProvider: newProvider,
      selectedModelId: firstPinned?.id ?? "",
    });
  };

  const handleModelChange = (modelId: string) => {
    // Also sync provider if needed
    useAppStore.setState({
      selectedProvider: effectiveProvider?.id ?? selectedProvider,
      selectedModelId: modelId,
    });
  };

  return (
    <div className="flex gap-3 items-end">
      <div className="flex-1">
        <label className="block text-xs text-[var(--muted)] mb-1">
          {t.provider}
        </label>
        <select
          value={effectiveProvider?.id ?? ""}
          onChange={(e) => handleProviderChange(e.target.value as AIProvider)}
          className="w-full bg-[var(--surface-2)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[var(--accent)]"
        >
          {pinnedProviders.length === 0 && (
            <option value="">— Configure providers in Settings —</option>
          )}
          {pinnedProviders.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>

      <div className="flex-1">
        <label className="block text-xs text-[var(--muted)] mb-1">
          {t.model}
        </label>
        <ModelDropdown
          models={pinnedModels}
          selectedModelId={effectiveModelId}
          onChange={handleModelChange}
          placeholder="— No pinned models —"
          showPricing={effectiveProvider?.id === "openrouter"}
          t={t}
        />
      </div>
    </div>
  );
}
