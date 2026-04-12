import { NextResponse } from "next/server";
import os from "node:os";

/**
 * Returns the server's LAN IP so the QR code can point mobile
 * devices to the correct address (not localhost).
 */
export async function GET() {
  const interfaces = os.networkInterfaces();
  let lanIp: string | null = null;

  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      // Skip internal (loopback) and non-IPv4
      if (iface.internal || iface.family !== "IPv4") continue;
      lanIp = iface.address;
      break;
    }
    if (lanIp) break;
  }

  return NextResponse.json({
    ip: lanIp,
    hostname: os.hostname(),
  });
}
