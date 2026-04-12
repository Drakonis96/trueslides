import { Language, LayoutMode, SlideLayoutId } from "./types";

export type ThemePackId = "minimal" | "corporate" | "startup" | "academic" | "creative";

export interface ThemePack {
  id: ThemePackId;
  name: Record<Language, string>;
  description: Record<Language, string>;
  designPrompt: Record<Language, string>;
  palette: {
    background: string;
    accent: string;
    sectionText: string;
    titleText: string;
    bulletText: string;
  };
  fonts: {
    heading: string;
    body: string;
    pptHeading: string;
    pptBody: string;
  };
  layout: {
    mode: LayoutMode;
    slideLayout: SlideLayoutId;
    stretchImages: boolean;
  };
}

export const THEME_PACKS: ThemePack[] = [
  {
    id: "minimal",
    name: { en: "Minimal", es: "Minimalista" },
    description: {
      en: "Current clean style. Neutral backgrounds, focused typography, subtle accent.",
      es: "Estilo limpio actual. Fondos neutros, tipografia enfocada y acento sutil.",
    },
    designPrompt: {
      en: "Ultra-clean minimalist design. Black and white with one accent color (teal). Generous white space. Thin sans-serif fonts. No borders or unnecessary decorations. Content-first approach with simple, elegant layouts.",
      es: "Diseno minimalista ultra-limpio. Blanco y negro con un color de acento (turquesa). Amplio espacio en blanco. Fuentes sans-serif delgadas. Sin bordes ni decoraciones innecesarias. Enfoque en contenido con disenos simples y elegantes.",
    },
    palette: {
      background: "FFFFFF",
      accent: "0EA5A4",
      sectionText: "6B7280",
      titleText: "111827",
      bulletText: "374151",
    },
    fonts: {
      heading: "'Inter', 'Helvetica Neue', Arial, sans-serif",
      body: "'Inter', 'Helvetica Neue', Arial, sans-serif",
      pptHeading: "Aptos Display",
      pptBody: "Aptos",
    },
    layout: {
      mode: "fixed",
      slideLayout: "single",
      stretchImages: false,
    },
  },
  {
    id: "corporate",
    name: { en: "Corporate", es: "Corporativo" },
    description: {
      en: "Executive deck with controlled contrast and formal hierarchy.",
      es: "Deck ejecutivo con contraste controlado y jerarquia formal.",
    },
    designPrompt: {
      en: "Professional corporate deck. Structured hierarchy, restrained visual language, navy and slate accents, clean data-forward compositions, consistent title positioning, and polished business tone.",
      es: "Deck corporativo profesional. Jerarquia estructurada, lenguaje visual sobrio, acentos azul marino y pizarra, composiciones limpias orientadas a datos, posicion de titulos consistente y tono empresarial.",
    },
    palette: {
      background: "F4F7FB",
      accent: "0B3A67",
      sectionText: "385170",
      titleText: "0F172A",
      bulletText: "334155",
    },
    fonts: {
      heading: "'Aptos', 'Segoe UI', Arial, sans-serif",
      body: "'Aptos', 'Segoe UI', Arial, sans-serif",
      pptHeading: "Aptos Display",
      pptBody: "Aptos",
    },
    layout: {
      mode: "fixed",
      slideLayout: "two-cols",
      stretchImages: false,
    },
  },
  {
    id: "startup",
    name: { en: "Startup", es: "Startup" },
    description: {
      en: "High-energy pitch style, dark canvas, bold accent and metric-first rhythm.",
      es: "Estilo pitch de alta energia, lienzo oscuro, acento fuerte y ritmo orientado a metricas.",
    },
    designPrompt: {
      en: "Modern startup pitch style. Use bold headlines, dark backgrounds, strong accent gradients, high-contrast callouts, metric-focused sections and confident visual rhythm.",
      es: "Estilo moderno de pitch startup. Usa titulares fuertes, fondos oscuros, gradientes de acento marcados, llamadas de alto contraste, secciones enfocadas en metricas y ritmo visual confiado.",
    },
    palette: {
      background: "0A1022",
      accent: "00D4FF",
      sectionText: "93C5FD",
      titleText: "F8FAFC",
      bulletText: "CBD5E1",
    },
    fonts: {
      heading: "'Montserrat', 'Avenir Next', 'Segoe UI', sans-serif",
      body: "'Montserrat', 'Avenir Next', 'Segoe UI', sans-serif",
      pptHeading: "Montserrat",
      pptBody: "Calibri",
    },
    layout: {
      mode: "smart",
      slideLayout: "left-right-stack",
      stretchImages: true,
    },
  },
  {
    id: "academic",
    name: { en: "Academic", es: "Academico" },
    description: {
      en: "Research-oriented with calm tones, rigorous hierarchy, and reading comfort.",
      es: "Orientado a investigacion con tonos serenos, jerarquia rigurosa y comodidad de lectura.",
    },
    designPrompt: {
      en: "Formal academic style for research presentations. Clear information architecture, restrained colors, references-friendly layouts, and analytical tone with visual clarity.",
      es: "Estilo academico formal para presentaciones de investigacion. Arquitectura de informacion clara, colores sobrios, layouts aptos para referencias y tono analitico con claridad visual.",
    },
    palette: {
      background: "FAF8F3",
      accent: "7B5E3B",
      sectionText: "8B6F47",
      titleText: "1F2937",
      bulletText: "374151",
    },
    fonts: {
      heading: "'Merriweather', Georgia, serif",
      body: "'Source Sans 3', 'Segoe UI', Arial, sans-serif",
      pptHeading: "Georgia",
      pptBody: "Calibri",
    },
    layout: {
      mode: "fixed",
      slideLayout: "two-rows",
      stretchImages: false,
    },
  },
  {
    id: "creative",
    name: { en: "Creative", es: "Creativo" },
    description: {
      en: "Expressive visual identity with asymmetry and playful color contrast.",
      es: "Identidad visual expresiva con asimetria y contraste cromatico audaz.",
    },
    designPrompt: {
      en: "Creative editorial style with expressive compositions. Use asymmetric balance, layered color planes, dynamic visual pacing and bold typographic personality while keeping readability high.",
      es: "Estilo editorial creativo con composiciones expresivas. Usa balance asimetrico, planos de color superpuestos, ritmo visual dinamico y personalidad tipografica fuerte manteniendo legibilidad.",
    },
    palette: {
      background: "FFF7ED",
      accent: "E76F51",
      sectionText: "C2410C",
      titleText: "1F2937",
      bulletText: "374151",
    },
    fonts: {
      heading: "'Poppins', 'Trebuchet MS', sans-serif",
      body: "'Nunito Sans', 'Segoe UI', sans-serif",
      pptHeading: "Trebuchet MS",
      pptBody: "Calibri",
    },
    layout: {
      mode: "smart",
      slideLayout: "diagonal",
      stretchImages: true,
    },
  },
];

export const DEFAULT_THEME_PACK_ID: ThemePackId = "minimal";

export function getThemeById(themeId: ThemePackId): ThemePack {
  return THEME_PACKS.find((theme) => theme.id === themeId) || THEME_PACKS[0];
}
