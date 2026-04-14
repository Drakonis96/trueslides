/**
 * Tests for manual-store.ts
 *
 * Covers: undo/redo, addElement, removeElement, updateElement,
 * slide CRUD, and copy/paste simulation.
 */

// Mock fetch to prevent real API calls for persistence
const mockFetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
global.fetch = mockFetch;

// Mock crypto.randomUUID for deterministic IDs
let uuidCounter = 0;
const originalRandomUUID = crypto.randomUUID;
beforeAll(() => {
  Object.defineProperty(crypto, "randomUUID", {
    value: () => `mock-uuid-${++uuidCounter}`,
    writable: true,
    configurable: true,
  });
});
afterAll(() => {
  Object.defineProperty(crypto, "randomUUID", {
    value: originalRandomUUID,
    writable: true,
    configurable: true,
  });
});

import {
  useManualStore,
  createSlideFromLayout,
  createSlideFromTemplate,
  type ManualSlideElement,
  type ManualSlide,
} from "@/lib/manual-store";

function resetStore() {
  uuidCounter = 0;
  useManualStore.setState({
    creations: [{
      id: "creation-1",
      title: "Test Deck",
      presentation: { title: "Test Deck", slides: [] },
      createdAt: 1000,
      updatedAt: 1000,
    }],
    activeCreationId: "creation-1",
    isLoaded: true,
    lastSavedAt: null,
    presentation: { title: "Test Deck", slides: [] },
    selectedSlideIndex: 0,
    selectedElementId: null,
    isFullscreen: false,
    showImageSearch: false,
    imageSearchTargetElementId: null,
    undoStack: [],
    redoStack: [],
  });
}

function makeElement(type: ManualSlideElement["type"], content: string, overrides?: Partial<ManualSlideElement>): ManualSlideElement {
  return {
    id: crypto.randomUUID(),
    type,
    x: 10,
    y: 10,
    w: 30,
    h: 20,
    content,
    zIndex: 1,
    ...overrides,
  };
}

function addTestSlide() {
  const store = useManualStore.getState();
  store.addSlide("single");
}

beforeEach(() => {
  mockFetch.mockClear();
  resetStore();
});

describe("manual-store: slide CRUD", () => {
  it("adds a slide from layout", () => {
    addTestSlide();
    const state = useManualStore.getState();
    expect(state.presentation.slides).toHaveLength(1);
    expect(state.selectedSlideIndex).toBe(0);
  });

  it("adds a slide from a predefined template", () => {
    const store = useManualStore.getState();
    store.addSlideFromTemplate("cover");
    const state = useManualStore.getState();
    expect(state.presentation.slides).toHaveLength(1);
    expect(state.presentation.slides[0].elements.length).toBeGreaterThan(1);
  });

  it("duplicates a slide", () => {
    addTestSlide();
    const store = useManualStore.getState();
    store.duplicateSlide(0);
    const state = useManualStore.getState();
    expect(state.presentation.slides).toHaveLength(2);
    expect(state.selectedSlideIndex).toBe(1);
    // IDs must differ
    expect(state.presentation.slides[0].id).not.toBe(state.presentation.slides[1].id);
  });

  it("deletes a slide", () => {
    addTestSlide();
    addTestSlide();
    const store = useManualStore.getState();
    store.deleteSlide(0);
    const state = useManualStore.getState();
    expect(state.presentation.slides).toHaveLength(1);
  });

  it("deletes multiple slides", () => {
    addTestSlide();
    addTestSlide();
    addTestSlide();
    const store = useManualStore.getState();
    store.deleteSlides([0, 2]);
    const state = useManualStore.getState();
    expect(state.presentation.slides).toHaveLength(1);
  });

  it("moves a slide", () => {
    addTestSlide();
    addTestSlide();
    const state0 = useManualStore.getState();
    const id0 = state0.presentation.slides[0].id;
    const id1 = state0.presentation.slides[1].id;

    state0.moveSlide(0, 1);
    const state = useManualStore.getState();
    expect(state.presentation.slides[0].id).toBe(id1);
    expect(state.presentation.slides[1].id).toBe(id0);
    expect(state.selectedSlideIndex).toBe(1);
  });
});

describe("manual-store: addElement / removeElement", () => {
  it("adds an element to a slide", () => {
    addTestSlide();
    const el = makeElement("text", "Hello World");
    useManualStore.getState().addElement(0, el);
    const state = useManualStore.getState();
    const slide = state.presentation.slides[0];
    expect(slide.elements.some((e) => e.content === "Hello World")).toBe(true);
  });

  it("removes an element from a slide", () => {
    addTestSlide();
    const el = makeElement("text", "To Be Removed");
    useManualStore.getState().addElement(0, el);
    const addedId = useManualStore.getState().presentation.slides[0].elements.find((e) => e.content === "To Be Removed")!.id;

    useManualStore.getState().removeElement(0, addedId);
    const state = useManualStore.getState();
    expect(state.presentation.slides[0].elements.find((e) => e.id === addedId)).toBeUndefined();
    expect(state.selectedElementId).toBeNull();
  });

  it("does nothing when removing from an invalid slide index", () => {
    addTestSlide();
    const countBefore = useManualStore.getState().presentation.slides[0].elements.length;
    useManualStore.getState().removeElement(99, "nonexistent");
    const countAfter = useManualStore.getState().presentation.slides[0].elements.length;
    expect(countAfter).toBe(countBefore);
  });
});

describe("manual-store: updateElement", () => {
  it("updates an element's properties", () => {
    addTestSlide();
    const el = makeElement("title", "Original Title", { fontSize: 24 });
    useManualStore.getState().addElement(0, el);
    const addedId = useManualStore.getState().presentation.slides[0].elements
      .find((e) => e.content === "Original Title")!.id;

    useManualStore.getState().updateElement(0, addedId, { content: "Updated Title", fontSize: 32 });
    const updated = useManualStore.getState().presentation.slides[0].elements.find((e) => e.id === addedId)!;
    expect(updated.content).toBe("Updated Title");
    expect(updated.fontSize).toBe(32);
  });

  it("updates multiple elements in batch", () => {
    addTestSlide();
    const el1 = makeElement("text", "Text A");
    const el2 = makeElement("text", "Text B");
    useManualStore.getState().addElement(0, el1);
    useManualStore.getState().addElement(0, el2);

    const elements = useManualStore.getState().presentation.slides[0].elements;
    const id1 = elements.find((e) => e.content === "Text A")!.id;
    const id2 = elements.find((e) => e.content === "Text B")!.id;

    useManualStore.getState().updateElements(0, [
      { elementId: id1, updates: { content: "A Updated" } },
      { elementId: id2, updates: { content: "B Updated" } },
    ]);

    const updated = useManualStore.getState().presentation.slides[0].elements;
    expect(updated.find((e) => e.id === id1)!.content).toBe("A Updated");
    expect(updated.find((e) => e.id === id2)!.content).toBe("B Updated");
  });
});

describe("manual-store: undo/redo", () => {
  it("cannot undo when stack is empty", () => {
    expect(useManualStore.getState().canUndo()).toBe(false);
  });

  it("cannot redo when stack is empty", () => {
    expect(useManualStore.getState().canRedo()).toBe(false);
  });

  it("undoes addSlide", () => {
    addTestSlide();
    expect(useManualStore.getState().presentation.slides).toHaveLength(1);
    expect(useManualStore.getState().canUndo()).toBe(true);

    useManualStore.getState().undo();
    expect(useManualStore.getState().presentation.slides).toHaveLength(0);
    expect(useManualStore.getState().canRedo()).toBe(true);
  });

  it("redoes after undo", () => {
    addTestSlide();
    useManualStore.getState().undo();
    expect(useManualStore.getState().presentation.slides).toHaveLength(0);

    useManualStore.getState().redo();
    expect(useManualStore.getState().presentation.slides).toHaveLength(1);
  });

  it("undoes addElement then redoes", () => {
    addTestSlide();
    const el = makeElement("text", "Undo me");
    useManualStore.getState().addElement(0, el);
    expect(useManualStore.getState().presentation.slides[0].elements.some((e) => e.content === "Undo me")).toBe(true);

    useManualStore.getState().undo();
    // After undo, the element should be gone (reverts to state before addElement)
    const slides = useManualStore.getState().presentation.slides;
    expect(slides.length).toBeGreaterThanOrEqual(0);
    if (slides.length > 0) {
      expect(slides[0].elements.find((e) => e.content === "Undo me")).toBeUndefined();
    }

    useManualStore.getState().redo();
    const afterRedo = useManualStore.getState().presentation.slides[0].elements;
    expect(afterRedo.some((e) => e.content === "Undo me")).toBe(true);
  });

  it("undoes removeElement", () => {
    addTestSlide();
    const el = makeElement("text", "Keep me");
    useManualStore.getState().addElement(0, el);
    const addedId = useManualStore.getState().presentation.slides[0].elements
      .find((e) => e.content === "Keep me")!.id;

    useManualStore.getState().removeElement(0, addedId);
    expect(useManualStore.getState().presentation.slides[0].elements
      .find((e) => e.id === addedId)).toBeUndefined();

    useManualStore.getState().undo();
    expect(useManualStore.getState().presentation.slides[0].elements
      .some((e) => e.content === "Keep me")).toBe(true);
  });

  it("clears redo stack on new action after undo", () => {
    addTestSlide();
    addTestSlide();
    useManualStore.getState().undo();
    expect(useManualStore.getState().canRedo()).toBe(true);

    // New action should clear redo
    addTestSlide();
    expect(useManualStore.getState().canRedo()).toBe(false);
  });

  it("respects MAX_UNDO limit of 50", () => {
    for (let i = 0; i < 55; i++) {
      addTestSlide();
    }
    const undoSize = useManualStore.getState().undoStack.length;
    expect(undoSize).toBeLessThanOrEqual(50);
  });

  it("undoes updateElement", () => {
    addTestSlide();
    const el = makeElement("title", "Before");
    useManualStore.getState().addElement(0, el);
    const addedId = useManualStore.getState().presentation.slides[0].elements
      .find((e) => e.content === "Before")!.id;

    useManualStore.getState().updateElement(0, addedId, { content: "After" });
    expect(useManualStore.getState().presentation.slides[0].elements
      .find((e) => e.id === addedId)!.content).toBe("After");

    useManualStore.getState().undo();
    expect(useManualStore.getState().presentation.slides[0].elements
      .find((e) => e.id === addedId)!.content).toBe("Before");
  });
});

describe("manual-store: copy/paste simulation", () => {
  it("simulates copy + paste by creating an element with offset and new ID", () => {
    addTestSlide();
    const el = makeElement("text", "Copy Me", { x: 20, y: 30 });
    useManualStore.getState().addElement(0, el);

    const source = useManualStore.getState().presentation.slides[0].elements
      .find((e) => e.content === "Copy Me")!;

    // Simulate paste: clone with offset + new ID (as ManualCreator does)
    const pasted: ManualSlideElement = {
      ...JSON.parse(JSON.stringify(source)),
      id: crypto.randomUUID(),
      x: source.x + 2,
      y: source.y + 2,
    };

    useManualStore.getState().addElement(0, pasted);

    const elements = useManualStore.getState().presentation.slides[0].elements;
    const copies = elements.filter((e) => e.content === "Copy Me");
    expect(copies).toHaveLength(2);
    expect(copies[0].id).not.toBe(copies[1].id);
    expect(copies[1].x).toBe(source.x + 2);
    expect(copies[1].y).toBe(source.y + 2);
  });

  it("paste is undoable", () => {
    addTestSlide();
    const el = makeElement("text", "Original");
    useManualStore.getState().addElement(0, el);

    const source = useManualStore.getState().presentation.slides[0].elements
      .find((e) => e.content === "Original")!;

    const pasted: ManualSlideElement = {
      ...JSON.parse(JSON.stringify(source)),
      id: crypto.randomUUID(),
      x: source.x + 2,
      y: source.y + 2,
    };
    useManualStore.getState().addElement(0, pasted);
    expect(useManualStore.getState().presentation.slides[0].elements.filter((e) => e.content === "Original")).toHaveLength(2);

    useManualStore.getState().undo();
    expect(useManualStore.getState().presentation.slides[0].elements.filter((e) => e.content === "Original")).toHaveLength(1);
  });
});

describe("manual-store: slide notes and bg color", () => {
  it("updates slide notes and pushes undo", () => {
    addTestSlide();
    useManualStore.getState().updateSlideNotes(0, "New notes");
    expect(useManualStore.getState().presentation.slides[0].notes).toBe("New notes");
    expect(useManualStore.getState().canUndo()).toBe(true);
  });

  it("updates slide background color", () => {
    addTestSlide();
    useManualStore.getState().updateSlideBgColor(0, "FF0000");
    expect(useManualStore.getState().presentation.slides[0].bgColor).toBe("FF0000");
  });

  it("applies background color to all slides", () => {
    addTestSlide();
    addTestSlide();
    useManualStore.getState().applyBgColorToAll("00FF00");
    const slides = useManualStore.getState().presentation.slides;
    expect(slides.every((s) => s.bgColor === "00FF00")).toBe(true);
  });
});

describe("manual-store: createSlideFromLayout / createSlideFromTemplate", () => {
  it("creates a slide with correct layout", () => {
    const slide = createSlideFromLayout("two-cards");
    expect(slide.layout).toBe("two-cards");
    expect(slide.elements.length).toBeGreaterThanOrEqual(2);
  });

  it("creates a cover template with expected elements", () => {
    const slide = createSlideFromTemplate("cover");
    expect(slide.bgColor).toBe("0F172A");
    const types = slide.elements.map((e) => e.type);
    expect(types).toContain("title");
    expect(types).toContain("subtitle");
    expect(types).toContain("image");
  });

  it("creates a comparison template with two columns", () => {
    const slide = createSlideFromTemplate("comparison");
    expect(slide.elements.filter((e) => e.type === "bullets")).toHaveLength(2);
    const subtitles = slide.elements.filter((e) => e.type === "subtitle");
    expect(subtitles.some((s) => s.content.includes("Option A"))).toBe(true);
    expect(subtitles.some((s) => s.content.includes("Option B"))).toBe(true);
  });

  it("creates a timeline template with steps", () => {
    const slide = createSlideFromTemplate("timeline");
    const texts = slide.elements.filter((e) => e.type === "text" && e.content.includes("Step"));
    expect(texts.length).toBeGreaterThanOrEqual(4);
  });

  it("creates a closing template", () => {
    const slide = createSlideFromTemplate("closing");
    expect(slide.elements.some((e) => e.content.includes("Thank You"))).toBe(true);
  });
});

describe("manual-store: no-op guards", () => {
  it("does not add a slide without an active creation", () => {
    useManualStore.setState({ activeCreationId: null });
    useManualStore.getState().addSlide("single");
    expect(useManualStore.getState().presentation.slides).toHaveLength(0);
  });

  it("does not undo without an active creation", () => {
    useManualStore.setState({ activeCreationId: null, undoStack: [{ slides: [], selectedSlideIndex: 0 }] });
    useManualStore.getState().undo();
    // Should not crash
    expect(useManualStore.getState().undoStack).toHaveLength(1);
  });

  it("does not redo without an active creation", () => {
    useManualStore.setState({ activeCreationId: null, redoStack: [{ slides: [], selectedSlideIndex: 0 }] });
    useManualStore.getState().redo();
    expect(useManualStore.getState().redoStack).toHaveLength(1);
  });
});
