import { PROMPT_FIELDS, DEFAULT_PROVIDERS, UI_TEXT, SLIDE_COUNT_OPTIONS, TEXT_DENSITY_OPTIONS } from "@/lib/presets";

describe("presets", () => {
  describe("PROMPT_FIELDS", () => {
    it("should have exactly 3 prompt fields", () => {
      expect(PROMPT_FIELDS).toHaveLength(3);
    });

    it("should have design, text, notes fields", () => {
      const keys = PROMPT_FIELDS.map((f) => f.key);
      expect(keys).toEqual(["design", "text", "notes"]);
    });

    it("should have labels in both English and Spanish for each field", () => {
      for (const field of PROMPT_FIELDS) {
        expect(field.label.en).toBeTruthy();
        expect(field.label.es).toBeTruthy();
      }
    });

    it("should have presets in both languages for each field", () => {
      for (const field of PROMPT_FIELDS) {
        expect(field.presets.en.length).toBeGreaterThan(0);
        expect(field.presets.es.length).toBeGreaterThan(0);
        // Same number of presets in both languages
        expect(field.presets.en.length).toBe(field.presets.es.length);
      }
    });

    it("should have unique preset IDs within each field", () => {
      for (const field of PROMPT_FIELDS) {
        const enIds = field.presets.en.map((p) => p.id);
        expect(new Set(enIds).size).toBe(enIds.length);
      }
    });

    it("each preset should have id, label, and text (empty only for none)", () => {
      for (const field of PROMPT_FIELDS) {
        for (const preset of [...field.presets.en, ...field.presets.es]) {
          expect(preset.id).toBeTruthy();
          expect(preset.label).toBeTruthy();
          if (preset.id.endsWith("-none")) {
            expect(preset.text).toBe("");
          } else {
            expect(preset.text.length).toBeGreaterThan(10);
          }
        }
      }
    });

    it("should have an icon for each field", () => {
      for (const field of PROMPT_FIELDS) {
        expect(field.icon).toBeTruthy();
      }
    });
  });

  describe("DEFAULT_PROVIDERS", () => {
    it("should have 4 providers", () => {
      expect(DEFAULT_PROVIDERS).toHaveLength(4);
    });

    it("should include openrouter, gemini, claude, openai", () => {
      const ids = DEFAULT_PROVIDERS.map((p) => p.id);
      expect(ids).toEqual(["openrouter", "gemini", "claude", "openai"]);
    });

    it("should have no keys set by default", () => {
      for (const provider of DEFAULT_PROVIDERS) {
        expect(provider.hasKey).toBeFalsy();
      }
    });

    it("should have empty model arrays by default", () => {
      for (const provider of DEFAULT_PROVIDERS) {
        expect(provider.models).toEqual([]);
      }
    });

    it("should have display names for each provider", () => {
      for (const provider of DEFAULT_PROVIDERS) {
        expect(provider.name).toBeTruthy();
        expect(provider.name.length).toBeGreaterThan(3);
      }
    });
  });

  describe("UI_TEXT", () => {
    it("should have translations for both en and es", () => {
      expect(UI_TEXT.en).toBeDefined();
      expect(UI_TEXT.es).toBeDefined();
    });

    it("should have the same keys in both languages", () => {
      const enKeys = Object.keys(UI_TEXT.en).sort();
      const esKeys = Object.keys(UI_TEXT.es).sort();
      expect(enKeys).toEqual(esKeys);
    });

    it("should have non-empty values for all keys in both languages", () => {
      for (const key of Object.keys(UI_TEXT.en) as (keyof typeof UI_TEXT.en)[]) {
        expect(UI_TEXT.en[key]).toBeTruthy();
        expect(UI_TEXT.es[key]).toBeTruthy();
      }
    });

    it("should have 'TrueSlides' as appName in both languages", () => {
      expect(UI_TEXT.en.appName).toBe("TrueSlides");
      expect(UI_TEXT.es.appName).toBe("TrueSlides");
    });
  });

  describe("SLIDE_COUNT_OPTIONS", () => {
    it("should contain the expected values", () => {
      expect([...SLIDE_COUNT_OPTIONS]).toEqual([5, 10, 15, 30, 50, 100]);
    });

    it("should be sorted in ascending order", () => {
      for (let i = 1; i < SLIDE_COUNT_OPTIONS.length; i++) {
        expect(SLIDE_COUNT_OPTIONS[i]).toBeGreaterThan(SLIDE_COUNT_OPTIONS[i - 1]);
      }
    });
  });

  describe("TEXT_DENSITY_OPTIONS", () => {
    it("should contain the expected values", () => {
      expect([...TEXT_DENSITY_OPTIONS]).toEqual([0, 5, 10, 30, 50]);
    });

    it("values should be between 0 and 100", () => {
      for (const v of TEXT_DENSITY_OPTIONS) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(100);
      }
    });
  });
});
