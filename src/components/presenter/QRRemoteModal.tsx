"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { Smartphone, X, Copy, Check, Wifi, WifiOff, Globe } from "lucide-react";

const UNREACHABLE_HOSTNAMES = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1", "::"]);

function normalizeHostname(hostname: string) {
  return hostname.replace(/^\[(.*)\]$/, "$1").toLowerCase();
}

function isUnreachableHostname(hostname: string) {
  return UNREACHABLE_HOSTNAMES.has(normalizeHostname(hostname));
}

function isUnreachableRemoteUrl(remoteUrl: string) {
  try {
    return isUnreachableHostname(new URL(remoteUrl).hostname);
  } catch {
    return false;
  }
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface ResolvedOrigin {
  origin: string | null;
  firewallWarning?: string | null;
  nodePath?: string | null;
}

async function resolveRemoteOrigin(): Promise<ResolvedOrigin> {
  const { origin, hostname, port, protocol } = window.location;
  let firewallWarning: string | null = null;
  let nodePath: string | null = null;

  if (!isUnreachableHostname(hostname)) {
    // Still fetch network-info to check firewall even when origin is already usable
    try {
      const resp = await fetch("/api/presenter-remote/network-info", { cache: "no-store" });
      if (resp.ok) {
        const data = await resp.json();
        firewallWarning = data.firewallWarning ?? null;
        nodePath = data.nodePath ?? null;
      }
    } catch { /* non-critical */ }
    return { origin, firewallWarning, nodePath };
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const resp = await fetch("/api/presenter-remote/network-info", { cache: "no-store" });
      if (resp.ok) {
        const data = await resp.json();
        firewallWarning = data.firewallWarning ?? null;
        nodePath = data.nodePath ?? null;
        if (typeof data.ip === "string" && data.ip) {
          return {
            origin: `${protocol}//${data.ip}${port ? `:${port}` : ""}`,
            firewallWarning,
            nodePath,
          };
        }
      }
    } catch {
      // The route can still be compiling in dev mode; retry a couple of times.
    }

    if (attempt < 2) {
      await wait(300 * (attempt + 1));
    }
  }

  return { origin: null, firewallWarning, nodePath };
}

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
  const [qrError, setQrError] = useState<"session" | "origin" | "qr" | null>(null);
  const [firewallWarning, setFirewallWarning] = useState<string | null>(null);
  const [firewallNodePath, setFirewallNodePath] = useState<string | null>(null);
  const [tunnelLoading, setTunnelLoading] = useState(false);
  const [tunnelError, setTunnelError] = useState<string | null>(null);
  // Ref to track the session ID used during init, so tunnel can use it
  const sessionIdForQrRef = useRef<string | null>(null);

  const es = lang === "es";

  // Generate QR once when modal opens (not on every render)
  const hasInitRef = useRef(false);
  useEffect(() => {
    let cancelled = false;

    if (!open) {
      hasInitRef.current = false;
      setStarting(false);
      setQrError(null);
      setQrDataUrl(null);
      setRemoteUrl("");
      setCopied(false);
      setFirewallWarning(null);
      setFirewallNodePath(null);
      setTunnelLoading(false);
      setTunnelError(null);
      return () => {
        cancelled = true;
      };
    }
    // Already initialized for this open cycle
    if (hasInitRef.current) return;
    hasInitRef.current = true;
    setStarting(true);
    setQrError(null);
    setQrDataUrl(null);
    setRemoteUrl("");
    setCopied(false);
    setFirewallWarning(null);
    setFirewallNodePath(null);
    setTunnelLoading(false);
    setTunnelError(null);

    async function init() {
      let sid = sessionId;
      if (!sid) {
        sid = await onStartSession();
      }

      if (!sid) {
        if (!cancelled) {
          setQrError("session");
          setStarting(false);
        }
        return;
      }

      sessionIdForQrRef.current = sid;

      const resolved = await resolveRemoteOrigin();
      if (!cancelled) {
        setFirewallWarning(resolved.firewallWarning ?? null);
        setFirewallNodePath(resolved.nodePath ?? null);
      }
      if (!resolved.origin) {
        if (!cancelled) {
          setQrError("origin");
          setStarting(false);
        }
        return;
      }

      const url = `${resolved.origin}/remote?session=${sid}`;
      if (!cancelled) {
        setRemoteUrl(url);
      }

      try {
        const dataUrl = await QRCode.toDataURL(url, {
          width: 280,
          margin: 2,
          color: { dark: "#000000", light: "#ffffff" },
          errorCorrectionLevel: "M",
        });
        if (!cancelled) {
          setQrDataUrl(dataUrl);
        }
      } catch (err) {
        console.error("Failed to generate QR:", err);
        if (!cancelled) {
          setQrError("qr");
        }
      }

      if (!cancelled) {
        setStarting(false);
      }
    }

    init();
  // Only trigger on open state change
  // eslint-disable-next-line react-hooks/exhaustive-deps
    return () => {
      cancelled = true;
    };
  }, [open]);

  const handleCopy = async () => {
    if (!remoteUrl) return;
    try {
      await navigator.clipboard.writeText(remoteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard not available */ }
  };

  const handleTunnel = useCallback(async () => {
    setTunnelLoading(true);
    setTunnelError(null);
    try {
      const resp = await fetch("/api/presenter-remote/tunnel", { method: "POST" });
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        setTunnelError(data.error || "Tunnel failed");
        setTunnelLoading(false);
        return;
      }
      const { url: tunnelUrl } = await resp.json();
      const sid = sessionIdForQrRef.current;
      const fullUrl = `${tunnelUrl}/remote?session=${sid}`;
      setRemoteUrl(fullUrl);
      const dataUrl = await QRCode.toDataURL(fullUrl, {
        width: 280,
        margin: 2,
        color: { dark: "#000000", light: "#ffffff" },
        errorCorrectionLevel: "M",
      });
      setQrDataUrl(dataUrl);
    } catch (err) {
      setTunnelError(es ? "No se pudo crear el túnel" : "Could not create tunnel");
    }
    setTunnelLoading(false);
  }, [es]);

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
              {isUnreachableRemoteUrl(remoteUrl) && (
                <div className="bg-amber-500/10 border border-amber-500/30 text-amber-300 text-[11px] px-3 py-2 rounded-lg mb-4 text-center leading-relaxed">
                  {es
                    ? "⚠️ No se detectó IP de red. Ejecuta el servidor con: npm run dev -- -H 0.0.0.0"
                    : "⚠️ No LAN IP detected. Start the server with: npm run dev -- -H 0.0.0.0"}
                </div>
              )}

              {/* Warn if macOS firewall is blocking node */}
              {firewallWarning && !connected && (
                <div className="bg-red-500/10 border border-red-500/30 text-red-300 text-[11px] px-3 py-2 rounded-lg mb-4 text-center leading-relaxed">
                  {es
                    ? "🛡️ El firewall de macOS está bloqueando las conexiones entrantes a Node. Tu móvil no podrá conectarse. Ejecuta en la terminal:"
                    : "🛡️ macOS Firewall is blocking incoming connections to Node. Your phone won't be able to connect. Run in terminal:"}
                  <code className="block mt-1.5 bg-black/30 rounded px-2 py-1 text-[10px] font-mono select-all break-all text-left">
                    sudo /usr/libexec/ApplicationFirewall/socketfilterfw --add {firewallNodePath ?? "$(which node)"} --unblockapp {firewallNodePath ?? "$(which node)"}
                  </code>
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

              {/* Tunnel fallback — shown when not connected */}
              {!connected && (
                <div className="mt-4 w-full">
                  <button
                    onClick={handleTunnel}
                    disabled={tunnelLoading}
                    className="flex items-center justify-center gap-2 text-xs px-4 py-2 w-full rounded-lg bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 transition-colors disabled:opacity-50"
                  >
                    {tunnelLoading ? (
                      <div className="w-3.5 h-3.5 border-2 border-blue-300 border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <Globe size={14} />
                    )}
                    {tunnelLoading
                      ? (es ? "Creando túnel..." : "Creating tunnel...")
                      : (es ? "¿No conecta? Usar túnel público" : "Can't connect? Use public tunnel")}
                  </button>
                  {tunnelError && (
                    <p className="text-[10px] text-red-400 text-center mt-1">{tunnelError}</p>
                  )}
                </div>
              )}
            </>
          ) : !qrError ? (
            <div className="py-8">
              <div className="w-8 h-8 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <div className="py-8 text-center space-y-2">
              <p className="text-sm text-[var(--muted)]">
                {qrError === "origin"
                  ? (es ? "No se pudo detectar una URL accesible desde el móvil." : "Could not detect a phone-accessible URL.")
                  : (es ? "Error al generar el código QR." : "Failed to generate QR code.")}
              </p>
              {qrError === "origin" && (
                <p className="text-xs text-[var(--muted)] max-w-[18rem] leading-relaxed">
                  {es
                    ? "Comprueba que el ordenador y el móvil están en la misma WiFi y vuelve a abrir el control remoto."
                    : "Make sure the computer and phone are on the same WiFi network, then reopen remote control."}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
