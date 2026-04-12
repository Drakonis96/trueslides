/**
 * Tests for React components
 *
 * Uses React Testing Library to render components and verify behavior.
 */

import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { useAppStore } from "@/lib/store";
import { useManualStore } from "@/lib/manual-store";
import { AIModel, DEFAULT_IMAGE_VERIFICATION } from "@/lib/types";

jest.mock("react-markdown", () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// Mock zustand store for component tests
jest.mock("@/lib/store", () => {
  const actual = jest.requireActual("@/lib/store");
  return actual;
});

// Reset store before each test
beforeEach(() => {
  useAppStore.setState({
    settings: {
      language: "en",
      outputLanguage: "en",
      enabledImageSources: ["wikimedia"],
      speedOptions: { maxFallbackAttempts: 2, skipCategorySearch: false, reduceQueryCandidates: false, lowerFetchLimit: false },
      imageVerification: { ...DEFAULT_IMAGE_VERIFICATION },
      providers: [
        { id: "openrouter", name: "OpenRouter", hasKey: true, models: [
          { id: "model-1", name: "GPT-4", provider: "openrouter", pinned: true, inputPrice: 2.5, outputPrice: 10 },
          { id: "model-2", name: "Claude", provider: "openrouter", pinned: true, inputPrice: 3, outputPrice: 15 },
          { id: "model-3", name: "Unpinned", provider: "openrouter", pinned: false },
        ]},
        { id: "gemini", name: "Google Gemini", models: [] },
        { id: "claude", name: "Anthropic Claude", models: [] },
        { id: "openai", name: "OpenAI", models: [] },
      ],
    },
    selectedProvider: "openrouter",
    selectedModelId: "model-1",
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

  useManualStore.setState({
    creations: [],
    activeCreationId: null,
    isLoaded: false,
    lastSavedAt: null,
    presentation: { title: "Untitled Manual Deck", slides: [] },
    selectedSlideIndex: 0,
    selectedElementId: null,
    isFullscreen: false,
    showImageSearch: false,
    imageSearchTargetElementId: null,
    undoStack: [],
    redoStack: [],
  });
});

describe("ProviderModelSelector", () => {
  it("should render provider and model dropdowns", async () => {
    const { default: ProviderModelSelector } = await import(
      "@/components/ProviderModelSelector"
    );
    render(<ProviderModelSelector />);

    expect(screen.getByText("Provider")).toBeInTheDocument();
    expect(screen.getByText("Model")).toBeInTheDocument();
  });

  it("should show pinned models only in model dropdown", async () => {
    const { default: ProviderModelSelector } = await import(
      "@/components/ProviderModelSelector"
    );
    render(<ProviderModelSelector />);

    fireEvent.click(screen.getByRole("button", { name: /gpt-4/i }));

    expect(screen.getByRole("option", { name: /GPT-4/i })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Claude/i })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Unpinned/i })).not.toBeInTheDocument();
  });

  it("should show OpenRouter price tags for the selected model", async () => {
    const { default: ProviderModelSelector } = await import(
      "@/components/ProviderModelSelector"
    );
    render(<ProviderModelSelector />);

    expect(screen.getByText("Input: $2.50")).toBeInTheDocument();
    expect(screen.getByText("Output: $10.00 /1M tokens")).toBeInTheDocument();
  });
});

describe("StatusBar", () => {
  it("should not render when status is idle", async () => {
    const { default: StatusBar } = await import("@/components/StatusBar");
    const { container } = render(<StatusBar />);
    expect(container.firstChild).toBeNull();
  });

  it("should not render when status is done", async () => {
    useAppStore.setState({ status: "done" });
    const { default: StatusBar } = await import("@/components/StatusBar");
    const { container } = render(<StatusBar />);
    expect(container.firstChild).toBeNull();
  });

  it("should show spinner when analyzing", async () => {
    useAppStore.setState({ status: "analyzing" });
    const { default: StatusBar } = await import("@/components/StatusBar");
    render(<StatusBar />);

    expect(screen.getAllByText(/Generating slides with AI/i).length).toBeGreaterThan(0);
  });

  it("should show error state", async () => {
    useAppStore.setState({ status: "error", error: "API failed" });
    const { default: StatusBar } = await import("@/components/StatusBar");
    render(<StatusBar />);

    expect(screen.getByText("Error")).toBeInTheDocument();
    expect(screen.getByText("API failed")).toBeInTheDocument();
  });

  it("should show Spanish status messages when language is es", async () => {
    useAppStore.setState({
      status: "analyzing",
      settings: {
        ...useAppStore.getState().settings,
        language: "es",
      },
    });
    const { default: StatusBar } = await import("@/components/StatusBar");
    render(<StatusBar />);

    expect(screen.getAllByText(/Generando diapositivas con IA/i).length).toBeGreaterThan(0);
  });
});

describe("FileUploader", () => {
  it("should render upload area with correct text", async () => {
    const { default: FileUploader } = await import("@/components/FileUploader");
    render(<FileUploader />);

    expect(screen.getByText("Upload Document")).toBeInTheDocument();
    expect(screen.getByText(/Drag & drop/i)).toBeInTheDocument();
    expect(screen.getByText("Browse Files")).toBeInTheDocument();
  });

  it("should have a hidden file input", async () => {
    const { default: FileUploader } = await import("@/components/FileUploader");
    render(<FileUploader />);

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(input.accept).toBe(".pdf,.docx,.txt");
    expect(input.className).toContain("hidden");
  });
});

describe("SettingsPanel", () => {
  it("should not render when showSettings is false", async () => {
    const { default: SettingsPanel } = await import("@/components/SettingsPanel");
    const { container } = render(<SettingsPanel />);
    expect(container.firstChild).toBeNull();
  });

  it("should render when showSettings is true", async () => {
    useAppStore.setState({ showSettings: true });
    const { default: SettingsPanel } = await import("@/components/SettingsPanel");
    render(<SettingsPanel />);

    expect(screen.getByText("Settings")).toBeInTheDocument();
    expect(screen.getByText("General")).toBeInTheDocument();
    expect(screen.getByText("AI")).toBeInTheDocument();
  });

  it("should show language toggle on General tab", async () => {
    useAppStore.setState({ showSettings: true, settingsTab: "general" });
    const { default: SettingsPanel } = await import("@/components/SettingsPanel");
    render(<SettingsPanel />);

    expect(screen.getByRole("button", { name: "English" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Español" })).toBeInTheDocument();
    expect(screen.getByLabelText("Presentation and Notes Language")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Deutsch" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "English" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Español" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Français" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Italiano" })).toBeInTheDocument();
  });

  it("should close when clicking close button", async () => {
    useAppStore.setState({ showSettings: true });
    const { default: SettingsPanel } = await import("@/components/SettingsPanel");
    render(<SettingsPanel />);

    const closeBtn = screen.getByText("Settings").closest("div")!.querySelector("button")!;
    fireEvent.click(closeBtn);
    expect(useAppStore.getState().showSettings).toBe(false);
  });
});

describe("SlideEditor", () => {
  it("should not render when there is no presentation", async () => {
    const { default: SlideEditor } = await import("@/components/SlideEditor");
    const { container } = render(<SlideEditor />);
    expect(container.firstChild).toBeNull();
  });

  it("should render when presentation exists", async () => {
    useAppStore.setState({
      presentation: {
        title: "Test Presentation",
        slides: [
          {
            id: "s1",
            index: 0,
            title: "Slide 1",
            bullets: ["Bullet 1"],
            notes: "Notes for slide 1",
            imageUrls: [],
            section: "Intro",
          },
          {
            id: "s2",
            index: 1,
            title: "Slide 2",
            bullets: ["Bullet A"],
            notes: "Notes for slide 2",
            imageUrls: [],
          },
        ],
      },
    });

    const { default: SlideEditor } = await import("@/components/SlideEditor");
    render(<SlideEditor />);

    expect(screen.getByText("Slide Editor")).toBeInTheDocument();
    expect(screen.getByText("All Slides")).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/Describe changes/i)).not.toBeInTheDocument();
  });

  it("should show slide selector buttons", async () => {
    useAppStore.setState({
      presentation: {
        title: "Test",
        slides: [
          { id: "s1", index: 0, title: "S1", bullets: [], notes: "", imageUrls: [] },
          { id: "s2", index: 1, title: "S2", bullets: [], notes: "", imageUrls: [] },
        ],
      },
    });

    const { default: SlideEditor } = await import("@/components/SlideEditor");
    render(<SlideEditor />);

    expect(screen.getByText("All Slides")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("should show presenter notes when a slide is selected", async () => {
    useAppStore.setState({
      presentation: {
        title: "Test",
        slides: [
          {
            id: "s1",
            index: 0,
            title: "Slide 1",
            bullets: ["B1"],
            notes: "These are the presenter notes",
            imageUrls: [],
          },
        ],
      },
      selectedSlideIndex: 0,
    });

    const { default: SlideEditor } = await import("@/components/SlideEditor");
    render(<SlideEditor />);

    expect(screen.getByText("Presenter Notes")).toBeInTheDocument();
    expect(screen.getByText("These are the presenter notes")).toBeInTheDocument();
  });

  it("should open fullscreen crop controls from the standard editor", async () => {
    useAppStore.setState({
      presentation: {
        title: "Test",
        slides: [
          {
            id: "s1",
            index: 0,
            title: "Slide 1",
            bullets: ["B1"],
            notes: "Notes 1",
            imageUrls: ["https://example.com/image.jpg"],
          },
        ],
      },
      selectedSlideIndex: 0,
    });

    const { default: SlideEditor } = await import("@/components/SlideEditor");
    render(<SlideEditor />);

    fireEvent.click(screen.getByRole("button", { name: /adjust image/i }));

    expect(screen.getByText("Single image layout")).toBeInTheDocument();
    expect(screen.getByText(/images loaded/i)).toBeInTheDocument();
  });

  it("should open a slide when clicking it from all slides", async () => {
    useAppStore.setState({
      presentation: {
        title: "Test",
        slides: [
          {
            id: "s1",
            index: 0,
            title: "Slide 1",
            bullets: ["B1"],
            notes: "Notes 1",
            imageUrls: [],
          },
          {
            id: "s2",
            index: 1,
            title: "Slide 2",
            bullets: ["B2"],
            notes: "Notes 2",
            imageUrls: [],
          },
        ],
      },
      selectedSlideIndex: "all",
    });

    const { default: SlideEditor } = await import("@/components/SlideEditor");
    render(<SlideEditor />);

    fireEvent.click(screen.getByRole("button", { name: "Open slide 2" }));

    expect(useAppStore.getState().selectedSlideIndex).toBe(1);
    expect(screen.getByText("Presenter Notes")).toBeInTheDocument();
    expect(screen.getByText("Notes 2")).toBeInTheDocument();
  });
});

describe("ManualCreator", () => {
  it("should show image crop controls for a selected manual image", async () => {
    const slide = {
      id: "manual-slide-1",
      layout: "single" as const,
      notes: "",
      bgColor: "FFFFFF",
      accentColor: "6366F1",
      elements: [
        {
          id: "manual-image-1",
          type: "image" as const,
          x: 10,
          y: 10,
          w: 50,
          h: 50,
          content: "https://example.com/manual.jpg",
          zIndex: 1,
          imageAdjustment: { scale: 1.4, offsetX: 12, offsetY: -6 },
        },
      ],
    };

    useManualStore.setState({
      isLoaded: true,
      activeCreationId: "manual-1",
      creations: [{
        id: "manual-1",
        title: "Manual Deck",
        presentation: { title: "Manual Deck", slides: [slide] },
        createdAt: 1,
        updatedAt: 1,
      }],
      presentation: { title: "Manual Deck", slides: [slide] },
      selectedSlideIndex: 0,
      selectedElementId: "manual-image-1",
    });

    useAppStore.setState({ manualSubTab: "editor" });

    const { default: ManualCreator } = await import("@/components/ManualCreator");
    render(<ManualCreator />);

    expect(screen.getByText("Reset crop")).toBeInTheDocument();
    expect(screen.getByText("Drag to reframe")).toBeInTheDocument();
  });
});

describe("PromptPanel", () => {
  it("should allow selecting 0% text density", async () => {
    const { default: PromptPanel } = await import("@/components/PromptPanel");
    render(<PromptPanel />);

    fireEvent.click(screen.getByRole("button", { name: "0%" }));
    expect(useAppStore.getState().textDensity).toBe(0);
  });
});
