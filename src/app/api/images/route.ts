import { NextRequest, NextResponse } from "next/server";
import { getApiKey, getImageSourceKey } from "@/lib/key-store";
import { getImageFeedbackProfile } from "@/lib/image-feedback";
import {
  searchSlideImages,
  type ImageCandidate,
  type ImageSearchAiConfig,
  type SlideContext,
  type VerificationConfig,
} from "@/lib/image-search";
import { rateLimiters } from "@/lib/rate-limit";
import { getSessionId } from "@/lib/session";
import { AIProvider, ImageSearchSpeedOptions, ImageSourceId } from "@/lib/types";

interface ImagesRouteRequest {
  searchTerms: string[][];
  presentationTopic?: string;
  slideContexts?: SlideContext[];
  exclude?: string[];
  aiConfig?: { provider: AIProvider; modelId: string };
  enabledSources?: ImageSourceId[];
  limit?: number;
  imageVerification?: {
    enabled: boolean;
    descriptorProvider: AIProvider;
    descriptorModelId: string;
  };
  speedOptions?: ImageSearchSpeedOptions;
}

export async function POST(req: NextRequest) {
  try {
    const sessionId = await getSessionId();

    const rl = rateLimiters.image.check(sessionId);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Too many image search requests. Please wait before trying again." },
        { status: 429, headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) } },
      );
    }

    const body = await req.json() as ImagesRouteRequest;
    const {
      searchTerms,
      presentationTopic,
      slideContexts,
      exclude,
      aiConfig: aiConfigInput,
      enabledSources: enabledSourcesInput,
      limit: limitInput,
      imageVerification: imageVerificationInput,
      speedOptions: speedOptionsInput,
    } = body;

    if (!Array.isArray(searchTerms)) {
      return NextResponse.json(
        { error: "searchTerms must be an array of string arrays" },
        { status: 400 },
      );
    }

    const MAX_SEARCH_TERM_GROUPS = 50;
    const MAX_TERMS_PER_GROUP = 10;
    const MAX_QUERY_LENGTH = 200;
    const MAX_EXCLUDE = 200;

    if (searchTerms.length > MAX_SEARCH_TERM_GROUPS) {
      return NextResponse.json(
        { error: `Too many search term groups (max ${MAX_SEARCH_TERM_GROUPS})` },
        { status: 400 },
      );
    }

    const sanitizedSearchTerms = searchTerms.map((group) => {
      if (!Array.isArray(group)) return [];
      return group
        .slice(0, MAX_TERMS_PER_GROUP)
        .map((term) =>
          typeof term === "string"
            ? term.replace(/[\x00-\x1f\x7f]/g, "").trim().slice(0, MAX_QUERY_LENGTH)
            : "",
        )
        .filter((term) => term.length > 0);
    });

    const sanitizedTopic = typeof presentationTopic === "string"
      ? presentationTopic.replace(/[\x00-\x1f\x7f]/g, "").trim().slice(0, MAX_QUERY_LENGTH)
      : undefined;

    const excludeSet = new Set((exclude ?? []).slice(0, MAX_EXCLUDE));
    const effectiveLimit = Math.min(Math.max(limitInput ?? 8, 1), 30);
    const searchDepthLimit = Math.min(
      80,
      Math.max(effectiveLimit, effectiveLimit + excludeSet.size + 8),
    );
    const enabledSources = new Set<ImageSourceId>(
      enabledSourcesInput ?? ["wikimedia", "openverse", "loc"],
    );

    const sourceKeys: Partial<Record<ImageSourceId, string>> = {};
    try {
      for (const source of enabledSources) {
        if (source === "wikimedia" || source === "openverse" || source === "loc") continue;
        const key = getImageSourceKey(source);
        if (key) sourceKeys[source] = key;
      }
    } catch {
      /* keys unavailable — sources without keys will be skipped */
    }

    let aiConfig: ImageSearchAiConfig | undefined;
    if (aiConfigInput?.provider && aiConfigInput?.modelId) {
      try {
        const key = getApiKey(aiConfigInput.provider);
        if (key) aiConfig = { ...aiConfigInput, apiKey: key };
      } catch {
        /* AI selection skipped if key unavailable */
      }
    }

    let resolvedVerification: VerificationConfig | undefined;
    if (
      imageVerificationInput?.enabled &&
      imageVerificationInput.descriptorProvider &&
      imageVerificationInput.descriptorModelId &&
      aiConfigInput?.provider &&
      aiConfigInput?.modelId
    ) {
      try {
        const descriptorKey = getApiKey(imageVerificationInput.descriptorProvider);
        const orchestratorKey = aiConfig?.apiKey ?? getApiKey(aiConfigInput.provider);
        if (descriptorKey && orchestratorKey) {
          resolvedVerification = {
            descriptorProvider: imageVerificationInput.descriptorProvider,
            descriptorModelId: imageVerificationInput.descriptorModelId,
            descriptorApiKey: descriptorKey,
            orchestratorProvider: aiConfigInput.provider,
            orchestratorModelId: aiConfigInput.modelId,
            orchestratorApiKey: orchestratorKey,
          };
        }
      } catch {
        /* verification skipped if keys unavailable */
      }
    }

    const results: ImageCandidate[][] = [];
    const batchSize = 5;

    for (let index = 0; index < sanitizedSearchTerms.length; index += batchSize) {
      const batch = sanitizedSearchTerms.slice(index, index + batchSize);
      const batchResults = await Promise.all(
        batch.map(async (queries, batchIndex) => {
          const slideIndex = index + batchIndex;
          if (!queries || queries.length === 0) return [];

          const slideContext = slideContexts?.[slideIndex];
          const feedbackProfile = getImageFeedbackProfile(sanitizedTopic, slideContext);
          const images = await searchSlideImages(
            queries,
            sanitizedTopic,
            slideContext,
            searchDepthLimit,
            enabledSources,
            sourceKeys,
            aiConfig,
            speedOptionsInput,
            feedbackProfile,
            resolvedVerification,
          );
          const fresh = images.filter(
            (image) => !excludeSet.has(image.url) && !excludeSet.has(image.thumbUrl),
          );
          return fresh.slice(0, effectiveLimit);
        }),
      );
      results.push(...batchResults);
    }

    return NextResponse.json({ images: results });
  } catch (err: unknown) {
    console.error("Image search error:", err);
    return NextResponse.json(
      { error: "Failed to fetch images" },
      { status: 500 },
    );
  }
}