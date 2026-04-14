"use client";

import { useAppStore } from "@/lib/store";
import { useState } from "react";
import { PROMPT_FIELDS, UI_TEXT } from "@/lib/presets";
import { PromptFieldKey, OUTPUT_LANGUAGE_OPTIONS, OutputLanguage } from "@/lib/types";
import { SLIDE_COUNT_OPTIONS, TEXT_DENSITY_OPTIONS } from "@/lib/presets";
import LayoutSelector from "./LayoutSelector";
import { IconPalette, IconText, IconMic, IconGlobe, IconHash, IconPercent, IconExpand, IconDroplet } from "./Icons";
import ThemePreviewModal from "./ThemePreviewModal";
import { THEME_PACKS } from "@/lib/themes";

const FIELD_ICONS: Record<string, React.ReactNode> = {
  palette: <IconPalette size={14} />,
  text: <IconText size={14} />,
  mic: <IconMic size={14} />,
};

function PromptField({ fieldKey }: { fieldKey: PromptFieldKey }) {
  const { settings, prompts, setPrompt, customPresets } = useAppStore();
  const lang = settings.language;
  const t = UI_TEXT[lang];

  const field = PROMPT_FIELDS.find((f) => f.key === fieldKey)!;
  const builtInPresets = field.presets[lang];

  const userPresets = customPresets
    .filter((p) => p.field === fieldKey)
    .map((p) => ({ id: p.id, label: p.label, text: p.text }));
  const allPresets = [...builtInPresets, ...userPresets];

  const activePreset = allPresets.find((p) => p.text === prompts[fieldKey]);

  return (
    <div className="space-y-2">
      <label className="flex items-center gap-1.5 text-sm font-medium">
        <span className="text-[var(--accent)]">{FIELD_ICONS[field.icon] || null}</span>
        {field.label[lang]}
      </label>

      <select
        className="w-full bg-[var(--surface-2)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[var(--accent)]"
        value={activePreset?.id ?? "__custom__"}
        onChange={(e) => {
          if (e.target.value === "__custom__") return;
          const preset = allPresets.find((p) => p.id === e.target.value);
          if (preset) setPrompt(fieldKey, preset.text);
        }}
      >
        {!activePreset && <option value="__custom__">{t.choosePreset}</option>}
        {allPresets.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label}
          </option>
        ))}
      </select>

      {prompts[fieldKey] !== "" && (
        <textarea
          value={prompts[fieldKey]}
          onChange={(e) => setPrompt(fieldKey, e.target.value)}
          rows={3}
          className="w-full bg-[var(--surface-2)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:border-[var(--accent)]"
          placeholder={`${field.label[lang]}...`}
        />
      )}
    </div>
  );
}

export default function PromptPanel() {
  const {
    settings,
    slideCount,
    customSlideCount,
    stretchImages,
    textDensity,
    customTextDensity,
    slideBgColor,
    slideAccentColor,
    selectedTheme,
    showImageSource,
    imageSourceFontColor,
    setSlideCount,
    setCustomSlideCount,
    setOutputLanguage,
    setStretchImages,
    setTextDensity,
    setCustomTextDensity,
    setSlideBgColor,
    setSlideAccentColor,
    applyThemePack,
    layoutMode,
    setLayoutMode,
    setShowImageSource,
    setImageSourceFontColor,
  } = useAppStore();

  const [showThemeModal, setShowThemeModal] = useState(false);
  const lang = settings.language;
  const t = UI_TEXT[lang];
  const activeTheme = THEME_PACKS.find((theme) => theme.id === selectedTheme) || THEME_PACKS[0];

  return (
    <div className="space-y-5">
      {/* Row 1: Slide count + Output Language side-by-side */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="flex items-center gap-1.5 text-sm font-medium mb-2">
            <span className="text-[var(--accent)]"><IconHash size={14} /></span>
            {t.slideCount}
          </label>
          <div className="flex flex-wrap gap-1.5">
            {SLIDE_COUNT_OPTIONS.map((n) => (
              <button
                key={n}
                onClick={() => {
                  setSlideCount(n);
                  setCustomSlideCount(false);
                }}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  !customSlideCount && slideCount === n
                    ? "bg-[var(--accent)] text-white"
                    : "bg-[var(--surface-2)] text-[var(--muted)] hover:text-[var(--fg)]"
                }`}
              >
                {n}
              </button>
            ))}
            <button
              onClick={() => setCustomSlideCount(true)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                customSlideCount
                  ? "bg-[var(--accent)] text-white"
                  : "bg-[var(--surface-2)] text-[var(--muted)] hover:text-[var(--fg)]"
              }`}
            >
              {t.custom}
            </button>
            {customSlideCount && (
              <input
                type="number"
                min={1}
                max={200}
                value={slideCount}
                onChange={(e) => setSlideCount(Math.max(1, Math.min(200, parseInt(e.target.value) || 1)))}
                className="w-20 bg-[var(--surface-2)] border border-[var(--border)] rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-[var(--accent)]"
              />
            )}
          </div>
        </div>

        <div>
          <label className="flex items-center gap-1.5 text-sm font-medium mb-2">
            <span className="text-[var(--accent)]"><IconGlobe size={14} /></span>
            {t.outputLanguage}
          </label>
          <select
            value={settings.outputLanguage}
            onChange={(e) => setOutputLanguage(e.target.value as OutputLanguage)}
            className="w-full bg-[var(--surface-2)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[var(--accent)]"
          >
            {OUTPUT_LANGUAGE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Design prompt + layout */}
      <div className="space-y-2">
        <label className="flex items-center gap-1.5 text-sm font-medium">
          <span className="text-[var(--accent)]"><IconPalette size={14} /></span>
          {lang === "es" ? "Paquete de tema" : "Theme pack"}
        </label>
        <div className="bg-[var(--surface-2)] border border-[var(--border)] rounded-xl p-3">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <p className="text-sm font-semibold">{activeTheme.name[lang]}</p>
              <p className="text-xs text-[var(--muted)] mt-0.5">{activeTheme.description[lang]}</p>
            </div>
            <button
              type="button"
              onClick={() => setShowThemeModal(true)}
              className="px-3 py-2 rounded-lg bg-[var(--surface)] border border-[var(--border)] hover:border-[var(--accent)] text-xs font-medium transition-colors"
            >
              {lang === "es" ? "Previsualizar temas" : "Preview themes"}
            </button>
          </div>

          <div className="mt-3 flex flex-wrap gap-1.5">
            {THEME_PACKS.map((theme) => {
              const active = theme.id === selectedTheme;
              return (
                <button
                  key={theme.id}
                  type="button"
                  onClick={() => applyThemePack(theme.id)}
                  className={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors ${
                    active
                      ? "bg-[var(--accent)] text-white border-[var(--accent)]"
                      : "bg-[var(--surface)] text-[var(--muted)] border-[var(--border)] hover:text-[var(--fg)] hover:border-[var(--accent)]/50"
                  }`}
                >
                  {theme.name[lang]}
                </button>
              );
            })}
          </div>
          <p className="text-[10px] text-[var(--muted)] mt-2">
            {lang === "es"
              ? "Minimalista es el estilo actual por defecto y sigue disponible tal cual."
              : "Minimal stays as the current default style and remains unchanged."}
          </p>
        </div>
      </div>

      <PromptField fieldKey="design" />

      <div className="pl-4 border-l-2 border-[var(--accent)]/30 space-y-3">
        {/* Layout mode selector */}
        <div className="space-y-2">
          <label className="text-xs font-medium text-[var(--muted)]">
            {lang === "en" ? "Layout Mode" : "Modo de Diseño"}
          </label>
          <div className="flex gap-2">
            <button
              onClick={() => setLayoutMode("fixed")}
              className={`flex-1 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                layoutMode === "fixed"
                  ? "bg-[var(--accent)] text-white"
                  : "bg-[var(--surface-2)] text-[var(--muted)] hover:text-[var(--fg)]"
              }`}
            >
              {lang === "en" ? "Fixed Layout" : "Diseño Fijo"}
            </button>
            <button
              onClick={() => setLayoutMode("smart")}
              className={`flex-1 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                layoutMode === "smart"
                  ? "bg-[var(--accent)] text-white"
                  : "bg-[var(--surface-2)] text-[var(--muted)] hover:text-[var(--fg)]"
              }`}
            >
              {lang === "en" ? "Smart Layout" : "Diseño Inteligente"}
            </button>
          </div>
          <p className="text-[10px] text-[var(--muted)]">
            {lang === "en"
              ? "Smart: AI chooses optimal layout per slide. Fixed: same layout for all slides."
              : "Inteligente: la IA elige el diseño óptimo de cada diapositiva. Fijo: el mismo diseño en todas."}
          </p>
        </div>

        {layoutMode === "fixed" && <LayoutSelector />}
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={stretchImages}
            onChange={(e) => setStretchImages(e.target.checked)}
            className="accent-[var(--accent)]"
          />
          <IconExpand size={12} className="text-[var(--muted)]" />
          {t.stretchImages}
        </label>

        {/* Slide colors */}
        <div className="space-y-2">
          <label className="flex items-center gap-1.5 text-xs font-medium text-[var(--muted)]">
            <IconDroplet size={12} />
            {lang === "en" ? "Slide Colors" : "Colores de Diapositiva"}
          </label>
          <div className="grid grid-cols-2 gap-2">
            {/* Background Color */}
            <div>
              <label className="block text-[10px] text-[var(--muted)] mb-1">
                {lang === "en" ? "Background" : "Fondo"}
              </label>
              <div className="flex items-center gap-1.5">
                <input
                  type="color"
                  value={`#${slideBgColor}`}
                  onChange={(e) => setSlideBgColor(e.target.value.replace("#", "").toUpperCase())}
                  className="w-7 h-7 rounded cursor-pointer border-0 bg-transparent shrink-0"
                />
                <input
                  type="text"
                  value={`#${slideBgColor}`}
                  onChange={(e) => {
                    const raw = e.target.value.replace("#", "").toUpperCase();
                    if (/^[0-9A-F]{0,6}$/.test(raw)) setSlideBgColor(raw.padEnd(6, "0"));
                  }}
                  className="flex-1 min-w-0 bg-[var(--surface)] border border-[var(--border)] rounded px-1.5 py-1 text-[10px] font-mono focus:outline-none focus:border-[var(--accent)]"
                />
              </div>
              <div className="flex gap-1 mt-1">
                {["000000", "0F172A", "1E293B", "F8FAFC", "FFFFFF"].map((c) => (
                  <button
                    key={c}
                    onClick={() => setSlideBgColor(c)}
                    className="w-5 h-5 rounded-full border transition-transform hover:scale-110"
                    style={{
                      backgroundColor: `#${c}`,
                      borderColor: slideBgColor === c ? "var(--accent)" : "var(--border)",
                      borderWidth: slideBgColor === c ? "2px" : "1px",
                    }}
                  />
                ))}
              </div>
            </div>

            {/* Accent Color */}
            <div>
              <label className="block text-[10px] text-[var(--muted)] mb-1">
                {lang === "en" ? "Accent" : "Acento"}
              </label>
              <div className="flex items-center gap-1.5">
                <input
                  type="color"
                  value={`#${slideAccentColor}`}
                  onChange={(e) => setSlideAccentColor(e.target.value.replace("#", "").toUpperCase())}
                  className="w-7 h-7 rounded cursor-pointer border-0 bg-transparent shrink-0"
                />
                <input
                  type="text"
                  value={`#${slideAccentColor}`}
                  onChange={(e) => {
                    const raw = e.target.value.replace("#", "").toUpperCase();
                    if (/^[0-9A-F]{0,6}$/.test(raw)) setSlideAccentColor(raw.padEnd(6, "0"));
                  }}
                  className="flex-1 min-w-0 bg-[var(--surface)] border border-[var(--border)] rounded px-1.5 py-1 text-[10px] font-mono focus:outline-none focus:border-[var(--accent)]"
                />
              </div>
              <div className="flex gap-1 mt-1">
                {["B30333", "6366F1", "38BDF8", "22C55E", "F59E0B"].map((c) => (
                  <button
                    key={c}
                    onClick={() => setSlideAccentColor(c)}
                    className="w-5 h-5 rounded-full border transition-transform hover:scale-110"
                    style={{
                      backgroundColor: `#${c}`,
                      borderColor: slideAccentColor === c ? "white" : "transparent",
                      borderWidth: slideAccentColor === c ? "2px" : "1px",
                    }}
                  />
                ))}
              </div>
            </div>
          </div>

          {/* Image Source Overlay */}
          <div className="space-y-2 mt-3 border-t border-[var(--border)]/50 pt-3">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={showImageSource}
                onChange={(e) => setShowImageSource(e.target.checked)}
                className="accent-[var(--accent)]"
              />
              <span className="text-[10px] text-[var(--muted)] font-medium">{t.showImageSource}</span>
            </label>

            {showImageSource && (
              <div>
                <label className="block text-[10px] text-[var(--muted)] mb-1">
                  {t.imageSourceFontColor}
                </label>
                <div className="flex items-center gap-1.5">
                  <input
                    type="color"
                    value={`#${imageSourceFontColor}`}
                    onChange={(e) => setImageSourceFontColor(e.target.value.replace("#", "").toUpperCase())}
                    className="w-7 h-7 rounded cursor-pointer border-0 bg-transparent shrink-0"
                  />
                  <input
                    type="text"
                    value={`#${imageSourceFontColor}`}
                    onChange={(e) => {
                      const raw = e.target.value.replace("#", "").toUpperCase();
                      if (/^[0-9A-F]{0,6}$/.test(raw)) setImageSourceFontColor(raw.padEnd(6, "0"));
                    }}
                    className="flex-1 min-w-0 bg-[var(--surface)] border border-[var(--border)] rounded px-1.5 py-1 text-[10px] font-mono focus:outline-none focus:border-[var(--accent)]"
                  />
                </div>
                <div className="flex gap-1 mt-1">
                  {["FFFFFF", "000000", "6366F1", "38BDF8", "F59E0B"].map((c) => (
                    <button
                      key={c}
                      onClick={() => setImageSourceFontColor(c)}
                      className="w-5 h-5 rounded border transition-transform hover:scale-110"
                      style={{
                        backgroundColor: `#${c}`,
                        borderColor: imageSourceFontColor === c ? "var(--accent)" : "var(--border)",
                        borderWidth: imageSourceFontColor === c ? "2px" : "1px",
                      }}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Text prompt + density */}
      <PromptField fieldKey="text" />

      <div className="pl-4 border-l-2 border-[var(--accent)]/30">
        <label className="flex items-center gap-1.5 text-xs text-[var(--muted)] mb-1.5">
          <IconPercent size={12} />
          {t.textDensity}: {textDensity}%
        </label>
        <div className="flex flex-wrap gap-1.5 mb-2">
          {TEXT_DENSITY_OPTIONS.map((n) => (
            <button
              key={n}
              onClick={() => {
                setTextDensity(n);
                setCustomTextDensity(false);
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                !customTextDensity && textDensity === n
                  ? "bg-[var(--accent)] text-white"
                  : "bg-[var(--surface-2)] text-[var(--muted)] hover:text-[var(--fg)]"
              }`}
            >
              {n}%
            </button>
          ))}
          <button
            onClick={() => setCustomTextDensity(true)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              customTextDensity
                ? "bg-[var(--accent)] text-white"
                : "bg-[var(--surface-2)] text-[var(--muted)] hover:text-[var(--fg)]"
            }`}
          >
            {t.custom}
          </button>
        </div>
        {customTextDensity && (
          <input
            type="range"
            min={0}
            max={100}
            value={textDensity}
            onChange={(e) => setTextDensity(parseInt(e.target.value))}
            className="w-full"
          />
        )}
      </div>

      {/* Notes prompt */}
      <PromptField fieldKey="notes" />

      <ThemePreviewModal
        open={showThemeModal}
        lang={lang}
        selectedTheme={selectedTheme}
        onClose={() => setShowThemeModal(false)}
        onSelect={(themeId) => {
          applyThemePack(themeId);
          setShowThemeModal(false);
        }}
      />
    </div>
  );
}
