import { ImageSearchCache } from "@/lib/image-cache";

describe("ImageSearchCache", () => {
  it("stores and retrieves values by key", () => {
    const cache = new ImageSearchCache<string[]>(10, 10_000);
    cache.set("wikimedia::daguerreotype", ["a", "b"]);

    expect(cache.get("wikimedia::daguerreotype")).toEqual(["a", "b"]);
  });

  it("expires values after ttl", async () => {
    const cache = new ImageSearchCache<string[]>(10, 5);
    cache.set("wikimedia::daguerreotype", ["a"]);

    await new Promise((r) => setTimeout(r, 10));
    expect(cache.get("wikimedia::daguerreotype")).toBeUndefined();
  });

  it("evicts least recently used when full", () => {
    const cache = new ImageSearchCache<string[]>(2, 10_000);
    cache.set("s1", ["1"]);
    cache.set("s2", ["2"]);

    // Touch s1 so s2 becomes least recently used.
    cache.get("s1");
    cache.set("s3", ["3"]);

    expect(cache.get("s2")).toBeUndefined();
    expect(cache.get("s1")).toEqual(["1"]);
    expect(cache.get("s3")).toEqual(["3"]);
  });
});
