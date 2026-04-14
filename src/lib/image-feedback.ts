import { ImageSourceId } from "./types";
import { getUserState, setUserState } from "./state-store";
import { normalizeQuery, tokenize, type SlideContextLike } from "./image-selection";

export interface SearchFeedbackProfile {
  positiveUrls: Record<string, number>;
  negativeUrls: Record<string, number>;
  positiveSources: Partial<Record<ImageSourceId, number>>;
  negativeSources: Partial<Record<ImageSourceId, number>>;
  positiveTokens: Record<string, number>;
  negativeTokens: Record<string, number>;
}

interface StoredImageFeedback {
  version: 1;
  global: SearchFeedbackProfile;
  topics: Record<string, SearchFeedbackProfile>;
}

export interface ImageFeedbackEvent {
  action: "selected" | "rejected" | "restored";
  imageUrl: string;
  imageTitle?: string;
  imageSource?: ImageSourceId;
  presentationTopic?: string;
  slideContext?: Partial<SlideContextLike>;
  queryTerms?: string[];
}

function emptyProfile(): SearchFeedbackProfile {
  return {
    positiveUrls: {},
    negativeUrls: {},
    positiveSources: {},
    negativeSources: {},
    positiveTokens: {},
    negativeTokens: {},
  };
}

function normalizeTopicKey(presentationTopic?: string, slideContext?: Partial<SlideContextLike>): string {
  const topic = normalizeQuery(presentationTopic || "");
  const context = normalizeQuery([slideContext?.section || "", slideContext?.title || ""].filter(Boolean).join(" "));
  return [topic, context].filter(Boolean).join(" :: ").toLowerCase();
}

function readFeedbackState(): StoredImageFeedback {
  const state = getUserState() ?? {};
  const raw = state.imageFeedback as StoredImageFeedback | undefined;
  if (!raw || raw.version !== 1) {
    return {
      version: 1,
      global: emptyProfile(),
      topics: {},
    };
  }

  return {
    version: 1,
    global: { ...emptyProfile(), ...raw.global },
    topics: raw.topics ?? {},
  };
}

function writeFeedbackState(feedback: StoredImageFeedback): void {
  const state = getUserState() ?? {};
  setUserState({ ...state, imageFeedback: feedback });
}

function mergeProfiles(...profiles: Array<SearchFeedbackProfile | undefined>): SearchFeedbackProfile {
  const merged = emptyProfile();

  for (const profile of profiles) {
    if (!profile) continue;

    Object.entries(profile.positiveUrls ?? {}).forEach(([url, count]) => {
      merged.positiveUrls[url] = (merged.positiveUrls[url] ?? 0) + count;
    });
    Object.entries(profile.negativeUrls ?? {}).forEach(([url, count]) => {
      merged.negativeUrls[url] = (merged.negativeUrls[url] ?? 0) + count;
    });
    Object.entries(profile.positiveSources ?? {}).forEach(([source, count]) => {
      merged.positiveSources[source as ImageSourceId] = (merged.positiveSources[source as ImageSourceId] ?? 0) + (count ?? 0);
    });
    Object.entries(profile.negativeSources ?? {}).forEach(([source, count]) => {
      merged.negativeSources[source as ImageSourceId] = (merged.negativeSources[source as ImageSourceId] ?? 0) + (count ?? 0);
    });
    Object.entries(profile.positiveTokens ?? {}).forEach(([token, count]) => {
      merged.positiveTokens[token] = (merged.positiveTokens[token] ?? 0) + count;
    });
    Object.entries(profile.negativeTokens ?? {}).forEach(([token, count]) => {
      merged.negativeTokens[token] = (merged.negativeTokens[token] ?? 0) + count;
    });
  }

  return merged;
}

function increment(record: Record<string, number>, key: string, value: number): void {
  record[key] = (record[key] ?? 0) + value;
}

function applyEvent(profile: SearchFeedbackProfile, event: ImageFeedbackEvent): void {
  const positive = event.action === "selected" || event.action === "restored";
  const urlBucket = positive ? profile.positiveUrls : profile.negativeUrls;
  increment(urlBucket, event.imageUrl, positive ? 1 : 1);

  if (event.imageSource) {
    const sourceBucket = positive ? profile.positiveSources : profile.negativeSources;
    sourceBucket[event.imageSource] = (sourceBucket[event.imageSource] ?? 0) + 1;
  }

  const texts = [
    event.presentationTopic || "",
    event.slideContext?.title || "",
    event.slideContext?.section || "",
    ...(event.slideContext?.bullets ?? []),
    ...(event.queryTerms ?? []),
    event.imageTitle || "",
  ];

  const tokenBucket = positive ? profile.positiveTokens : profile.negativeTokens;
  tokenize(texts.join(" ")).forEach((token) => increment(tokenBucket, token, 1));
}

export function getImageFeedbackProfile(
  presentationTopic?: string,
  slideContext?: Partial<SlideContextLike>,
): SearchFeedbackProfile {
  const feedback = readFeedbackState();
  const topicKey = normalizeTopicKey(presentationTopic, slideContext);
  const topicProfile = topicKey ? feedback.topics[topicKey] : undefined;
  if (topicProfile) return mergeProfiles(topicProfile);
  return mergeProfiles(feedback.global);
}

export function recordImageFeedback(event: ImageFeedbackEvent): void {
  const feedback = readFeedbackState();
  applyEvent(feedback.global, event);

  const topicKey = normalizeTopicKey(event.presentationTopic, event.slideContext);
  if (topicKey) {
    if (!feedback.topics[topicKey]) feedback.topics[topicKey] = emptyProfile();
    applyEvent(feedback.topics[topicKey], event);
  }

  writeFeedbackState(feedback);
}

export function __resetImageFeedbackForTests(): void {
  const state = getUserState() ?? {};
  const { imageFeedback, ...rest } = state;
  void imageFeedback;
  setUserState(rest);
}