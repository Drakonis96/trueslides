"use client";

import { useAppStore } from "@/lib/store";
import { SLIDE_LAYOUTS, SlideLayoutId, SlideLayoutDef } from "@/lib/types";
import { UI_TEXT } from "@/lib/presets";

export const LAYOUT_LABELS: Record<SlideLayoutId, { en: string; es: string }> = {
  single:                 { en: "Full (1)",               es: "Completa (1)" },
  "two-cards":            { en: "2 Cards",                es: "2 Tarjetas" },
  "three-cards":          { en: "3 Cards",                es: "3 Tarjetas" },
  "four-cards":           { en: "4 Cards",                es: "4 Tarjetas" },
  "grid-2x2":             { en: "2×2 Grid",               es: "Cuadrícula 2×2" },
  "two-cols":             { en: "2 Columns",              es: "2 Columnas" },
  diagonal:               { en: "Diagonal",               es: "Diagonal" },
  "left-small-right-large": { en: "Narrow + Wide",       es: "Estrecha + Ancha" },
  "three-cols":           { en: "3 Columns",              es: "3 Columnas" },
  "four-cols":            { en: "4 Columns",              es: "4 Columnas" },
  "two-rows":             { en: "2 Rows",                 es: "2 Filas" },
  "three-rows":           { en: "3 Rows",                 es: "3 Filas" },
  "four-rows":            { en: "4 Rows",                 es: "4 Filas" },
  "left-stack-right":     { en: "Stack + Large",          es: "Pila + Grande" },
  "left-right-stack":     { en: "Large + Stack",          es: "Grande + Pila" },
};

export function LayoutThumbnail({ layout, active }: { layout: SlideLayoutDef; active: boolean }) {
  const W = 64;
  const H = 36;
  const PAD = 1.5;

  return (
    <svg
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      className="block"
    >
      {/* Background */}
      <rect
        x={0} y={0} width={W} height={H} rx={3}
        fill={active ? "var(--accent)" : "var(--surface-2)"}
        opacity={active ? 0.15 : 1}
        stroke={active ? "var(--accent)" : "var(--border)"}
        strokeWidth={1.2}
      />
      {/* Slots */}
      {layout.slots.map((slot, i) => {
        const sx = PAD + slot.x * (W - PAD * 2);
        const sy = PAD + slot.y * (H - PAD * 2);
        const sw = slot.w * (W - PAD * 2);
        const sh = slot.h * (H - PAD * 2);

        // For diagonal layout, draw overlapping rectangles matching the actual slots
        if (layout.id === "diagonal") {
          // Slot 1 is behind (bottom-left), slot 2 is in front (top-right)
          const order = i === 0 ? 0 : 1;
          return (
            <rect
              key={i}
              x={sx}
              y={sy}
              width={sw}
              height={sh}
              rx={2}
              fill={active ? "var(--accent)" : "var(--surface)"}
              opacity={active ? (order === 0 ? 0.35 : 0.6) : (order === 0 ? 0.25 : 0.4)}
              stroke={active ? "var(--accent)" : "var(--muted)"}
              strokeWidth={0.8}
            />
          );
        }

        return (
          <rect
            key={i}
            x={sx}
            y={sy}
            width={sw}
            height={sh}
            rx={1.5}
            fill={active ? "var(--accent)" : "var(--muted)"}
            opacity={active ? 0.6 : 0.35}
            stroke={active ? "var(--accent)" : "var(--muted)"}
            strokeWidth={0.5}
          />
        );
      })}
      {/* Slot numbers */}
      {layout.slots.map((slot, i) => {
        const cx = PAD + slot.x * (W - PAD * 2) + (slot.w * (W - PAD * 2)) / 2;
        const cy = PAD + slot.y * (H - PAD * 2) + (slot.h * (H - PAD * 2)) / 2;
        return (
          <text
            key={`n${i}`}
            x={cx}
            y={cy}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={8}
            fontWeight={600}
            fill={active ? "var(--accent)" : "var(--fg)"}
            opacity={active ? 1 : 0.6}
          >
            {i + 1}
          </text>
        );
      })}
    </svg>
  );
}

export default function LayoutSelector() {
  const { settings, slideLayout, setSlideLayout } = useAppStore();
  const lang = settings.language;
  const t = UI_TEXT[lang];

  return (
    <div>
      <label className="block text-xs text-[var(--muted)] mb-1.5">
        {lang === "en" ? "Slide Layout" : "Disposición de Diapositiva"}
      </label>
      <div className="grid grid-cols-5 gap-2">
        {SLIDE_LAYOUTS.map((layout) => {
          const active = slideLayout === layout.id;
          return (
            <button
              key={layout.id}
              onClick={() => setSlideLayout(layout.id)}
              title={LAYOUT_LABELS[layout.id][lang]}
              className={`rounded-lg p-1 transition-all flex flex-col items-center ${
                active
                  ? "ring-2 ring-[var(--accent)] bg-[var(--accent)]/10"
                  : "hover:bg-[var(--surface-2)] bg-transparent"
              }`}
            >
              <LayoutThumbnail layout={layout} active={active} />
              <span className="block text-[9px] mt-0.5 truncate text-center" style={{ color: active ? "var(--accent)" : "var(--muted)" }}>
                {LAYOUT_LABELS[layout.id][lang]}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
