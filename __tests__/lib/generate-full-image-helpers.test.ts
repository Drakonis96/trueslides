import {
  buildImageQueryCandidates,
  extractTopicQueries,
  getMaxImagesForSlide,
  resolveSlideLayout,
} from "@/lib/generate-full/image-helpers";

describe("generate-full image helpers", () => {
  describe("buildImageQueryCandidates", () => {
    it("prioritizes AI terms before contextual fallbacks", () => {
      expect(
        buildImageQueryCandidates({
          title: "Modern Photography",
          section: "History",
          imageSearchTerms: ["camera close-up", "darkroom process", "  ", "film grain"],
        }),
      ).toEqual([
        "camera close-up",
        "darkroom process",
        "film grain",
        "Modern Photography",
      ]);
    });
  });

  describe("extractTopicQueries", () => {
    it("returns the most repeated non-stopword terms", () => {
      expect(
        extractTopicQueries(
          "Photography lenses photography exposure photography aperture aperture museum museum archive",
          "en",
        ),
      ).toEqual(["photography", "aperture", "museum"]);
    });

    it("uses language-aware fallbacks when no useful terms exist", () => {
      expect(extractTopicQueries("para como esta desde entre sobre", "es")).toEqual([
        "historia",
        "fotografia",
      ]);
    });
  });

  describe("getMaxImagesForSlide", () => {
    it("uses the generated slide layout when smart mode is enabled", () => {
      expect(
        getMaxImagesForSlide({
          requestedLayoutMode: "smart",
          requestedSlideLayout: "single",
          requestedImageLayout: "full",
          generatedSlideLayout: "three-cards",
        }),
      ).toBe(3);
    });

    it("falls back to the requested image layout when the layout id is unknown", () => {
      expect(
        getMaxImagesForSlide({
          requestedLayoutMode: "smart",
          requestedSlideLayout: "single",
          requestedImageLayout: "two",
          generatedSlideLayout: "unknown-layout",
        }),
      ).toBe(2);
    });
  });

  describe("resolveSlideLayout", () => {
    it("preserves per-slide layout in smart mode", () => {
      expect(
        resolveSlideLayout({
          requestedLayoutMode: "smart",
          requestedSlideLayout: "single",
          generatedSlideLayout: "three-cards",
        }),
      ).toBe("three-cards");
    });

    it("keeps the requested layout outside smart mode", () => {
      expect(
        resolveSlideLayout({
          requestedLayoutMode: "fixed",
          requestedSlideLayout: "single",
          generatedSlideLayout: "three-cards",
        }),
      ).toBe("single");
    });
  });
});