"use client";

import { ThemePack, THEME_PACKS, ThemePackId } from "@/lib/themes";
import { Language } from "@/lib/types";

interface ThemePreviewModalProps {
  open: boolean;
  lang: Language;
  selectedTheme: ThemePackId;
  onClose: () => void;
  onSelect: (themeId: ThemePackId) => void;
}

function MiniSlide({
  theme,
  variant,
}: {
  theme: ThemePack;
  variant: "cover" | "content" | "image";
}) {
  const accent = `#${theme.palette.accent}`;
  const bg = `#${theme.palette.background}`;
  const titleColor = `#${theme.palette.titleText}`;
  const sectionColor = `#${theme.palette.sectionText}`;
  const bulletColor = `#${theme.palette.bulletText}`;

  return (
    <div
      className="aspect-video rounded-lg border border-black/10 overflow-hidden relative"
      style={{ backgroundColor: bg, fontFamily: theme.fonts.body }}
    >
      {variant === "cover" ? (
        <div className="h-full p-3 flex flex-col justify-between">
          <div
            className="text-[9px] uppercase tracking-[0.18em] font-bold"
            style={{ color: sectionColor }}
          >
            Cover
          </div>
          <div
            className="text-sm leading-tight font-bold"
            style={{ color: titleColor, fontFamily: theme.fonts.heading }}
          >
            Market Expansion 2027
          </div>
          <div className="h-1 rounded-full" style={{ backgroundColor: accent }} />
        </div>
      ) : null}

      {variant === "content" ? (
        <div className="h-full p-3 flex flex-col">
          <div
            className="text-[9px] uppercase tracking-[0.16em] font-semibold mb-1"
            style={{ color: sectionColor }}
          >
            Strategy
          </div>
          <div
            className="text-[11px] font-bold leading-tight mb-2"
            style={{ color: titleColor, fontFamily: theme.fonts.heading }}
          >
            Core Growth Levers
          </div>
          <ul className="space-y-1 text-[9px]">
            <li className="flex items-start gap-1" style={{ color: bulletColor }}>
              <span style={{ color: accent }}>●</span>
              Product localization
            </li>
            <li className="flex items-start gap-1" style={{ color: bulletColor }}>
              <span style={{ color: accent }}>●</span>
              Regional partnerships
            </li>
            <li className="flex items-start gap-1" style={{ color: bulletColor }}>
              <span style={{ color: accent }}>●</span>
              Acquisition funnel tuning
            </li>
          </ul>
          <div className="mt-auto h-1 rounded-full" style={{ backgroundColor: accent }} />
        </div>
      ) : null}

      {variant === "image" ? (
        <div className="h-full relative">
          <div
            className="absolute inset-0"
            style={{
              background:
                "radial-gradient(circle at 25% 20%, rgba(255,255,255,0.42), transparent 48%), linear-gradient(135deg, rgba(0,0,0,0.1), rgba(0,0,0,0.32))",
            }}
          />
          <div className="absolute inset-x-0 bottom-0 p-2.5 bg-gradient-to-t from-black/65 to-transparent">
            <div className="text-[8px] uppercase tracking-[0.15em] text-white/70">Image only</div>
            <div className="text-[10px] font-semibold text-white leading-tight" style={{ fontFamily: theme.fonts.heading }}>
              Without text density
            </div>
            <div className="mt-1 h-1 rounded-full" style={{ backgroundColor: accent }} />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ThemeCard({
  theme,
  lang,
  active,
  onSelect,
}: {
  theme: ThemePack;
  lang: Language;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`text-left rounded-2xl border p-4 transition-all ${
        active
          ? "border-[var(--accent)] bg-[var(--accent)]/10 ring-1 ring-[var(--accent)]/40"
          : "border-[var(--border)] bg-[var(--surface-2)] hover:border-[var(--accent)]/60"
      }`}
    >
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold">{theme.name[lang]}</h3>
        {active ? (
          <span className="text-[10px] uppercase tracking-wide text-[var(--accent)] font-semibold">
            {lang === "es" ? "Activo" : "Active"}
          </span>
        ) : null}
      </div>

      <p className="text-xs text-[var(--muted)] mb-3">{theme.description[lang]}</p>

      <div className="grid grid-cols-3 gap-2 mb-3">
        <MiniSlide theme={theme} variant="cover" />
        <MiniSlide theme={theme} variant="content" />
        <MiniSlide theme={theme} variant="image" />
      </div>

      <div className="flex items-center gap-1.5">
        {[theme.palette.background, theme.palette.accent, theme.palette.sectionText].map((color) => (
          <span
            key={color}
            className="w-4 h-4 rounded-full border border-black/10"
            style={{ backgroundColor: `#${color}` }}
          />
        ))}
      </div>
    </button>
  );
}

export default function ThemePreviewModal({
  open,
  lang,
  selectedTheme,
  onClose,
  onSelect,
}: ThemePreviewModalProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/65 backdrop-blur-sm" onClick={onClose} />

      <div className="relative w-full max-w-6xl max-h-[90vh] overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
          <div>
            <h2 className="text-base font-semibold">
              {lang === "es" ? "Coleccion de temas" : "Theme collection"}
            </h2>
            <p className="text-xs text-[var(--muted)] mt-0.5">
              {lang === "es"
                ? "Previsualiza portada, contenido y modo sin texto antes de aplicar."
                : "Preview cover, content and no-text mode before applying."}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-sm px-3 py-1.5 rounded-lg bg-[var(--surface-2)] hover:bg-[var(--border)] transition-colors"
          >
            {lang === "es" ? "Cerrar" : "Close"}
          </button>
        </div>

        <div className="p-5 overflow-y-auto max-h-[calc(90vh-6rem)] grid grid-cols-1 lg:grid-cols-2 gap-4">
          {THEME_PACKS.map((theme) => (
            <ThemeCard
              key={theme.id}
              theme={theme}
              lang={lang}
              active={selectedTheme === theme.id}
              onSelect={() => onSelect(theme.id)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
