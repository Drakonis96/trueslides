/**
 * Type-level validation tests to ensure data structures are consistent.
 */
import type {
  AIProvider,
  AIModel,
  CustomPreset,
  PromptFieldKey,
  SlideData,
  PresentationData,
  GenerationConfig,
  ImageLayout,
  Language,
  GenerationStatus,
} from "@/lib/types";

describe("types consistency", () => {
  it("AIProvider should accept only valid values", () => {
    const providers: AIProvider[] = ["openrouter", "gemini", "claude", "openai"];
    expect(providers).toHaveLength(4);
  });

  it("PromptFieldKey should accept only valid values", () => {
    const keys: PromptFieldKey[] = ["design", "text", "notes"];
    expect(keys).toHaveLength(3);
  });

  it("ImageLayout should accept only valid values", () => {
    const layouts: ImageLayout[] = ["full", "two", "three", "collage", "combined"];
    expect(layouts).toHaveLength(5);
  });

  it("Language should accept only en and es", () => {
    const langs: Language[] = ["en", "es"];
    expect(langs).toHaveLength(2);
  });

  it("GenerationStatus should cover all states", () => {
    const statuses: GenerationStatus[] = [
      "idle",
      "uploading",
      "analyzing",
      "generating",
      "fetching-images",
      "building-pptx",
      "done",
      "error",
    ];
    expect(statuses).toHaveLength(8);
  });

  it("SlideData should have required fields", () => {
    const slide: SlideData = {
      id: "test-id",
      index: 0,
      title: "Test Slide",
      bullets: ["b1", "b2"],
      notes: "notes here",
      imageUrls: ["url1"],
      section: "Section A",
    };
    expect(slide.id).toBeTruthy();
    expect(slide.title).toBeTruthy();
    expect(slide.bullets.length).toBeGreaterThan(0);
  });

  it("PresentationData should have title and slides array", () => {
    const pres: PresentationData = {
      title: "My Pres",
      slides: [],
    };
    expect(pres.title).toBeTruthy();
    expect(Array.isArray(pres.slides)).toBe(true);
  });

  it("AIModel should have all required properties", () => {
    const model: AIModel = {
      id: "gpt-4",
      name: "GPT-4",
      provider: "openai",
      pinned: false,
      inputPrice: 30,
      outputPrice: 60,
    };
    expect(model.id).toBeTruthy();
    expect(model.provider).toBe("openai");
    expect(typeof model.pinned).toBe("boolean");
  });

  it("GenerationConfig should hold all required fields", () => {
    const config: GenerationConfig = {
      provider: "openrouter",
      modelId: "gpt-4",
      slideCount: 10,
      imageLayout: "full",
      stretchImages: false,
      textDensity: 30,
      outputLanguage: "en",
      prompts: { design: "", text: "", notes: "" },
      sourceText: "text",
    };
    expect(config.provider).toBeTruthy();
    expect(config.slideCount).toBeGreaterThan(0);
  });

  it("CustomPreset should have required fields", () => {
    const preset: CustomPreset = {
      id: "cp-1",
      field: "design",
      label: "My Preset",
      text: "Some prompt text",
    };
    expect(preset.id).toBeTruthy();
    expect(preset.field).toBe("design");
    expect(preset.label).toBeTruthy();
    expect(preset.text).toBeTruthy();
  });
});
