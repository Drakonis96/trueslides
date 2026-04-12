import { ImageSourceId } from "./types";
import type { SearchFeedbackProfile } from "./image-feedback";

export interface ImageCandidateLike {
  title: string;
  url: string;
  thumbUrl: string;
  width: number;
  height: number;
  source: ImageSourceId;
}

export interface SlideContextLike {
  title: string;
  bullets: string[];
  section: string;
}

export type VisualIntent =
  | "person"
  | "place"
  | "object"
  | "process"
  | "data"
  | "scientific"
  | "historical"
  | "abstract";

export interface SearchPlanQuery {
  query: string;
  weight: number;
  stage: "primary" | "entity" | "context" | "disambiguated" | "broadened" | "feedback" | "ai";
}

export interface SearchPlan {
  intent: VisualIntent;
  topic: string;
  queries: SearchPlanQuery[];
  anchorPhrases: string[];
  focusTokens: string[];
  ambiguousTokens: string[];
  sourcePriorities: Partial<Record<ImageSourceId, number>>;
}

export interface RankSignals {
  exactPhraseHits: number;
  entityHits: number;
  tokenCoverage: number;
  focusCoverage: number;
  qualityScore: number;
  sourceAffinity: number;
  feedbackBias: number;
  intentAffinity: number;
}

export interface RankedImageCandidate<T extends ImageCandidateLike> {
  image: T;
  score: number;
  signals: RankSignals;
}

const STOP_WORDS = new Set([
  "about", "after", "before", "from", "into", "slide", "slides",
  "their", "this", "with", "that", "have", "been", "were", "will",
  "what", "when", "where", "which", "these", "those", "them", "than",
  "then", "some", "such", "each", "other", "more", "most", "also",
  "para", "como", "esta", "este", "desde", "entre", "sobre", "tambien",
  "when", "using", "used", "use", "into", "through", "across", "presentation",
]);

const INTENT_KEYWORDS: Record<VisualIntent, string[]> = {
  person: ["founder", "leader", "president", "scientist", "artist", "inventor", "portrait", "biography", "person"],
  place: ["city", "country", "region", "landscape", "site", "monument", "temple", "museum", "campus", "island"],
  object: ["device", "camera", "machine", "artifact", "tool", "vehicle", "product", "instrument", "prototype"],
  process: ["process", "workflow", "timeline", "evolution", "pipeline", "lifecycle", "steps", "manufacturing", "production"],
  data: ["data", "market", "trend", "comparison", "statistics", "report", "analysis", "finance", "revenue", "metric"],
  scientific: ["cell", "dna", "genome", "protein", "species", "ecosystem", "laboratory", "microscope", "molecule", "experiment"],
  historical: ["history", "ancient", "century", "empire", "war", "revolution", "archival", "historic", "medieval", "victorian"],
  abstract: ["strategy", "innovation", "growth", "transformation", "vision", "culture", "concept", "framework"],
};

const INTENT_MODIFIERS: Record<Exclude<VisualIntent, "abstract">, string[]> = {
  person: ["portrait", "photo"],
  place: ["landmark", "landscape"],
  object: ["device", "artifact"],
  process: ["workshop", "production"],
  data: ["trading floor", "factory"],
  scientific: ["laboratory", "microscope"],
  historical: ["historical photo", "archive"],
};

const SOURCE_INTENT_PRIORITIES: Record<VisualIntent, Partial<Record<ImageSourceId, number>>> = {
  person: { wikimedia: 1.2, flickr: 0.9, loc: 0.7, europeana: 0.7, hispana: 0.7, unsplash: 0.3, pexels: 0.2 },
  place: { unsplash: 1.1, pexels: 1.1, wikimedia: 0.6, flickr: 0.4, openverse: 0.3 },
  object: { unsplash: 0.8, pexels: 0.8, wikimedia: 0.7, openverse: 0.5, flickr: 0.3 },
  process: { wikimedia: 0.8, loc: 0.5, openverse: 0.4, unsplash: 0.2, pexels: 0.2 },
  data: { wikimedia: 0.6, loc: 0.5, openverse: 0.3, unsplash: 0.1, pexels: 0.1 },
  scientific: { wikimedia: 1.1, openverse: 0.8, loc: 0.5, flickr: 0.4, unsplash: 0.2 },
  historical: { wikimedia: 1.4, loc: 1.3, europeana: 1.1, hispana: 1.1, flickr: 0.7, unsplash: -0.2, pexels: -0.2 },
  abstract: { unsplash: 0.4, pexels: 0.4, openverse: 0.2, wikimedia: -0.1 },
};

function dedupeStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const normalized = normalizeQuery(value);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
  }
  return out;
}

function buildCompactQuery(...parts: string[]): string {
  const words: string[] = [];
  const seen = new Set<string>();

  for (const part of parts) {
    const normalized = normalizeQuery(part);
    if (!normalized) continue;
    for (const word of normalized.split(/\s+/)) {
      const key = word.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      words.push(word);
      if (words.length >= 4) return words.join(" ");
    }
  }

  return words.join(" ");
}

export function normalizeQuery(query: string): string {
  return query.replace(/\s+/g, " ").trim();
}

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 2 && !STOP_WORDS.has(token));
}

function titleSimilarity(a: string, b: string): number {
  const aTokens = new Set(tokenize(a));
  const bTokens = new Set(tokenize(b));
  if (aTokens.size === 0 || bTokens.size === 0) return 0;

  let shared = 0;
  for (const token of aTokens) {
    if (bTokens.has(token)) shared++;
  }

  return shared / new Set([...aTokens, ...bTokens]).size;
}

function takeTopTokens(texts: string[], limit: number): string[] {
  const counts = new Map<string, number>();
  for (const text of texts) {
    for (const token of tokenize(text)) {
      counts.set(token, (counts.get(token) ?? 0) + 1);
    }
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([token]) => token);
}

export function extractEntityPhrases(values: string[]): string[] {
  const phrases: string[] = [];

  for (const value of values) {
    const normalized = normalizeQuery(value);
    if (!normalized) continue;

    if (normalized.split(" ").length >= 2) {
      phrases.push(normalized);
    }

    const matches = normalized.match(/\b(?:[A-Z][\p{L}\p{N}-]+(?:\s+[A-Z][\p{L}\p{N}-]+){0,3}|[A-Z]{2,}(?:\s+\d+)*)\b/gu);
    if (matches) phrases.push(...matches);
  }

  return dedupeStrings(phrases);
}

export function inferVisualIntent(
  queries: string[],
  presentationTopic?: string,
  slideContext?: SlideContextLike,
): VisualIntent {
  const texts = [presentationTopic || "", ...(queries || [])];
  if (slideContext) {
    texts.push(slideContext.title, slideContext.section, ...slideContext.bullets.slice(0, 4));
  }

  const lower = texts.join(" ").toLowerCase();
  const scores = new Map<VisualIntent, number>();

  (Object.keys(INTENT_KEYWORDS) as VisualIntent[]).forEach((intent) => {
    let score = 0;
    for (const keyword of INTENT_KEYWORDS[intent]) {
      if (lower.includes(keyword)) score += keyword.includes(" ") ? 2 : 1;
    }
    scores.set(intent, score);
  });

  const primaryQuery = normalizeQuery(queries[0] || "");
  const title = slideContext?.title || "";

  if (/\b(photo|portrait|founder|president|biography)\b/i.test(lower)) {
    scores.set("person", (scores.get("person") ?? 0) + 2);
  }
  if (/\b(city|rome|paris|london|tokyo|berlin|madrid|landscape|cathedral|museum|campus)\b/i.test(lower)) {
    scores.set("place", (scores.get("place") ?? 0) + 2);
  }
  if (/\b(compare|versus|comparison|trend|market|revenue|statistics)\b/i.test(lower)) {
    scores.set("data", (scores.get("data") ?? 0) + 2);
  }
  if (/\b(history|century|war|empire|ancient|victorian|industrial)\b/i.test(lower)) {
    scores.set("historical", (scores.get("historical") ?? 0) + 2);
  }
  if (/\b(process|workflow|steps|lifecycle|timeline|pipeline|evolution)\b/i.test(lower)) {
    scores.set("process", (scores.get("process") ?? 0) + 2);
  }
  if (/\b(lab|laboratory|dna|protein|cell|species|ecosystem|genome|molecule)\b/i.test(lower)) {
    scores.set("scientific", (scores.get("scientific") ?? 0) + 2);
  }

  if (primaryQuery && primaryQuery.split(" ").length === 1 && title && title.toLowerCase().includes(primaryQuery.toLowerCase())) {
    scores.set("object", (scores.get("object") ?? 0) + 1);
  }

  const best = [...scores.entries()].sort((a, b) => b[1] - a[1])[0];
  if (!best || best[1] <= 0) return "object";
  return best[0];
}

function buildAmbiguousTokens(queries: string[], anchorPhrases: string[]): string[] {
  const anchors = new Set(anchorPhrases.map((phrase) => phrase.toLowerCase()));
  return dedupeStrings(
    queries
      .map((query) => normalizeQuery(query))
      .filter(Boolean)
      .filter((query) => query.split(" ").length === 1 && !anchors.has(query.toLowerCase()))
  );
}

function buildFeedbackQueryHints(profile?: SearchFeedbackProfile): string[] {
  if (!profile) return [];

  const weighted = Object.entries(profile.positiveTokens)
    .map(([token, count]) => ({
      token,
      score: count - (profile.negativeTokens[token] ?? 0) * 1.5,
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.token.localeCompare(b.token))
    .slice(0, 2)
    .map((entry) => entry.token);

  return dedupeStrings(weighted);
}

export function buildSearchPlan(
  queries: string[],
  presentationTopic?: string,
  slideContext?: SlideContextLike,
  feedbackProfile?: SearchFeedbackProfile,
): SearchPlan {
  const normalizedQueries = dedupeStrings(queries).slice(0, 4);
  const topic = normalizeQuery(presentationTopic || "");
  const intent = inferVisualIntent(normalizedQueries, topic, slideContext);
  const contextTexts = [topic];

  if (slideContext) {
    contextTexts.push(slideContext.title, slideContext.section, ...slideContext.bullets.slice(0, 4));
  }

  const anchorPhrases = extractEntityPhrases([...normalizedQueries, ...contextTexts]);
  const focusTokens = takeTopTokens([...normalizedQueries, ...contextTexts], 8);
  const ambiguousTokens = buildAmbiguousTokens(normalizedQueries, anchorPhrases);
  const feedbackHints = buildFeedbackQueryHints(feedbackProfile);

  const queryCandidates: SearchPlanQuery[] = [];
  normalizedQueries.forEach((query, index) => {
    queryCandidates.push({ query, weight: 1 - index * 0.12, stage: "primary" });
  });

  anchorPhrases.slice(0, 3).forEach((phrase, index) => {
    queryCandidates.push({ query: phrase, weight: 0.96 - index * 0.08, stage: "entity" });
  });

  const contextAnchor = dedupeStrings([
    slideContext?.title || "",
    slideContext?.section || "",
    topic,
  ]).find(Boolean);
  const modifier = intent === "abstract" ? "" : INTENT_MODIFIERS[intent][0];
  const distinctFocus = (token: string) => focusTokens.find((candidate) => candidate.toLowerCase() !== token.toLowerCase()) || "";

  for (const token of ambiguousTokens.slice(0, 2)) {
    const expanded = dedupeStrings([
      buildCompactQuery(token, distinctFocus(token)),
      buildCompactQuery(token, contextAnchor || ""),
      modifier ? buildCompactQuery(token, modifier) : "",
    ]).find((candidate) => candidate.toLowerCase() !== token.toLowerCase());
    if (expanded && expanded.toLowerCase() !== token.toLowerCase()) {
      queryCandidates.push({ query: expanded, weight: 0.86, stage: "disambiguated" });
    }
  }

  if (contextAnchor && normalizedQueries[0] && contextAnchor.toLowerCase() !== normalizedQueries[0].toLowerCase()) {
    queryCandidates.push({
      query: buildCompactQuery(normalizedQueries[0], contextAnchor),
      weight: 0.82,
      stage: "context",
    });
  }

  if (modifier && normalizedQueries[0]) {
    queryCandidates.push({
      query: buildCompactQuery(normalizedQueries[0], modifier),
      weight: 0.72,
      stage: "broadened",
    });
  }

  feedbackHints.forEach((token) => {
    queryCandidates.push({ query: token, weight: 0.68, stage: "feedback" });
  });

  const uniqueQueries: SearchPlanQuery[] = [];
  const seen = new Set<string>();
  for (const item of queryCandidates) {
    const normalized = normalizeQuery(item.query);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    uniqueQueries.push({ ...item, query: normalized });
  }

  return {
    intent,
    topic,
    queries: uniqueQueries.slice(0, 8),
    anchorPhrases,
    focusTokens,
    ambiguousTokens,
    sourcePriorities: SOURCE_INTENT_PRIORITIES[intent],
  };
}

function computeTokenCoverage(tokens: string[], expected: Set<string>): number {
  if (tokens.length === 0 || expected.size === 0) return 0;
  let matches = 0;
  for (const token of tokens) {
    if (expected.has(token)) matches++;
  }
  const precision = matches / tokens.length;
  const recall = matches / expected.size;
  return precision * 0.4 + recall * 0.6;
}

function getFeedbackBias<T extends ImageCandidateLike>(image: T, profile?: SearchFeedbackProfile): number {
  if (!profile) return 0;

  let bias = 0;
  bias += (profile.positiveUrls[image.url] ?? 0) * 3.5;
  bias -= (profile.negativeUrls[image.url] ?? 0) * 4.5;
  bias += (profile.positiveSources[image.source] ?? 0) * 0.4;
  bias -= (profile.negativeSources[image.source] ?? 0) * 0.6;

  for (const token of tokenize(image.title)) {
    bias += (profile.positiveTokens[token] ?? 0) * 0.3;
    bias -= (profile.negativeTokens[token] ?? 0) * 0.35;
  }

  return bias;
}

function getIntentAffinity(intent: VisualIntent, titleLower: string): number {
  const keywords = INTENT_KEYWORDS[intent] ?? [];
  let hits = 0;
  for (const keyword of keywords) {
    if (titleLower.includes(keyword)) hits++;
  }
  return Math.min(hits * 0.7, 2.1);
}

export function rankImageCandidate<T extends ImageCandidateLike>(
  image: T,
  plan: SearchPlan,
  feedbackProfile?: SearchFeedbackProfile,
): RankedImageCandidate<T> {
  const titleLower = image.title.toLowerCase();
  const titleTokens = tokenize(image.title);
  const expectedTokenSet = new Set(plan.focusTokens);
  const queryPhrases = plan.queries.map((item) => item.query.toLowerCase());
  const exactPhraseHits = queryPhrases.filter((phrase) => titleLower.includes(phrase)).length;
  const entityHits = plan.anchorPhrases.filter((phrase) => titleLower.includes(phrase.toLowerCase())).length;
  const tokenCoverage = computeTokenCoverage(titleTokens, expectedTokenSet);
  const focusCoverage = computeTokenCoverage(titleTokens, new Set(plan.focusTokens.slice(0, 4)));

  const aspectRatio = image.width / Math.max(image.height, 1);
  const area = image.width * image.height;
  const landscapeBonus = aspectRatio >= 1.2 && aspectRatio <= 2.4 ? 2.4 : aspectRatio >= 1 ? 1.2 : 0;
  const sizeScore = Math.min(area / 650000, 4.5);
  const qualityScore = landscapeBonus + sizeScore;

  const sourceAffinity = plan.sourcePriorities[image.source] ?? 0;
  const feedbackBias = getFeedbackBias(image, feedbackProfile);
  const intentAffinity = getIntentAffinity(plan.intent, titleLower);

  const score =
    exactPhraseHits * 3 +
    entityHits * 2.4 +
    tokenCoverage * 9 +
    focusCoverage * 4 +
    qualityScore +
    sourceAffinity +
    feedbackBias +
    intentAffinity;

  return {
    image,
    score,
    signals: {
      exactPhraseHits,
      entityHits,
      tokenCoverage,
      focusCoverage,
      qualityScore,
      sourceAffinity,
      feedbackBias,
      intentAffinity,
    },
  };
}

export function computeSelectionConfidence<T extends ImageCandidateLike>(
  ranked: RankedImageCandidate<T>[],
): number {
  if (ranked.length === 0) return 0;
  const top = ranked[0];
  const second = ranked[1];
  const normalizedTop = Math.max(0, Math.min(1, (top.score - 6) / 12));
  const gap = second ? Math.max(0, Math.min(1, (top.score - second.score) / 3.5)) : 1;
  const semantic = Math.max(
    top.signals.exactPhraseHits > 0 ? 0.35 : 0,
    top.signals.entityHits > 0 ? 0.25 : 0,
  ) + Math.min(0.3, top.signals.focusCoverage * 0.3);

  return Math.max(0, Math.min(1, normalizedTop * 0.45 + gap * 0.25 + semantic));
}

export function selectDiverseImages<T extends ImageCandidateLike>(
  ranked: RankedImageCandidate<T>[],
  limit: number,
): T[] {
  if (limit <= 0) return [];
  if (ranked.length <= limit) return ranked.map((entry) => entry.image);

  const remaining = [...ranked];
  const selected: RankedImageCandidate<T>[] = [];

  while (selected.length < limit && remaining.length > 0) {
    let bestIndex = 0;
    let bestScore = Number.NEGATIVE_INFINITY;

    remaining.forEach((candidate, index) => {
      const maxSimilarity = selected.length === 0
        ? 0
        : Math.max(
            ...selected.map((picked) => {
              const lexical = titleSimilarity(candidate.image.title, picked.image.title);
              const sourcePenalty = candidate.image.source === picked.image.source ? 0.18 : 0;
              return Math.min(1, lexical + sourcePenalty);
            })
          );

      const adjustedScore = candidate.score - maxSimilarity * 2.4 + (selected.some((picked) => picked.image.source === candidate.image.source) ? 0 : 0.25);
      if (adjustedScore > bestScore) {
        bestScore = adjustedScore;
        bestIndex = index;
      }
    });

    selected.push(remaining.splice(bestIndex, 1)[0]);
  }

  return selected.map((entry) => entry.image);
}

export function mergeRankedWithFallback<T extends ImageCandidateLike>(
  preferred: T[],
  ranked: RankedImageCandidate<T>[],
  limit: number,
): T[] {
  const selected = [...preferred];
  const seen = new Set(selected.map((item) => item.url));
  for (const candidate of ranked) {
    if (selected.length >= limit) break;
    if (seen.has(candidate.image.url)) continue;
    selected.push(candidate.image);
    seen.add(candidate.image.url);
  }
  return selected.slice(0, limit);
}