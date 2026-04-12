"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useAppStore } from "@/lib/store";
import { AIProvider, AIModel } from "@/lib/types";
import type { ChatMode } from "@/app/api/presenter-chat/route";
import { Mic, List, FileText, Bot, X, AlertTriangle } from "lucide-react";
import ReactMarkdown from "react-markdown";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  mode?: ChatMode;
}

interface PresenterAIChatProps {
  open: boolean;
  onClose: () => void;
  allNotes: string;
  presentationTitle: string;
  currentSlideIndex: number;
  currentSlideTitle: string;
}

const MODE_LABELS: Record<ChatMode, { en: string; es: string; icon: React.ReactNode }> = {
  "presenter-voice":   { en: "Presenter Voice",   es: "Voz del Presentador", icon: <Mic size={12} /> },
  "bullet-reminders":  { en: "Bullet Reminders",  es: "Puntos Clave",        icon: <List size={12} /> },
  "brief-elaboration": { en: "Brief Elaboration", es: "Elaboración Breve",   icon: <FileText size={12} /> },
};

export default function PresenterAIChat({
  open,
  onClose,
  allNotes,
  presentationTitle,
  currentSlideIndex,
  currentSlideTitle,
}: PresenterAIChatProps) {
  const lang = useAppStore((s) => s.settings.language);
  const providers = useAppStore((s) => s.settings.providers);
  const getPinnedModels = useAppStore((s) => s.getPinnedModels);

  // Independent provider/model selection for the chat
  const [chatProvider, setChatProvider] = useState<AIProvider>("openrouter");
  const [chatModelId, setChatModelId] = useState("");
  const [chatMode, setChatMode] = useState<ChatMode>("presenter-voice");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [availableModels, setAvailableModels] = useState<AIModel[]>([]);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Load models when provider changes
  useEffect(() => {
    const models = getPinnedModels(chatProvider);
    setAvailableModels(models);
    if (models.length > 0 && !models.find((m) => m.id === chatModelId)) {
      setChatModelId(models[0].id);
    }
  }, [chatProvider, getPinnedModels, chatModelId]);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Focus input when opened
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 100);
  }, [open]);

  // Escape to close
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || loading || !chatModelId) return;

    const userMsg: ChatMessage = { role: "user", content: text, mode: chatMode };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch("/api/presenter-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: chatProvider,
          modelId: chatModelId,
          mode: chatMode,
          userMessage: text,
          allNotes,
          presentationTitle,
          currentSlideIndex,
          currentSlideTitle,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Request failed");

      setMessages((prev) => [...prev, { role: "assistant", content: data.response }]);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : "Unknown error";
      setMessages((prev) => [...prev, { role: "assistant", content: `Error: ${errMsg}` }]);
    } finally {
      setLoading(false);
    }
  }, [input, loading, chatModelId, chatMode, chatProvider, allNotes, presentationTitle, currentSlideIndex, currentSlideTitle]);

  const providersWithKeys = providers.filter((p) => p.hasKey);

  if (!open) return null;

  const t = lang === "es" ? {
    title: "Asistente IA",
    placeholder: "Escribe tu pregunta sobre la presentación...",
    send: "Enviar",
    noKey: "Configura una clave API en Ajustes primero.",
    provider: "Proveedor",
    model: "Modelo",
    mode: "Modo",
    clear: "Limpiar chat",
  } : {
    title: "AI Assistant",
    placeholder: "Ask about the presentation content...",
    send: "Send",
    noKey: "Set up an API key in Settings first.",
    provider: "Provider",
    model: "Model",
    mode: "Mode",
    clear: "Clear chat",
  };

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center"
      onClick={onClose}
      style={{ backgroundColor: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
    >
      <div
        className="bg-[var(--bg)] border border-[var(--border)] rounded-2xl shadow-2xl flex flex-col"
        style={{ width: "min(600px, 90vw)", height: "min(700px, 85vh)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--border)]">
          <h3 className="text-sm font-bold flex items-center gap-2">
            <Bot size={18} className="text-[var(--accent)]" />
            {t.title}
          </h3>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setMessages([])}
              className="text-[10px] text-[var(--muted)] hover:text-[var(--fg)] px-2 py-1 rounded hover:bg-[var(--surface-2)] transition-colors"
            >
              {t.clear}
            </button>
            <button
              onClick={onClose}
              className="text-[var(--muted)] hover:text-[var(--fg)] text-lg leading-none px-1"
              aria-label="Close"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Config bar */}
        <div className="flex flex-wrap gap-2 px-5 py-2.5 border-b border-[var(--border)] bg-[var(--surface)]">
          {/* Provider */}
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-[var(--muted)] uppercase tracking-wide">{t.provider}</span>
            <select
              value={chatProvider}
              onChange={(e) => setChatProvider(e.target.value as AIProvider)}
              className="text-xs bg-[var(--surface-2)] border border-[var(--border)] rounded-lg px-2 py-1 focus:outline-none focus:border-[var(--accent)]"
            >
              {providersWithKeys.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>

          {/* Model */}
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-[var(--muted)] uppercase tracking-wide">{t.model}</span>
            <select
              value={chatModelId}
              onChange={(e) => setChatModelId(e.target.value)}
              className="text-xs bg-[var(--surface-2)] border border-[var(--border)] rounded-lg px-2 py-1 focus:outline-none focus:border-[var(--accent)] max-w-[200px]"
            >
              {availableModels.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          </div>

          {/* Mode */}
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-[var(--muted)] uppercase tracking-wide">{t.mode}</span>
            <div className="flex gap-1">
              {(Object.entries(MODE_LABELS) as [ChatMode, typeof MODE_LABELS[ChatMode]][]).map(([key, val]) => (
                <button
                  key={key}
                  onClick={() => setChatMode(key)}
                  className={`text-[10px] px-2 py-1 rounded-lg transition-colors ${
                    chatMode === key
                      ? "bg-[var(--accent)] text-white"
                      : "bg-[var(--surface-2)] text-[var(--muted)] hover:text-[var(--fg)]"
                  }`}
                  title={lang === "es" ? val.es : val.en}
                >
                  {val.icon} {lang === "es" ? val.es : val.en}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-5 py-3 space-y-3" style={{ minHeight: 0 }}>
          {providersWithKeys.length === 0 && (
            <div className="flex items-center justify-center h-full">
              <p className="text-sm text-[var(--muted)]">{t.noKey}</p>
            </div>
          )}
          {messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[85%] rounded-xl px-3.5 py-2.5 text-sm leading-relaxed ${
                  msg.role === "user"
                    ? "bg-[var(--accent)] text-white"
                    : "bg-[var(--surface-2)] text-[var(--fg)]"
                }`}
              >
                {msg.role === "user" && msg.mode && (
                  <div className="text-[9px] opacity-70 mb-1 flex items-center gap-1">
                    {MODE_LABELS[msg.mode].icon} {lang === "es" ? MODE_LABELS[msg.mode].es : MODE_LABELS[msg.mode].en}
                  </div>
                )}
                {msg.role === "assistant" ? (
                  <div className="prose prose-sm prose-invert max-w-none [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
                    <ReactMarkdown>{msg.content}</ReactMarkdown>
                  </div>
                ) : (
                  <div className="whitespace-pre-wrap">{msg.content}</div>
                )}
              </div>
            </div>
          ))}
          {loading && (
            <div className="flex justify-start">
              <div className="bg-[var(--surface-2)] rounded-xl px-3.5 py-2.5 text-sm text-[var(--muted)]">
                <span className="inline-flex gap-1">
                  <span className="animate-bounce" style={{ animationDelay: "0ms" }}>●</span>
                  <span className="animate-bounce" style={{ animationDelay: "150ms" }}>●</span>
                  <span className="animate-bounce" style={{ animationDelay: "300ms" }}>●</span>
                </span>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="px-5 py-3 border-t border-[var(--border)]">
          <div className="flex gap-2">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder={t.placeholder}
              rows={2}
              className="flex-1 bg-[var(--surface-2)] border border-[var(--border)] rounded-xl px-3 py-2 text-sm resize-none focus:outline-none focus:border-[var(--accent)] placeholder:text-[var(--muted)]"
            />
            <button
              onClick={handleSend}
              disabled={loading || !input.trim() || !chatModelId}
              className="bg-[var(--accent)] hover:bg-[var(--accent-hover)] disabled:opacity-40 text-white rounded-xl px-4 py-2 text-sm font-semibold self-end transition-colors"
            >
              {t.send}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
