import { NextRequest, NextResponse } from "next/server";
import { AIProvider, OutputLanguage, OUTPUT_LANGUAGE_NAMES } from "@/lib/types";
import { getApiKey } from "@/lib/key-store";
import { getSessionId } from "@/lib/session";
import { callAI, callAIVision, sanitizeErrorMessage } from "@/lib/ai-client";
import { createJob, updateJobProgress, completeJob, failJob } from "@/lib/job-manager";

export const maxDuration = 120;

interface SlideInput {
  index: number;
  texts: string[];
  presenterNotes?: string;
  imageBase64?: string; // first slide image for vision analysis
}

interface GenerateNotesRequest {
  jobId?: string;
  provider: AIProvider;
  modelId: string;
  outputLanguage?: OutputLanguage;
  notesPrompt: string;
  docText: string;
  docDensity?: number; // 0-100
  paragraphs?: number; // 1, 2, 3, or 0 for no constraint
  includeExistingNotes?: boolean;
  useVision?: boolean;
  slides: SlideInput[];
  // For single-slide regeneration
  targetSlideIndex?: number;
  customInstruction?: string;
  existingNote?: string;
}

function buildSystemPrompt(
  notesPrompt: string,
  outputLanguage: OutputLanguage,
  totalSlides: number,
  isSingleSlide: boolean,
  docDensity: number,
  paragraphs: number,
  includeExistingNotes: boolean,
  useVision: boolean,
  customInstruction?: string,
): string {
  const langName = OUTPUT_LANGUAGE_NAMES[outputLanguage];

  const baseInstruction = customInstruction
    ? `CUSTOM INSTRUCTION FROM USER:\n${customInstruction}\n\nBase notes style:\n${notesPrompt}`
    : notesPrompt;

  const promptLangNote = `(Follow these style instructions regardless of what language they are written in — always write ALL output in ${langName}.)`;

  const densityInstruction = docDensity === 0
    ? "Base the notes ONLY on what appears on each slide. Do NOT reference the source document."
    : docDensity <= 30
      ? `Use the source document sparingly — only reference it when it directly clarifies something on the slide. About ${docDensity}% of the notes content should draw from the document.`
      : docDensity <= 70
        ? `Balance slide content and source document. About ${docDensity}% of the notes should incorporate relevant information from the document, weaving it naturally with what the slide shows.`
        : `The notes should extensively cover the source document's content, distributing it across slides proportionally. About ${docDensity}% of the notes should draw from the document — use the slides as an outline but the document as the primary source of depth.`;

  const paragraphInstruction = paragraphs > 0
    ? `\n- Each note MUST have exactly ${paragraphs} paragraph${paragraphs > 1 ? "s" : ""}. Separate paragraphs with a blank line.`
    : "";

  const existingNotesInstruction = includeExistingNotes
    ? "\n- If the slide includes EXISTING PRESENTER NOTES, treat them as the speaker's intended talking points or outline. Use them as a guide for tone, focus, and structure — expand and improve on them rather than ignoring them."
    : "";

  const visionInstruction = useVision
    ? "\n- You will also receive an IMAGE of each slide. Analyze it visually — note charts, diagrams, images, layout, color cues, and anything the extracted text alone cannot capture. Reference visual elements in your notes when relevant (e.g. \"As the diagram on the right shows...\")."
    : "";

  if (isSingleSlide) {
    return `You are an expert presenter and presentation coach. You will receive structured data about a single slide (as JSON) and context from a source document.

Your task: Generate or regenerate the presenter notes for this ONE slide.

NOTES STYLE INSTRUCTIONS ${promptLangNote}:
${baseInstruction}

DOCUMENT COVERAGE: ${densityInstruction}

ANALYSIS INSTRUCTIONS:
- The slide data is provided as structured JSON with fields: slideNumber, texts, presenterNotes (if any).${existingNotesInstruction}${visionInstruction}${paragraphInstruction}
- Use the source document to provide deeper context, examples, and talking points.

CRITICAL: Write ALL notes in ${langName}.

Respond ONLY with a valid JSON object (no markdown, no code fences):
{
  "note": "The presenter note text here..."
}`;
  }

  return `You are an expert presenter and presentation coach. You will receive structured data about ${totalSlides} PowerPoint slides (as JSON) and a source document.

Your task: Generate detailed presenter notes for EACH slide that form a COHERENT, CONTINUOUS SPEECH.

NOTES STYLE INSTRUCTIONS ${promptLangNote}:
${baseInstruction}

DOCUMENT COVERAGE: ${densityInstruction}

ANALYSIS INSTRUCTIONS:
- Each slide is provided as structured JSON with fields: slideNumber, texts, presenterNotes (if any).${existingNotesInstruction}${visionInstruction}${paragraphInstruction}

COHERENCE REQUIREMENTS — THIS IS CRITICAL:
1. FIRST, mentally plan what information from the document belongs in each slide's notes. Distribute content logically — do not repeat the same points across slides.
2. Write the notes as a continuous speech: each slide's notes should naturally follow from the previous one. The presenter should be able to read them in sequence as a flowing discourse.
3. Use transitions between slides (e.g. "Building on what we just discussed...", "Now let's turn to...", "This connects to...").
4. Maintain consistent terminology, tone, and level of detail throughout all notes.
5. Avoid redundancy — if a concept was explained in slide N, reference it briefly in slide N+2 rather than re-explaining.

CRITICAL: Write ALL notes in ${langName}.

Respond ONLY with a valid JSON object (no markdown, no code fences):
{
  "notes": [
    "Note for slide 1...",
    "Note for slide 2...",
    ...
  ]
}

The "notes" array MUST have exactly ${totalSlides} entries, one per slide, in order.`;
}

function buildUserPrompt(
  docText: string,
  slides: SlideInput[],
  isSingleSlide: boolean,
  docDensity: number,
  includeExistingNotes: boolean,
  existingNote?: string,
): { cached: string; dynamic: string } {
  const DOC_CHAR_LIMIT = 120_000;
  const docTrimmed = docText.slice(0, DOC_CHAR_LIMIT);
  const cached = docDensity > 0 ? `SOURCE DOCUMENT:
${docTrimmed}` : "";

  if (isSingleSlide) {
    const slide = slides[0];
    const slideData: Record<string, unknown> = {
      slideNumber: slide.index + 1,
      texts: slide.texts,
    };
    if (includeExistingNotes && slide.presenterNotes) {
      slideData.existingPresenterNotes = slide.presenterNotes;
    }

    let dynamic = `SLIDE DATA:\n${JSON.stringify(slideData, null, 2)}`;
    if (existingNote) {
      dynamic += `\n\nCURRENT NOTE (to improve/regenerate):\n${existingNote}`;
    }
    return { cached, dynamic };
  }

  const slidesData = slides.map((s) => {
    const entry: Record<string, unknown> = {
      slideNumber: s.index + 1,
      texts: s.texts,
    };
    if (includeExistingNotes && s.presenterNotes) {
      entry.existingPresenterNotes = s.presenterNotes;
    }
    return entry;
  });

  const dynamic = `SLIDES DATA:\n${JSON.stringify(slidesData, null, 2)}`;

  return { cached, dynamic };
}

/**
 * Runs notes generation as a background job.
 */
async function runNotesJob(
  jobId: string,
  body: GenerateNotesRequest,
  apiKey: string,
) {
  try {
    updateJobProgress(jobId, 10, "Generating notes with AI...");

    const outputLanguage = body.outputLanguage ?? "en";
    const docDensity = body.docDensity ?? 70;
    const paragraphs = body.paragraphs ?? 2;
    const includeExistingNotes = body.includeExistingNotes ?? true;
    const useVision = body.useVision ?? false;
    const isSingleSlide = body.targetSlideIndex !== undefined;
    const targetSlides = isSingleSlide
      ? body.slides.filter((s) => s.index === body.targetSlideIndex)
      : body.slides;

    const systemPrompt = buildSystemPrompt(
      body.notesPrompt,
      outputLanguage,
      body.slides.length,
      isSingleSlide,
      docDensity,
      paragraphs,
      includeExistingNotes,
      useVision,
      body.customInstruction,
    );
    const { cached: cachedContext, dynamic: userPrompt } = buildUserPrompt(
      body.docText,
      targetSlides,
      isSingleSlide,
      docDensity,
      includeExistingNotes,
      body.existingNote,
    );

    updateJobProgress(jobId, 30, "Calling AI model...");

    let raw: string;
    const cacheOpts = cachedContext ? { cachedUserPrefix: cachedContext } : undefined;

    if (useVision) {
      // Collect slide images for vision call
      const imageDataUris: string[] = [];
      for (const slide of targetSlides) {
        if (slide.imageBase64) {
          imageDataUris.push(slide.imageBase64);
        }
      }

      if (imageDataUris.length > 0) {
        raw = await callAIVision(
          body.provider,
          body.modelId,
          apiKey,
          systemPrompt,
          userPrompt,
          imageDataUris,
          4000,
          cacheOpts,
        );
      } else {
        // Fallback to text-only if no images available
        raw = await callAI(
          body.provider,
          body.modelId,
          apiKey,
          systemPrompt,
          userPrompt,
          16000,
          cacheOpts,
        );
      }
    } else {
      raw = await callAI(
        body.provider,
        body.modelId,
        apiKey,
        systemPrompt,
        userPrompt,
        16000,
        cacheOpts,
      );
    }

    if (!raw.trim()) {
      failJob(jobId, "AI returned an empty response");
      return;
    }

    updateJobProgress(jobId, 80, "Processing response...");

    let jsonStr = raw;
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) jsonStr = jsonMatch[0];

    const parsed = JSON.parse(jsonStr);

    if (isSingleSlide) {
      completeJob(jobId, { note: parsed.note || "" });
      return;
    }

    if (!Array.isArray(parsed.notes)) {
      failJob(jobId, "AI response missing notes array");
      return;
    }

    completeJob(jobId, { notes: parsed.notes });
  } catch (err: unknown) {
    console.error("Notes job error:", err);
    const message = err instanceof Error ? err.message : "Failed to generate notes";
    failJob(jobId, sanitizeErrorMessage(message));
  }
}

export async function POST(req: NextRequest) {
  try {
    const body: GenerateNotesRequest = await req.json();

    const sessionId = await getSessionId();
    const apiKey = getApiKey(sessionId, body.provider);

    if (!apiKey) {
      return NextResponse.json(
        { error: "API key is required" },
        { status: 400 }
      );
    }

    // If jobId is provided, run as background job
    if (body.jobId) {
      const isSingleSlide = body.targetSlideIndex !== undefined;
      const targetSlides = isSingleSlide
        ? body.slides.filter((s) => s.index === body.targetSlideIndex)
        : body.slides;

      if (targetSlides.length === 0) {
        return NextResponse.json(
          { error: "No slides to process" },
          { status: 400 }
        );
      }

      createJob(body.jobId, sessionId, "notes");
      runNotesJob(body.jobId, body, apiKey);
      return NextResponse.json({ jobId: body.jobId });
    }

    // Synchronous mode (for single-slide regeneration)
    const outputLanguage = body.outputLanguage ?? "en";
    const docDensity = body.docDensity ?? 70;
    const paragraphs = body.paragraphs ?? 2;
    const includeExistingNotes = body.includeExistingNotes ?? true;
    const useVision = body.useVision ?? false;
    const isSingleSlide = body.targetSlideIndex !== undefined;

    const targetSlides = isSingleSlide
      ? body.slides.filter((s) => s.index === body.targetSlideIndex)
      : body.slides;

    if (targetSlides.length === 0) {
      return NextResponse.json(
        { error: "No slides to process" },
        { status: 400 }
      );
    }

    const systemPrompt = buildSystemPrompt(
      body.notesPrompt,
      outputLanguage,
      body.slides.length,
      isSingleSlide,
      docDensity,
      paragraphs,
      includeExistingNotes,
      useVision,
      body.customInstruction,
    );

    const { cached: cachedCtx, dynamic: syncUserPrompt } = buildUserPrompt(
      body.docText,
      targetSlides,
      isSingleSlide,
      docDensity,
      includeExistingNotes,
      body.existingNote,
    );

    let raw: string;
    const syncCacheOpts = cachedCtx ? { cachedUserPrefix: cachedCtx } : undefined;

    if (useVision) {
      const imageDataUris: string[] = [];
      for (const slide of targetSlides) {
        if (slide.imageBase64) {
          imageDataUris.push(slide.imageBase64);
        }
      }

      if (imageDataUris.length > 0) {
        raw = await callAIVision(
          body.provider,
          body.modelId,
          apiKey,
          systemPrompt,
          syncUserPrompt,
          imageDataUris,
          4000,
          syncCacheOpts,
        );
      } else {
        raw = await callAI(
          body.provider,
          body.modelId,
          apiKey,
          systemPrompt,
          syncUserPrompt,
          16000,
          syncCacheOpts,
        );
      }
    } else {
      raw = await callAI(
        body.provider,
        body.modelId,
        apiKey,
        systemPrompt,
        syncUserPrompt,
        16000,
        syncCacheOpts,
      );
    }

    if (!raw.trim()) {
      return NextResponse.json(
        { error: "AI returned an empty response" },
        { status: 502 }
      );
    }

    // Parse response
    let jsonStr = raw;
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) jsonStr = jsonMatch[0];

    const parsed = JSON.parse(jsonStr);

    if (isSingleSlide) {
      return NextResponse.json({ note: parsed.note || "" });
    }

    if (!Array.isArray(parsed.notes)) {
      return NextResponse.json(
        { error: "AI response missing notes array" },
        { status: 502 }
      );
    }

    return NextResponse.json({ notes: parsed.notes });
  } catch (err: unknown) {
    console.error("Generate notes error:", err);
    const message =
      err instanceof Error ? err.message : "Failed to generate notes";
    return NextResponse.json({ error: sanitizeErrorMessage(message) }, { status: 500 });
  }
}
