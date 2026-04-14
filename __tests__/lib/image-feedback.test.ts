/**
 * @jest-environment node
 */

let store: Record<string, unknown> | null = null;

jest.mock("@/lib/state-store", () => ({
  getUserState: jest.fn(() => store),
  setUserState: jest.fn((state: Record<string, unknown>) => {
    store = state;
  }),
}));

import { getImageFeedbackProfile, recordImageFeedback } from "@/lib/image-feedback";

describe("image feedback store", () => {
  beforeEach(() => {
    store = null;
  });

  it("persists selected and rejected signals and retrieves them by topic", () => {
    recordImageFeedback({
      action: "selected",
      imageUrl: "https://example.com/good.jpg",
      imageTitle: "Daguerreotype camera",
      imageSource: "wikimedia",
      presentationTopic: "History of photography",
      slideContext: {
        title: "Early cameras",
        section: "Origins",
        bullets: ["Daguerreotypes became commercially important"],
      },
      queryTerms: ["daguerreotype", "antique camera"],
    });

    recordImageFeedback({
      action: "rejected",
      imageUrl: "https://example.com/bad.jpg",
      imageTitle: "Generic factory building",
      imageSource: "unsplash",
      presentationTopic: "History of photography",
      slideContext: {
        title: "Early cameras",
        section: "Origins",
      },
      queryTerms: ["camera history"],
    });

    const profile = getImageFeedbackProfile("History of photography", {
      title: "Early cameras",
      section: "Origins",
    });

    expect(profile.positiveUrls["https://example.com/good.jpg"]).toBe(1);
    expect(profile.negativeUrls["https://example.com/bad.jpg"]).toBe(1);
    expect(profile.positiveSources.wikimedia).toBe(1);
    expect(profile.negativeSources.unsplash).toBe(1);
    expect(profile.positiveTokens.daguerreotype).toBeGreaterThan(0);
  });
});