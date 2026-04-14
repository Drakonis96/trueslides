import { NextResponse } from "next/server";
import os from "node:os";
import { execSync } from "node:child_process";

const PREFERRED_INTERFACE_RE = /^(en|eth|wlan|wifi)/i;
const DEPRIORITIZED_INTERFACE_RE = /^(lo|utun|llw|awdl|bridge|docker|veth|vmnet|vboxnet|tailscale|zt|tun|tap)/i;

function isPrivateIpv4(address: string) {
  return (
    address.startsWith("10.")
    || address.startsWith("192.168.")
    || /^172\.(1[6-9]|2\d|3[01])\./.test(address)
  );
}

export function selectLanIp(interfaces: ReturnType<typeof os.networkInterfaces>) {
  const candidates: Array<{ address: string; score: number }> = [];

  for (const [name, variants] of Object.entries(interfaces)) {
    for (const iface of variants || []) {
      if (iface.internal || iface.family !== "IPv4" || iface.address.startsWith("169.254.")) {
        continue;
      }

      let score = 0;
      if (isPrivateIpv4(iface.address)) score += 20;
      if (PREFERRED_INTERFACE_RE.test(name)) score += 10;
      if (DEPRIORITIZED_INTERFACE_RE.test(name)) score -= 10;

      candidates.push({ address: iface.address, score });
    }
  }

  candidates.sort((left, right) => right.score - left.score);
  return candidates[0]?.address ?? null;
}

/**
 * On macOS, check whether the macOS Application Firewall might block
 * incoming connections to the running Node binary.
 * Returns a warning string when the firewall is on and the current
 * node binary is explicitly blocked, or null otherwise.
 */
function checkMacFirewall(): string | null {
  if (os.platform() !== "darwin") return null;
  try {
    const state = execSync(
      "/usr/libexec/ApplicationFirewall/socketfilterfw --getglobalstate",
      { encoding: "utf8", timeout: 3000 },
    );
    if (!state.includes("State = 1")) return null; // firewall is off

    // Check if auto-allow for signed software is enabled
    const allowSigned = execSync(
      "/usr/libexec/ApplicationFirewall/socketfilterfw --getallowsigned",
      { encoding: "utf8", timeout: 3000 },
    );
    const autoAllowDownloaded = allowSigned.includes("downloaded signed software ENABLED");

    const nodeBin = process.execPath;
    const apps = execSync(
      "/usr/libexec/ApplicationFirewall/socketfilterfw --listapps",
      { encoding: "utf8", timeout: 3000 },
    );

    // Each entry is two lines: "N : /path/to/app" then "  (Allow|Block incoming connections)"
    const lines = apps.split("\n");
    for (let i = 0; i < lines.length - 1; i++) {
      const pathMatch = lines[i].match(/^\s*\d+\s*:\s*(.+)$/);
      if (pathMatch) {
        const appPath = pathMatch[1].trim();
        if (appPath === nodeBin) {
          // Found – check if explicitly blocked
          const next = lines[i + 1] ?? "";
          if (next.includes("Block incoming connections")) return "firewall-blocked";
          return null; // explicitly allowed
        }
      }
    }

    // Node binary not in the explicit list.
    // If auto-allow for signed software is enabled and node is code-signed,
    // the firewall will allow it automatically — don't warn.
    if (autoAllowDownloaded) return null;

    // Auto-allow is off and node isn't in the list → firewall will block or prompt
    return "firewall-unlisted";
  } catch {
    return null; // can't determine – don't warn
  }
}

/**
 * Returns the server's LAN IP so the QR code can point mobile
 * devices to the correct address (not localhost).
 * Also reports macOS firewall status when relevant.
 */
export async function GET() {
  const lanIp = selectLanIp(os.networkInterfaces());
  const firewallWarning = checkMacFirewall();

  return NextResponse.json({
    ip: lanIp,
    hostname: os.hostname(),
    ...(firewallWarning ? { firewallWarning, nodePath: process.execPath } : {}),
  });
}
