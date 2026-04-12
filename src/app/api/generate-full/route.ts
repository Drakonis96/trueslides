import { NextRequest, NextResponse } from "next/server";
import { AIProvider, ImageLayout, ImageVerificationConfig, LayoutMode, ImageSearchSpeedOptions, ImageSourceId, OutputLanguage, SlideLayoutId, SLIDE_LAYOUTS } from "@/lib/types";
import { PromptFieldKey } from "@/lib/types";
import { getApiKey, getImageSourceKey } from "@/lib/key-store";
import { getImageFeedbackProfile } from "@/lib/image-feedback";
import { getSessionId } from "@/lib/session";
import { createJob, getJob, updateJobProgress, updateJobDisplay, updateJobPartialSlides, completeJob, failJob } from "@/lib/job-manager";
import type { PartialSlideInfo } from "@/lib/job-manager";
import { generateSlides } from "@/lib/generate-slides";
import { searchSlideImages } from "@/app/api/images/route";
import { sanitizeErrorMessage } from "@/lib/ai-client";

export const maxDuration = 600; // 10 minutes — large presentations use chunked generation

interface GenerateFullRequest {
  jobId: string;
  provider: AIProvider;
  modelId: string;
  slideCount: number;
  textDensity: number;
  outputLanguage?: OutputLanguage;
  prompts: Record<PromptFieldKey, string>;
  sourceText: string;
  // Image config
  imageLayout: ImageLayout;
  layoutMode?: LayoutMode;
  slideLayout: SlideLayoutId;
  enabledSources?: ImageSourceId[];
  slideAccentColor?: string;
  speedOptions?: ImageSearchSpeedOptions;
  imageVerification?: ImageVerificationConfig;
}

function buildImageQueryCandidates(slide: { title: string; section?: string; imageSearchTerms?: string[] }): string[] {
  const aiTerms = (slide.imageSearchTerms ?? []).filter((t) => t?.trim());
  const contextTerms = [slide.title || "", slide.section || ""].filter(Boolean);
  return [...aiTerms, ...contextTerms].filter(Boolean).slice(0, 4);
}

function extractTopicQueries(sourceText: string, outputLanguage?: OutputLanguage): string[] {
  const text = sourceText.toLowerCase();
  const words = text
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 4);

  const stopWords = new Set([
    "this", "that", "with", "from", "have", "were", "they", "about", "into", "between", "through",
    "para", "como", "esta", "este", "desde", "entre", "sobre", "tambien", "cuando", "donde",
  ]);
  const counts = new Map<string, number>();

  for (const w of words) {
    if (stopWords.has(w)) continue;
    counts.set(w, (counts.get(w) ?? 0) + 1);
  }

  const ranked = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([w]) => w);

  if (ranked.length === 0) {
    return outputLanguage === "es" ? ["historia", "fotografia"] : ["history", "photography"];
  }

  return ranked;
}

/**
 * Runs the full generation pipeline in the background.
 * Calls AI and image search directly — no internal HTTP calls.
 */
async function runPresentationJob(
  jobId: string,
  sessionId: string,
  body: GenerateFullRequest,
) {
  try {
    const job = getJob(jobId, sessionId);

    const enabledSources = new Set<ImageSourceId>(
      body.enabledSources || ["wikimedia"]
    );

    // Resolve image source API keys as early as possible so we can prefetch while AI runs.
    const sourceKeys: Partial<Record<ImageSourceId, string>> = {};
    for (const src of enabledSources) {
      if (src === "wikimedia" || src === "openverse" || src === "loc") continue;
      const key = getImageSourceKey(sessionId, src);
      if (key) sourceKeys[src] = key;
    }

    // Get API key for the AI provider
    const apiKey = getApiKey(sessionId, body.provider);
    if (!apiKey) {
      failJob(jobId, "API key not found for provider");
      return;
    }

    const aiConfig = {
      provider: body.provider,
      modelId: body.modelId,
      apiKey,
    };

    // Resolve AI visual verification config
    let verificationConfig: { descriptorProvider: AIProvider; descriptorModelId: string; descriptorApiKey: string; orchestratorProvider: AIProvider; orchestratorModelId: string; orchestratorApiKey: string } | undefined;
    if (body.imageVerification?.enabled && body.imageVerification.descriptorModelId) {
      try {
        const descriptorKey = getApiKey(sessionId, body.imageVerification.descriptorProvider);
        if (descriptorKey) {
          verificationConfig = {
            descriptorProvider: body.imageVerification.descriptorProvider,
            descriptorModelId: body.imageVerification.descriptorModelId,
            descriptorApiKey: descriptorKey,
            orchestratorProvider: body.provider,
            orchestratorModelId: body.modelId,
            orchestratorApiKey: apiKey,
          };
        }
      } catch {
        /* verification skipped if descriptor key unavailable */
      }
    }

    const requestedSlides = body.slideCount;
    const useChunked = requestedSlides > 15;

    const providerLabel = body.provider === "openrouter" ? "OpenRouter" : body.provider === "openai" ? "OpenAI" : body.provider === "gemini" ? "Gemini" : body.provider === "claude" ? "Claude" : body.provider;
    const initialMsg = useChunked
      ? `Planning ${requestedSlides}-slide presentation structure via ${providerLabel}...`
      : `Calling ${providerLabel} to generate ${requestedSlides} slides...`;
    updateJobProgress(jobId, 5, initialMsg);
    console.log(`[generate-full] Job ${jobId}: starting AI generation (${requestedSlides} slides, ${useChunked ? 'chunked' : 'single-call'} mode, provider=${body.provider}/${body.modelId})`);

    // ── Step 1: Generate slides directly via AI (no HTTP) ──
    let aiSlidesGenerated = 0;

    // ── Concurrent image search infrastructure ──
    // Scale concurrency based on presentation size
    const maxConcurrentSearches = requestedSlides <= 10 ? 5 : requestedSlides <= 30 ? 8 : 12;
    let activeSearches = 0;
    const searchQueue: Array<() => void> = [];
    const imageResultMap = new Map<number, Promise<{ urls: string[]; sources: string[] }>>();
    const liveSlides: PartialSlideInfo[] = [];
    let aiComplete = false;
    let imagesCompleted = 0;
    let maxProgressSeen = 0; // Track max progress to prevent bouncing backwards

    const acquireSlot = (): Promise<void> => {
      if (activeSearches < maxConcurrentSearches) {
        activeSearches++;
        return Promise.resolve();
      }
      return new Promise<void>((resolve) => searchQueue.push(resolve));
    };

    const releaseSlot = () => {
      activeSearches--;
      const next = searchQueue.shift();
      if (next) {
        activeSearches++;
        next();
      }
    };

    // Determine max images for a slide based on layout
    const getMaxImages = (slideLayout?: string) => {
      const effectiveLayoutId =
        body.layoutMode === "smart" && slideLayout
          ? slideLayout
          : body.slideLayout;
      const layoutDef = SLIDE_LAYOUTS.find((l) => l.id === effectiveLayoutId);
      return layoutDef
        ? layoutDef.imageCount
        : body.imageLayout === "full" ? 1
        : body.imageLayout === "two" ? 2
        : body.imageLayout === "three" ? 3
        : 4;
    };

    // Start a full image search for a single slide with concurrency limiting
    const startSlideImageSearch = (
      slideIdx: number,
      slide: { title?: string; section?: string; bullets?: string[]; imageSearchTerms?: string[]; slideLayout?: string },
      presentationTitle?: string,
    ) => {
      if (imageResultMap.has(slideIdx)) return; // Already started

      const promise = (async () => {
        await acquireSlot();
        try {
          // Check cancellation
          if (job?.abortController.signal.aborted) return [];

          const queries = buildImageQueryCandidates({
            title: slide.title || "",
            section: slide.section || "",
            imageSearchTerms: slide.imageSearchTerms,
          });
          if (!queries.length) return [];

          const images = await searchSlideImages(
            queries,
            presentationTitle,
            { title: slide.title || "", bullets: slide.bullets || [], section: slide.section || "" },
            8,
            enabledSources,
            sourceKeys,
            aiConfig,
            body.speedOptions,
            getImageFeedbackProfile(sessionId, presentationTitle || "", {
              title: slide.title || "",
              bullets: slide.bullets || [],
              section: slide.section || "",
            }),
            verificationConfig,
          );

          const maxImgs = getMaxImages(slide.slideLayout);
          const selected = images.slice(0, maxImgs);
          const urls = selected.map((img) => img.url);
          const sources = selected.map((img) => img.source || "");

          // Update live preview
          if (liveSlides[slideIdx]) {
            liveSlides[slideIdx] = { ...liveSlides[slideIdx], imageUrls: urls };
            updateJobPartialSlides(jobId, [...liveSlides]);
          }

          return { urls, sources };
        } catch {
          return { urls: [], sources: [] };
        } finally {
          releaseSlot();
          imagesCompleted++;
          // Only show image progress after AI is done (avoid overwriting AI progress)
          if (aiComplete) {
            const totalSlides = imageResultMap.size;
            const pct = 50 + Math.round((imagesCompleted / totalSlides) * 40);
            updateJobProgress(jobId, Math.min(pct, 89), `Images: ${imagesCompleted}/${totalSlides}`);
          }
        }
      })();

      imageResultMap.set(slideIdx, promise);
    };

    // Warm query/source cache while AI is generating.
    const topicQueries = extractTopicQueries(body.sourceText, body.outputLanguage);
    searchSlideImages(
      topicQueries,
      undefined,
      undefined,
      8,
      enabledSources,
      sourceKeys,
      undefined,
      body.speedOptions,
    ).catch(() => []);

    console.log(`[generate-full] Job ${jobId}: calling AI directly...`);
    let genResult;
    // Heartbeat: updates UI display only (no log entries) so the user sees elapsed time
    const heartbeatStart = Date.now();
    const heartbeatTimer = setInterval(() => {
      const job = getJob(jobId, sessionId);
      if (!job || job.status !== "running") return;
      const elapsed = Math.round((Date.now() - heartbeatStart) / 1000);
      const mins = Math.floor(elapsed / 60);
      const secs = elapsed % 60;
      const timeStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
      // Strip any previous time suffix, append fresh one
      const baseMsg = job.progress.message.replace(/\s*\(\d+m?\s*\d*s?\)$/, "");
      updateJobDisplay(jobId, job.progress.percent, `${baseMsg} (${timeStr})`);
    }, 4_000);
    try {
      genResult = await generateSlides(apiKey, {
        provider: body.provider,
        modelId: body.modelId,
        slideCount: body.slideCount,
        textDensity: body.textDensity,
        outputLanguage: body.outputLanguage,
        layoutMode: body.layoutMode,
        prompts: body.prompts,
        sourceText: body.sourceText,
      }, {
        onChunkProgress: (chunkIdx, totalChunks, message) => {
          let pct: number;
          if (totalChunks === 0) {
            // Outline phase
            pct = 8;
          } else {
            // Chunk phase: 10 → 45 over all chunks
            pct = 10 + Math.round((chunkIdx / totalChunks) * 35);
          }
          console.log(`[generate-full] Job ${jobId}: chunk ${chunkIdx}/${totalChunks} — ${message}`);
          updateJobProgress(jobId, pct, message);
        },
        // Streamed partial slides: update progress + start full image search immediately.
        onSlidesPartial: (partialSlides) => {
          for (const s of partialSlides) {
            const slideIdx = aiSlidesGenerated;
            aiSlidesGenerated++;
            const slideTitle = s.title || `Slide ${aiSlidesGenerated}`;
            const pct = Math.min(49, 5 + Math.round((aiSlidesGenerated / requestedSlides) * 44));
            // When a new slide is confirmed, update max progress from the log-based progress
            if (pct > maxProgressSeen) maxProgressSeen = pct;
            const msg = `Generated slide ${aiSlidesGenerated}/${requestedSlides}: "${slideTitle}"`;
            console.log(`[generate-full] Job ${jobId}: ${msg}`);
            updateJobProgress(jobId, pct, msg);

            liveSlides[slideIdx] = {
              title: s.title || "",
              bullets: Array.isArray(s.bullets) ? s.bullets : [],
              notes: s.notes || "",
              section: s.section,
              imageUrls: [],
            };

            // Start full image search immediately (overlapped with AI generation)
            startSlideImageSearch(slideIdx, s);
          }
          updateJobPartialSlides(jobId, [...liveSlides]);
        },
        // Stream-level activity: shows "receiving data" before any full slide is parsed
        onStreamActivity: (bytesReceived, slidesFoundSoFar) => {
          // Only update display (no log entry) — real progress logs come from onSlidesPartial
          if (slidesFoundSoFar <= aiSlidesGenerated) {
            const kb = (bytesReceived / 1024).toFixed(1);
            const calculatedPct = Math.min(49, 5 + Math.round((bytesReceived / (requestedSlides * 1500)) * 20));
            // Enforce monotonic progress: never go backwards
            const pct = Math.max(Math.max(calculatedPct, 6), maxProgressSeen);
            if (pct > maxProgressSeen) maxProgressSeen = pct;
            updateJobDisplay(jobId, pct, `Receiving AI response... ${kb} KB received`);
          }
        },
      });
    } catch (err) {
      clearInterval(heartbeatTimer);
      throw err;
    }
    clearInterval(heartbeatTimer);

    if (!genResult.slides?.length) {
      console.error(`[generate-full] Job ${jobId}: AI returned no slides`);
      failJob(jobId, "AI returned no slides");
      return;
    }

    // Mark AI phase complete — image progress updates can now show in the progress bar
    aiComplete = true;

    // ── Step 2: Start image search for any slides not already started during streaming ──
    const totalSlides = genResult.slides.length;
    for (let i = 0; i < totalSlides; i++) {
      const s = genResult.slides[i];
      // Update liveSlides with complete data from final parse
      liveSlides[i] = {
        title: s.title,
        bullets: s.bullets,
        notes: s.notes,
        section: s.section,
        imageUrls: liveSlides[i]?.imageUrls || [],
      };
      // Start search for slides that weren't emitted via streaming
      if (!imageResultMap.has(i)) {
        startSlideImageSearch(i, s, genResult.title);
      }
    }
    updateJobPartialSlides(jobId, [...liveSlides]);

    const alreadyDone = imagesCompleted;
    console.log(`[generate-full] Job ${jobId}: AI returned ${totalSlides} slides. ${alreadyDone}/${totalSlides} images already fetched during AI streaming.`);
    updateJobProgress(jobId, 50 + Math.round((alreadyDone / totalSlides) * 40), `Waiting for remaining images (${alreadyDone}/${totalSlides} done)...`);

    // Wait for all image searches to complete
    const imageResults: { urls: string[]; sources: string[] }[] = [];
    for (let i = 0; i < totalSlides; i++) {
      const promise = imageResultMap.get(i);
      imageResults.push(promise ? await promise : { urls: [], sources: [] });
    }

    updateJobProgress(jobId, 90, "Assembling final presentation...");
    console.log(`[generate-full] Job ${jobId}: assembling ${genResult.slides.length} slides with images...`);

    // ── Step 3: Assemble final presentation ──
    const layoutMode = body.layoutMode ?? "fixed";
    const slides = genResult.slides.map((s, i) => ({
      id: s.id,
      index: i,
      title: s.title,
      bullets: s.bullets,
      notes: s.notes,
      section: s.section,
      imageUrls: imageResults[i]?.urls || [],
      imageSources: imageResults[i]?.sources || [],
      accentColor: body.slideAccentColor || "B30333",
      imageSearchTerms: s.imageSearchTerms,
      // In smart mode, use per-slide layout; in fixed mode, all use the same layout
      slideLayout: layoutMode === "smart" && s.slideLayout ? s.slideLayout : body.slideLayout,
    }));

    const result = { title: genResult.title, slides };
    console.log(`[generate-full] Job ${jobId}: completed with ${slides.length} slides`);
    completeJob(jobId, result, genResult.title);
  } catch (err: unknown) {
    console.error(`[generate-full] Job ${jobId}: UNCAUGHT ERROR:`, err);
    const message = err instanceof Error ? err.message : "Failed to generate presentation";
    failJob(jobId, sanitizeErrorMessage(message));
  }
}

export async function POST(req: NextRequest) {
  try {
    const body: GenerateFullRequest = await req.json();
    const sessionId = await getSessionId();

    if (!body.jobId) {
      return NextResponse.json({ error: "jobId is required" }, { status: 400 });
    }

    // Create a tracked background job
    createJob(body.jobId, sessionId, "presentation");

    // Fire and forget — the generation runs in the background
    runPresentationJob(body.jobId, sessionId, body);

    return NextResponse.json({ jobId: body.jobId });
  } catch (err: unknown) {
    console.error("Generate-full error:", err);
    const message = err instanceof Error ? err.message : "Failed to generate presentation";
    return NextResponse.json({ error: sanitizeErrorMessage(message) }, { status: 500 });
  }
}
