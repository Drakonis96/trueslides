"use client";

import React, { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { Smartphone, X, Copy, Check, Wifi, WifiOff } from "lucide-react";

interface QRRemoteModalProps {
  open: boolean;
  onClose: () => void;
  sessionId: string | null;
  connected: boolean;
  lang: string;
  onStartSession: () => Promise<string | null>;
}

export default function QRRemoteModal({
  open,
  onClose,
  sessionId,
  connected,
  lang,
  onStartSession,
}: QRRemoteModalProps) {
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [remoteUrl, setRemoteUrl] = useState<string>("");
  const [copied, setCopied] = useState(false);
  const [starting, setStarting] = useState(false);

  const es = lang === "es";

  // Generate QR once when modal opens (not on every render)
  const hasInitRef = useRef(false);
  useEffect(() => {
    if (!open) {
      hasInitRef.current = false;
      return;
    }
    // Already initialized for this open cycle
    if (hasInitRef.current) return;
    hasInitRef.current = true;

    async function init() {
      let sid = sessionId;
      if (!sid) {
        setStarting(true);
        sid = await onStartSession();
        setStarting(false);
      }

      if (sid) {
        // Resolve the LAN IP so the phone can reach this server
        let origin = window.location.origin;
        try {
          const resp = await fetch("/api/presenter-remote/network-info");
          if (resp.ok) {
            const { ip } = await resp.json();
            if (ip) {
              origin = `${window.location.protocol}//${ip}:${window.location.port}`;
            }
          }
        } catch { /* fall back to window.location.origin */ }

        const url = `${origin}/remote?session=${sid}`;
        setRemoteUrl(url);
        try {
          const dataUrl = await QRCode.toDataURL(url, {
            width: 280,
            margin: 2,
            color: { dark: "#000000", light: "#ffffff" },
            errorCorrectionLevel: "M",
          });
          setQrDataUrl(dataUrl);
        } catch (err) {
          console.error("Failed to generate QR:", err);
        }
      }
    }

    init();
  // Only trigger on open state change
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleCopy = async () => {
    if (!remoteUrl) return;
    try {
      await navigator.clipboard.writeText(remoteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard not available */ }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[9500] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-[var(--surface)] rounded-2xl shadow-2xl border border-[var(--border)] max-w-sm w-full mx-4 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
          <div className="flex items-center gap-2">
            <Smartphone size={18} className="text-[var(--accent)]" />
            <h2 className="text-sm font-bold">{es ? "Control Remoto" : "Remote Control"}</h2>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-[var(--surface-2)] transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Content */}
        <div className="px-5 py-5 flex flex-col items-center">
          {starting ? (
            <div className="py-8">
              <div className="w-8 h-8 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
            </div>
          ) : qrDataUrl ? (
            <>
              {/* QR Code */}
              <div className="bg-white p-3 rounded-xl shadow-inner mb-4">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={qrDataUrl} alt="QR Code" width={280} height={280} className="block" />
              </div>

              {/* Instructions */}
              <p className="text-xs text-[var(--muted)] text-center mb-4 leading-relaxed">
                {es
                  ? "Escanea este código QR con la cámara de tu móvil para abrir el control remoto."
                  : "Scan this QR code with your phone camera to open the remote control."}
              </p>

              {/* Warn if URL contains localhost */}
              {remoteUrl.includes("localhost") && (
                <div className="bg-amber-500/10 border border-amber-500/30 text-amber-300 text-[11px] px-3 py-2 rounded-lg mb-4 text-center leading-relaxed">
                  {es
                    ? "⚠️ No se detectó IP de red. Ejecuta el servidor con: npm run dev -- -H 0.0.0.0"
                    : "⚠️ No LAN IP detected. Start the server with: npm run dev -- -H 0.0.0.0"}
                </div>
              )}

              {/* Connection status */}
              <div className={`flex items-center gap-2 text-xs px-3 py-1.5 rounded-full mb-4 ${
                connected ? "bg-emerald-500/15 text-emerald-400" : "bg-gray-500/15 text-gray-400"
              }`}>
                {connected ? <Wifi size={12} /> : <WifiOff size={12} />}
                {connected
                  ? (es ? "Remoto conectado" : "Remote connected")
                  : (es ? "Esperando conexión..." : "Waiting for connection...")}
              </div>

              {/* Copy URL */}
              <button
                onClick={handleCopy}
                className="flex items-center gap-2 text-xs px-4 py-2 rounded-lg bg-[var(--surface-2)] hover:bg-[var(--border)] transition-colors"
              >
                {copied ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
                {copied ? (es ? "Copiado" : "Copied") : (es ? "Copiar enlace" : "Copy link")}
              </button>
            </>
          ) : (
            <p className="text-sm text-[var(--muted)] py-8">
              {es ? "Error al generar el código QR." : "Failed to generate QR code."}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
