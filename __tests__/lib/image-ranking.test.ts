/**
 * @jest-environment node
 */

/**
 * Extended tests for image-selection.ts
 *
 * Covers: ranking edge cases, intent inference, entity extraction,
 * feedback bias, confidence scoring edge cases, diverse selection
 * with many candidates, mergeRankedWithFallback, normalizeQuery, tokenize.
 */

import type { SearchFeedbackProfile } from "@/lib/image-feedback";
import {
  buildSearchPlan,
  computeSelectionConfidence,
  extractEntityPhrases,
  inferVisualIntent,
  mergeRankedWithFallback,
  normalizeQuery,
  rankImageCandidate,
  selectDiverseImages,
  tokenize,
  type ImageCandidateLike,
  type RankedImageCandidate,
  type SlideContextLike,
  type VisualIntent,
} from "@/lib/image-selection";

function makeImage(
  title: string,
  url: string,
  source: ImageCandidateLike["source"] = "wikimedia",
  width = 1400,
  height = 900,
): ImageCandidateLike {
  return { title, url, thumbUrl: `${url}?thumb`, width, height, source };
}

function emptyFeedback(): SearchFeedbackProfile {
  return {
    positiveUrls: {},
    negativeUrls: {},
    positiveSources: {},
    negativeSources: {},
    positiveTokens: {},
    negativeTokens: {},
  };
}

// ── normalizeQuery & tokenize ──

describe("normalizeQuery", () => {
  it("collapses multiple spaces", () => {
    expect(normalizeQuery("  a    b  c  ")).toBe("a b c");
  });

  it("returns empty for whitespace-only input", () => {
    expect(normalizeQuery("   ")).toBe("");
  });
});

describe("tokenize", () => {
  it("produces lowercase tokens without stop words", () => {
    const tokens = tokenize("About This Quick Brown Fox Jumps");
    expect(tokens).toContain("quick");
    expect(tokens).toContain("brown");
    expect(tokens).not.toContain("about");
    expect(tokens).not.toContain("this");
  });

  it("filters short tokens <= 2 characters", () => {
    const tokens = tokenize("AI is ok by me");
    expect(tokens).not.toContain("is");
    expect(tokens).not.toContain("ok");
    expect(tokens).not.toContain("by");
  });

  it("handles unicode characters", () => {
    const tokens = tokenize("Café résumé naïve");
    expect(tokens).toContain("café");
    expect(tokens).toContain("résumé");
    expect(tokens).toContain("naïve");
  });

  it("removes punctuation", () => {
    const tokens = tokenize("Hello, world! (test)");
    expect(tokens).toContain("hello");
    expect(tokens).toContain("world");
    expect(tokens).toContain("test");
  });
});

// ── extractEntityPhrases ──

describe("extractEntityPhrases", () => {
  it("extracts capitalized multi-word entities", () => {
    const phrases = extractEntityPhrases(["Albert Einstein", "Theory of Relativity"]);
    expect(phrases.some((p) => /einstein/i.test(p))).toBe(true);
  });

  it("returns multi-word phrases as anchor candidates", () => {
    const phrases = extractEntityPhrases(["machine learning"]);
    expect(phrases.some((p) => /machine learning/i.test(p))).toBe(true);
  });

  it("deduplicates case-insensitive", () => {
    const phrases = extractEntityPhrases(["NASA", "nasa", "Nasa"]);
    const normalized = phrases.map((p) => p.toLowerCase());
    const unique = new Set(normalized);
    expect(unique.size).toBe(normalized.length);
  });
});

// ── inferVisualIntent ──

describe("inferVisualIntent", () => {
  it("infers 'person' for biography-related content", () => {
    const intent = inferVisualIntent(["Albert Einstein biography"], "Physics", {
      title: "Einstein's Legacy",
      bullets: ["Born in Ulm, Germany"],
      section: "Biography",
    });
    expect(intent).toBe("person");
  });

  it("infers 'place' for city/landmark content", () => {
    const intent = inferVisualIntent(["Rome Colosseum"], "Travel", {
      title: "Landmarks of Rome",
      bullets: [],
      section: "Europe",
    });
    expect(intent).toBe("place");
  });

  it("infers 'data' for statistical content", () => {
    const intent = inferVisualIntent(["market trends comparison"], "Finance");
    expect(intent).toBe("data");
  });

  it("infers 'scientific' for lab/genome content", () => {
    const intent = inferVisualIntent(["DNA genome sequencing"], "Biology");
    expect(intent).toBe("scientific");
  });

  it("infers 'historical' for war/century content", () => {
    const intent = inferVisualIntent(["World War II history"], "History");
    expect(intent).toBe("historical");
  });

  it("infers 'process' for workflow/pipeline content", () => {
    const intent = inferVisualIntent(["software development lifecycle pipeline"], "Engineering");
    expect(intent).toBe("process");
  });

  it("defaults to 'object' for generic queries", () => {
    const intent = inferVisualIntent(["something random"]);
    expect(intent).toBe("object");
  });
});

// ── buildSearchPlan edge cases ──

describe("buildSearchPlan edge cases", () => {
  it("handles empty query array", () => {
    const plan = buildSearchPlan([]);
    expect(plan.queries).toBeDefined();
    expect(plan.intent).toBeDefined();
  });

  it("limits queries to 8", () => {
    const queries = Array.from({ length: 12 }, (_, i) => `query-term-${i}`);
    const plan = buildSearchPlan(queries);
    expect(plan.queries.length).toBeLessThanOrEqual(8);
  });

  it("includes feedback hints in plan queries", () => {
    const feedback = emptyFeedback();
    feedback.positiveTokens.blockchain = 5;
    feedback.positiveTokens.crypto = 3;

    const plan = buildSearchPlan(["finance"], "Technology", undefined, feedback);
    const allQueryText = plan.queries.map((q) => q.query.toLowerCase()).join(" ");
    expect(allQueryText).toContain("blockchain");
  });

  it("generates disambiguation queries for ambiguous single-word terms", () => {
    const context: SlideContextLike = {
      title: "Python Programming",
      bullets: ["Variables", "Functions"],
      section: "Development",
    };
    const plan = buildSearchPlan(["Python"], "Software Engineering", context);
    // Should have disambiguated queries (not just "Python" alone)
    expect(plan.queries.length).toBeGreaterThan(1);
    expect(plan.ambiguousTokens.length).toBeGreaterThanOrEqual(0);
  });

  it("sets source priorities based on intent", () => {
    const plan = buildSearchPlan(["ancient Rome history"], "History");
    // historical intent should prioritize wikimedia/loc
    expect(plan.sourcePriorities.wikimedia).toBeGreaterThan(0);
  });
});

// ── rankImageCandidate edge cases ──

describe("rankImageCandidate edge cases", () => {
  it("scores zero-size images lower due to quality penalty", () => {
    const plan = buildSearchPlan(["mountains"], "Nature");
    const large = rankImageCandidate(makeImage("Mountain landscape", "https://example.com/large.jpg", "unsplash", 2000, 1200), plan);
    const tiny = rankImageCandidate(makeImage("Mountain landscape", "https://example.com/tiny.jpg", "unsplash", 50, 30), plan);

    expect(large.score).toBeGreaterThan(tiny.score);
  });

  it("gives landscape bonus over portrait images", () => {
    const plan = buildSearchPlan(["architecture"], "Design");
    const landscape = rankImageCandidate(makeImage("Building facade", "https://example.com/wide.jpg", "unsplash", 1600, 900), plan);
    const portrait = rankImageCandidate(makeImage("Building facade", "https://example.com/tall.jpg", "unsplash", 600, 1200), plan);

    expect(landscape.signals.qualityScore).toBeGreaterThan(portrait.signals.qualityScore);
  });

  it("applies negative feedback bias", () => {
    const plan = buildSearchPlan(["sunset"], "Photography");
    const feedback = emptyFeedback();
    feedback.negativeUrls["https://example.com/bad.jpg"] = 3;

    const penalized = rankImageCandidate(
      makeImage("Sunset photo", "https://example.com/bad.jpg", "unsplash"),
      plan,
      feedback,
    );
    const neutral = rankImageCandidate(
      makeImage("Sunset photo", "https://example.com/ok.jpg", "unsplash"),
      plan,
      feedback,
    );

    expect(penalized.score).toBeLessThan(neutral.score);
  });

  it("boosts positively-rated URLs", () => {
    const plan = buildSearchPlan(["technology"], "Tech");
    const feedback = emptyFeedback();
    feedback.positiveUrls["https://example.com/liked.jpg"] = 2;

    const boosted = rankImageCandidate(
      makeImage("Tech article", "https://example.com/liked.jpg"),
      plan,
      feedback,
    );
    const unboosted = rankImageCandidate(
      makeImage("Tech article", "https://example.com/other.jpg"),
      plan,
      feedback,
    );

    expect(boosted.score).toBeGreaterThan(unboosted.score);
  });

  it("applies intent affinity for matching keywords", () => {
    const plan = buildSearchPlan(["laboratory microscope"], "Science");
    const matching = rankImageCandidate(
      makeImage("Laboratory microscope equipment", "https://example.com/lab.jpg"),
      plan,
    );
    const unrelated = rankImageCandidate(
      makeImage("Random unrelated photo", "https://example.com/random.jpg"),
      plan,
    );

    expect(matching.signals.intentAffinity).toBeGreaterThan(unrelated.signals.intentAffinity);
  });

  it("returns all signal fields in expected range", () => {
    const plan = buildSearchPlan(["test"], "Test");
    const result = rankImageCandidate(makeImage("Test image", "https://example.com/test.jpg"), plan);

    expect(result.signals).toHaveProperty("exactPhraseHits");
    expect(result.signals).toHaveProperty("entityHits");
    expect(result.signals).toHaveProperty("tokenCoverage");
    expect(result.signals).toHaveProperty("focusCoverage");
    expect(result.signals).toHaveProperty("qualityScore");
    expect(result.signals).toHaveProperty("sourceAffinity");
    expect(result.signals).toHaveProperty("feedbackBias");
    expect(result.signals).toHaveProperty("intentAffinity");
    expect(result.signals.tokenCoverage).toBeGreaterThanOrEqual(0);
    expect(result.signals.tokenCoverage).toBeLessThanOrEqual(1);
  });
});

// ── selectDiverseImages edge cases ──

describe("selectDiverseImages edge cases", () => {
  it("returns empty array when limit is 0", () => {
    const plan = buildSearchPlan(["cats"]);
    const ranked = [rankImageCandidate(makeImage("Cat", "https://example.com/cat.jpg"), plan)];
    expect(selectDiverseImages(ranked, 0)).toEqual([]);
  });

  it("returns all when candidates <= limit", () => {
    const plan = buildSearchPlan(["dogs"]);
    const ranked = [
      rankImageCandidate(makeImage("Dog A", "https://example.com/a.jpg"), plan),
      rankImageCandidate(makeImage("Dog B", "https://example.com/b.jpg"), plan),
    ].sort((a, b) => b.score - a.score);

    const result = selectDiverseImages(ranked, 5);
    expect(result).toHaveLength(2);
  });

  it("favors source diversity when selecting multiple images", () => {
    const plan = buildSearchPlan(["nature landscape"]);
    const ranked = [
      rankImageCandidate(makeImage("Forest landscape A", "https://example.com/a.jpg", "unsplash", 1600, 900), plan),
      rankImageCandidate(makeImage("Forest landscape B", "https://example.com/b.jpg", "unsplash", 1600, 900), plan),
      rankImageCandidate(makeImage("Mountain landscape", "https://example.com/c.jpg", "pexels", 1600, 900), plan),
      rankImageCandidate(makeImage("Ocean landscape", "https://example.com/d.jpg", "wikimedia", 1600, 900), plan),
    ].sort((a, b) => b.score - a.score);

    const selected = selectDiverseImages(ranked, 3);
    const sources = new Set(selected.map((img) => img.source));
    // Should pick from different sources when possible
    expect(sources.size).toBeGreaterThanOrEqual(2);
  });

  it("penalizes near-duplicate titles in selection", () => {
    const plan = buildSearchPlan(["architecture"]);
    const ranked = [
      rankImageCandidate(makeImage("Gothic cathedral exterior view", "https://example.com/1.jpg", "wikimedia", 2000, 1200), plan),
      rankImageCandidate(makeImage("Gothic cathedral exterior facade", "https://example.com/2.jpg", "wikimedia", 2000, 1200), plan),
      rankImageCandidate(makeImage("Modern skyscraper downtown", "https://example.com/3.jpg", "unsplash", 1600, 1000), plan),
    ].sort((a, b) => b.score - a.score);

    const selected = selectDiverseImages(ranked, 2);
    const titles = selected.map((img) => img.title);
    // Should pick the skyscraper over the duplicate cathedral
    expect(titles.some((t) => t.includes("skyscraper"))).toBe(true);
  });
});

// ── computeSelectionConfidence edge cases ──

describe("computeSelectionConfidence edge cases", () => {
  it("returns 0 for empty ranked array", () => {
    expect(computeSelectionConfidence([])).toBe(0);
  });

  it("returns higher confidence when only one candidate and it matches well", () => {
    const plan = buildSearchPlan(["exact topic match"]);
    const single = [
      rankImageCandidate(makeImage("Exact topic match photo", "https://example.com/exact.jpg"), plan),
    ];
    const conf = computeSelectionConfidence(single);
    expect(conf).toBeGreaterThan(0);
  });

  it("returns value between 0 and 1", () => {
    const plan = buildSearchPlan(["test topic"]);
    const ranked = [
      rankImageCandidate(makeImage("Test topic image", "https://example.com/1.jpg"), plan),
      rankImageCandidate(makeImage("Unrelated thing", "https://example.com/2.jpg"), plan),
    ].sort((a, b) => b.score - a.score);

    const conf = computeSelectionConfidence(ranked);
    expect(conf).toBeGreaterThanOrEqual(0);
    expect(conf).toBeLessThanOrEqual(1);
  });
});

// ── mergeRankedWithFallback ──

describe("mergeRankedWithFallback", () => {
  it("prefers preferred images over ranked", () => {
    const plan = buildSearchPlan(["cats"]);
    const preferred = [makeImage("Preferred Cat", "https://example.com/pref.jpg")];
    const ranked = [
      rankImageCandidate(makeImage("Ranked Cat A", "https://example.com/a.jpg"), plan),
      rankImageCandidate(makeImage("Ranked Cat B", "https://example.com/b.jpg"), plan),
    ];

    const merged = mergeRankedWithFallback(preferred, ranked, 2);
    expect(merged).toHaveLength(2);
    expect(merged[0].title).toBe("Preferred Cat");
  });

  it("deduplicates by URL", () => {
    const plan = buildSearchPlan(["dogs"]);
    const preferred = [makeImage("Dog", "https://example.com/same.jpg")];
    const ranked = [
      rankImageCandidate(makeImage("Dog", "https://example.com/same.jpg"), plan),
      rankImageCandidate(makeImage("Other Dog", "https://example.com/other.jpg"), plan),
    ];

    const merged = mergeRankedWithFallback(preferred, ranked, 3);
    const urls = merged.map((img) => img.url);
    expect(new Set(urls).size).toBe(urls.length);
  });

  it("respects the limit", () => {
    const plan = buildSearchPlan(["test"]);
    const preferred = [makeImage("A", "https://example.com/a.jpg"), makeImage("B", "https://example.com/b.jpg")];
    const ranked = [
      rankImageCandidate(makeImage("C", "https://example.com/c.jpg"), plan),
    ];

    const merged = mergeRankedWithFallback(preferred, ranked, 2);
    expect(merged).toHaveLength(2);
  });

  it("returns empty when limit is 0", () => {
    const merged = mergeRankedWithFallback([], [], 0);
    expect(merged).toHaveLength(0);
  });
});
