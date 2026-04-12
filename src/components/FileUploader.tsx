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
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => fileRef.current?.click()}
        className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${
          dragging
            ? "border-[var(--accent)] bg-[var(--accent)]/10"
            : "border-[var(--border)] hover:border-[var(--muted)]"
        }`}
      >
        <input
          ref={fileRef}
          type="file"
          accept=".pdf,.docx,.txt"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
          }}
        />
        <div className="text-[var(--muted)] mb-2"><IconUpload size={32} /></div>
        <p className="text-sm text-[var(--muted)]">
          {uploading ? "Processing..." : t.dragDrop}
        </p>
        <button
          type="button"
          className="mt-3 text-xs text-[var(--accent)] hover:text-[var(--accent-hover)] font-medium"
        >
          {t.browse}
        </button>
      </div>

      {error && (
        <p className="text-xs text-[var(--danger)]">{error}</p>
      )}
    </div>
  );
}
