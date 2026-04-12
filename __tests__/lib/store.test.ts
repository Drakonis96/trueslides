import { useAppStore } from "@/lib/store";
import { AIModel } from "@/lib/types";

// Reset store between tests
beforeEach(() => {
  const { setState } = useAppStore;
  setState({
    settings: {
      language: "en",
      outputLanguage: "en",
      enabledImageSources: ["wikimedia"],
      speedOptions: { maxFallbackAttempts: 2, skipCategorySearch: false, reduceQueryCandidates: false, lowerFetchLimit: false },
      providers: [
        { id: "openrouter", name: "OpenRouter", models: [] },
        { id: "gemini", name: "Google Gemini", models: [] },
        { id: "claude", name: "Anthropic Claude", models: [] },
        { id: "openai", name: "OpenAI", models: [] },
      ],
    },
    selectedProvider: "openrouter",
    selectedModelId: "",
    slideCount: 10,
    customSlideCount: false,
    imageLayout: "full",
    stretchImages: false,
    textDensity: 30,
    customTextDensity: false,
    prompts: { design: "", text: "", notes: "" },
    sourceText: "",
    sourceFileName: "",
    status: "idle",
    statusMessage: "",
    presentation: null,
    error: "",
    showSettings: false,
    settingsTab: "general",
    selectedSlideIndex: "all",
    editorInstruction: "",
    customPresets: [],
  });
});

describe("useAppStore", () => {
  describe("initial state", () => {
    it("should have default language as en", () => {
      expect(useAppStore.getState().settings.language).toBe("en");
    });

    it("should have 4 providers", () => {
      expect(useAppStore.getState().settings.providers).toHaveLength(4);
    });

    it("should have idle status", () => {
      expect(useAppStore.getState().status).toBe("idle");
    });

    it("should have no presentation", () => {
      expect(useAppStore.getState().presentation).toBeNull();
    });

    it("should default to openrouter provider", () => {
      expect(useAppStore.getState().selectedProvider).toBe("openrouter");
    });

    it("should default to 10 slide count", () => {
      expect(useAppStore.getState().slideCount).toBe(10);
    });

    it("should default to 30% text density", () => {
      expect(useAppStore.getState().textDensity).toBe(30);
    });

    it("should default to full image layout", () => {
      expect(useAppStore.getState().imageLayout).toBe("full");
    });
  });

  describe("setLanguage", () => {
    it("should change language to Spanish", () => {
      useAppStore.getState().setLanguage("es");
      expect(useAppStore.getState().settings.language).toBe("es");
    });

    it("should change language back to English", () => {
      useAppStore.getState().setLanguage("es");
      useAppStore.getState().setLanguage("en");
      expect(useAppStore.getState().settings.language).toBe("en");
    });
  });

  describe("setOutputLanguage", () => {
    it("should change presentation language to French", () => {
      useAppStore.getState().setOutputLanguage("fr");
      expect(useAppStore.getState().settings.outputLanguage).toBe("fr");
    });

    it("should keep interface language unchanged", () => {
      useAppStore.getState().setOutputLanguage("de");
      expect(useAppStore.getState().settings.language).toBe("en");
    });
  });

  describe("setProviderHasKey", () => {
    it("should set hasKey for a specific provider", () => {
      useAppStore.getState().setProviderHasKey("openrouter", true);
      const provider = useAppStore.getState().settings.providers.find(
        (p) => p.id === "openrouter"
      );
      expect(provider?.hasKey).toBe(true);
    });

    it("should not affect other providers", () => {
      useAppStore.getState().setProviderHasKey("openrouter", true);
      const gemini = useAppStore.getState().settings.providers.find(
        (p) => p.id === "gemini"
      );
      expect(gemini?.hasKey).toBeFalsy();
    });
  });

  describe("setProviderModels", () => {
    it("should set models for a provider", () => {
      const models: AIModel[] = [
        { id: "model-1", name: "Model 1", provider: "openrouter", pinned: false },
        { id: "model-2", name: "Model 2", provider: "openrouter", pinned: true },
      ];
      useAppStore.getState().setProviderModels("openrouter", models);
      const provider = useAppStore.getState().settings.providers.find(
        (p) => p.id === "openrouter"
      );
      expect(provider?.models).toHaveLength(2);
      expect(provider?.models[0].name).toBe("Model 1");
    });
  });

  describe("toggleModelPin", () => {
    it("should toggle a model's pinned state", () => {
      const models: AIModel[] = [
        { id: "model-1", name: "Model 1", provider: "openrouter", pinned: false },
      ];
      useAppStore.getState().setProviderModels("openrouter", models);
      useAppStore.getState().toggleModelPin("openrouter", "model-1");
      const provider = useAppStore.getState().settings.providers.find(
        (p) => p.id === "openrouter"
      );
      expect(provider?.models[0].pinned).toBe(true);
    });

    it("should toggle back to unpinned", () => {
      const models: AIModel[] = [
        { id: "model-1", name: "Model 1", provider: "openrouter", pinned: true },
      ];
      useAppStore.getState().setProviderModels("openrouter", models);
      useAppStore.getState().toggleModelPin("openrouter", "model-1");
      const provider = useAppStore.getState().settings.providers.find(
        (p) => p.id === "openrouter"
      );
      expect(provider?.models[0].pinned).toBe(false);
    });
  });

  describe("generation config setters", () => {
    it("setSelectedProvider should reset selectedModelId", () => {
      useAppStore.getState().setSelectedModelId("some-model");
      useAppStore.getState().setSelectedProvider("gemini");
      expect(useAppStore.getState().selectedProvider).toBe("gemini");
      expect(useAppStore.getState().selectedModelId).toBe("");
    });

    it("setSlideCount should update slide count", () => {
      useAppStore.getState().setSlideCount(50);
      expect(useAppStore.getState().slideCount).toBe(50);
    });

    it("setImageLayout should update image layout", () => {
      useAppStore.getState().setImageLayout("collage");
      expect(useAppStore.getState().imageLayout).toBe("collage");
    });

    it("setStretchImages should update stretch flag", () => {
      useAppStore.getState().setStretchImages(true);
      expect(useAppStore.getState().stretchImages).toBe(true);
    });

    it("setTextDensity should update text density", () => {
      useAppStore.getState().setTextDensity(50);
      expect(useAppStore.getState().textDensity).toBe(50);
    });

    it("setPrompt should update specific prompt field", () => {
      useAppStore.getState().setPrompt("design", "test design prompt");
      expect(useAppStore.getState().prompts.design).toBe("test design prompt");
      // Others remain empty
      expect(useAppStore.getState().prompts.text).toBe("");
    });

    it("setSourceText should update source text", () => {
      useAppStore.getState().setSourceText("Hello world");
      expect(useAppStore.getState().sourceText).toBe("Hello world");
    });

    it("setSourceFileName should update file name", () => {
      useAppStore.getState().setSourceFileName("doc.pdf");
      expect(useAppStore.getState().sourceFileName).toBe("doc.pdf");
    });
  });

  describe("generation state", () => {
    it("setStatus should update status and message", () => {
      useAppStore.getState().setStatus("analyzing", "Processing...");
      expect(useAppStore.getState().status).toBe("analyzing");
      expect(useAppStore.getState().statusMessage).toBe("Processing...");
    });

    it("setStatus without message should clear statusMessage", () => {
      useAppStore.getState().setStatus("analyzing", "Processing...");
      useAppStore.getState().setStatus("done");
      expect(useAppStore.getState().statusMessage).toBe("");
    });

    it("setError should set error and status to error", () => {
      useAppStore.getState().setError("Something went wrong");
      expect(useAppStore.getState().error).toBe("Something went wrong");
      expect(useAppStore.getState().status).toBe("error");
    });

    it("setPresentation should store presentation data", () => {
      const pres = {
        title: "Test",
        slides: [
          {
            id: "1",
            index: 0,
            title: "Slide 1",
            bullets: ["a"],
            notes: "n",
            imageUrls: [],
          },
        ],
      };
      useAppStore.getState().setPresentation(pres);
      expect(useAppStore.getState().presentation).toEqual(pres);
    });

    it("setPresentation null should clear presentation", () => {
      useAppStore.getState().setPresentation({
        title: "T",
        slides: [],
      });
      useAppStore.getState().setPresentation(null);
      expect(useAppStore.getState().presentation).toBeNull();
    });
  });

  describe("UI state", () => {
    it("setShowSettings should toggle settings panel", () => {
      useAppStore.getState().setShowSettings(true);
      expect(useAppStore.getState().showSettings).toBe(true);
    });

    it("setSettingsTab should switch tabs", () => {
      useAppStore.getState().setSettingsTab("ai");
      expect(useAppStore.getState().settingsTab).toBe("ai");
    });

    it("setSelectedSlideIndex should update index", () => {
      useAppStore.getState().setSelectedSlideIndex(3);
      expect(useAppStore.getState().selectedSlideIndex).toBe(3);
    });

    it("setSelectedSlideIndex 'all' should work", () => {
      useAppStore.getState().setSelectedSlideIndex("all");
      expect(useAppStore.getState().selectedSlideIndex).toBe("all");
    });

    it("setEditorInstruction should update instruction", () => {
      useAppStore.getState().setEditorInstruction("make it bold");
      expect(useAppStore.getState().editorInstruction).toBe("make it bold");
    });
  });

  describe("helper: getPinnedModels", () => {
    it("should return only pinned models for current provider", () => {
      const models: AIModel[] = [
        { id: "m1", name: "M1", provider: "openrouter", pinned: true },
        { id: "m2", name: "M2", provider: "openrouter", pinned: false },
        { id: "m3", name: "M3", provider: "openrouter", pinned: true },
      ];
      useAppStore.getState().setProviderModels("openrouter", models);
      const pinned = useAppStore.getState().getPinnedModels();
      expect(pinned).toHaveLength(2);
      expect(pinned.map((m) => m.id)).toEqual(["m1", "m3"]);
    });

    it("should return pinned models for a specific provider", () => {
      const models: AIModel[] = [
        { id: "g1", name: "G1", provider: "gemini", pinned: true },
      ];
      useAppStore.getState().setProviderModels("gemini", models);
      const pinned = useAppStore.getState().getPinnedModels("gemini");
      expect(pinned).toHaveLength(1);
    });

    it("should return empty array when no models are pinned", () => {
      const pinned = useAppStore.getState().getPinnedModels();
      expect(pinned).toEqual([]);
    });
  });

  describe("helper: getActiveProvider", () => {
    it("should return the currently selected provider config", () => {
      useAppStore.getState().setProviderHasKey("openrouter", true);
      const active = useAppStore.getState().getActiveProvider();
      expect(active?.id).toBe("openrouter");
      expect(active?.hasKey).toBe(true);
    });
  });

  describe("helper: getGenerationConfig", () => {
    it("should return a snapshot of generation config", () => {
      useAppStore.getState().setSelectedModelId("gpt-4");
      useAppStore.getState().setSlideCount(15);
      useAppStore.getState().setPrompt("design", "bold");
      useAppStore.getState().setSourceText("test document");

      const config = useAppStore.getState().getGenerationConfig();
      expect(config.provider).toBe("openrouter");
      expect(config.modelId).toBe("gpt-4");
      expect(config.slideCount).toBe(15);
      expect(config.prompts.design).toBe("bold");
      expect(config.sourceText).toBe("test document");
      expect(config.imageLayout).toBe("full");
      expect(config.stretchImages).toBe(false);
      expect(config.textDensity).toBe(30);
    });
  });

  describe("custom presets", () => {
    it("should start with empty custom presets", () => {
      expect(useAppStore.getState().customPresets).toEqual([]);
    });

    it("addCustomPreset should add a preset", () => {
      useAppStore.getState().addCustomPreset({
        id: "cp-1",
        field: "design",
        label: "My Design",
        text: "Custom design prompt",
      });
      expect(useAppStore.getState().customPresets).toHaveLength(1);
      expect(useAppStore.getState().customPresets[0].label).toBe("My Design");
    });

    it("updateCustomPreset should update label and text", () => {
      useAppStore.getState().addCustomPreset({
        id: "cp-2",
        field: "text",
        label: "Original",
        text: "Original text",
      });
      useAppStore.getState().updateCustomPreset("cp-2", "Updated", "Updated text");
      const preset = useAppStore.getState().customPresets.find((p) => p.id === "cp-2");
      expect(preset?.label).toBe("Updated");
      expect(preset?.text).toBe("Updated text");
    });

    it("deleteCustomPreset should remove a preset", () => {
      useAppStore.getState().addCustomPreset({
        id: "cp-3",
        field: "notes",
        label: "To Delete",
        text: "Will be deleted",
      });
      const before = useAppStore.getState().customPresets.length;
      useAppStore.getState().deleteCustomPreset("cp-3");
      expect(useAppStore.getState().customPresets.length).toBe(before - 1);
      expect(useAppStore.getState().customPresets.find((p) => p.id === "cp-3")).toBeUndefined();
    });
  });
});
