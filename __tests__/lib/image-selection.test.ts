/**
 * @jest-environment node
 */

import type { SearchFeedbackProfile } from "@/lib/image-feedback";
import {
  buildSearchPlan,
  computeSelectionConfidence,
  rankImageCandidate,
  selectDiverseImages,
  type SlideContextLike,
} from "@/lib/image-selection";

const slideContext: SlideContextLike = {
  title: "Java Virtual Machine",
  bullets: ["Bytecode is executed in a managed runtime"],
  section: "Runtime",
};

function makeImage(
  title: string,
  url: string,
  source: "wikimedia" | "unsplash" | "pexels" | "pixabay" | "flickr" | "openverse" | "loc" | "europeana" | "hispana" = "wikimedia",
) {
  return {
    title,
    url,
    thumbUrl: `${url}?thumb=1`,
    width: 1400,
    height: 900,
    source,
  };
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

describe("image selection helpers", () => {
  it("builds disambiguated contextual queries for ambiguous terms", () => {
    const plan = buildSearchPlan(["Java"], "Programming Languages", slideContext);

    expect(plan.queries.some((item) => /virtual/i.test(item.query))).toBe(true);
    expect(plan.anchorPhrases).toContain("Java Virtual Machine");
  });

  it("applies feedback and semantic context when scoring candidates", () => {
    const feedback = emptyFeedback();
    feedback.positiveSources.unsplash = 2;
    feedback.negativeSources.wikimedia = 1;
    feedback.positiveTokens.runtime = 2;
    feedback.positiveTokens.java = 2;

    const plan = buildSearchPlan(["Java runtime"], "Programming Languages", slideContext, feedback);
    const exact = rankImageCandidate(
      makeImage("Java runtime environment", "https://example.com/runtime.jpg", "unsplash"),
      plan,
      feedback,
    );
    const generic = rankImageCandidate(
      makeImage("Coffee plantation on Java island", "https://example.com/java-island.jpg", "wikimedia"),
      plan,
      feedback,
    );

    expect(exact.score).toBeGreaterThan(generic.score);
  });

  it("prefers diverse results instead of near-duplicates in multi-image selections", () => {
    const plan = buildSearchPlan(
      ["Roman architecture"],
      "Ancient Rome",
      { title: "Landmarks of Rome", bullets: [], section: "Architecture" },
    );

    const ranked = [
      rankImageCandidate(makeImage("Colosseum Rome exterior", "https://example.com/colosseum-1.jpg", "wikimedia"), plan),
      rankImageCandidate(makeImage("Colosseum Rome facade", "https://example.com/colosseum-2.jpg", "wikimedia"), plan),
      rankImageCandidate(makeImage("Roman Forum columns", "https://example.com/forum.jpg", "flickr"), plan),
    ].sort((a, b) => b.score - a.score);

    const selected = selectDiverseImages(ranked, 2);

    expect(selected).toHaveLength(2);
    expect(selected.some((image) => image.title.includes("Roman Forum"))).toBe(true);
  });

  it("reports lower confidence for vague matches than for exact entity matches", () => {
    const plan = buildSearchPlan(["Java"], "Programming Languages", slideContext);
    const highConfidence = computeSelectionConfidence([
      rankImageCandidate(makeImage("Java Virtual Machine architecture", "https://example.com/exact.jpg"), plan),
      rankImageCandidate(makeImage("Java runtime internals", "https://example.com/second.jpg"), plan),
    ].sort((a, b) => b.score - a.score));

    const lowConfidence = computeSelectionConfidence([
      rankImageCandidate(makeImage("Tropical island landscape", "https://example.com/vague-1.jpg"), plan),
      rankImageCandidate(makeImage("Sunset over water", "https://example.com/vague-2.jpg", "unsplash"), plan),
    ].sort((a, b) => b.score - a.score));

    expect(highConfidence).toBeGreaterThan(lowConfidence);
    expect(highConfidence).toBeGreaterThan(0.55);
  });
});