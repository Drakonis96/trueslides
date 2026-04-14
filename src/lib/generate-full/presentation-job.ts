import { searchSlideImages } from "@/lib/image-search";
import { sanitizeErrorMessage } from "@/lib/ai-client";
import { generateSlides } from "@/lib/generate-slides";
import { getImageFeedbackProfile } from "@/lib/image-feedback";
import {
  completeJob,
  failJob,
  getJob,
  updateJobDisplay,
  updateJobPartialSlides,
  updateJobProgress,
} from "@/lib/job-manager";
import type { PartialSlideInfo } from "@/lib/job-manager";
import { getApiKey, getImageSourceKey } from "@/lib/key-store";
import { ImageSourceId } from "@/lib/types";
import {
  buildImageQueryCandidates,
  extractTopicQueries,
  getMaxImagesForSlide,
  resolveSlideLayout,
} from "@/lib/generate-full/image-helpers";
import {
  GenerateFullRequest,
  ResolvedAiConfig,
  ResolvedVerificationConfig,
} from "@/lib/generate-full/types";

function resolveVerificationConfig(
  body: GenerateFullRequest,
  aiConfig: ResolvedAiConfig,
): ResolvedVerificationConfig | undefined {
  if (!body.imageVerification?.enabled || !body.imageVerification.descriptorModelId) {
    return undefined;
  }

  try {
    const descriptorApiKey = getApiKey(body.imageVerification.descriptorProvider);
    if (!descriptorApiKey) {
      return undefined;
    }

    return {
      descriptorProvider: body.imageVerification.descriptorProvider,
      descriptorModelId: body.imageVerification.descriptorModelId,
      descriptorApiKey,
      orchestratorProvider: aiConfig.provider,
      orchestratorModelId: aiConfig.modelId,
      orchestratorApiKey: aiConfig.apiKey,
    };
  } catch {
    return undefined;
  }
}

export async function runPresentationJob(
  jobId: string,
  body: GenerateFullRequest,
) {
  try {
    const job = getJob(jobId);
    const enabledSources = new Set<ImageSourceId>(body.enabledSources || ["wikimedia"]);

    const sourceKeys: Partial<Record<ImageSourceId, string>> = {};
    for (const source of enabledSources) {
      if (source === "wikimedia" || source === "openverse" || source === "loc") continue;
      const key = getImageSourceKey(source);
      if (key) sourceKeys[source] = key;
    }

    const apiKey = getApiKey(body.provider);
    if (!apiKey) {
      failJob(jobId, "API key not found for provider");
      return;
    }

    const aiConfig: ResolvedAiConfig = {
      provider: body.provider,
      modelId: body.modelId,
      apiKey,
    };
    const verificationConfig = resolveVerificationConfig(body, aiConfig);

    const requestedSlides = body.slideCount;
    const useChunked = requestedSlides > 15;
    const providerLabel = body.provider === "openrouter"
      ? "OpenRouter"
      : body.provider === "openai"
        ? "OpenAI"
        : body.provider === "gemini"
          ? "Gemini"
          : body.provider === "claude"
            ? "Claude"
            : body.provider;
    const initialMessage = useChunked
      ? `Planning ${requestedSlides}-slide presentation structure via ${providerLabel}...`
      : `Calling ${providerLabel} to generate ${requestedSlides} slides...`;

    updateJobProgress(jobId, 5, initialMessage);
    console.log(
      `[generate-full] Job ${jobId}: starting AI generation (${requestedSlides} slides, ${useChunked ? "chunked" : "single-call"} mode, provider=${body.provider}/${body.modelId})`,
    );

    let aiSlidesGenerated = 0;
    const maxConcurrentSearches = requestedSlides <= 10 ? 5 : requestedSlides <= 30 ? 8 : 12;
    let activeSearches = 0;
    const searchQueue: Array<() => void> = [];
    const imageResultMap = new Map<number, Promise<{ urls: string[]; sources: string[] }>>();
    const liveSlides: PartialSlideInfo[] = [];
    let aiComplete = false;
    let imagesCompleted = 0;
    let maxProgressSeen = 0;

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

    const startSlideImageSearch = (
      slideIndex: number,
      slide: { title?: string; section?: string; bullets?: string[]; imageSearchTerms?: string[]; slideLayout?: string },
      presentationTitle?: string,
    ) => {
      if (imageResultMap.has(slideIndex)) return;

      const promise = (async (): Promise<{ urls: string[]; sources: string[] }> => {
        await acquireSlot();

        try {
          if (job?.abortController.signal.aborted) {
            return { urls: [], sources: [] };
          }

          const queries = buildImageQueryCandidates({
            title: slide.title || "",
            section: slide.section || "",
            imageSearchTerms: slide.imageSearchTerms,
          });
          if (!queries.length) {
            return { urls: [], sources: [] };
          }

          const images = await searchSlideImages(
            queries,
            presentationTitle,
            { title: slide.title || "", bullets: slide.bullets || [], section: slide.section || "" },
            8,
            enabledSources,
            sourceKeys,
            aiConfig,
            body.speedOptions,
            getImageFeedbackProfile(presentationTitle || "", {
              title: slide.title || "",
              bullets: slide.bullets || [],
              section: slide.section || "",
            }),
            verificationConfig,
          );

          const selectedImages = images.slice(0, getMaxImagesForSlide({
            requestedLayoutMode: body.layoutMode,
            requestedSlideLayout: body.slideLayout,
            requestedImageLayout: body.imageLayout,
            generatedSlideLayout: slide.slideLayout,
          }));
          const urls = selectedImages.map((image) => image.url);
          const sources = selectedImages.map((image) => image.source || "");

          if (liveSlides[slideIndex]) {
            liveSlides[slideIndex] = { ...liveSlides[slideIndex], imageUrls: urls };
            updateJobPartialSlides(jobId, [...liveSlides]);
          }

          return { urls, sources };
        } catch {
          return { urls: [], sources: [] };
        } finally {
          releaseSlot();
          imagesCompleted++;

          if (aiComplete) {
            const totalSlides = imageResultMap.size;
            const progress = 50 + Math.round((imagesCompleted / totalSlides) * 40);
            updateJobProgress(jobId, Math.min(progress, 89), `Images: ${imagesCompleted}/${totalSlides}`);
          }
        }
      })();

      imageResultMap.set(slideIndex, promise);
    };

    const topicQueries = extractTopicQueries(body.sourceText, body.outputLanguage);
    void searchSlideImages(
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

    let generationResult;
    const heartbeatStart = Date.now();
    const heartbeatTimer = setInterval(() => {
      const activeJob = getJob(jobId);
      if (!activeJob || activeJob.status !== "running") return;

      const elapsedSeconds = Math.round((Date.now() - heartbeatStart) / 1000);
      const minutes = Math.floor(elapsedSeconds / 60);
      const seconds = elapsedSeconds % 60;
      const timeLabel = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
      const baseMessage = activeJob.progress.message.replace(/\s*\(\d+m?\s*\d*s?\)$/, "");
      updateJobDisplay(jobId, activeJob.progress.percent, `${baseMessage} (${timeLabel})`);
    }, 4_000);

    try {
      generationResult = await generateSlides(
        apiKey,
        {
          provider: body.provider,
          modelId: body.modelId,
          slideCount: body.slideCount,
          textDensity: body.textDensity,
          outputLanguage: body.outputLanguage,
          layoutMode: body.layoutMode,
          prompts: body.prompts,
          sourceText: body.sourceText,
        },
        {
          onChunkProgress: (chunkIndex, totalChunks, message) => {
            const progress = totalChunks === 0
              ? 8
              : 10 + Math.round((chunkIndex / totalChunks) * 35);
            console.log(`[generate-full] Job ${jobId}: chunk ${chunkIndex}/${totalChunks} — ${message}`);
            updateJobProgress(jobId, progress, message);
          },
          onSlidesPartial: (partialSlides) => {
            for (const partialSlide of partialSlides) {
              const slideIndex = aiSlidesGenerated;
              aiSlidesGenerated++;
              const slideTitle = partialSlide.title || `Slide ${aiSlidesGenerated}`;
              const progress = Math.min(49, 5 + Math.round((aiSlidesGenerated / requestedSlides) * 44));

              if (progress > maxProgressSeen) {
                maxProgressSeen = progress;
              }

              const message = `Generated slide ${aiSlidesGenerated}/${requestedSlides}: "${slideTitle}"`;
              console.log(`[generate-full] Job ${jobId}: ${message}`);
              updateJobProgress(jobId, progress, message);

              liveSlides[slideIndex] = {
                title: partialSlide.title || "",
                bullets: Array.isArray(partialSlide.bullets) ? partialSlide.bullets : [],
                notes: partialSlide.notes || "",
                section: partialSlide.section,
                imageUrls: [],
              };

              startSlideImageSearch(slideIndex, partialSlide);
            }

            updateJobPartialSlides(jobId, [...liveSlides]);
          },
          onStreamActivity: (bytesReceived, slidesFoundSoFar) => {
            if (slidesFoundSoFar > aiSlidesGenerated) {
              return;
            }

            const kilobytes = (bytesReceived / 1024).toFixed(1);
            const calculatedProgress = Math.min(49, 5 + Math.round((bytesReceived / (requestedSlides * 1500)) * 20));
            const progress = Math.max(Math.max(calculatedProgress, 6), maxProgressSeen);

            if (progress > maxProgressSeen) {
              maxProgressSeen = progress;
            }

            updateJobDisplay(jobId, progress, `Receiving AI response... ${kilobytes} KB received`);
          },
        },
      );
    } catch (error) {
      clearInterval(heartbeatTimer);
      throw error;
    }

    clearInterval(heartbeatTimer);

    if (!generationResult.slides?.length) {
      console.error(`[generate-full] Job ${jobId}: AI returned no slides`);
      failJob(jobId, "AI returned no slides");
      return;
    }

    if (generationResult.warnings?.length) {
      for (const warning of generationResult.warnings) {
        console.warn(`[generate-full] Job ${jobId}: Warning: ${warning}`);
        const activeJob = getJob(jobId);
        updateJobProgress(jobId, activeJob?.progress.percent ?? 49, `Warning: ${warning}`);
      }
    }

    aiComplete = true;

    const totalSlides = generationResult.slides.length;
    for (let index = 0; index < totalSlides; index++) {
      const slide = generationResult.slides[index];
      liveSlides[index] = {
        title: slide.title,
        bullets: slide.bullets,
        notes: slide.notes,
        section: slide.section,
        imageUrls: liveSlides[index]?.imageUrls || [],
      };

      if (!imageResultMap.has(index)) {
        startSlideImageSearch(index, slide, generationResult.title);
      }
    }

    updateJobPartialSlides(jobId, [...liveSlides]);

    const completedImages = imagesCompleted;
    console.log(
      `[generate-full] Job ${jobId}: AI returned ${totalSlides} slides. ${completedImages}/${totalSlides} images already fetched during AI streaming.`,
    );
    updateJobProgress(
      jobId,
      50 + Math.round((completedImages / totalSlides) * 40),
      `Waiting for remaining images (${completedImages}/${totalSlides} done)...`,
    );

    const imageResults: Array<{ urls: string[]; sources: string[] }> = [];
    for (let index = 0; index < totalSlides; index++) {
      const result = imageResultMap.get(index);
      imageResults.push(result ? await result : { urls: [], sources: [] });
    }

    updateJobProgress(jobId, 90, "Assembling final presentation...");
    console.log(`[generate-full] Job ${jobId}: assembling ${generationResult.slides.length} slides with images...`);

    const slides = generationResult.slides.map((slide, index) => ({
      id: slide.id,
      index,
      title: slide.title,
      bullets: slide.bullets,
      notes: slide.notes,
      section: slide.section,
      imageUrls: imageResults[index]?.urls || [],
      imageSources: imageResults[index]?.sources || [],
      accentColor: body.slideAccentColor || "B30333",
      imageSearchTerms: slide.imageSearchTerms,
      slideLayout: resolveSlideLayout({
        requestedLayoutMode: body.layoutMode,
        requestedSlideLayout: body.slideLayout,
        generatedSlideLayout: slide.slideLayout,
      }),
    }));

    const result = { title: generationResult.title, slides };
    console.log(`[generate-full] Job ${jobId}: completed with ${slides.length} slides`);
    completeJob(jobId, result, generationResult.title);
  } catch (error: unknown) {
    console.error(`[generate-full] Job ${jobId}: UNCAUGHT ERROR:`, error);
    const message = error instanceof Error ? error.message : "Failed to generate presentation";
    failJob(jobId, sanitizeErrorMessage(message));
  }
}