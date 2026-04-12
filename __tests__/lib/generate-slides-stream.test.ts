import { generateSlides } from "@/lib/generate-slides";
import { callAI } from "@/lib/ai-client";

jest.mock("@/lib/ai-client", () => ({
  callAI: jest.fn(),
}));

jest.mock("uuid", () => ({
  v4: jest.fn().mockReturnValue("uuid-1"),
}));

const mockedCallAI = callAI as jest.MockedFunction<typeof callAI>;

describe("generateSlides streaming partial callbacks", () => {
  it("emits partial slides while streaming and returns final parsed result", async () => {
    mockedCallAI.mockImplementation(async (...args: Parameters<typeof callAI>) => {
      const options = args[6];
      const full = JSON.stringify({
        title: "Photography Origins",
        slides: [
          {
            title: "Daguerreotype",
            bullets: ["1839", "Silver plate"],
            notes: "Explain first practical process",
            section: "Origins",
            imageSearchTerms: ["daguerreotype", "antique camera", "photography history"],
          },
          {
            title: "Talbot",
            bullets: ["Calotype", "Paper negative"],
            notes: "Contrast with daguerreotype",
            section: "Origins",
            imageSearchTerms: ["calotype", "paper negative", "early photography"],
          },
        ],
      });

      // Simulate SSE chunks arriving in two parts.
      options?.onTextChunk?.(full.slice(0, Math.floor(full.length / 2)));
      options?.onTextChunk?.(full.slice(Math.floor(full.length / 2)));
      return full;
    });

    const partialCalls: Array<Array<{ title?: string }>> = [];

    const result = await generateSlides(
      "test-key",
      {
        provider: "openrouter",
        modelId: "openai/gpt-4o-mini",
        slideCount: 2,
        textDensity: 30,
        outputLanguage: "en",
        prompts: {
          design: "",
          text: "",
          notes: "",
        },
        sourceText: "History of photography and daguerreotypes",
      },
      {
        onSlidesPartial: (slides) => {
          partialCalls.push(slides.map((s) => ({ title: s.title })));
        },
      }
    );

    expect(result.title).toBe("Photography Origins");
    expect(result.slides).toHaveLength(2);
    expect(result.slides[0].title).toBe("Daguerreotype");
    expect(partialCalls.length).toBeGreaterThan(0);
    expect(mockedCallAI).toHaveBeenCalled();
  });
});
