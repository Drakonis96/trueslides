/**
 * Shared slide generation logic.
 * Used by both /api/generate (HTTP endpoint) and /api/generate-full (background job).
 */
import { AIProvider, OUTPUT_LANGUAGE_NAMES, OutputLanguage, SlideData, LayoutMode, SlideLayoutId, SLIDE_LAYOUTS } from "@/lib/types";
import { callAI } from "@/lib/ai-client";
import { v4 as uuid } from "uuid";

export interface GenerateRequest {
  provider: AIProvider;
  modelId: string;
  slideCount: number;
  textDensity: number;
  outputLanguage?: OutputLanguage;
  layoutMode?: LayoutMode;
  prompts: {
    design: string;
    text: string;
    notes: string;
  };
  sourceText: string;
}

export interface GenerateResult {
  title: string;
  slides: (SlideData & { imageSearchTerms?: string[] })[];
  warnings: string[];
}

type PartialSlide = {
  title?: string;
  bullets?: string[];
  notes?: string;
  section?: string;
  imageSearchTerms?: string[];
  slideLayout?: string;
};

// ── Chunked Generation Constants ──

const CHUNK_THRESHOLD = 15;
const SLIDES_PER_CHUNK = 12;

// ── Compact Key Mapping (reduce output tokens) ──
// AI outputs short keys; we expand to full names during parsing.
const COMPACT_KEYS: Record<string, string> = {
  t: "title",
  b: "bullets",
  n: "notes",
  s: "section",
  i: "imageSearchTerms",
  l: "slideLayout",
};

function expandCompactSlide(obj: Record<string, unknown>): Record<string, unknown> {
  const expanded: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    expanded[COMPACT_KEYS[key] || key] = value;
  }
  return expanded;
}

interface OutlineSlide {
  title: string;
  section: string;
  keyPoints: string;
}

interface OutlineResult {
  title: string;
  slides: OutlineSlide[];
}

export interface GenerateSlidesOptions {
  onSlidesPartial?: (slides: PartialSlide[]) => void;
  onChunkProgress?: (chunkIndex: number, totalChunks: number, message: string) => void;
  /** Fires when AI stream data arrives — useful for showing "receiving data" before full slides are parsed. */
  onStreamActivity?: (bytesReceived: number, slidesFoundSoFar: number) => void;
}

function buildSystemPrompt(body: GenerateRequest): string {
  const outputLanguage = body.outputLanguage ?? "en";
  const langName = OUTPUT_LANGUAGE_NAMES[outputLanguage];

  const textDensityInstruction =
    body.textDensity === 0
      ? `- This is an IMAGE-ONLY presentation. Do NOT include any bullet points. Set the "bullets" array to [] (empty) for EVERY slide. The presentation must be driven entirely by strong visuals.`
      : `- Text density: approximately ${body.textDensity}% of slide area should be text. Each slide should have ${body.textDensity <= 20 ? "2-3" : "3-6"} concise bullet points.`;

  const bulletsInstruction =
    body.textDensity === 0
      ? 'an EMPTY bullets array (literally "bullets": [])'
      : `bullet points (${body.textDensity <= 20 ? "2-3" : "3-6"} per slide)`;

  const notesInstruction = body.prompts.notes
    ? `PRESENTER NOTES INSTRUCTIONS (follow these guidelines regardless of what language they are written in — always write notes in ${langName}):\n${body.prompts.notes}\nIMPORTANT: Write all presenter notes in ${langName}.`
    : `PRESENTER NOTES: Do not generate presenter notes. Set the "notes" field to an empty string ("") for every slide.`;

  return `You are an expert presentation designer. Generate a professional presentation based on the provided source material.

CRITICAL LANGUAGE REQUIREMENT:
The ENTIRE presentation MUST be written in ${langName}. This includes: the presentation title, EVERY slide title, EVERY section name, ALL bullet points, and ALL presenter notes.
The ONLY exception is imageSearchTerms, which must always be in English.
If the source material is in a different language, translate and adapt all content so it reads naturally in ${langName}.

REQUIREMENTS:
- Generate exactly ${body.slideCount} slides
${textDensityInstruction}
- Each slide MUST have: title, ${bulletsInstruction}, presenter notes (or empty string if not requested), a section name, and imageSearchTerms
- The FIRST slide MUST be a polished cover/title slide: use the overall presentation title as its title, set an evocative section name, and choose imageSearchTerms for a striking, iconic photograph that represents the entire topic
- Include a closing/summary slide as the last slide

IMAGE SEARCH TERMS — CRITICAL:
- imageSearchTerms: mandatory for EVERY slide. Must be in English.
- You are searching Wikimedia Commons, Unsplash, and Pexels — repositories of real photographs, artworks, and illustrations.
- Use SHORT KEYWORD PHRASES (1-3 words each). Image search APIs work best with brief, concrete terms — NOT long descriptive sentences.
- CONTEXT-AWARE SEARCH: Before choosing image terms, consider the OVERALL PRESENTATION TOPIC and this specific slide's role within it. Ask yourself: "What specific photograph would best illustrate THIS slide's content IN THE CONTEXT of the broader presentation?"
  For example, if the presentation is about "History of Photography" and a slide discusses "The Industrial Revolution", do NOT search for generic "industrial revolution" images. Instead, think about how the industrial revolution relates to photography: search for "daguerreotype factory", "Victorian photography studio", or "19th century camera production".
  Another example: if the presentation is about "Marine Biology" and a slide covers "Climate Change Effects", do NOT search for generic "climate change" images. Instead, search for "coral bleaching", "ocean temperature map", or "endangered marine species".
- Provide 3 search terms per slide, ordered from most specific to most general:
  1. The MOST SPECIFIC keyword for a concrete image that connects THIS slide's topic to the OVERALL presentation theme. Use the name of a concrete object, device, person, place, or artifact. Example: "daguerreotype" or "Kodak Brownie" or "Apollo 11 launch".
  2. A RELATED keyword that broadens slightly but remains relevant. Example: "antique camera" or "film camera" or "moon landing".
  3. A GENERAL FALLBACK keyword tied to the presentation theme. Example: "photography history" or "space exploration".
- GOOD examples: ["daguerreotype", "antique camera", "photography history"], ["CRISPR", "gene editing lab", "biotechnology"], ["Colosseum Rome", "Roman architecture", "ancient Rome"]
- BAD examples (too long, will fail): ["daguerreotype camera silver plate 1839 history photography"], ["digital camera sensor DSLR photography evolution technology"]
- BAD examples (too generic, ignores presentation context): ["industrial revolution", "factory", "innovation"] when the presentation is about photography history
- NEVER use abstract or conceptual terms like "innovation", "growth", "strategy", "digital transformation". These return irrelevant images.
- ALWAYS name what you want to SEE: objects, places, people, actions, historical items.
- For technology topics: name the specific technology, product, or device.
- For historical topics: name specific artifacts, people, or places.
- For scientific topics: name the specific organism, equipment, or phenomenon.

DESIGN INSTRUCTIONS (follow these guidelines regardless of what language they are written in — always produce output in ${langName}):
${body.prompts.design || "Use a clean, professional design."}

SLIDE TEXT INSTRUCTIONS (follow these guidelines regardless of what language they are written in — always produce output in ${langName}):
${body.prompts.text || "Generate informative, well-structured content organized in a logical sequential flow."}

${notesInstruction}

${
  body.layoutMode === "smart"
    ? `SMART LAYOUT INSTRUCTIONS — CRITICAL FOR THIS MODE:
For EACH slide, choose the optimal layout from this list based on the slide's content type:
- "single": Use for full-frame iconic images, title slides, or breathtaking visuals that deserve full attention.
- "two-cols": Use for comparisons, contrasts, before/after, or side-by-side concepts. Perfect for data visualization comparisons.
- "left-right-stack" or "left-stack-right": Use for content + supporting visuals, timeline progression on one side, main concept on the other.
- "three-cols" or "four-cols": Use for product showcase, 3-4 related items, or parallel concepts.
- "grid-2x2" or "four-cards": Use for 4-item grids (team members, products, benefits, pillars, etc.).
- "three-rows" or "two-rows": Use for timeline, sequential process, or vertical flow (e.g., steps 1→2→3).
- "two-cards" or "three-cards": Use for featured items with cardinality emphasis (2-3 main themes, spotlights).
- "diagonal": Use for dynamic, asymmetric layouts when you want visual interest and movement.

REASONING: Choose the layout that best suits the CONTENT STRUCTURE and VISUAL HIERARCHY of that specific slide.
- Data/comparison → 2-cols or grid
- Timeline/process → rows  
- Multiple items → cards or grid
- Hero image → single
- Asymmetric emphasis → left-right-stack or diagonal

Include a "slideLayout" field in EVERY slide with your chosen layout ID from the list above.`
    : `FIXED LAYOUT: All slides will use the same layout, so you don't need to specify a layout per slide.`
}

COMPACT OUTPUT FORMAT: Use single-letter keys for slide fields to minimize output size.
Key map: t=title, b=bullets, n=notes, s=section, i=imageSearchTerms${body.layoutMode === "smart" ? ", l=slideLayout" : ""}
The outer "title" and "slides" keys remain unchanged.

Respond ONLY with valid JSON (no markdown, no code fences):
{
  "title": "Presentation Title in ${langName}",
  "slides": [
    {
      "t": "Slide Title in ${langName}",
      "b": ${body.textDensity === 0 ? "[]" : `["Point 1 in ${langName}", "Point 2", "Point 3"]`},
      "n": "${body.prompts.notes ? `Presenter notes in ${langName}...` : ""}",
      "s": "Section Name in ${langName}",
      "i": ["very specific English term", "moderately specific term", "broader fallback term"]${body.layoutMode === "smart" ? `,
      "l": "single"` : ""}
    }
  ]
}`;
}

function buildUserPrompt(sourceText: string): string {
  // Limit to 200k chars to support presentations with 30+ slides while keeping reasonable API costs
  // For typical documents: 200k chars ≈ 40-50 pages of content, sufficient for comprehensive presentations
  const trimmed = sourceText.slice(0, 200000);
  return `SOURCE DOCUMENT:\n\n${trimmed}`;
}

function parseAIResponse(raw: string): GenerateResult {
  let jsonStr = raw;
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    jsonStr = jsonMatch[0];
  }

  const parsed = JSON.parse(jsonStr);

  if (!parsed.title || !Array.isArray(parsed.slides)) {
    throw new Error("Invalid presentation format from AI");
  }

  return {
    title: parsed.title,
    warnings: [],
    slides: parsed.slides.map(
      (
        rawSlide: Record<string, unknown>,
        i: number
      ) => {
        const s = expandCompactSlide(rawSlide) as {
          title?: string;
          bullets?: string[];
          notes?: string;
          section?: string;
          imageSearchTerms?: string[];
          slideLayout?: string;
        };
        const fallbackImageSearchTerms = [
          [s.section, s.title].filter(Boolean).join(" "),
          s.title || "",
        ]
          .map((term) => term.trim())
          .filter(Boolean);

        const imageSearchTerms = Array.isArray(s.imageSearchTerms)
          ? s.imageSearchTerms
              .filter((term): term is string => typeof term === "string")
              .map((term) => term.trim())
              .filter(Boolean)
          : fallbackImageSearchTerms;

        // Validate slideLayout is one of the known layouts
        const validLayouts = SLIDE_LAYOUTS.map((l) => l.id);
        const slideLayout = s.slideLayout && validLayouts.includes(s.slideLayout as SlideLayoutId)
          ? (s.slideLayout as SlideLayoutId)
          : undefined;

        return {
          id: uuid(),
          index: i,
          title: s.title || `Slide ${i + 1}`,
          bullets: Array.isArray(s.bullets)
            ? s.bullets.filter((bullet): bullet is string => typeof bullet === "string")
            : [],
          notes: s.notes || "",
          section: s.section || "",
          imageUrls: [],
          imageSearchTerms: imageSearchTerms.length > 0 ? imageSearchTerms : fallbackImageSearchTerms,
          ...(slideLayout && { slideLayout }),
        };
      }
    ),
  };
}

// ── Outline + Chunk Prompts (for large presentations) ──

function buildOutlineSystemPrompt(body: GenerateRequest): string {
  const outputLanguage = body.outputLanguage ?? "en";
  const langName = OUTPUT_LANGUAGE_NAMES[outputLanguage];

  return `You are an expert presentation designer. Create a DETAILED OUTLINE for a ${body.slideCount}-slide presentation.

CRITICAL: ALL text in ${langName}.

REQUIREMENTS:
- Plan exactly ${body.slideCount} slides
- First slide: polished cover/title slide
- Last slide: closing/summary slide
- Group slides into logical sections that flow naturally
- Each slide: title, section, keyPoints (1-2 sentences describing the SPECIFIC content, data, or arguments this slide will present)
- Distribute the source material EVENLY across all ${body.slideCount} slides — every part of the document must be represented proportionally
- Later slides must be just as detailed and specific as earlier ones

${body.prompts.design ? `DESIGN DIRECTION: ${body.prompts.design}` : ""}
${body.prompts.text ? `TEXT DIRECTION: ${body.prompts.text}` : ""}

Respond ONLY with valid JSON (no markdown, no code fences):
{
  "title": "Presentation Title in ${langName}",
  "slides": [
    { "title": "Slide Title", "section": "Section Name", "keyPoints": "Specific description of content to cover" }
  ]
}`;
}

function buildChunkSystemPrompt(
  body: GenerateRequest,
  outline: OutlineResult,
  chunkStart: number,
  chunkEnd: number,
): string {
  const outputLanguage = body.outputLanguage ?? "en";
  const langName = OUTPUT_LANGUAGE_NAMES[outputLanguage];

  const outlineContext = outline.slides
    .map((s, i) => {
      const marker = i >= chunkStart && i < chunkEnd ? ">>>" : "   ";
      return `${marker} [${i + 1}] (${s.section}) ${s.title} — ${s.keyPoints}`;
    })
    .join("\n");

  const textDensityInstruction =
    body.textDensity === 0
      ? 'Set "bullets" to [] for every slide. Image-only presentation.'
      : `Each slide: ${body.textDensity <= 20 ? "2-3" : "3-6"} concise bullet points (~${body.textDensity}% text density).`;

  const bulletsFormat =
    body.textDensity === 0 ? '"b": []' : '"b": ["Point 1", "Point 2", "Point 3"]';

  const notesInstruction = body.prompts.notes
    ? `PRESENTER NOTES — write THOROUGH, DETAILED notes for EVERY slide:\n${body.prompts.notes}\nNotes must be in ${langName}. Include talking points, context, transitions, supporting data, and stories. A presenter unfamiliar with the topic should be able to deliver confidently using only these notes.`
    : 'Set "n" to "" for every slide.';

  const smartLayoutInstructions =
    body.layoutMode === "smart"
      ? `\nChoose a slideLayout per slide from: "single", "two-cols", "left-right-stack", "left-stack-right", "three-cols", "four-cols", "grid-2x2", "four-cards", "three-rows", "two-rows", "two-cards", "three-cards", "diagonal".`
      : "";

  return `Generate slides ${chunkStart + 1}–${chunkEnd} of a ${outline.slides.length}-slide presentation: "${outline.title}".

ALL content in ${langName}. Only imageSearchTerms in English.

FULL OUTLINE (>>> = your slides):
${outlineContext}

GENERATE slides ${chunkStart + 1}–${chunkEnd} with COMPLETE content following the outline's keyPoints precisely.

${textDensityInstruction}

${notesInstruction}

IMAGE SEARCH TERMS (3 per slide, English, 1-3 words each):
- Specific → moderate → broad. Name CONCRETE subjects (objects, places, people, devices).
- Connect to the overall theme: "${outline.title}".
- NEVER use abstract terms (innovation, growth, strategy, transformation).
${smartLayoutInstructions}

${body.prompts.design ? `DESIGN: ${body.prompts.design}` : ""}
${body.prompts.text ? `TEXT: ${body.prompts.text}` : ""}

COMPACT OUTPUT: Use short keys. Map: t=title, b=bullets, n=notes, s=section, i=imageSearchTerms${body.layoutMode === "smart" ? ", l=slideLayout" : ""}

Valid JSON only (no markdown):
{
  "slides": [
    {
      "t": "...",
      ${bulletsFormat},
      "n": "${body.prompts.notes ? "Detailed notes..." : ""}",
      "s": "...",
      "i": ["specific", "related", "fallback"]${body.layoutMode === "smart" ? ',\n      "l": "single"' : ""}
    }
  ]
}`;
}

function parseOutlineResponse(raw: string, expectedCount: number): OutlineResult {
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : raw);

  if (!parsed.title || !Array.isArray(parsed.slides)) {
    throw new Error("Invalid outline format from AI");
  }

  const slides: OutlineSlide[] = parsed.slides.map(
    (s: { title?: string; section?: string; keyPoints?: string }) => ({
      title: s.title || "",
      section: s.section || "",
      keyPoints: s.keyPoints || "",
    }),
  );

  if (slides.length < expectedCount * 0.5) {
    console.warn(
      `[generate] Outline produced only ${slides.length}/${expectedCount} slides — possible output truncation`,
    );
  }

  return { title: parsed.title, slides };
}

function parseChunkSlides(
  raw: string,
  outlineSlides: OutlineSlide[],
  chunkStart: number,
): GenerateResult["slides"] {
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : raw);
  const rawSlides: Record<string, unknown>[] = Array.isArray(parsed.slides) ? parsed.slides : [];

  return rawSlides.map((rawSlide, i) => {
    const s = expandCompactSlide(rawSlide) as PartialSlide;
    const globalIdx = chunkStart + i;
    const outlineSlide = outlineSlides[globalIdx];

    const fallbackTerms = [
      [s.section || outlineSlide?.section, s.title || outlineSlide?.title].filter(Boolean).join(" "),
      s.title || outlineSlide?.title || "",
    ]
      .map((t) => t.trim())
      .filter(Boolean);

    const imageSearchTerms = Array.isArray(s.imageSearchTerms)
      ? s.imageSearchTerms
          .filter((t): t is string => typeof t === "string")
          .map((t) => t.trim())
          .filter(Boolean)
      : fallbackTerms;

    const validLayouts = SLIDE_LAYOUTS.map((l) => l.id);
    const slideLayout =
      s.slideLayout && validLayouts.includes(s.slideLayout as SlideLayoutId)
        ? (s.slideLayout as SlideLayoutId)
        : undefined;

    return {
      id: uuid(),
      index: globalIdx,
      title: s.title || outlineSlide?.title || `Slide ${globalIdx + 1}`,
      bullets: Array.isArray(s.bullets)
        ? s.bullets.filter((b): b is string => typeof b === "string")
        : [],
      notes: s.notes || "",
      section: s.section || outlineSlide?.section || "",
      imageUrls: [],
      imageSearchTerms: imageSearchTerms.length > 0 ? imageSearchTerms : fallbackTerms,
      ...(slideLayout && { slideLayout }),
    };
  });
}

/**
 * Best-effort extraction of fully closed slide objects from partial JSON text.
 * Used to overlap image prefetch while the model is still streaming.
 */
function extractCompletedSlidesFromPartial(raw: string): PartialSlide[] {
  const slidesKeyIdx = raw.indexOf('"slides"');
  if (slidesKeyIdx < 0) return [];

  const arrayStart = raw.indexOf("[", slidesKeyIdx);
  if (arrayStart < 0) return [];

  const out: PartialSlide[] = [];
  let inString = false;
  let escaping = false;
  let depth = 0;
  let objStart = -1;

  for (let i = arrayStart + 1; i < raw.length; i++) {
    const ch = raw[i];

    if (inString) {
      if (escaping) {
        escaping = false;
      } else if (ch === "\\") {
        escaping = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === "{") {
      if (depth === 0) objStart = i;
      depth++;
      continue;
    }

    if (ch === "}") {
      if (depth === 0) continue;
      depth--;
      if (depth === 0 && objStart >= 0) {
        const candidate = raw.slice(objStart, i + 1);
        try {
          const parsed = JSON.parse(candidate) as Record<string, unknown>;
          out.push(expandCompactSlide(parsed) as unknown as PartialSlide);
        } catch {
          // ignore non-parseable partials
        }
        objStart = -1;
      }
      continue;
    }
  }

  return out;
}

/**
 * Generate slides by calling the AI provider directly.
 * No internal HTTP calls — safe to use from background jobs.
 * For large presentations (> CHUNK_THRESHOLD slides), uses a 2-phase approach:
 *   Phase 1: compact outline of the entire presentation
 *   Phase 2: full content generated in chunks of SLIDES_PER_CHUNK
 */
export async function generateSlides(
  apiKey: string,
  body: GenerateRequest,
  options?: GenerateSlidesOptions,
): Promise<GenerateResult> {
  if (body.slideCount <= CHUNK_THRESHOLD) {
    return generateSlidesSingleCall(apiKey, body, options);
  }
  return generateSlidesChunked(apiKey, body, options);
}

/** Original single-call generation — used for presentations ≤ CHUNK_THRESHOLD slides. */
async function generateSlidesSingleCall(
  apiKey: string,
  body: GenerateRequest,
  options?: GenerateSlidesOptions,
): Promise<GenerateResult> {
  const systemPrompt = buildSystemPrompt(body);
  const userPrompt = buildUserPrompt(body.sourceText);

  const maxTokens = Math.max(16000, body.slideCount * 600 + 2000);

  console.log(`[generate] Single-call mode: requesting ${body.slideCount} slides from ${body.provider}/${body.modelId} (maxTokens=${maxTokens})`);
  const callStart = Date.now();

  let streamedText = "";
  let emittedSlideCount = 0;

  const rawResponse = await callAI(
    body.provider,
    body.modelId,
    apiKey,
    systemPrompt,
    userPrompt,
    maxTokens,
    {
      stream: true,
      jsonMode: true,
      onTextChunk: (chunk) => {
        streamedText += chunk;
        const extracted = extractCompletedSlidesFromPartial(streamedText);
        // Report stream activity so the UI can show "receiving data"
        options?.onStreamActivity?.(streamedText.length, extracted.length);
        if (!options?.onSlidesPartial) return;
        if (extracted.length <= emittedSlideCount) return;
        const newlyCompleted = extracted.slice(emittedSlideCount);
        emittedSlideCount = extracted.length;
        options.onSlidesPartial(newlyCompleted);
      },
    },
  );

  if (!rawResponse.trim()) {
    throw new Error("AI returned an empty response");
  }

  console.log(`[generate] Single-call AI response received in ${((Date.now() - callStart) / 1000).toFixed(1)}s (${rawResponse.length} chars, ${emittedSlideCount} slides streamed)`);
  return parseAIResponse(rawResponse);
}

/**
 * Chunked generation — Phase 1 (outline) + Phase 2 (content chunks).
 * Avoids output token truncation for large presentations.
 */
async function generateSlidesChunked(
  apiKey: string,
  body: GenerateRequest,
  options?: GenerateSlidesOptions,
): Promise<GenerateResult> {
  const userPrompt = buildUserPrompt(body.sourceText);

  // ── Phase 1: Generate outline ──
  console.log(`[generate] Chunked mode: requesting outline for ${body.slideCount} slides from ${body.provider}/${body.modelId}`);
  options?.onChunkProgress?.(0, 0, `Planning ${body.slideCount}-slide presentation structure...`);

  const outlineStart = Date.now();
  const outlineMaxTokens = Math.max(8000, body.slideCount * 60 + 2000);
  const outlineRaw = await callAI(
    body.provider,
    body.modelId,
    apiKey,
    buildOutlineSystemPrompt(body),
    userPrompt,
    outlineMaxTokens,
    { jsonMode: true },
  );

  if (!outlineRaw.trim()) {
    throw new Error("AI returned an empty outline");
  }

  const outline = parseOutlineResponse(outlineRaw, body.slideCount);
  const actualSlideCount = outline.slides.length;
  const totalChunks = Math.ceil(actualSlideCount / SLIDES_PER_CHUNK);
  const allSlides: GenerateResult["slides"] = [];
  const warnings: string[] = [];

  // Warn if outline is significantly shorter than requested
  if (actualSlideCount < body.slideCount * 0.8) {
    warnings.push(`Outline produced ${actualSlideCount}/${body.slideCount} slides (possible output truncation)`);
  }

  console.log(`[generate] Outline received in ${((Date.now() - outlineStart) / 1000).toFixed(1)}s: "${outline.title}" — ${actualSlideCount} slides planned, ${totalChunks} chunks`);

  // ── Phase 2: Generate content in chunks ──
  for (let chunkIdx = 0; chunkIdx < totalChunks; chunkIdx++) {
    const chunkStart = chunkIdx * SLIDES_PER_CHUNK;
    const chunkEnd = Math.min(chunkStart + SLIDES_PER_CHUNK, actualSlideCount);
    const chunkSize = chunkEnd - chunkStart;

    const chunkSlideTitles = outline.slides.slice(chunkStart, chunkEnd).map(s => s.title).join(', ');
    const chunkMsg = `Generating chunk ${chunkIdx + 1}/${totalChunks}: slides ${chunkStart + 1}–${chunkEnd} of ${actualSlideCount}`;
    console.log(`[generate] ${chunkMsg} [${chunkSlideTitles}]`);
    options?.onChunkProgress?.(
      chunkIdx + 1,
      totalChunks,
      `${chunkMsg}...`,
    );
    const chunkCallStart = Date.now();

    let chunkStreamedText = "";
    let chunkEmittedCount = 0;

    let chunkRaw: string;
    try {
      chunkRaw = await callAI(
        body.provider,
        body.modelId,
        apiKey,
        buildChunkSystemPrompt(body, outline, chunkStart, chunkEnd),
        userPrompt,
        chunkSize * 600 + 2000,
        {
          stream: true,
          jsonMode: true,
          onTextChunk: (chunk) => {
            chunkStreamedText += chunk;
            const extracted = extractCompletedSlidesFromPartial(chunkStreamedText);
            options?.onStreamActivity?.(chunkStreamedText.length, chunkStart + extracted.length);
            if (!options?.onSlidesPartial) return;
            if (extracted.length <= chunkEmittedCount) return;
            const newSlides = extracted.slice(chunkEmittedCount);
            chunkEmittedCount = extracted.length;
            options.onSlidesPartial(newSlides);
          },
        },
      );
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.warn(`[generate] Chunk ${chunkIdx + 1}/${totalChunks} call failed after ${((Date.now() - chunkCallStart) / 1000).toFixed(1)}s:`, err);
      warnings.push(`Chunk ${chunkIdx + 1}/${totalChunks} (slides ${chunkStart + 1}–${chunkEnd}) failed: ${errMsg}`);
      chunkRaw = "";
    }

    if (chunkRaw.trim()) {
      console.log(`[generate] Chunk ${chunkIdx + 1}/${totalChunks} response received in ${((Date.now() - chunkCallStart) / 1000).toFixed(1)}s (${chunkRaw.length} chars)`);
    }

    if (!chunkRaw.trim()) {
      console.warn(`[generate] Chunk ${chunkIdx + 1}/${totalChunks} empty — using outline fallback`);
      warnings.push(`Chunk ${chunkIdx + 1}/${totalChunks} (slides ${chunkStart + 1}–${chunkEnd}) returned empty — using outline fallback`);
      for (let i = chunkStart; i < chunkEnd; i++) {
        const os = outline.slides[i];
        allSlides.push({
          id: uuid(),
          index: i,
          title: os?.title || `Slide ${i + 1}`,
          bullets: [],
          notes: "",
          section: os?.section || "",
          imageUrls: [],
          imageSearchTerms: [os?.title, os?.section].filter(Boolean) as string[],
        });
      }
      continue;
    }

    let chunkSlides: GenerateResult["slides"];
    try {
      chunkSlides = parseChunkSlides(chunkRaw, outline.slides, chunkStart);
    } catch (parseErr) {
      const parseErrMsg = parseErr instanceof Error ? parseErr.message : String(parseErr);
      console.warn(`[generate] Chunk ${chunkIdx + 1} parse failed:`, parseErr);
      warnings.push(`Chunk ${chunkIdx + 1} parse failed: ${parseErrMsg} — using outline fallback`);
      chunkSlides = [];
      for (let i = chunkStart; i < chunkEnd; i++) {
        const os = outline.slides[i];
        chunkSlides.push({
          id: uuid(),
          index: i,
          title: os?.title || `Slide ${i + 1}`,
          bullets: [],
          notes: "",
          section: os?.section || "",
          imageUrls: [],
          imageSearchTerms: [os?.title, os?.section].filter(Boolean) as string[],
        });
      }
    }

    // Emit slides not already emitted via streaming (Gemini/Claude don't stream)
    if (options?.onSlidesPartial && chunkSlides.length > chunkEmittedCount) {
      options.onSlidesPartial(
        chunkSlides.slice(chunkEmittedCount).map((s) => ({
          title: s.title,
          section: s.section,
          imageSearchTerms: s.imageSearchTerms,
        })),
      );
    }

    allSlides.push(...chunkSlides);
  }

  // Re-index slides sequentially
  for (let i = 0; i < allSlides.length; i++) {
    allSlides[i].index = i;
  }

  return { title: outline.title, slides: allSlides, warnings };
}
