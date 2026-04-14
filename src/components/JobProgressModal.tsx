"use client";

import { useEffect, useRef, useState } from "react";
import { IconLoader, IconCheck, IconWarning, IconStop } from "./Icons";
import { X } from "lucide-react";

interface ProgressLogEntry {
  timestamp: number;
  percent: number;
  message: string;
}

interface PreviewSlide {
  title: string;
  bullets: string[];
  notes: string;
  section?: string;
  imageUrls?: string[];
}

interface JobProgressModalProps {
  jobId: string;
  title: string;
  status: "running" | "completed" | "error";
  percent: number;
  message: string;
  progressLog: ProgressLogEntry[];
  previewSlides: PreviewSlide[];
  expectedSlides?: number;
  onClose: () => void;
  onStop: (jobId: string) => void;
  onCompleted?: (jobId: string) => void;
  lang: "en" | "es";
}

export default function JobProgressModal({
  jobId,
  title,
  status,
  percent,
  message,
  progressLog,
  previewSlides,
  expectedSlides,
  onClose,
  onStop,
  onCompleted,
  lang,
}: JobProgressModalProps) {
  const logScrollRef = useRef<HTMLDivElement>(null);
  const previewScrollRef = useRef<HTMLDivElement>(null);
  const [currentTime, setCurrentTime] = useState(Date.now());

  // Live timer: update every second for real-time elapsed display
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(Date.now());
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // Auto-scroll to bottom when new log entries arrive.
  useEffect(() => {
    const el = logScrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [progressLog.length]);

  // Auto-scroll preview to show newest generated slide.
  useEffect(() => {
    const el = previewScrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [previewSlides.length]);

  // Auto-close and open edit when job completes
  useEffect(() => {
    if (status === "completed" && onCompleted) {
      const timer = setTimeout(() => onCompleted(jobId), 1200);
      return () => clearTimeout(timer);
    }
  }, [status, jobId, onCompleted]);

  const isRunning = status === "running";
  const isError = status === "error";

  // Timeout warning: AI has a 15-minute timeout
  const AI_TIMEOUT_MS = 15 * 60 * 1000;
  const TIMEOUT_WARN_MS = 13 * 60 * 1000; // warn at 13 min
  const elapsedMs = currentTime - baseTime;
  const isNearTimeout = isRunning && elapsedMs >= TIMEOUT_WARN_MS;
  const isTimedOut = isError && progressLog.some((e) => e.message.includes("timed out") || e.message.includes("timeout") || e.message.includes("aborted"));
  const timeoutRemainingSeconds = Math.max(0, Math.ceil((AI_TIMEOUT_MS - elapsedMs) / 1000));
  const timeoutRemainingMin = Math.floor(timeoutRemainingSeconds / 60);
  const timeoutRemainingSec = timeoutRemainingSeconds % 60;

  const statusIcon = isRunning ? (
    <IconLoader size={18} className="animate-spin text-blue-400" />
  ) : isError ? (
    <IconWarning size={18} className="text-red-400" />
  ) : (
    <IconCheck size={18} className="text-emerald-400" />
  );

  const statusLabel = isRunning
    ? lang === "es" ? "En progreso" : "In Progress"
    : isError
    ? lang === "es" ? "Error" : "Error"
    : lang === "es" ? "Completado" : "Completed";

  const barColor = isError ? "bg-red-500" : isRunning ? "bg-blue-500" : "bg-emerald-500";
  const barBg = isError ? "bg-red-500/15" : isRunning ? "bg-blue-500/15" : "bg-emerald-500/15";

  // Format relative time from first log entry
  const baseTime = progressLog.length > 0 ? progressLog[0].timestamp : Date.now();

  const formatTime = (ts: number) => {
    const diff = Math.max(0, Math.round((ts - baseTime) / 1000));
    const h = Math.floor(diff / 3600);
    const m = Math.floor((diff % 3600) / 60);
    const s = diff % 60;
    if (h > 0) {
      return `${h}h ${m}m ${s}s`;
    } else if (m > 0) {
      return `${m}m ${s}s`;
    } else {
      return `${s}s`;
    }
  };

  const generatedCount = previewSlides.length;
  const totalCount = expectedSlides ?? generatedCount;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl shadow-2xl w-full max-w-6xl mx-4 flex flex-col h-[640px]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-6 pt-5 pb-4 border-b border-[var(--border)]">
          {statusIcon}
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-semibold truncate">{title}</h2>
            <p className="text-xs text-[var(--muted)]">{statusLabel}</p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-[var(--surface-2)] transition-colors text-[var(--muted)] hover:text-[var(--fg)]"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[1.2fr_1fr]">
          {/* Live slide previews */}
          <div className="min-h-0 border-b lg:border-b-0 lg:border-r border-[var(--border)] flex flex-col">
            <div className="px-6 pt-4 pb-2">
              <h3 className="text-[10px] font-semibold text-[var(--muted)] uppercase tracking-wider">
                {lang === "es" ? "Vista previa en vivo" : "Live Slide Preview"}
              </h3>
              <p className="text-xs text-[var(--muted)] mt-1">
                {generatedCount}/{totalCount} {lang === "es" ? "diapositivas generadas" : "slides generated"}
              </p>
            </div>
            <div ref={previewScrollRef} className="flex-1 min-h-0 overflow-y-auto px-4 pb-4">
              {previewSlides.length === 0 ? (
                <div className="h-full min-h-[180px] rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface-2)]/40 flex items-center justify-center px-6 text-center">
                  <p className="text-sm text-[var(--muted)]">
                    {lang === "es"
                      ? "Las diapositivas apareceran aqui en cuanto se vayan generando."
                      : "Slides will appear here as soon as they are generated."}
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  {previewSlides.map((slide, idx) => {
                    const hasImage = slide.imageUrls && slide.imageUrls.length > 0;
                    return (
                      <article
                        key={`${idx}-${slide.title}`}
                        className="rounded-md border border-[var(--border)] overflow-hidden"
                        style={{ aspectRatio: "16 / 9" }}
                      >
                        <div className="relative w-full h-full bg-slate-900 overflow-hidden">
                          {/* Background image */}
                          {hasImage && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={slide.imageUrls![0]}
                              alt=""
                              className="absolute inset-0 w-full h-full object-cover"
                              loading="lazy"
                            />
                          )}
                          {/* Dark overlay for text readability */}
                          <div className={`absolute inset-0 ${hasImage ? "bg-black/50" : "bg-gradient-to-br from-slate-800 to-slate-900"}`} />

                          {/* Slide content overlay */}
                          <div className="relative z-10 flex flex-col justify-between w-full h-full p-2">
                            {/* Top row: slide number + section */}
                            <div className="flex items-center justify-between gap-1">
                              <span className="text-[8px] font-bold text-white/60 bg-white/10 px-1 py-px rounded shrink-0">
                                {idx + 1}
                              </span>
                              {slide.section && (
                                <span className="text-[7px] px-1 py-px rounded bg-blue-500/20 text-blue-300 truncate">
                                  {slide.section}
                                </span>
                              )}
                            </div>

                            {/* Center: title + bullets */}
                            <div className="flex-1 flex flex-col justify-center min-h-0 px-0.5">
                              <h4 className="text-[10px] font-bold text-white leading-tight line-clamp-2 mb-0.5">
                                {slide.title || "..."}
                              </h4>
                              {slide.bullets.length > 0 && (
                                <ul className="space-y-px">
                                  {slide.bullets.slice(0, 3).map((bullet, bIdx) => (
                                    <li
                                      key={`${idx}-b-${bIdx}`}
                                      className="text-[7px] text-white/60 leading-snug flex items-start gap-1"
                                    >
                                      <span className="w-0.5 h-0.5 rounded-full bg-blue-400/60 mt-[3px] shrink-0" />
                                      <span className="line-clamp-1">{bullet}</span>
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </div>

                            {/* Bottom accent */}
                            <div className="h-px w-full bg-gradient-to-r from-blue-400/40 to-transparent" />
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Progress and activity log */}
          <div className="min-h-0 flex flex-col">
            <div className="px-6 pt-4 pb-2">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs text-[var(--muted)] truncate max-w-[80%]">{message}</span>
                <span className="text-xs font-semibold text-[var(--fg)]">{percent}%</span>
              </div>
              <div className={`relative h-2 w-full rounded-full ${barBg} overflow-hidden`}>
                <div
                  className={`absolute inset-y-0 left-0 rounded-full ${barColor} transition-all duration-500 ease-out`}
                  style={{ width: `${percent}%` }}
                />
              </div>
            </div>

            {/* Timeout warning banner */}
            {(isNearTimeout || isTimedOut) && (
              <div className={`mx-6 mb-2 flex items-start gap-2 rounded-lg px-3 py-2 text-xs ${
                isTimedOut
                  ? "bg-red-500/10 border border-red-500/20 text-red-400"
                  : "bg-amber-500/10 border border-amber-500/20 text-amber-400"
              }`}>
                <IconWarning size={14} className="mt-0.5 shrink-0" />
                <span>
                  {isTimedOut
                    ? (lang === "es"
                      ? "La generación excedió el límite de 15 minutos y fue cancelada automáticamente. Intenta con menos diapositivas o un modelo más rápido."
                      : "Generation exceeded the 15-minute limit and was automatically cancelled. Try fewer slides or a faster model.")
                    : (lang === "es"
                      ? `Atención: la generación se detendrá automáticamente en ${timeoutRemainingMin}m ${timeoutRemainingSec}s (límite de 15 minutos).`
                      : `Warning: generation will automatically stop in ${timeoutRemainingMin}m ${timeoutRemainingSec}s (15-minute limit).`)}
                </span>
              </div>
            )}

            <div className="px-6 pt-2 pb-1 flex items-center justify-between">
              <h3 className="text-[10px] font-semibold text-[var(--muted)] uppercase tracking-wider">
                {lang === "es" ? "Registro de actividad" : "Activity Log"}
              </h3>
              {isRunning && (
                <span className="text-[10px] font-mono text-blue-400 font-semibold">
                  {formatTime(currentTime)}
                </span>
              )}
            </div>
            <div ref={logScrollRef} className="flex-1 min-h-0 overflow-y-auto px-6 pb-4">
              <div className="relative pl-4 border-l-2 border-[var(--border)] space-y-0">
                {progressLog.map((entry, i) => {
                  const isLast = i === progressLog.length - 1;
                  const isErrorEntry = entry.message.startsWith("Error:");
                  const isWarningEntry = entry.message.startsWith("Warning:");
                  const isDone = entry.message === "Done";

                  return (
                    <div key={i} className="relative py-1.5 group">
                      {/* Timeline dot */}
                      <div
                        className={`absolute -left-[calc(0.25rem+5px)] top-[11px] w-2 h-2 rounded-full border-2 ${
                          isErrorEntry
                            ? "bg-red-500 border-red-500"
                            : isWarningEntry
                            ? "bg-amber-500 border-amber-500"
                            : isDone
                            ? "bg-emerald-500 border-emerald-500"
                            : isLast && isRunning
                            ? "bg-blue-500 border-blue-500 animate-pulse"
                            : "bg-[var(--surface-2)] border-[var(--muted)]"
                        }`}
                      />
                      <div className="flex items-start gap-2 ml-2">
                        <span className="text-[10px] text-[var(--muted)] font-mono shrink-0 w-10 pt-px">
                          {formatTime(entry.timestamp)}
                        </span>
                        <span className="text-[10px] text-[var(--muted)] font-mono shrink-0 w-8 pt-px text-right">
                          {entry.percent}%
                        </span>
                        <span
                          className={`text-xs leading-snug ${
                            isErrorEntry
                              ? "text-red-400"
                              : isWarningEntry
                              ? "text-amber-400"
                              : isDone
                              ? "text-emerald-400 font-medium"
                              : isLast && isRunning
                              ? "text-[var(--fg)] font-medium"
                              : "text-[var(--muted)]"
                          }`}
                        >
                          {entry.message}
                        </span>
                      </div>
                    </div>
                  );
                })}
                {isRunning && (
                  <div className="relative py-1.5">
                    <div className="absolute -left-[calc(0.25rem+5px)] top-[11px] w-2 h-2 rounded-full bg-blue-500/30 animate-ping" />
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        {isRunning && (
          <div className="px-6 py-3 border-t border-[var(--border)] flex justify-end">
            <button
              onClick={() => onStop(jobId)}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors"
            >
              <IconStop size={13} />
              {lang === "es" ? "Detener" : "Stop"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
