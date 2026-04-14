"use client";

import { useCallback, useRef, useState } from "react";
import { useAppStore } from "@/lib/store";
import { UI_TEXT } from "@/lib/presets";
import { IconUpload } from "./Icons";

export default function FileUploader() {
  const { settings, setSourceText, setSourceFileName } = useAppStore();
  const lang = settings.language;
  const t = UI_TEXT[lang];

  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(
    async (file: File) => {
      setError("");
      const name = file.name.toLowerCase();
      if (!name.endsWith(".pdf") && !name.endsWith(".docx") && !name.endsWith(".txt")) {
        setError(t.unsupportedFile);
        return;
      }

      setUploading(true);
      try {
        const formData = new FormData();
        formData.append("file", file);

        const res = await fetch("/api/parse", { method: "POST", body: formData });
        const data = await res.json();

        if (!res.ok) {
          setError(data.error || "Upload failed");
          return;
        }

        setSourceText(data.text);
        setSourceFileName(data.fileName);
      } catch {
        setError("Failed to upload file");
      } finally {
        setUploading(false);
      }
    },
    [t.unsupportedFile, setSourceText, setSourceFileName]
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  return (
    <div className="space-y-3">
      <label className="block text-sm font-medium">{t.uploadFile}</label>

      {/* Drop zone */}
      <div
        onDragOver={(e) => {
          if (uploading) return;
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          if (uploading) return;
          onDrop(e);
        }}
        onClick={() => !uploading && fileRef.current?.click()}
        className={`border-2 border-dashed rounded-xl p-8 text-center transition-colors ${
          uploading
            ? "border-[var(--border)] opacity-60 cursor-not-allowed"
            : dragging
            ? "border-[var(--accent)] bg-[var(--accent)]/10 cursor-pointer"
            : "border-[var(--border)] hover:border-[var(--muted)] cursor-pointer"
        }`}
      >
        <input
          ref={fileRef}
          type="file"
          accept=".pdf,.docx,.txt"
          className="hidden"
          disabled={uploading}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
          }}
        />
        {uploading ? (
          <>
            <div className="text-[var(--accent)] mb-3 flex justify-center">
              <svg className="animate-spin h-8 w-8" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            </div>
            <p className="text-sm text-[var(--muted)] font-medium">
              {lang === "es" ? "Procesando archivo..." : "Processing file..."}
            </p>
            <div className="mt-3 w-full bg-[var(--border)] rounded-full h-1.5 overflow-hidden">
              <div className="bg-[var(--accent)] h-full rounded-full animate-pulse" style={{ width: "60%" }} />
            </div>
          </>
        ) : (
          <>
            <div className="text-[var(--muted)] mb-2"><IconUpload size={32} /></div>
            <p className="text-sm text-[var(--muted)]">{t.dragDrop}</p>
            <button
              type="button"
              className="mt-3 text-xs text-[var(--accent)] hover:text-[var(--accent-hover)] font-medium"
            >
              {t.browse}
            </button>
          </>
        )}
      </div>

      {error && (
        <p className="text-xs text-[var(--danger)]">{error}</p>
      )}
    </div>
  );
}
