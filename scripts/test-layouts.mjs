#!/usr/bin/env node
/**
 * Test script: Generate a presentation with Gemini Flash, then build PPTX
 * for each slide layout to verify text sizing, spacing and visual quality.
 */

const BASE = "http://localhost:3000";

// Cookie jar for session — use existing session that already has Gemini key
let sessionCookie = process.env.TS_SESSION_COOKIE || "ts_session=dev-placeholder";

async function apiFetch(path, options = {}) {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  if (sessionCookie) headers["Cookie"] = sessionCookie;

  const res = await fetch(`${BASE}${path}`, { ...options, headers, redirect: "manual" });

  // Capture set-cookie
  const setCookie = res.headers.getSetCookie?.() || [];
  for (const c of setCookie) {
    const match = c.match(/ts_session=([^;]+)/);
    if (match) sessionCookie = `ts_session=${match[1]}`;
  }
  return res;
}

const LAYOUTS = [
  "single",
  "two-cards",
  "three-cards",
  "four-cards",
  "grid-2x2",
  "two-cols",
  "diagonal",
  "left-small-right-large",
  "three-cols",
  "four-cols",
  "two-rows",
  "three-rows",
  "four-rows",
  "left-stack-right",
  "left-right-stack",
];

async function setGeminiKey() {
  // Check if key already stored by trying to list models
  const modelsRes = await apiFetch(`/api/models`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider: "gemini" }),
  });
  if (modelsRes.ok) {
    console.log("✓ Gemini key already configured");
    return true;
  }

  // Need to store key - check env
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    console.error("✗ GEMINI_API_KEY env var required. Export it and retry.");
    process.exit(1);
  }

  const storeRes = await apiFetch(`/api/keys`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider: "gemini", apiKey: key }),
  });

  if (!storeRes.ok) {
    console.error("✗ Failed to store key:", await storeRes.text());
    process.exit(1);
  }
  console.log("✓ Gemini key stored");
  return true;
}

async function getGeminiFlashModel() {
  const res = await apiFetch(`/api/models`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider: "gemini" }),
  });
  if (!res.ok) {
    console.error("✗ Failed to fetch models:", await res.text());
    process.exit(1);
  }

  const data = await res.json();
  // Find gemini-2.0-flash or gemini-flash-latest or similar
  const flashModel = data.models.find(
    (m) =>
      m.id.includes("flash") &&
      !m.id.includes("thinking") &&
      !m.id.includes("lite") &&
      !m.id.includes("image") &&
      !m.id.includes("8b")
  );

  if (!flashModel) {
    console.error("✗ No Flash model found. Available:", data.models.map((m) => m.id).join(", "));
    process.exit(1);
  }

  console.log(`✓ Using model: ${flashModel.id}`);
  return flashModel.id;
}

async function generatePresentation(modelId) {
  console.log("\n⏳ Generating presentation...");
  const res = await apiFetch(`/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      provider: "gemini",
      modelId,
      slideCount: 5,
      textDensity: 30,
      outputLanguage: "es",
      prompts: {
        design: "Estilo profesional con paleta azul marino y blanco. Tipografía limpia.",
        text: "Genera contenido informativo con viñetas claras de longitud media. Cada viñeta debe tener entre 10 y 20 palabras.",
        notes: "",
      },
      sourceText:
        "La inteligencia artificial está transformando la industria tecnológica. Desde el aprendizaje automático hasta el procesamiento del lenguaje natural, las empresas están adoptando IA para automatizar procesos, mejorar la experiencia del cliente y optimizar operaciones. Los grandes modelos de lenguaje como GPT-4 y Gemini están democratizando el acceso a la IA, permitiendo que desarrolladores y empresas de todos los tamaños construyan aplicaciones inteligentes. La IA generativa está revolucionando campos como el diseño, la programación y la creación de contenido. Sin embargo, también plantea desafíos éticos y regulatorios que la sociedad debe abordar.",
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error("✗ Generate failed:", err);
    process.exit(1);
  }

  const presentation = await res.json();
  console.log(`✓ Generated: "${presentation.title}" — ${presentation.slides.length} slides`);
  for (const s of presentation.slides) {
    console.log(`   Slide ${s.index + 1}: "${s.title}" (${s.bullets.length} bullets)`);
  }
  return presentation;
}

async function fetchImages(presentation) {
  console.log("\n⏳ Fetching images...");
  const searchTerms = presentation.slides.map(
    (s) => s.imageSearchTerms || [s.title]
  );

  const res = await apiFetch(`/api/images`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ searchTerms }),
  });

  if (!res.ok) {
    console.warn("⚠ Image fetch failed, continuing without images");
    return presentation;
  }

  const data = await res.json();
  if (data.images) {
    presentation.slides.forEach((slide, i) => {
      const candidates = data.images[i] || [];
      slide.imageUrls = candidates.slice(0, 4).map((c) => c.thumbUrl);
    });
    const totalImages = presentation.slides.reduce((sum, s) => sum + s.imageUrls.length, 0);
    console.log(`✓ Fetched ${totalImages} images total`);
  }
  return presentation;
}

async function buildPptx(presentation, layoutId, index) {
  const res = await apiFetch(`/api/build-pptx`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      presentation,
      imageLayout: "combined",
      slideLayout: layoutId,
      stretchImages: false,
      textDensity: 30,
      slideBgColor: "0F172A",
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error(`  ✗ ${layoutId}: build failed — ${err}`);
    return false;
  }

  const buf = Buffer.from(await res.arrayBuffer());
  const fs = await import("fs");
  const path = await import("path");
  const dir = path.join(process.cwd(), "test-output");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const filename = `${String(index + 1).padStart(2, "0")}-${layoutId}.pptx`;
  fs.writeFileSync(path.join(dir, filename), buf);
  console.log(`  ✓ ${layoutId} → test-output/${filename} (${(buf.length / 1024).toFixed(0)} KB)`);
  return true;
}

async function main() {
  console.log("=== TrueSlides Layout Test ===\n");

  await setGeminiKey();
  const modelId = await getGeminiFlashModel();
  let presentation = await generatePresentation(modelId);
  presentation = await fetchImages(presentation);

  console.log(`\n⏳ Building PPTX for ${LAYOUTS.length} layouts...\n`);
  let success = 0;
  let fail = 0;

  for (let i = 0; i < LAYOUTS.length; i++) {
    const ok = await buildPptx(presentation, LAYOUTS[i], i);
    if (ok) success++;
    else fail++;
  }

  console.log(`\n=== Done: ${success} succeeded, ${fail} failed ===`);
  console.log("Files saved in test-output/ — open each PPTX to verify:");
  console.log("  • Text readable from distance (17pt bullets, 28pt title)");
  console.log("  • Proper spacing between section, title, bullets");
  console.log("  • Balanced text/image distribution (~30% text)");
  console.log("  • Margins and padding consistent across all layouts");
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
