import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Singleton tunnel state, preserved across HMR via globalThis.
 */
const g = globalThis as unknown as {
  __presenterTunnel?: { url: string; close: () => void };
  __presenterTunnelPromise?: Promise<{ url: string; close: () => void } | null>;
};

async function ensureTunnel(port: number): Promise<string | null> {
  if (g.__presenterTunnel) return g.__presenterTunnel.url;

  // Avoid racing multiple requests
  if (g.__presenterTunnelPromise) {
    const result = await g.__presenterTunnelPromise;
    return result?.url ?? null;
  }

  g.__presenterTunnelPromise = (async () => {
    try {
      // Dynamic import so the dependency is optional (devDependency only)
      const localtunnel = (await import("localtunnel")).default;
      const tunnel = await localtunnel({ port });
      const entry = { url: tunnel.url, close: () => tunnel.close() };
      g.__presenterTunnel = entry;

      tunnel.on("close", () => {
        if (g.__presenterTunnel === entry) {
          g.__presenterTunnel = undefined;
        }
      });

      return entry;
    } catch (err) {
      console.error("Failed to create tunnel:", err);
      return null;
    } finally {
      g.__presenterTunnelPromise = undefined;
    }
  })();

  return (await g.__presenterTunnelPromise)?.url ?? null;
}

/**
 * POST: Create a localtunnel to expose the server publicly.
 * Used when mobile devices can't reach the LAN IP (AP isolation, etc.).
 */
export async function POST() {
  const port = parseInt(process.env.PORT || "3000", 10);
  const url = await ensureTunnel(port);

  if (!url) {
    return NextResponse.json(
      { error: "Failed to create tunnel. Make sure localtunnel is installed: npm i -D localtunnel" },
      { status: 500 },
    );
  }

  return NextResponse.json({ url });
}

/**
 * DELETE: Close an active tunnel.
 */
export async function DELETE() {
  if (g.__presenterTunnel) {
    g.__presenterTunnel.close();
    g.__presenterTunnel = undefined;
  }
  return NextResponse.json({ ok: true });
}
