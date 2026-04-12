"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import { useAppStore } from "@/lib/store";
import { UI_TEXT } from "@/lib/presets";
import {
  AIProvider,
  IMAGE_SOURCES,
  ImageSourceId,
  Language,
  OUTPUT_LANGUAGE_OPTIONS,
  PromptFieldKey,
  ImageSearchSpeedOptions,
} from "@/lib/types";
import { IconCheck, IconEye, IconEyeOff, IconCopy, IconGlobe, IconZap, IconImage, IconFileText, IconSearch, IconClock, IconSparkles, IconPalette, IconText, IconMic, IconWarning, IconTrash } from "./Icons";
import { useManualStore } from "@/lib/manual-store";

function GeneralTab() {
  const { settings, setLanguage, setOutputLanguage } = useAppStore();
  const lang = settings.language;
  const t = UI_TEXT[lang];

  return (
    <div className="space-y-6">
      <div>
        <label className="block text-sm font-medium mb-2">{t.language}</label>
        <div className="flex gap-2">
          {(["en", "es"] as Language[]).map((l) => (
            <button
              key={l}
              onClick={() => setLanguage(l)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                lang === l
                  ? "bg-[var(--accent)] text-white"
                  : "bg-[var(--surface-2)] text-[var(--muted)] hover:text-[var(--fg)]"
              }`}
            >
              {l === "en" ? "English" : "Español"}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label htmlFor="output-language" className="block text-sm font-medium mb-2">
          {t.outputLanguage}
        </label>
        <select
          id="output-language"
          value={settings.outputLanguage}
          onChange={(e) => setOutputLanguage(e.target.value as (typeof OUTPUT_LANGUAGE_OPTIONS)[number]["value"])}
          className="w-full bg-[var(--surface-2)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[var(--accent)]"
        >
          {OUTPUT_LANGUAGE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

function AITab() {
  const {
    settings,
    setProviderHasKey,
    setProviderModels,
    toggleModelPin,
  } = useAppStore();

  const lang = settings.language;
  const t = UI_TEXT[lang];

  const [selectedProvider, setSelectedProvider] = useState<AIProvider>("openrouter");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [keyInput, setKeyInput] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [copied, setCopied] = useState(false);

  const provider = settings.providers.find((p) => p.id === selectedProvider)!;

  const filteredModels = useMemo(() => {
    if (!search.trim()) return provider.models;
    const q = search.toLowerCase();
    return provider.models.filter(
      (m) => m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q)
    );
  }, [provider.models, search]);

  const saveKey = async () => {
    if (!keyInput.trim()) {
      setError(lang === "es" ? "Ingresa una clave API" : "Please enter an API key");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: selectedProvider, apiKey: keyInput.trim() }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Failed to save key");
        return;
      }
      setProviderHasKey(selectedProvider, true);
      // Keep keyInput so user can still see/copy the key they just saved
    } catch {
      setError(lang === "es" ? "Error de red" : "Network error");
    } finally {
      setSaving(false);
    }
  };

  const removeKey = async () => {
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/keys", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: selectedProvider }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Failed to remove key");
        return;
      }
      setProviderHasKey(selectedProvider, false);
    } catch {
      setError(lang === "es" ? "Error de red" : "Network error");
    } finally {
      setSaving(false);
    }
  };

  const loadModels = async () => {
    if (!provider.hasKey) {
      setError(lang === "es" ? "Primero guarda una clave API" : "Please save an API key first");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: selectedProvider }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to load models");
        return;
      }
      // Preserve existing pin state
      const existingPins = new Set(
        provider.models.filter((m) => m.pinned).map((m) => m.id)
      );
      const models = data.models.map(
        (m: { id: string; name: string; inputPrice?: number; outputPrice?: number }) => ({
          ...m,
          provider: selectedProvider,
          pinned: existingPins.has(m.id),
        })
      );
      setProviderModels(selectedProvider, models);
    } catch {
      setError(lang === "es" ? "Error de red al cargar modelos" : "Network error loading models");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Provider tabs */}
      <div className="flex gap-1 bg-[var(--surface)] rounded-lg p-1">
        {settings.providers.map((p) => (
          <button
            key={p.id}
            onClick={() => {
              setSelectedProvider(p.id);
              setSearch("");
              setError("");
              setKeyInput("");
              setShowKey(false);
              setCopied(false);
            }}
            className={`flex-1 px-3 py-2 rounded-md text-xs font-medium transition-colors flex items-center justify-center gap-1.5 ${
              selectedProvider === p.id
                ? "bg-[var(--accent)] text-white"
                : "text-[var(--muted)] hover:text-[var(--fg)]"
            }`}
          >
            {p.id === "openrouter" ? <IconGlobe size={12} /> : p.id === "openai" ? <IconSparkles size={12} /> : p.id === "gemini" ? <IconZap size={12} /> : <IconFileText size={12} />}
            {p.name}
            {p.hasKey && <span className="ml-1"><IconCheck size={12} className="inline" /></span>}
          </button>
        ))}
      </div>

      {/* API Key */}
      <div>
        <label className="block text-xs text-[var(--muted)] mb-1">
          {t.apiKey}
        </label>
        {provider.hasKey && !keyInput ? (
          <div className="flex items-center gap-2">
            <div className="flex-1 bg-[var(--surface-2)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--success)] flex items-center gap-1.5">
              <IconCheck size={14} /> {lang === "es" ? "Clave guardada de forma segura" : "Key stored securely"}
            </div>
            <button
              onClick={removeKey}
              disabled={saving}
              className="bg-[var(--danger)] hover:opacity-80 disabled:opacity-50 text-white rounded-lg px-3 py-2 text-xs font-medium transition-opacity"
            >
              {lang === "es" ? "Eliminar" : "Remove"}
            </button>
          </div>
        ) : (
          <div className="flex gap-2">
            <div className="relative flex-1">
              <input
                type={showKey ? "text" : "password"}
                value={keyInput}
                onChange={(e) => setKeyInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !provider.hasKey && saveKey()}
                readOnly={provider.hasKey}
                className={`w-full bg-[var(--surface-2)] border border-[var(--border)] rounded-lg px-3 py-2 pr-16 text-sm focus:outline-none focus:border-[var(--accent)] ${provider.hasKey ? "opacity-70" : ""}`}
                placeholder={`Enter ${provider.name} API key...`}
              />
              <div className="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
                <button
                  type="button"
                  onClick={() => setShowKey((v) => !v)}
                  className="p-1 rounded text-[var(--muted)] hover:text-[var(--fg)] transition-colors"
                  title={showKey ? "Hide" : "Show"}
                >
                  {showKey ? <IconEyeOff size={14} /> : <IconEye size={14} />}
                </button>
                {keyInput && (
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(keyInput);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1500);
                    }}
                    className="p-1 rounded text-[var(--muted)] hover:text-[var(--fg)] transition-colors"
                    title={lang === "es" ? "Copiar" : "Copy"}
                  >
                    {copied ? <IconCheck size={14} className="text-[var(--success)]" /> : <IconCopy size={14} />}
                  </button>
                )}
              </div>
            </div>
            {provider.hasKey ? (
              <button
                onClick={() => { setKeyInput(""); }}
                className="bg-[var(--success)] text-white rounded-lg px-3 py-2 text-xs font-medium flex items-center gap-1"
              >
                <IconCheck size={12} /> {lang === "es" ? "Guardado" : "Saved"}
              </button>
            ) : (
              <button
                onClick={saveKey}
                disabled={saving || !keyInput.trim()}
                className="bg-[var(--accent)] hover:bg-[var(--accent-hover)] disabled:opacity-50 text-white rounded-lg px-4 py-2 text-xs font-medium transition-colors"
              >
                {saving ? "..." : t.save}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Load Models button */}
      <button
        onClick={loadModels}
        disabled={loading || !provider.hasKey}
        className="w-full bg-[var(--accent)] hover:bg-[var(--accent-hover)] disabled:opacity-50 text-white rounded-lg px-4 py-2 text-sm font-medium transition-colors"
      >
        {loading ? t.fetchingModels : t.loadModels}
      </button>

      {error && <p className="text-xs text-[var(--danger)]">{error}</p>}

      {/* Search */}
      {provider.models.length > 0 && (
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t.searchModels}
          className="w-full bg-[var(--surface-2)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[var(--accent)]"
        />
      )}

      {/* Model list */}
      <div className="max-h-64 overflow-y-auto space-y-1">
        {filteredModels.map((model) => (
          <div
            key={model.id}
            className="flex items-center justify-between bg-[var(--surface-2)] rounded-lg px-3 py-2"
          >
            <div className="flex-1 min-w-0">
              <p className="text-sm truncate">{model.name}</p>
              {selectedProvider === "openrouter" &&
                model.inputPrice !== undefined && (
                  <p className="text-[10px] text-[var(--muted)]">
                    {t.inputPrice}: ${model.inputPrice?.toFixed(2)} · {t.outputPrice}: $
                    {model.outputPrice?.toFixed(2)} {t.perMillion}
                  </p>
                )}
            </div>
            <button
              onClick={() => toggleModelPin(selectedProvider, model.id)}
              className={`ml-2 text-lg transition-opacity ${
                model.pinned ? "opacity-100" : "opacity-30 hover:opacity-60"
              }`}
              title={t.pinned}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/></svg>
            </button>
          </div>
        ))}
        {provider.models.length === 0 && (
          <p className="text-xs text-[var(--muted)] text-center py-4">
            {t.noModels}
          </p>
        )}
      </div>
    </div>
  );
}

function ImagesTab() {
  const { settings, toggleImageSource, setSpeedOption, setImageVerification } = useAppStore();
  const lang = settings.language;
  const t = UI_TEXT[lang];
  const enabled = settings.enabledImageSources;

  const [subTab, setSubTab] = useState<"sources" | "speed" | "verification">("sources");
  const [keyInputs, setKeyInputs] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [imageSourceSearch, setImageSourceSearch] = useState("");
  const [sourceKeyStatus, setSourceKeyStatus] = useState<Record<string, boolean>>({
    wikimedia: true,
  });

  // Fetch image source key status on mount
  const fetchKeyStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/keys");
      const data = await res.json();
      if (data.imageSourceStatus) {
        setSourceKeyStatus(data.imageSourceStatus);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    fetchKeyStatus();
  }, [fetchKeyStatus]);

  const saveKey = async (sourceId: ImageSourceId) => {
    const key = keyInputs[sourceId]?.trim();
    if (!key) return;
    setSaving(sourceId);
    setError("");
    try {
      const res = await fetch("/api/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageSource: sourceId, apiKey: key }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Failed to save key");
        return;
      }
      setSourceKeyStatus((prev) => ({ ...prev, [sourceId]: true }));
      setKeyInputs((prev) => ({ ...prev, [sourceId]: "" }));
      // Auto-enable when key is saved
      if (!enabled.includes(sourceId)) toggleImageSource(sourceId);
    } catch {
      setError(lang === "es" ? "Error de red" : "Network error");
    } finally {
      setSaving(null);
    }
  };

  const removeKey = async (sourceId: ImageSourceId) => {
    setSaving(sourceId);
    setError("");
    try {
      const res = await fetch("/api/keys", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageSource: sourceId }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Failed to remove key");
        return;
      }
      setSourceKeyStatus((prev) => ({ ...prev, [sourceId]: false }));
      // Auto-disable when key is removed
      if (enabled.includes(sourceId)) toggleImageSource(sourceId);
    } catch {
      setError(lang === "es" ? "Error de red" : "Network error");
    } finally {
      setSaving(null);
    }
  };

  const sortedSources = useMemo(() => {
    const filtered = IMAGE_SOURCES.filter((s) =>
      s.name.toLowerCase().includes(imageSourceSearch.toLowerCase())
    );
    const sorted = [...filtered].sort((a, b) => a.name.localeCompare(b.name));
    const enabledSources = sorted.filter((s) => enabled.includes(s.id));
    const disabledSources = sorted.filter((s) => !enabled.includes(s.id));
    return [...enabledSources, ...disabledSources];
  }, [enabled, imageSourceSearch]);

  const speedOpts = settings.speedOptions;

  return (
    <div className="space-y-5">
      {/* Sub-tabs */}
      <div className="flex gap-1 bg-[var(--surface)] rounded-lg p-1">
        <button
          onClick={() => setSubTab("sources")}
          className={`flex-1 px-3 py-2 rounded-md text-xs font-medium transition-colors flex items-center justify-center gap-1.5 ${
            subTab === "sources"
              ? "bg-[var(--accent)] text-white"
              : "text-[var(--muted)] hover:text-[var(--fg)]"
          }`}
        >
          <IconSearch size={12} />
          {lang === "es" ? "Fuentes" : "Sources"}
        </button>
        <button
          onClick={() => setSubTab("speed")}
          className={`flex-1 px-3 py-2 rounded-md text-xs font-medium transition-colors flex items-center justify-center gap-1.5 ${
            subTab === "speed"
              ? "bg-[var(--accent)] text-white"
              : "text-[var(--muted)] hover:text-[var(--fg)]"
          }`}
        >
          <IconClock size={12} />
          {t.speedOptimizations}
        </button>
        <button
          onClick={() => setSubTab("verification")}
          className={`flex-1 px-3 py-2 rounded-md text-xs font-medium transition-colors flex items-center justify-center gap-1.5 ${
            subTab === "verification"
              ? "bg-[var(--accent)] text-white"
              : "text-[var(--muted)] hover:text-[var(--fg)]"
          }`}
        >
          <IconEye size={12} />
          {lang === "es" ? "Verificación IA" : "AI Verification"}
        </button>
      </div>

      {subTab === "sources" ? (
        /* ── Sources sub-tab ── */
        <div className="space-y-5">
          <p className="text-xs text-[var(--muted)]">{t.imageSourcesDesc}</p>

          {error && <p className="text-xs text-[var(--danger)]">{error}</p>}

          <input
            type="text"
            value={imageSourceSearch}
            onChange={(e) => setImageSourceSearch(e.target.value)}
            placeholder={lang === "es" ? "Buscar fuentes de imágenes…" : "Search image sources…"}
            className="w-full bg-[var(--surface-2)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[var(--accent)] placeholder:text-[var(--muted)]"
          />

          <div className="space-y-3">
            {sortedSources.map((source) => {
              const isEnabled = enabled.includes(source.id);
              const hasKey = sourceKeyStatus[source.id] ?? false;
              const canToggle = !source.needsKey || hasKey;

              return (
                <div
                  key={source.id}
                  className="bg-[var(--surface-2)] rounded-xl p-4 space-y-3"
                >
                  {/* Header row: checkbox + name */}
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => {
                        if (canToggle) toggleImageSource(source.id);
                      }}
                      disabled={!canToggle}
                      className={`w-5 h-5 rounded-md border-2 flex items-center justify-center transition-colors shrink-0 ${
                        isEnabled
                          ? "bg-[var(--accent)] border-[var(--accent)]"
                          : canToggle
                          ? "border-[var(--border)] hover:border-[var(--accent)]"
                          : "border-[var(--border)] opacity-40 cursor-not-allowed"
                      }`}
                    >
                      {isEnabled && (
                        <IconCheck size={12} className="text-white" />
                      )}
                    </button>

                    <div className="flex-1 min-w-0">
                      <span className="text-sm font-medium">{source.name}</span>
                      {!source.needsKey && (
                        <span className="ml-2 text-[10px] bg-[var(--accent)]/10 text-[var(--accent)] px-1.5 py-0.5 rounded-full">
                          {lang === "es" ? "Gratis, sin clave" : "Free, no key"}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* API key section for sources that need keys */}
                  {source.needsKey && (
                    <div className="pl-8">
                      {hasKey ? (
                        <div className="flex items-center gap-2">
                          <div className="flex-1 bg-[var(--surface)] border border-[var(--border)] rounded-lg px-3 py-1.5 text-xs text-[var(--success)] flex items-center gap-1.5">
                            <IconCheck size={12} /> {t.keyStored}
                          </div>
                          <button
                            onClick={() => removeKey(source.id)}
                            disabled={saving === source.id}
                            className="bg-[var(--danger)] hover:opacity-80 disabled:opacity-50 text-white rounded-lg px-2.5 py-1.5 text-[10px] font-medium transition-opacity"
                          >
                            {t.remove}
                          </button>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          <div className="flex gap-2">
                            <input
                              type="password"
                              value={keyInputs[source.id] || ""}
                              onChange={(e) =>
                                setKeyInputs((prev) => ({
                                  ...prev,
                                  [source.id]: e.target.value,
                                }))
                              }
                              onKeyDown={(e) =>
                                e.key === "Enter" && saveKey(source.id)
                              }
                              className="flex-1 bg-[var(--surface)] border border-[var(--border)] rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:border-[var(--accent)]"
                              placeholder={source.keyPlaceholder}
                            />
                            <button
                              onClick={() => saveKey(source.id)}
                              disabled={
                                saving === source.id ||
                                !keyInputs[source.id]?.trim()
                              }
                              className="bg-[var(--accent)] hover:bg-[var(--accent-hover)] disabled:opacity-50 text-white rounded-lg px-3 py-1.5 text-[10px] font-medium transition-colors"
                            >
                              {saving === source.id ? "..." : t.save}
                            </button>
                          </div>
                          <a
                            href={source.keyUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[10px] text-[var(--accent)] hover:underline"
                          >
                            → {t.getApiKey}
                          </a>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ) : subTab === "speed" ? (
        /* ── Speed sub-tab ── */
        <div className="space-y-4">
          <p className="text-xs text-[var(--muted)]">{t.speedOptimizationsDesc}</p>

          {([
            {
              key: "capFallbacks",
              label: t.speedCapFallbacks,
              desc: t.speedCapFallbacksDesc,
              gain: t.speedCapFallbacksGain,
              loss: t.speedCapFallbacksLoss,
              isActive: speedOpts.maxFallbackAttempts === 0,
              onToggle: () => setSpeedOption("maxFallbackAttempts", speedOpts.maxFallbackAttempts === 0 ? 2 : 0),
            },
            {
              key: "skipCategory",
              label: t.speedSkipCategory,
              desc: t.speedSkipCategoryDesc,
              gain: t.speedSkipCategoryGain,
              loss: t.speedSkipCategoryLoss,
              isActive: speedOpts.skipCategorySearch,
              onToggle: () => setSpeedOption("skipCategorySearch", !speedOpts.skipCategorySearch),
            },
            {
              key: "reduceQueries",
              label: t.speedReduceQueries,
              desc: t.speedReduceQueriesDesc,
              gain: t.speedReduceQueriesGain,
              loss: t.speedReduceQueriesLoss,
              isActive: speedOpts.reduceQueryCandidates,
              onToggle: () => setSpeedOption("reduceQueryCandidates", !speedOpts.reduceQueryCandidates),
            },
            {
              key: "lowerLimit",
              label: t.speedLowerLimit,
              desc: t.speedLowerLimitDesc,
              gain: t.speedLowerLimitGain,
              loss: t.speedLowerLimitLoss,
              isActive: speedOpts.lowerFetchLimit,
              onToggle: () => setSpeedOption("lowerFetchLimit", !speedOpts.lowerFetchLimit),
            },
          ] as const).map((opt) => (
            <div key={opt.key} className="bg-[var(--surface-2)] rounded-xl p-4 space-y-2">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  role="switch"
                  aria-checked={opt.isActive}
                  onClick={() => opt.onToggle()}
                  className={`w-10 h-6 rounded-full relative transition-colors shrink-0 cursor-pointer ${
                    opt.isActive ? "bg-[var(--accent)]" : "bg-[var(--border)]"
                  }`}
                >
                  <span
                    className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white shadow-sm transition-transform duration-200 ${
                      opt.isActive ? "translate-x-4" : "translate-x-0"
                    }`}
                  />
                </button>
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium">{opt.label}</span>
                  <p className="text-[11px] text-[var(--muted)] mt-0.5">{opt.desc}</p>
                </div>
              </div>
              <div className="pl-12 space-y-1">
                <p className="text-[11px]">
                  <span className="text-[var(--success)] font-medium">✦ {t.speedGain}:</span>{" "}
                  <span className="text-[var(--muted)]">{opt.gain}</span>
                </p>
                <p className="text-[11px]">
                  <span className="text-orange-400 font-medium">⚠ {t.speedLoss}:</span>{" "}
                  <span className="text-[var(--muted)]">{opt.loss}</span>
                </p>
              </div>
            </div>
          ))}
        </div>
      ) : (
        /* ── AI Verification sub-tab ── */
        <div className="space-y-4">
          <p className="text-xs text-[var(--muted)]">
            {lang === "es"
              ? "Usa un modelo de visión barato para describir cada imagen candidata y deja que el modelo orquestador elija la mejor para cada diapositiva basándose en la descripción visual real."
              : "Use a cheap vision model to describe each candidate image, then let the orchestrator model pick the best one for each slide based on the actual visual description."}
          </p>

          {/* Enable / disable toggle */}
          <div className="bg-[var(--surface-2)] rounded-xl p-4 space-y-3">
            <div className="flex items-center gap-3">
              <button
                type="button"
                role="switch"
                aria-checked={settings.imageVerification.enabled}
                onClick={() => setImageVerification("enabled", !settings.imageVerification.enabled)}
                className={`w-10 h-6 rounded-full relative transition-colors shrink-0 cursor-pointer ${
                  settings.imageVerification.enabled ? "bg-[var(--accent)]" : "bg-[var(--border)]"
                }`}
              >
                <span
                  className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white shadow-sm transition-transform duration-200 ${
                    settings.imageVerification.enabled ? "translate-x-4" : "translate-x-0"
                  }`}
                />
              </button>
              <div className="flex-1 min-w-0">
                <span className="text-sm font-medium">
                  {lang === "es" ? "Verificación visual con IA" : "AI Visual Verification"}
                </span>
                <p className="text-[11px] text-[var(--muted)] mt-0.5">
                  {lang === "es"
                    ? "Aumenta la precisión de la selección de imágenes pero incrementa el uso de tokens."
                    : "Increases image selection accuracy but increases token usage."}
                </p>
              </div>
            </div>

            {settings.imageVerification.enabled && (
              <div className="pl-12 space-y-3">
                {/* Warning */}
                <div className="flex items-start gap-2 bg-orange-500/10 border border-orange-500/20 rounded-lg px-3 py-2">
                  <span className="text-orange-400 text-sm mt-0.5">⚠</span>
                  <p className="text-[11px] text-orange-300">
                    {lang === "es"
                      ? "Cada imagen candidata será enviada a un modelo de visión para obtener una descripción. Esto consume tokens adicionales por cada diapositiva."
                      : "Each candidate image will be sent to a vision model for description. This consumes additional tokens per slide."}
                  </p>
                </div>

                {/* Descriptor Provider */}
                <div>
                  <label className="block text-xs font-medium text-[var(--muted)] mb-1">
                    {lang === "es" ? "Proveedor descriptor (visión)" : "Descriptor provider (vision)"}
                  </label>
                  <select
                    value={settings.imageVerification.descriptorProvider}
                    onChange={(e) => {
                      const provider = e.target.value as AIProvider;
                      setImageVerification("descriptorProvider", provider);
                      setImageVerification("descriptorModelId", "");
                    }}
                    className="w-full bg-[var(--surface)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[var(--accent)]"
                  >
                    {settings.providers.filter((p) => p.hasKey).map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                  {settings.providers.filter((p) => p.hasKey).length === 0 && (
                    <p className="text-[10px] text-[var(--danger)] mt-1">
                      {lang === "es"
                        ? "Configura al menos un proveedor en la pestaña IA primero."
                        : "Configure at least one provider in the AI tab first."}
                    </p>
                  )}
                </div>

                {/* Descriptor Model */}
                <div>
                  <label className="block text-xs font-medium text-[var(--muted)] mb-1">
                    {lang === "es" ? "Modelo descriptor (visión)" : "Descriptor model (vision)"}
                  </label>
                  {(() => {
                    const descProvider = settings.providers.find(
                      (p) => p.id === settings.imageVerification.descriptorProvider
                    );
                    const pinnedModels = descProvider?.models.filter((m) => m.pinned) ?? [];
                    return pinnedModels.length > 0 ? (
                      <select
                        value={settings.imageVerification.descriptorModelId}
                        onChange={(e) => setImageVerification("descriptorModelId", e.target.value)}
                        className="w-full bg-[var(--surface)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[var(--accent)]"
                      >
                        <option value="">
                          {lang === "es" ? "— Seleccionar modelo —" : "— Select model —"}
                        </option>
                        {pinnedModels.map((m) => (
                          <option key={m.id} value={m.id}>{m.name}</option>
                        ))}
                      </select>
                    ) : (
                      <p className="text-[10px] text-[var(--muted)]">
                        {lang === "es"
                          ? "Fija (pin) modelos en la pestaña IA para que aparezcan aquí."
                          : "Pin models in the AI tab to see them here."}
                      </p>
                    );
                  })()}
                  <p className="text-[10px] text-[var(--muted)] mt-1">
                    {lang === "es"
                      ? "Usa un modelo de visión económico (ej: gpt-4o-mini, gemini-2.0-flash-lite). El modelo principal (orquestador) se usará para elegir la mejor imagen."
                      : "Use a cheap vision model (e.g. gpt-4o-mini, gemini-2.0-flash-lite). The main (orchestrator) model will pick the best image."}
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function PromptsTab() {
  const {
    settings,
    customPresets,
    addCustomPreset,
    updateCustomPreset,
    deleteCustomPreset,
  } = useAppStore();

  const lang = settings.language;
  const t = UI_TEXT[lang];

  const [activeField, setActiveField] = useState<PromptFieldKey>("design");
  const [newLabel, setNewLabel] = useState("");
  const [newText, setNewText] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [editText, setEditText] = useState("");

  const fieldTabs: { key: PromptFieldKey; label: string; icon: React.ComponentType<{ size?: number }> }[] = [
    { key: "design", label: t.designSection, icon: IconPalette },
    { key: "text", label: t.textSection, icon: IconText },
    { key: "notes", label: t.notesSection, icon: IconMic },
  ];

  const filtered = customPresets.filter((p) => p.field === activeField);

  const handleAdd = () => {
    if (!newLabel.trim() || !newText.trim()) return;
    addCustomPreset({
      id: `custom-${crypto.randomUUID()}`,
      field: activeField,
      label: newLabel.trim(),
      text: newText.trim(),
    });
    setNewLabel("");
    setNewText("");
  };

  const startEdit = (id: string, label: string, text: string) => {
    setEditingId(id);
    setEditLabel(label);
    setEditText(text);
  };

  const saveEdit = () => {
    if (!editingId || !editLabel.trim() || !editText.trim()) return;
    updateCustomPreset(editingId, editLabel.trim(), editText.trim());
    setEditingId(null);
  };

  return (
    <div className="space-y-5">
      {/* Section tabs */}
      <div className="flex gap-1 bg-[var(--surface)] rounded-lg p-1">
        {fieldTabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => {
              setActiveField(tab.key);
              setEditingId(null);
            }}
            className={`flex-1 px-3 py-2 rounded-md text-xs font-medium transition-colors flex items-center justify-center gap-1.5 ${
              activeField === tab.key
                ? "bg-[var(--accent)] text-white"
                : "text-[var(--muted)] hover:text-[var(--fg)]"
            }`}
          >
            <tab.icon size={12} />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Add new prompt */}
      <div className="space-y-2 bg-[var(--surface-2)] rounded-xl p-4">
        <p className="text-xs font-medium text-[var(--muted)]">{t.addPrompt}</p>
        <input
          type="text"
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          placeholder={t.promptName}
          className="w-full bg-[var(--surface)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[var(--accent)]"
        />
        <textarea
          value={newText}
          onChange={(e) => setNewText(e.target.value)}
          placeholder={t.promptText}
          rows={3}
          className="w-full bg-[var(--surface)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:border-[var(--accent)]"
        />
        <button
          onClick={handleAdd}
          disabled={!newLabel.trim() || !newText.trim()}
          className="w-full bg-[var(--accent)] hover:bg-[var(--accent-hover)] disabled:opacity-50 text-white rounded-lg px-4 py-2 text-xs font-medium transition-colors"
        >
          {t.addPrompt}
        </button>
      </div>

      {/* List */}
      <div className="space-y-2 max-h-56 overflow-y-auto">
        {filtered.length === 0 && (
          <p className="text-xs text-[var(--muted)] text-center py-4">
            {t.noCustomPrompts}
          </p>
        )}
        {filtered.map((preset) =>
          editingId === preset.id ? (
            <div
              key={preset.id}
              className="bg-[var(--surface-2)] rounded-xl p-3 space-y-2"
            >
              <input
                type="text"
                value={editLabel}
                onChange={(e) => setEditLabel(e.target.value)}
                className="w-full bg-[var(--surface)] border border-[var(--border)] rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-[var(--accent)]"
              />
              <textarea
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                rows={3}
                className="w-full bg-[var(--surface)] border border-[var(--border)] rounded-lg px-3 py-1.5 text-sm resize-none focus:outline-none focus:border-[var(--accent)]"
              />
              <div className="flex gap-2">
                <button
                  onClick={saveEdit}
                  disabled={!editLabel.trim() || !editText.trim()}
                  className="flex-1 bg-[var(--accent)] hover:bg-[var(--accent-hover)] disabled:opacity-50 text-white rounded-lg px-3 py-1.5 text-xs font-medium"
                >
                  {t.save}
                </button>
                <button
                  onClick={() => setEditingId(null)}
                  className="flex-1 bg-[var(--surface)] text-[var(--muted)] hover:text-[var(--fg)] rounded-lg px-3 py-1.5 text-xs font-medium"
                >
                  {t.cancel}
                </button>
              </div>
            </div>
          ) : (
            <div
              key={preset.id}
              className="bg-[var(--surface-2)] rounded-xl p-3 flex items-start gap-3"
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{preset.label}</p>
                <p className="text-xs text-[var(--muted)] line-clamp-2 mt-0.5">
                  {preset.text}
                </p>
              </div>
              <div className="flex gap-1 shrink-0">
                <button
                  onClick={() => startEdit(preset.id, preset.label, preset.text)}
                  className="text-xs text-[var(--accent)] hover:underline"
                >
                  {t.editPrompt}
                </button>
                <span className="text-[var(--border)]">·</span>
                <button
                  onClick={() => deleteCustomPreset(preset.id)}
                  className="text-xs text-[var(--danger)] hover:underline"
                >
                  {t.deletePrompt}
                </button>
              </div>
            </div>
          )
        )}
      </div>
    </div>
  );
}

type DangerAction =
  | "remove-ai-keys"
  | "remove-image-keys"
  | "remove-manual"
  | "remove-ai-creations"
  | "remove-notes"
  | "remove-all-creations"
  | "remove-everything";

function DangerTab() {
  const { settings, setProviderHasKey, _loadFromServer } = useAppStore();
  const lang = settings.language;
  const t = UI_TEXT[lang];

  const [confirmAction, setConfirmAction] = useState<DangerAction | null>(null);
  const [loading, setLoading] = useState(false);
  const [successMsg, setSuccessMsg] = useState("");

  const actions: { action: DangerAction; label: string; desc: string }[] = [
    { action: "remove-ai-keys", label: t.dangerRemoveAiKeys, desc: t.dangerRemoveAiKeysDesc },
    { action: "remove-image-keys", label: t.dangerRemoveImageKeys, desc: t.dangerRemoveImageKeysDesc },
    { action: "remove-manual", label: t.dangerRemoveManual, desc: t.dangerRemoveManualDesc },
    { action: "remove-ai-creations", label: t.dangerRemoveAiCreations, desc: t.dangerRemoveAiCreationsDesc },
    { action: "remove-notes", label: t.dangerRemoveNotes, desc: t.dangerRemoveNotesDesc },
    { action: "remove-all-creations", label: t.dangerRemoveAllCreations, desc: t.dangerRemoveAllCreationsDesc },
    { action: "remove-everything", label: t.dangerRemoveEverything, desc: t.dangerRemoveEverythingDesc },
  ];

  const executeAction = async (action: DangerAction) => {
    setLoading(true);
    setSuccessMsg("");
    try {
      const res = await fetch("/api/danger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) return;

      // Client-side cleanup
      switch (action) {
        case "remove-ai-keys":
          (["openrouter", "gemini", "claude", "openai"] as const).forEach((p) =>
            setProviderHasKey(p, false)
          );
          break;
        case "remove-manual":
          useManualStore.getState().reset();
          useManualStore.getState().loadCreations();
          break;
        case "remove-ai-creations":
          useAppStore.setState((s) => ({
            history: s.history.filter((e) => e.type !== "presentation"),
            presentation: null,
          }));
          break;
        case "remove-notes":
          useAppStore.setState((s) => ({
            history: s.history.filter((e) => e.type !== "notes"),
            notesProject: null,
          }));
          break;
        case "remove-all-creations":
          useManualStore.getState().reset();
          useManualStore.getState().loadCreations();
          useAppStore.setState({ history: [], presentation: null, notesProject: null });
          break;
        case "remove-everything":
          useManualStore.getState().reset();
          useManualStore.getState().loadCreations();
          // Reload state from server (which is now empty)
          await _loadFromServer();
          break;
      }
      setSuccessMsg(t.dangerSuccess);
      setTimeout(() => setSuccessMsg(""), 2000);
    } catch {
      // silent
    } finally {
      setLoading(false);
      setConfirmAction(null);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-base font-semibold text-[var(--danger)] flex items-center gap-2">
          <IconWarning size={18} />
          {t.dangerZone}
        </h3>
        <p className="text-xs text-[var(--muted)] mt-1">{t.dangerZoneDesc}</p>
      </div>

      {successMsg && (
        <div className="bg-green-500/10 border border-green-500/30 text-green-400 rounded-lg px-3 py-2 text-sm flex items-center gap-2">
          <IconCheck size={14} />
          {successMsg}
        </div>
      )}

      <div className="space-y-3">
        {actions.map(({ action, label, desc }) => (
          <div
            key={action}
            className="bg-[var(--surface-2)] rounded-xl p-4 flex items-center justify-between gap-4"
          >
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">{label}</p>
              <p className="text-xs text-[var(--muted)] mt-0.5">{desc}</p>
            </div>
            <button
              onClick={() => setConfirmAction(action)}
              disabled={loading}
              className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium bg-[var(--danger)]/10 text-[var(--danger)] border border-[var(--danger)]/30 hover:bg-[var(--danger)]/20 transition-colors disabled:opacity-50"
            >
              <IconTrash size={13} className="inline mr-1 -mt-0.5" />
              {label}
            </button>
          </div>
        ))}
      </div>

      {/* Confirmation modal */}
      {confirmAction && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => !loading && setConfirmAction(null)}
          />
          <div className="relative bg-[var(--surface)] border border-[var(--danger)]/40 rounded-2xl w-full max-w-sm p-6 shadow-2xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-[var(--danger)]/10 flex items-center justify-center shrink-0">
                <IconWarning size={20} className="text-[var(--danger)]" />
              </div>
              <div>
                <h3 className="text-base font-semibold">{t.dangerConfirmTitle}</h3>
                <p className="text-xs text-[var(--muted)] mt-0.5">
                  {actions.find((a) => a.action === confirmAction)?.label}
                </p>
              </div>
            </div>
            <p className="text-sm text-[var(--muted)] mb-5">{t.dangerConfirmMessage}</p>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmAction(null)}
                disabled={loading}
                className="flex-1 px-4 py-2 rounded-lg text-sm font-medium bg-[var(--surface-2)] text-[var(--muted)] hover:text-[var(--fg)] transition-colors disabled:opacity-50"
              >
                {t.cancel}
              </button>
              <button
                onClick={() => executeAction(confirmAction)}
                disabled={loading}
                className="flex-1 px-4 py-2 rounded-lg text-sm font-medium bg-[var(--danger)] text-white hover:opacity-90 transition-colors disabled:opacity-50"
              >
                {loading ? "..." : t.dangerConfirmButton}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function SettingsPanel() {
  const { settings, showSettings, settingsTab, setShowSettings, setSettingsTab } =
    useAppStore();

  const lang = settings.language;
  const t = UI_TEXT[lang];

  if (!showSettings) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={() => setShowSettings(false)}
      />

      {/* Panel */}
      <div className="relative bg-[var(--surface)] border border-[var(--border)] rounded-2xl w-full max-w-4xl h-[85vh] sm:h-[44rem] overflow-hidden flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border)]">
          <h2 className="text-lg font-semibold">{t.settings}</h2>
          <button
            onClick={() => setShowSettings(false)}
            className="text-[var(--muted)] hover:text-[var(--fg)] text-xl"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-[var(--border)]">
          {(["general", "ai", "images", "prompts", "danger"] as const).map((tab) => {
            const Icon = tab === "general" ? IconGlobe : tab === "ai" ? IconSparkles : tab === "images" ? IconImage : tab === "prompts" ? IconFileText : IconWarning;
            return (
              <button
                key={tab}
                onClick={() => setSettingsTab(tab)}
                className={`flex-1 px-4 py-3 text-sm font-medium transition-colors flex items-center justify-center gap-1.5 ${
                  settingsTab === tab
                    ? tab === "danger" ? "text-[var(--danger)] border-b-2 border-[var(--danger)]" : "text-[var(--accent)] border-b-2 border-[var(--accent)]"
                    : "text-[var(--muted)] hover:text-[var(--fg)]"
                }`}
              >
                <Icon size={15} />
                {tab === "general" ? t.general : tab === "ai" ? t.ai : tab === "images" ? t.images : tab === "prompts" ? t.promptsTab : t.dangerZone}
              </button>
            );
          })}
        </div>

        {/* Content */}
        <div className="flex-1 min-h-0 overflow-y-auto p-6">
          {settingsTab === "general" ? (
            <GeneralTab />
          ) : settingsTab === "ai" ? (
            <AITab />
          ) : settingsTab === "images" ? (
            <ImagesTab />
          ) : settingsTab === "danger" ? (
            <DangerTab />
          ) : (
            <PromptsTab />
          )}
        </div>
      </div>
    </div>
  );
}
