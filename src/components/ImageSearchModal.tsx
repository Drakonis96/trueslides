"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useAppStore } from "@/lib/store";
import { UI_TEXT } from "@/lib/presets";
import { ImageSourceId, SlideLayoutId, SLIDE_LAYOUTS } from "@/lib/types";
import { IconSearch, IconLoader, IconImage, IconGlobe, IconInfo } from "./Icons";
import { fetchImagesWithCache } from "@/lib/image-cache-idb";

interface ImageResult {
  title: string;
  url: string;
  thumbUrl: string;
  width: number;
  height: number;
  source: "wikimedia" | "unsplash" | "pexels" | "pixabay" | "flickr" | "openverse" | "loc" | "europeana" | "hispana" | "web";
  description?: string;
  author?: string;
  pageUrl?: string;
  license?: string;
}

const SOURCE_LABELS: Record<string, string> = {
  wikimedia: "Wikimedia",
  openverse: "Openverse",
  unsplash: "Unsplash",
  pexels: "Pexels",
  pixabay: "Pixabay",
  flickr: "Flickr",
  loc: "Library of Congress",
  europeana: "Europeana",
  hispana: "Hispana",
  web: "Web",
};

interface ImageSearchModalProps {
  slotIndex: number;
  expectedSlots?: number;
  layoutId?: SlideLayoutId;
  currentImageUrls?: string[];
  requireSlotSelectionOnSelect?: boolean;
  slideTitle?: string;
  presentationTopic?: string;
  onSelect: (image: ImageResult, slotIndex: number) => void;
  onSlotChange?: (slotIndex: number) => void;
  onClose: () => void;
}

export default function ImageSearchModal({
  slotIndex,
  expectedSlots = 1,
  layoutId,
  currentImageUrls = [],
  requireSlotSelectionOnSelect = false,
  slideTitle,
  presentationTopic,
  onSelect,
  onSlotChange,
  onClose,
}: ImageSearchModalProps) {
  const { settings } = useAppStore();
  const lang = settings.language;
  const t = UI_TEXT[lang];

  const enabledSources: ImageSourceId[] = settings.enabledImageSources;

  const [query, setQuery] = useState(slideTitle || "");
  const [sourceFilter, setSourceFilter] = useState<ImageSourceId | "all">("all");
  const [results, setResults] = useState<ImageResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [selectedUrl, setSelectedUrl] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<number>(slotIndex);
  const [showSlotPicker, setShowSlotPicker] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const lastSearchedQuery = useRef("");
  const searchingRef = useRef(false);
  const searchGenRef = useRef(0);
  const [translateToEnglish, setTranslateToEnglish] = useState(false);
  const [translating, setTranslating] = useState(false);
  const [infoImage, setInfoImage] = useState<ImageResult | null>(null);
  const [webMode, setWebMode] = useState(false);
  const [webImages, setWebImages] = useState<ImageResult[]>([]);
  const [dropActive, setDropActive] = useState(false);
  const [pasteUrl, setPasteUrl] = useState("");
  const [pasteError, setPasteError] = useState("");

  const PAGE_SIZE = 12;
  const slotCount = Math.max(1, expectedSlots);
  const layoutDef = layoutId
    ? SLIDE_LAYOUTS.find((layout) => layout.id === layoutId)
    : undefined;
  const slotFrames = layoutDef
    ? layoutDef.slots.slice(0, slotCount)
    : Array.from({ length: slotCount }, (_, i) => ({
        x: i / slotCount,
        y: 0,
        w: 1 / slotCount,
        h: 1,
      }));

  useEffect(() => {
    const clamped = Math.min(Math.max(slotIndex, 0), Math.max(0, slotCount - 1));
    setSelectedSlot(clamped);
  }, [slotIndex, slotCount]);

  useEffect(() => {
    setShowSlotPicker(false);
  }, [selectedUrl]);

  const { getEffectiveSelection } = useAppStore();

  const translateQuery = useCallback(async (text: string): Promise<string> => {
    if (!translateToEnglish) return text;
    const { provider, modelId } = getEffectiveSelection();
    if (!provider || !modelId) return text;
    try {
      setTranslating(true);
      const res = await fetch("/api/translate-query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, modelId, text }),
      });
      if (!res.ok) return text;
      const data = await res.json();
      return data.translated || text;
    } catch {
      return text;
    } finally {
      setTranslating(false);
    }
  }, [translateToEnglish, getEffectiveSelection]);

  const doSearch = useCallback(async (append: boolean, overrideSource?: ImageSourceId | "all") => {
    const trimmed = query.trim();
    if (!trimmed) return;
    // For "load more", block if already loading more
    if (append && loadingMore) return;

    const activeSource = overrideSource ?? sourceFilter;

    // Bump generation so any in-flight non-append search becomes stale
    const gen = append ? searchGenRef.current : ++searchGenRef.current;

    if (append) {
      setLoadingMore(true);
    } else {
      searchingRef.current = true;
      setSearching(true);
      setHasSearched(true);
      setResults([]);
      setSelectedUrl(null);
    }
    lastSearchedQuery.current = trimmed;

    try {
      const searchText = await translateQuery(trimmed);

      // If a newer search was started while we were translating, abort
      if (gen !== searchGenRef.current) return;

      const sourcesToSearch =
        activeSource === "all"
          ? enabledSources
          : enabledSources.includes(activeSource)
          ? [activeSource]
          : [activeSource];

      // Exclude already-loaded URLs when loading more
      const excludeUrls = append
        ? results.flatMap((r) => [r.url, r.thumbUrl])
        : [];

      const data = await fetchImagesWithCache({
          searchTerms: [[searchText]],
          presentationTopic: presentationTopic || "",
          slideContexts: [{ title: searchText, bullets: [], section: "" }],
          enabledSources: sourcesToSearch,
          limit: PAGE_SIZE,
          exclude: excludeUrls,
          speedOptions: {
            maxFallbackAttempts: 0,
            skipCategorySearch: true,
            reduceQueryCandidates: true,
            lowerFetchLimit: true,
          },
        });

      // If a newer search was started while we were fetching, discard results
      if (gen !== searchGenRef.current) return;

      if (data.ok && data.images?.[0]) {
        const newImages = data.images[0] as ImageResult[];
        if (append) {
          setResults((prev) => [...prev, ...newImages]);
          // Keep "Load More" visible as long as new results were returned;
          // the exclude-based pagination may return fewer than PAGE_SIZE
          // from cached results even when more exist.
          setHasMore(newImages.length > 0);
        } else {
          setResults(newImages);
          setHasMore(newImages.length >= PAGE_SIZE);
        }
      } else {
        if (!append) setResults([]);
        setHasMore(false);
      }
    } catch {
      if (gen !== searchGenRef.current) return;
      if (!append) setResults([]);
      setHasMore(false);
    } finally {
      if (gen === searchGenRef.current) {
        searchingRef.current = false;
        setSearching(false);
      }
      setLoadingMore(false);
    }
  }, [query, sourceFilter, enabledSources, presentationTopic, loadingMore, results, translateQuery]);

  const handleSearch = useCallback(() => doSearch(false), [doSearch]);
  const handleLoadMore = useCallback(() => doSearch(true), [doSearch]);

  // ── Web mode helpers ──

  const addWebImage = useCallback((url: string, title?: string) => {
    setWebImages((prev) => {
      if (prev.some((img) => img.url === url)) return prev;
      return [
        {
          title: title || "Web image",
          url,
          thumbUrl: url,
          width: 0,
          height: 0,
          source: "web" as const,
        },
        ...prev,
      ];
    });
    setSelectedUrl(url);
  }, []);

  const removeWebImage = useCallback(
    (url: string) => {
      setWebImages((prev) => prev.filter((img) => img.url !== url));
      if (selectedUrl === url) setSelectedUrl(null);
    },
    [selectedUrl],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDropActive(false);

      // Check for files first (desktop drops)
      if (e.dataTransfer.files.length > 0) {
        const file = e.dataTransfer.files[0];
        if (file.type.startsWith("image/")) {
          const reader = new FileReader();
          reader.onload = () => {
            if (typeof reader.result === "string") {
              addWebImage(reader.result, file.name.replace(/\.[^.]+$/, ""));
            }
          };
          reader.readAsDataURL(file);
          return;
        }
      }

      // Try to extract URL from HTML (best for browser image drags)
      const html = e.dataTransfer.getData("text/html");
      if (html) {
        const match = html.match(/<img[^>]+src=["']([^"']+)["']/i);
        if (
          match?.[1] &&
          (match[1].startsWith("http") || match[1].startsWith("data:"))
        ) {
          addWebImage(match[1]);
          return;
        }
      }

      // Try URI list
      const uri = e.dataTransfer.getData("text/uri-list");
      if (uri && uri.startsWith("http")) {
        addWebImage(uri);
        return;
      }

      // Try plain text
      const text = e.dataTransfer.getData("text/plain");
      if (text && /^https?:\/\//.test(text.trim())) {
        addWebImage(text.trim());
      }
    },
    [addWebImage],
  );

  const handlePasteUrl = useCallback(() => {
    const url = pasteUrl.trim();
    if (!url) return;
    try {
      new URL(url);
      addWebImage(url);
      setPasteUrl("");
      setPasteError("");
    } catch {
      setPasteError(lang === "en" ? "Invalid URL" : "URL no válida");
    }
  }, [pasteUrl, addWebImage, lang]);

  const openGoogleImages = useCallback(() => {
    const q = encodeURIComponent(query.trim() || "presentation images");
    window.open(
      `https://www.google.com/search?tbm=isch&q=${q}`,
      "_blank",
      "noopener",
    );
  }, [query]);

  // Auto-search when the source filter changes and there's an active query
  const handleSourceChange = useCallback(async (src: ImageSourceId | "all") => {
    setSourceFilter(src);
    if (lastSearchedQuery.current.trim()) {
      setSearching(true);
      setHasSearched(true);
      setResults([]);
      setSelectedUrl(null);
      setHasMore(false);

      const trimmed = lastSearchedQuery.current.trim();
      const searchText = await translateQuery(trimmed);
      const sourcesToSearch =
        src === "all"
          ? enabledSources
          : enabledSources.includes(src)
          ? [src]
          : [src];

      fetchImagesWithCache({
          searchTerms: [[searchText]],
          presentationTopic: presentationTopic || "",
          slideContexts: [{ title: searchText, bullets: [], section: "" }],
          enabledSources: sourcesToSearch,
          limit: PAGE_SIZE,
          exclude: [],
          speedOptions: {
            maxFallbackAttempts: 0,
            skipCategorySearch: true,
            reduceQueryCandidates: true,
            lowerFetchLimit: true,
          },
        })
        .then((data) => {
          if (data.ok && data.images?.[0]) {
            const newImages = data.images[0] as ImageResult[];
            setResults(newImages);
            setHasMore(newImages.length >= PAGE_SIZE);
          } else {
            setResults([]);
            setHasMore(false);
          }
        })
        .catch(() => {
          setResults([]);
          setHasMore(false);
        })
        .finally(() => {
          setSearching(false);
        });
    }
  }, [enabledSources, presentationTopic, translateQuery]);

  const chooseSlot = (slot: number) => {
    const clamped = Math.min(Math.max(slot, 0), Math.max(0, slotCount - 1));
    setSelectedSlot(clamped);
    onSlotChange?.(clamped);
  };

  const handleSelect = () => {
    if (selectedUrl) {
      const pool = webMode ? webImages : results;
      const selected = pool.find((result) => result.url === selectedUrl);
      if (!selected) return;

      if (requireSlotSelectionOnSelect && slotCount > 1 && !showSlotPicker) {
        setShowSlotPicker(true);
        return;
      }

      onSelect(selected, selectedSlot);
    }
  };

  // Unique sources from enabledSources + wikimedia is always available
  const availableSources: (ImageSourceId | "all")[] = [
    "all",
    ...new Set<ImageSourceId>(["wikimedia", ...enabledSources]),
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl shadow-2xl w-full max-w-2xl mx-4 max-h-[85vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 pt-5 pb-4 border-b border-[var(--border)] shrink-0">
          <div className="flex items-center gap-2 mb-1">
            <IconSearch size={20} className="text-[var(--accent)]" />
            <h3 className="text-lg font-bold">{t.imageSearchTitle}</h3>
          </div>
          <p className="text-xs text-[var(--muted)]">
            {t.imageSearchSlot} #{selectedSlot + 1}
          </p>

          {/* Search bar */}
          <div className="flex gap-2 mt-3">
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              placeholder={t.imageSearchPlaceholder}
              className="flex-1 bg-[var(--surface-2)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[var(--accent)]"
              autoFocus
            />
            <button
              onClick={handleSearch}
              disabled={!query.trim() || searching || translating}
              className="bg-[var(--accent)] hover:bg-[var(--accent-hover)] disabled:opacity-50 text-white rounded-lg px-4 py-2 text-sm font-medium transition-colors flex items-center gap-1.5 shrink-0"
            >
              {searching || translating ? (
                <IconLoader size={14} className="animate-spin" />
              ) : (
                <IconSearch size={14} />
              )}
              {t.imageSearchButton}
            </button>
          </div>

          {/* Translate toggle + Source filter */}
          <div className="flex items-center gap-3 mt-3 flex-wrap">
            <button
              onClick={() => setTranslateToEnglish(!translateToEnglish)}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors shrink-0 ${
                translateToEnglish
                  ? "bg-[var(--accent)] text-white"
                  : "bg-[var(--surface-2)] text-[var(--muted)] hover:text-[var(--fg)]"
              }`}
              title={lang === "en" ? "Translate search query to English using AI" : "Traducir búsqueda al inglés con IA"}
            >
              {translating ? (
                <IconLoader size={12} className="animate-spin" />
              ) : (
                <IconGlobe size={12} />
              )}
              {lang === "en" ? "Translate to EN" : "Traducir a EN"}
            </button>

            <div className="w-px h-4 bg-[var(--border)]" />

            {availableSources.map((src) => (
              <button
                key={src}
                onClick={() => {
                  setWebMode(false);
                  setSelectedUrl(null);
                  handleSourceChange(src);
                }}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                  !webMode && sourceFilter === src
                    ? "bg-[var(--accent)] text-white"
                    : "bg-[var(--surface-2)] text-[var(--muted)] hover:text-[var(--fg)]"
                }`}
              >
                {src === "all" ? t.imageSearchAllSources : SOURCE_LABELS[src] || src}
              </button>
            ))}

            <div className="w-px h-4 bg-[var(--border)]" />

            <button
              onClick={() => {
                setWebMode(true);
                setSelectedUrl(null);
                setShowSlotPicker(false);
              }}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors flex items-center gap-1 ${
                webMode
                  ? "bg-[var(--accent)] text-white"
                  : "bg-[var(--surface-2)] text-[var(--muted)] hover:text-[var(--fg)]"
              }`}
            >
              <IconGlobe size={12} />
              Web
            </button>
          </div>
        </div>

        {/* Results grid */}
        <div className="flex-1 overflow-y-auto p-4">
          {showSlotPicker && selectedUrl && (
            <div className="mb-4 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-3">
              <p className="text-xs text-[var(--muted)] mb-2">
                {lang === "en"
                  ? "Choose which image slot to replace"
                  : "Elige qué hueco de imagen reemplazar"}
              </p>
              <div className="relative w-full aspect-video rounded-lg border border-[var(--border)] bg-black/5 overflow-hidden">
                {slotFrames.map((slot, i) => {
                  const isActive = selectedSlot === i;
                  const url = currentImageUrls[i];
                  return (
                    <button
                      key={i}
                      onClick={() => chooseSlot(i)}
                      className={`absolute overflow-hidden rounded-md border-2 transition-colors ${
                        isActive
                          ? "border-[var(--accent)] ring-2 ring-[var(--accent)]/30"
                          : "border-transparent hover:border-[var(--border)]"
                      }`}
                      style={{
                        left: `${slot.x * 100}%`,
                        top: `${slot.y * 100}%`,
                        width: `${slot.w * 100}%`,
                        height: `${slot.h * 100}%`,
                      }}
                    >
                      {url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={url} alt="" className="w-full h-full object-cover" loading="lazy" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-[10px] text-[var(--muted)] bg-black/5">
                          {lang === "en" ? "Empty" : "Vacío"}
                        </div>
                      )}
                      <span className="absolute top-1 left-1 text-[10px] px-1.5 py-0.5 rounded bg-black/60 text-white">
                        {i + 1}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {webMode ? (
            <div className="space-y-4">
              {/* Drop zone */}
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setDropActive(true);
                }}
                onDragEnter={(e) => {
                  e.preventDefault();
                  setDropActive(true);
                }}
                onDragLeave={(e) => {
                  e.preventDefault();
                  setDropActive(false);
                }}
                onDrop={handleDrop}
                className={`border-2 border-dashed rounded-xl p-8 text-center transition-colors ${
                  dropActive
                    ? "border-[var(--accent)] bg-[var(--accent)]/10"
                    : "border-[var(--border)] hover:border-[var(--muted)]"
                }`}
              >
                <IconImage
                  size={40}
                  className="mx-auto mb-3 text-[var(--muted)] opacity-50"
                />
                <p className="text-sm font-medium mb-1">
                  {lang === "en"
                    ? "Drag images here from your browser"
                    : "Arrastra imágenes aquí desde tu navegador"}
                </p>
                <p className="text-xs text-[var(--muted)] mb-4">
                  {lang === "en"
                    ? "Or open Google Images to find what you need"
                    : "O abre Google Images para encontrar lo que necesites"}
                </p>
                <button
                  onClick={openGoogleImages}
                  className="bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white rounded-lg px-4 py-2 text-sm font-medium transition-colors inline-flex items-center gap-2"
                >
                  <IconGlobe size={14} />
                  {lang === "en"
                    ? "Open Google Images"
                    : "Abrir Google Images"}
                </button>
              </div>

              {/* Paste URL */}
              <div className="flex gap-2">
                <input
                  type="text"
                  value={pasteUrl}
                  onChange={(e) => {
                    setPasteUrl(e.target.value);
                    setPasteError("");
                  }}
                  onKeyDown={(e) => e.key === "Enter" && handlePasteUrl()}
                  placeholder={
                    lang === "en"
                      ? "Paste image URL..."
                      : "Pegar URL de imagen..."
                  }
                  className="flex-1 bg-[var(--surface-2)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[var(--accent)]"
                />
                <button
                  onClick={handlePasteUrl}
                  disabled={!pasteUrl.trim()}
                  className="bg-[var(--surface-2)] hover:bg-[var(--surface-2)]/80 disabled:opacity-50 text-[var(--fg)] rounded-lg px-3 py-2 text-sm font-medium transition-colors"
                >
                  {lang === "en" ? "Add" : "Añadir"}
                </button>
              </div>
              {pasteError && (
                <p className="text-xs text-red-500 -mt-2">{pasteError}</p>
              )}

              {/* Web images grid */}
              {webImages.length > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {webImages.map((img, i) => {
                    const isSelected = selectedUrl === img.url;
                    return (
                      <div
                        key={`web-${i}`}
                        className="relative group"
                      >
                        <button
                          onClick={() => setSelectedUrl(img.url)}
                          className={`w-full relative rounded-xl overflow-hidden aspect-video border-2 transition-all ${
                            isSelected
                              ? "border-[var(--accent)] ring-2 ring-[var(--accent)]/30"
                              : "border-transparent hover:border-[var(--border)]"
                          }`}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={img.thumbUrl}
                            alt={img.title}
                            className="w-full h-full object-cover"
                            loading="lazy"
                            onError={(e) => {
                              (e.target as HTMLImageElement).src = "";
                              (e.target as HTMLImageElement).alt =
                                lang === "en"
                                  ? "Failed to load"
                                  : "Error al cargar";
                            }}
                          />
                          <div
                            className={`absolute inset-0 transition-opacity flex flex-col justify-end ${
                              isSelected
                                ? "opacity-100 bg-black/40"
                                : "opacity-0 group-hover:opacity-100 bg-black/30"
                            }`}
                          >
                            <div className="p-2">
                              <span className="text-[10px] bg-black/60 text-white px-1.5 py-0.5 rounded">
                                Web
                              </span>
                            </div>
                          </div>
                          {isSelected && (
                            <div className="absolute top-2 right-2 w-5 h-5 bg-[var(--accent)] rounded-full flex items-center justify-center">
                              <svg
                                width="12"
                                height="12"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="white"
                                strokeWidth="3"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              >
                                <polyline points="20 6 9 17 4 12" />
                              </svg>
                            </div>
                          )}
                        </button>
                        {/* Remove button */}
                        <button
                          onClick={() => removeWebImage(img.url)}
                          className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-red-500 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity text-xs leading-none"
                          title={lang === "en" ? "Remove" : "Eliminar"}
                        >
                          ×
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : (
            <>
          {searching && (
            <div className="flex items-center justify-center py-12 gap-2 text-[var(--muted)]">
              <IconLoader size={20} className="animate-spin text-[var(--accent)]" />
              <span className="text-sm">{t.imageSearchSearching}</span>
            </div>
          )}

          {!searching && hasSearched && results.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 gap-2 text-[var(--muted)]">
              <IconImage size={32} className="opacity-30" />
              <p className="text-sm">{t.imageSearchNoResults}</p>
            </div>
          )}

          {!searching && results.length > 0 && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {results.map((img, i) => {
                  const isSelected = selectedUrl === img.url;
                  return (
                    <button
                      key={`${img.thumbUrl}-${i}`}
                      onClick={() => setSelectedUrl(img.url)}
                      className={`group relative rounded-xl overflow-hidden aspect-video border-2 transition-all ${
                        isSelected
                          ? "border-[var(--accent)] ring-2 ring-[var(--accent)]/30"
                          : "border-transparent hover:border-[var(--border)]"
                      }`}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={img.thumbUrl}
                        alt={img.title}
                        className="w-full h-full object-cover"
                        loading="lazy"
                      />
                      {/* Hover / selected overlay */}
                      <div
                        className={`absolute inset-0 transition-opacity flex flex-col justify-end ${
                          isSelected
                            ? "opacity-100 bg-black/40"
                            : "opacity-0 group-hover:opacity-100 bg-black/30"
                        }`}
                      >
                        <div className="p-2 flex items-end justify-between">
                          <span className="text-[10px] bg-black/60 text-white px-1.5 py-0.5 rounded">
                            {SOURCE_LABELS[img.source] || img.source}
                          </span>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setInfoImage(img);
                            }}
                            className="w-5 h-5 rounded-full bg-black/60 hover:bg-black/80 flex items-center justify-center transition-colors"
                            title={lang === "en" ? "Image info" : "Info de imagen"}
                          >
                            <IconInfo size={12} className="text-white" />
                          </button>
                        </div>
                      </div>
                      {isSelected && (
                        <div className="absolute top-2 right-2 w-5 h-5 bg-[var(--accent)] rounded-full flex items-center justify-center">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>

              {hasMore && (
                <div className="flex justify-center">
                  <button
                    onClick={handleLoadMore}
                    disabled={searching || loadingMore}
                    className="px-4 py-2 rounded-lg text-sm font-medium bg-[var(--surface-2)] text-[var(--fg)] hover:bg-[var(--surface-2)]/80 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
                  >
                    {loadingMore && <IconLoader size={14} className="animate-spin" />}
                    {lang === "en" ? "Load more" : "Cargar más"}
                  </button>
                </div>
              )}
            </div>
          )}

          {!searching && !hasSearched && (
            <div className="flex flex-col items-center justify-center py-12 gap-2 text-[var(--muted)]">
              <IconSearch size={32} className="opacity-30" />
              <p className="text-sm">
                {lang === "en"
                  ? "Search for images to add to your slide"
                  : "Busca imágenes para añadir a tu diapositiva"}
              </p>
            </div>
          )}
            </>
          )}
        </div>

        {/* Footer actions */}
        <div className="px-6 py-4 border-t border-[var(--border)] flex gap-3 shrink-0">
          {showSlotPicker && (
            <button
              onClick={() => setShowSlotPicker(false)}
              className="px-4 py-2.5 rounded-lg text-sm font-medium bg-[var(--surface-2)] text-[var(--muted)] hover:text-[var(--fg)] transition-colors"
            >
              {lang === "en" ? "Back" : "Volver"}
            </button>
          )}
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2.5 rounded-lg text-sm font-medium bg-[var(--surface-2)] text-[var(--muted)] hover:text-[var(--fg)] transition-colors"
          >
            {t.cancel}
          </button>
          <button
            onClick={handleSelect}
            disabled={!selectedUrl}
            className="flex-1 bg-[var(--accent)] hover:bg-[var(--accent-hover)] disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg px-4 py-2.5 text-sm font-medium transition-colors"
          >
            {showSlotPicker
              ? lang === "en"
                ? `Replace slot #${selectedSlot + 1}`
                : `Reemplazar hueco #${selectedSlot + 1}`
              : t.imageSearchSelect}
          </button>
        </div>
      </div>

      {/* Image info modal */}
      {infoImage && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm"
          onClick={() => setInfoImage(null)}
        >
          <div
            className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Preview */}
            <div className="relative aspect-video bg-black">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={infoImage.thumbUrl}
                alt={infoImage.title}
                className="w-full h-full object-contain"
              />
            </div>
            {/* Metadata */}
            <div className="p-4 space-y-2.5 max-h-[40vh] overflow-y-auto">
              <h4 className="text-sm font-semibold leading-snug break-words">{infoImage.title}</h4>
              {infoImage.description && infoImage.description !== infoImage.title && (
                <p className="text-xs text-[var(--muted)] leading-relaxed break-words">{infoImage.description}</p>
              )}
              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                <span className="text-[var(--muted)]">{lang === "en" ? "Source" : "Fuente"}</span>
                <span className="font-medium">{SOURCE_LABELS[infoImage.source] || infoImage.source}</span>
                {infoImage.author && (
                  <>
                    <span className="text-[var(--muted)]">{lang === "en" ? "Author" : "Autor"}</span>
                    <span className="font-medium break-words">{infoImage.author}</span>
                  </>
                )}
                <span className="text-[var(--muted)]">{lang === "en" ? "Dimensions" : "Dimensiones"}</span>
                <span className="font-medium">{infoImage.width} × {infoImage.height} px</span>
                {infoImage.license && (
                  <>
                    <span className="text-[var(--muted)]">{lang === "en" ? "License" : "Licencia"}</span>
                    <span className="font-medium">{infoImage.license}</span>
                  </>
                )}
              </div>
              {infoImage.pageUrl && (
                <a
                  href={infoImage.pageUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs text-[var(--accent)] hover:underline mt-1"
                >
                  <IconGlobe size={12} />
                  {lang === "en" ? "View original page" : "Ver página original"}
                </a>
              )}
            </div>
            {/* Close */}
            <div className="px-4 pb-4">
              <button
                onClick={() => setInfoImage(null)}
                className="w-full px-4 py-2 rounded-lg text-sm font-medium bg-[var(--surface-2)] text-[var(--muted)] hover:text-[var(--fg)] transition-colors"
              >
                {lang === "en" ? "Close" : "Cerrar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
