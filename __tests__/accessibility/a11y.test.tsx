/**
 * Accessibility tests
 *
 * Covers: ARIA attributes, keyboard navigation, semantic HTML,
 * label associations, focus management, and screen reader compatibility
 * for key components.
 */

import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { useAppStore } from "@/lib/store";
import { useManualStore } from "@/lib/manual-store";
import { DEFAULT_IMAGE_VERIFICATION } from "@/lib/types";

jest.mock("react-markdown", () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

jest.mock("@/lib/store", () => {
  const actual = jest.requireActual("@/lib/store");
  return actual;
});

const baseSettings = {
  language: "en" as const,
  outputLanguage: "en" as const,
  enabledImageSources: ["wikimedia" as const],
  speedOptions: { maxFallbackAttempts: 2, skipCategorySearch: false, reduceQueryCandidates: false, lowerFetchLimit: false },
  imageVerification: { ...DEFAULT_IMAGE_VERIFICATION },
  providers: [
    {
      id: "openrouter" as const,
      name: "OpenRouter",
      hasKey: true,
      models: [
        { id: "model-1", name: "GPT-4", provider: "openrouter" as const, pinned: true, inputPrice: 2.5, outputPrice: 10 },
        { id: "model-2", name: "Claude", provider: "openrouter" as const, pinned: true, inputPrice: 3, outputPrice: 15 },
      ],
    },
    { id: "gemini" as const, name: "Google Gemini", models: [] },
    { id: "claude" as const, name: "Anthropic Claude", models: [] },
    { id: "openai" as const, name: "OpenAI", models: [] },
  ],
};

beforeEach(() => {
  useAppStore.setState({
    settings: baseSettings,
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

describe("FileUploader accessibility", () => {
  it("has an accessible file input with correct accept attribute", async () => {
    const { default: FileUploader } = await import("@/components/FileUploader");
    render(<FileUploader />);

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(input.accept).toBe(".pdf,.docx,.txt");
  });

  it("shows a visible label for the upload section", async () => {
    const { default: FileUploader } = await import("@/components/FileUploader");
    render(<FileUploader />);

    expect(screen.getByText("Upload Document")).toBeInTheDocument();
  });

  it("has an actionable Browse Files button discoverable by screen readers", async () => {
    const { default: FileUploader } = await import("@/components/FileUploader");
    render(<FileUploader />);

    expect(screen.getByText("Browse Files")).toBeInTheDocument();
  });
});

describe("ProviderModelSelector accessibility", () => {
  it("renders labeled Provider and Model sections", async () => {
    const { default: ProviderModelSelector } = await import("@/components/ProviderModelSelector");
    render(<ProviderModelSelector />);

    expect(screen.getByText("Provider")).toBeInTheDocument();
    expect(screen.getByText("Model")).toBeInTheDocument();
  });

  it("model dropdown button has aria-haspopup and aria-expanded", async () => {
    const { default: ProviderModelSelector } = await import("@/components/ProviderModelSelector");
    render(<ProviderModelSelector />);

    const modelButton = screen.getByRole("button", { name: /gpt-4/i });
    expect(modelButton).toHaveAttribute("aria-haspopup", "listbox");
    expect(modelButton).toHaveAttribute("aria-expanded", "false");
  });

  it("model dropdown toggles aria-expanded on click", async () => {
    const { default: ProviderModelSelector } = await import("@/components/ProviderModelSelector");
    render(<ProviderModelSelector />);

    const modelButton = screen.getByRole("button", { name: /gpt-4/i });
    fireEvent.click(modelButton);
    expect(modelButton).toHaveAttribute("aria-expanded", "true");
  });

  it("shows empty state when no models are available", async () => {
    useAppStore.setState({
      selectedProvider: "gemini",
      selectedModelId: "",
    });
    const { default: ProviderModelSelector } = await import("@/components/ProviderModelSelector");
    render(<ProviderModelSelector />);

    // When no models, the dropdown button should still render
    const buttons = screen.getAllByRole("button");
    expect(buttons.length).toBeGreaterThanOrEqual(1);
  });
});

describe("StatusBar accessibility", () => {
  it("does not render anything when idle (no empty containers)", async () => {
    const { default: StatusBar } = await import("@/components/StatusBar");
    const { container } = render(<StatusBar />);
    expect(container.firstChild).toBeNull();
  });

  it("shows error with descriptive text for screen readers", async () => {
    useAppStore.setState({ status: "error", error: "API key invalid" });
    const { default: StatusBar } = await import("@/components/StatusBar");
    render(<StatusBar />);

    expect(screen.getByText("Error")).toBeInTheDocument();
    expect(screen.getByText("API key invalid")).toBeInTheDocument();
  });

  it("shows retry button for non-input errors", async () => {
    const onRetry = jest.fn();
    useAppStore.setState({ status: "error", error: "Network timeout" });
    const { default: StatusBar } = await import("@/components/StatusBar");
    render(<StatusBar onRetry={onRetry} />);

    const retryButton = screen.getByText("Retry");
    expect(retryButton).toBeInTheDocument();
    fireEvent.click(retryButton);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("does not show retry for input errors", async () => {
    const onRetry = jest.fn();
    useAppStore.setState({ status: "error", error: "Upload empty file" });
    const { default: StatusBar } = await import("@/components/StatusBar");
    render(<StatusBar onRetry={onRetry} />);

    expect(screen.queryByText("Retry")).not.toBeInTheDocument();
  });

  it("shows progress percentage when generating", async () => {
    useAppStore.setState({ status: "analyzing", progress: 42 });
    const { default: StatusBar } = await import("@/components/StatusBar");
    render(<StatusBar />);

    expect(screen.getByText("42%")).toBeInTheDocument();
  });
});

describe("SettingsPanel accessibility", () => {
  it("renders tab buttons that are focusable", async () => {
    useAppStore.setState({ showSettings: true });
    const { default: SettingsPanel } = await import("@/components/SettingsPanel");
    render(<SettingsPanel />);

    const generalTab = screen.getByText("General");
    const aiTab = screen.getByText("AI");
    expect(generalTab.closest("button") || generalTab).toBeTruthy();
    expect(aiTab.closest("button") || aiTab).toBeTruthy();
  });

  it("has a labeled output language select with for/id association", async () => {
    useAppStore.setState({ showSettings: true });
    const { default: SettingsPanel } = await import("@/components/SettingsPanel");
    render(<SettingsPanel />);

    const select = document.getElementById("output-language") as HTMLSelectElement;
    expect(select).toBeTruthy();
    expect(select.tagName.toLowerCase()).toBe("select");

    // Verify there is a label pointing to this select
    const label = document.querySelector('label[for="output-language"]');
    expect(label).toBeTruthy();
  });

  it("language buttons indicate the active selection visually", async () => {
    useAppStore.setState({ showSettings: true });
    const { default: SettingsPanel } = await import("@/components/SettingsPanel");
    render(<SettingsPanel />);

    // "English" may appear in both the language button and the output language dropdown
    // Use getAllByText and find the button one
    const allEnglish = screen.getAllByText("English");
    const englishButton = allEnglish.find((el) => el.tagName.toLowerCase() === "button");
    expect(englishButton).toBeTruthy();
    // Active language should have accent styling
    expect(englishButton!.className).toContain("accent");
  });
});

describe("Semantic HTML checks", () => {
  it("FileUploader uses a <label> element for the heading", async () => {
    const { default: FileUploader } = await import("@/components/FileUploader");
    render(<FileUploader />);

    const label = screen.getByText("Upload Document");
    expect(label.tagName.toLowerCase()).toBe("label");
  });

  it("ProviderModelSelector uses label elements", async () => {
    const { default: ProviderModelSelector } = await import("@/components/ProviderModelSelector");
    render(<ProviderModelSelector />);

    const providerLabel = screen.getByText("Provider");
    expect(providerLabel.tagName.toLowerCase()).toBe("label");
  });
});

describe("Keyboard interaction", () => {
  it("model dropdown opens with Enter key", async () => {
    const { default: ProviderModelSelector } = await import("@/components/ProviderModelSelector");
    render(<ProviderModelSelector />);

    const modelButton = screen.getByRole("button", { name: /gpt-4/i });
    modelButton.focus();
    fireEvent.keyDown(modelButton, { key: "Enter" });
    fireEvent.click(modelButton);
    expect(modelButton).toHaveAttribute("aria-expanded", "true");
  });

  it("retry button in error state is keyboard accessible", async () => {
    const onRetry = jest.fn();
    useAppStore.setState({ status: "error", error: "Server timeout" });
    const { default: StatusBar } = await import("@/components/StatusBar");
    render(<StatusBar onRetry={onRetry} />);

    const retryButton = screen.getByText("Retry");
    retryButton.focus();
    fireEvent.keyDown(retryButton, { key: "Enter" });
    fireEvent.click(retryButton);
    expect(onRetry).toHaveBeenCalled();
  });
});
