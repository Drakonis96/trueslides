import { cookies } from "next/headers";
import { randomBytes } from "node:crypto";

const SESSION_COOKIE_NAME = "ts_session";
const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

/**
 * Get or create a session ID from the HTTP-only secure cookie.
 * Returns the session ID string.
 */
export async function getSessionId(): Promise<string> {
  const cookieStore = await cookies();
  const existing = cookieStore.get(SESSION_COOKIE_NAME);
  if (existing?.value) return existing.value;

  const sessionId = randomBytes(32).toString("hex");
  cookieStore.set(SESSION_COOKIE_NAME, sessionId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: SESSION_MAX_AGE,
    path: "/",
  });
  return sessionId;
}
