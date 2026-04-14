/**
 * @jest-environment node
 */

/**
 * Security tests: Ensure API keys never leak to clients via error messages,
 * response bodies, headers, URLs, or any other channel.
 */

import { sanitizeErrorMessage, sanitizeErrorData } from "@/lib/ai-client";

// ── sanitizeErrorMessage unit tests ──

describe("sanitizeErrorMessage", () => {
  it("redacts ?key= query parameter values", () => {
    const msg = 'Gemini error 403: {"error":{"message":"Permission denied","details":[{"url":"https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=AIzaSyC1234567890abcdef"}]}}';
    const result = sanitizeErrorMessage(msg);
    expect(result).not.toContain("AIzaSyC1234567890abcdef");
    expect(result).toContain("key=[REDACTED]");
  });

  it("redacts Bearer tokens", () => {
    const msg = 'OpenRouter error 401: {"error":"Invalid token","authorization":"Bearer sk-or-v1-abc123xyz456"}';
    const result = sanitizeErrorMessage(msg);
    expect(result).not.toContain("sk-or-v1-abc123xyz456");
    expect(result).toContain("Bearer [REDACTED]");
  });

  it("redacts x-api-key header values", () => {
    const msg = 'Claude error 401: {"headers":{"x-api-key: sk-ant-api03-abcdef1234567890"}}';
    const result = sanitizeErrorMessage(msg);
    expect(result).not.toContain("sk-ant-api03-abcdef1234567890");
    expect(result).toContain("x-api-key: [REDACTED]");
  });

  it("redacts sk- prefixed secret keys", () => {
    const msg = "Error: authentication failed for key sk-proj-abc123456789012345678901234567890";
    const result = sanitizeErrorMessage(msg);
    expect(result).not.toContain("sk-proj-abc123456789012345678901234567890");
    expect(result).toContain("[REDACTED]");
  });

  it("redacts AIza prefixed Google API keys", () => {
    const msg = "Gemini error: key=AIzaSyDabcdefghijklmnopqrstuvwx was invalid";
    const result = sanitizeErrorMessage(msg);
    expect(result).not.toContain("AIzaSyDabcdefghijklmnopqrstuvwx");
    expect(result).toContain("[REDACTED]");
  });

  it("preserves safe error messages", () => {
    const msg = "Gemini error 429: rate limit exceeded";
    const result = sanitizeErrorMessage(msg);
    expect(result).toBe("Gemini error 429: rate limit exceeded");
  });

  it("handles multiple key patterns in one message", () => {
    const msg = 'Error with key=AIzaSySecret123 and Bearer sk-secret-value-long-enough-1234567890 and x-api-key: sk-ant-long-secret-1234567890123';
    const result = sanitizeErrorMessage(msg);
    expect(result).not.toContain("AIzaSySecret123");
    expect(result).not.toContain("sk-secret-value-long-enough-1234567890");
    expect(result).not.toContain("sk-ant-long-secret-1234567890123");
  });
});

// ── /api/keys route: never returns key values ──

jest.mock("@/lib/session", () => ({
  getSessionId: jest.fn().mockResolvedValue("test-session-id"),
}));

const mockGetKeyStatus = jest.fn();
const mockGetImageSourceKeyStatus = jest.fn();
const mockSetApiKey = jest.fn();
const mockDeleteApiKey = jest.fn();
const mockSetImageSourceKey = jest.fn();
const mockDeleteImageSourceKey = jest.fn();

jest.mock("@/lib/key-store", () => ({
  getKeyStatus: (...args: unknown[]) => mockGetKeyStatus(...args),
  getImageSourceKeyStatus: (...args: unknown[]) => mockGetImageSourceKeyStatus(...args),
  setApiKey: (...args: unknown[]) => mockSetApiKey(...args),
  deleteApiKey: (...args: unknown[]) => mockDeleteApiKey(...args),
  setImageSourceKey: (...args: unknown[]) => mockSetImageSourceKey(...args),
  deleteImageSourceKey: (...args: unknown[]) => mockDeleteImageSourceKey(...args),
}));

import { GET, POST, DELETE } from "@/app/api/keys/route";
import { NextRequest } from "next/server";

function createKeysRequest(method: string, body?: object): NextRequest {
  return new NextRequest("http://localhost:3000/api/keys", {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

describe("/api/keys — no key value leaks", () => {
  beforeEach(() => {
    mockGetKeyStatus.mockReturnValue({
      openrouter: true,
      gemini: true,
      claude: false,
      openai: false,
    });
    mockGetImageSourceKeyStatus.mockReturnValue({
      wikimedia: true,
      openverse: true,
      loc: true,
      unsplash: true,
      pexels: false,
      pixabay: false,
      flickr: false,
      europeana: false,
      hispana: false,
    });
  });

  it("GET returns only boolean statuses, never key values", async () => {
    const res = await GET();
    const data = await res.json();

    // Must contain only boolean values
    for (const key of Object.keys(data.status)) {
      expect(typeof data.status[key]).toBe("boolean");
    }
    for (const key of Object.keys(data.imageSourceStatus)) {
      expect(typeof data.imageSourceStatus[key]).toBe("boolean");
    }

    // Stringify the entire response and check no key-like patterns exist
    const raw = JSON.stringify(data);
    expect(raw).not.toMatch(/sk-/);
    expect(raw).not.toMatch(/AIza/);
    expect(raw).not.toMatch(/Bearer/);
  });

  it("POST never echoes back the stored key", async () => {
    const res = await POST(
      createKeysRequest("POST", { provider: "openrouter", apiKey: "sk-or-secret-12345678901234567890" })
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data).toEqual({ ok: true });

    const raw = JSON.stringify(data);
    expect(raw).not.toContain("sk-or-secret");
  });

  it("DELETE never returns key values", async () => {
    const res = await DELETE(
      createKeysRequest("DELETE", { provider: "gemini" })
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data).toEqual({ ok: true });

    const raw = JSON.stringify(data);
    expect(raw).not.toMatch(/sk-/);
    expect(raw).not.toMatch(/AIza/);
  });

  it("POST rejects keys over 512 characters", async () => {
    const longKey = "a".repeat(513);
    const res = await POST(
      createKeysRequest("POST", { provider: "openrouter", apiKey: longKey })
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe("API key is too long");
  });
});

// ── Source code scans: no hardcoded keys ──

import { readFileSync, readdirSync, statSync } from "fs";
import { join, extname } from "path";

function collectFiles(dir: string, extensions: string[]): string[] {
  const results: string[] = [];
  try {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      try {
        const s = statSync(full);
        if (s.isDirectory()) {
          if (["node_modules", ".next", ".git", "coverage", "dist", "build"].includes(entry)) continue;
          results.push(...collectFiles(full, extensions));
        } else if (extensions.includes(extname(entry))) {
          results.push(full);
        }
      } catch { /* skip inaccessible */ }
    }
  } catch { /* skip inaccessible */ }
  return results;
}

describe("Source code — no hardcoded secrets", () => {
  const root = join(__dirname, "..", "..");
  const srcFiles = collectFiles(join(root, "src"), [".ts", ".tsx", ".js", ".mjs"]);

  // Patterns that indicate a hardcoded secret (not in a comment, not a variable name)
  const secretPatterns = [
    /["'`]sk-[A-Za-z0-9_-]{20,}["'`]/,      // OpenAI / OpenRouter keys
    /["'`]AIza[A-Za-z0-9_-]{20,}["'`]/,       // Google API keys
    /["'`]sk-ant-api[A-Za-z0-9_-]{20,}["'`]/, // Anthropic keys
  ];

  it("no hardcoded API keys in src/ files", () => {
    for (const file of srcFiles) {
      const content = readFileSync(file, "utf8");
      for (const pattern of secretPatterns) {
        expect(content).not.toMatch(pattern);
      }
    }
  });
});

describe("Source code — Gemini API key never in URL query params", () => {
  const root = join(__dirname, "..", "..");
  const srcFiles = collectFiles(join(root, "src"), [".ts", ".tsx"]);

  it("Gemini API key is passed via header, not URL", () => {
    const dangerousPattern = /\?key=.*apiKey|key=\$\{.*apiKey|key=\$\{encodeURIComponent\(apiKey\)/;
    for (const file of srcFiles) {
      const content = readFileSync(file, "utf8");
      const match = content.match(dangerousPattern);
      if (match) {
        fail(`Found Gemini API key in URL query parameter in ${file}: ${match[0]}`);
      }
    }
  });
});

describe("Source code — error responses never contain raw API keys", () => {
  const root = join(__dirname, "..", "..");
  const routeFiles = collectFiles(join(root, "src", "app", "api"), [".ts"]);

  it("all ai-client error throws use sanitizeErrorMessage or sanitizeErrorData", () => {
    const aiClientPath = join(root, "src", "lib", "ai-client.ts");
    const content = readFileSync(aiClientPath, "utf8");

    // Find all throw new Error lines with JSON.stringify(errData)
    const throwLines = content.split("\n").filter(
      (line) => line.includes("throw new Error") && line.includes("JSON.stringify")
    );

    for (const line of throwLines) {
      const hasSanitize = line.includes("sanitizeErrorMessage") || line.includes("sanitizeErrorData");
      expect(hasSanitize).toBe(true);
    }
  });

  it("route error responses use generic messages or sanitized errors", () => {
    // Ensure no route directly interpolates apiKey into error responses
    for (const file of routeFiles) {
      const content = readFileSync(file, "utf8");
      // Should never include apiKey in a NextResponse.json call
      expect(content).not.toMatch(/NextResponse\.json\([^)]*apiKey/);
    }
  });

  it("all routes that forward err.message to clients use sanitizeErrorMessage", () => {
    for (const file of routeFiles) {
      const content = readFileSync(file, "utf8");
      const lines = content.split("\n");

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Detect lines that return err.message in a JSON response
        if (
          line.includes("NextResponse.json") &&
          line.includes("error") &&
          line.includes("message")
        ) {
          // If the line (or nearby) uses a variable that came from err.message,
          // it must also reference sanitizeErrorMessage somewhere in the file
          if (
            content.includes("err.message") &&
            content.includes("NextResponse.json({ error: message")
          ) {
            // This file returns err.message to clients — must import sanitizeErrorMessage
            expect(content).toContain("sanitizeErrorMessage");
          }
        }
      }
    }
  });
});

describe(".gitignore — sensitive files are excluded", () => {
  const root = join(__dirname, "..", "..");
  const gitignore = readFileSync(join(root, ".gitignore"), "utf8");

  const requiredEntries = [
    ".env",
    ".env*.local",
    "data/keys.json",
    "data/state.json",
    "data/manual-creations.json",
    "cookies.txt",
  ];

  for (const entry of requiredEntries) {
    it(`ignores ${entry}`, () => {
      expect(gitignore).toContain(entry);
    });
  }
});

describe(".dockerignore — sensitive files excluded from Docker builds", () => {
  const root = join(__dirname, "..", "..");
  const dockerignore = readFileSync(join(root, ".dockerignore"), "utf8");

  const requiredEntries = [
    ".env",
    ".env*.local",
    "data/keys.json",
    "data/state.json",
    "data/manual-creations.json",
    "cookies.txt",
    "scripts/",
  ];

  for (const entry of requiredEntries) {
    it(`excludes ${entry}`, () => {
      expect(dockerignore).toContain(entry);
    });
  }
});

describe("Docker — no secrets baked into image", () => {
  const root = join(__dirname, "..", "..");
  const dockerfile = readFileSync(join(root, "Dockerfile"), "utf8");

  it("does not contain ENV instructions with secret values", () => {
    const envLines = dockerfile.split("\n").filter((l) => l.match(/^\s*ENV\s+/));
    for (const line of envLines) {
      // Only NODE_ENV, PORT, HOSTNAME should be set statically
      expect(line).not.toMatch(/ENCRYPTION_KEY|API_KEY|SECRET|TOKEN|PASSWORD/i);
    }
  });

  it("does not COPY .env files into the image", () => {
    const copyLines = dockerfile.split("\n").filter((l) => l.match(/^\s*COPY\s+/));
    for (const line of copyLines) {
      expect(line).not.toMatch(/\.env/);
    }
  });

  it("runs as non-root user", () => {
    expect(dockerfile).toContain("USER nextjs");
    expect(dockerfile).toMatch(/adduser.*nextjs/);
  });
});

describe("Docker Compose — secrets passed via environment only", () => {
  const root = join(__dirname, "..", "..");
  const compose = readFileSync(join(root, "docker-compose.yml"), "utf8");

  it("ENCRYPTION_KEY is sourced from host env, not hardcoded", () => {
    expect(compose).toContain("ENCRYPTION_KEY=${ENCRYPTION_KEY}");
    // No hardcoded value after =
    expect(compose).not.toMatch(/ENCRYPTION_KEY=[^$\s{]/);
  });

  it("does not mount source code or .env into container", () => {
    expect(compose).not.toMatch(/\.env:/);
    expect(compose).not.toMatch(/\.\/src:/);
  });
});

// ── sanitizeErrorData recursive tests ──

describe("sanitizeErrorData — recursive object sanitization", () => {
  it("sanitizes strings at top level", () => {
    const result = sanitizeErrorData("Bearer sk-or-v1-abc123xyz456def789");
    expect(result).toBe("Bearer [REDACTED]");
  });

  it("sanitizes nested object values", () => {
    const result = sanitizeErrorData({
      message: "Auth failed",
      details: {
        key: "sk-proj-abc123456789012345678901234567890",
        nested: { url: "https://api.example.com?key=AIzaSySecret1234567890abcdef" },
      },
    }) as Record<string, unknown>;
    const raw = JSON.stringify(result);
    expect(raw).not.toContain("sk-proj-abc");
    expect(raw).not.toContain("AIzaSySecret");
    expect(raw).toContain("[REDACTED]");
  });

  it("sanitizes arrays", () => {
    const result = sanitizeErrorData([
      "Bearer sk-test-abcdefghijklmnopqrst12345",
      { key: "AIzaSyTestKey12345678901234" },
    ]);
    const raw = JSON.stringify(result);
    expect(raw).not.toContain("sk-test-abc");
    expect(raw).not.toContain("AIzaSyTestKey");
  });

  it("handles non-string primitives safely", () => {
    expect(sanitizeErrorData(42)).toBe(42);
    expect(sanitizeErrorData(null)).toBe(null);
    expect(sanitizeErrorData(true)).toBe(true);
    expect(sanitizeErrorData(undefined)).toBe(undefined);
  });

  it("limits recursion depth", () => {
    // Build deeply nested object
    let obj: Record<string, unknown> = { key: "sk-deep-abcdefghijklmnopqrst12345" };
    for (let i = 0; i < 15; i++) {
      obj = { nested: obj };
    }
    const result = JSON.stringify(sanitizeErrorData(obj));
    // Should not throw and should truncate deep nesting
    expect(result).toContain("[TRUNCATED]");
  });
});

// ── Rate limiter unit tests ──

import { RateLimiter } from "@/lib/rate-limit";

describe("RateLimiter", () => {
  it("allows requests under the limit", () => {
    const limiter = new RateLimiter({ maxRequests: 3, windowMs: 60_000 });
    expect(limiter.check("session-1").allowed).toBe(true);
    expect(limiter.check("session-1").allowed).toBe(true);
    expect(limiter.check("session-1").allowed).toBe(true);
  });

  it("blocks requests over the limit", () => {
    const limiter = new RateLimiter({ maxRequests: 2, windowMs: 60_000 });
    limiter.check("session-1");
    limiter.check("session-1");
    const result = limiter.check("session-1");
    expect(result.allowed).toBe(false);
    expect(result.retryAfterMs).toBeGreaterThan(0);
  });

  it("tracks separate keys independently", () => {
    const limiter = new RateLimiter({ maxRequests: 1, windowMs: 60_000 });
    expect(limiter.check("session-a").allowed).toBe(true);
    expect(limiter.check("session-b").allowed).toBe(true);
    expect(limiter.check("session-a").allowed).toBe(false);
  });

  it("cleans up stale entries", () => {
    const limiter = new RateLimiter({ maxRequests: 1, windowMs: 1 });
    limiter.check("session-cleanup");
    // After cleanup with tiny window, entries should be cleared
    limiter.cleanup();
    // The entry should have been cleaned up since windowMs=1ms has passed
  });
});

// ── File upload size limit tests ──

describe("Source code — upload routes enforce file size limits", () => {
  const root = join(__dirname, "..", "..");

  it("parse route has MAX_FILE_SIZE constant", () => {
    const content = readFileSync(join(root, "src", "app", "api", "parse", "route.ts"), "utf8");
    expect(content).toContain("MAX_FILE_SIZE");
    expect(content).toContain("status: 413");
  });

  it("parse-pptx route has MAX_FILE_SIZE constant", () => {
    const content = readFileSync(join(root, "src", "app", "api", "parse-pptx", "route.ts"), "utf8");
    expect(content).toContain("MAX_FILE_SIZE");
    expect(content).toContain("status: 413");
  });
});

// ── Image download buffer cap tests ──

describe("Source code — image downloads enforce size limits", () => {
  const root = join(__dirname, "..", "..");

  it("build-pptx route has image size cap", () => {
    const content = readFileSync(join(root, "src", "app", "api", "build-pptx", "route.ts"), "utf8");
    expect(content).toContain("MAX_PPTX_IMAGE_BYTES");
    expect(content).toContain("Image too large");
  });

  it("image-proxy route has image size cap", () => {
    const content = readFileSync(join(root, "src", "app", "api", "image-proxy", "route.ts"), "utf8");
    expect(content).toContain("MAX_IMAGE_BYTES");
    expect(content).toContain("Image too large");
  });

  it("image search service has vision image size cap", () => {
    const content = readFileSync(join(root, "src", "lib", "image-search.ts"), "utf8");
    expect(content).toContain("MAX_VISION_IMAGE_BYTES");
  });
});

// ── Rate limiting presence tests ──

describe("Source code — expensive routes have rate limiting", () => {
  const root = join(__dirname, "..", "..");

  const rateLimitedRoutes = [
    "src/app/api/generate/route.ts",
    "src/app/api/generate-full/route.ts",
    "src/app/api/images/route.ts",
    "src/app/api/edit/route.ts",
    "src/app/api/generate-image/route.ts",
    "src/app/api/slide-variants/route.ts",
    "src/app/api/parse/route.ts",
    "src/app/api/parse-pptx/route.ts",
    "src/app/api/image-proxy/route.ts",
  ];

  for (const route of rateLimitedRoutes) {
    it(`${route} imports rate-limit`, () => {
      const content = readFileSync(join(root, route), "utf8");
      expect(content).toContain("rateLimiters");
      expect(content).toContain("status: 429");
    });
  }
});

// ── Input validation tests ──

describe("Source code — image search input validation", () => {
  const root = join(__dirname, "..", "..");

  it("images route validates search term array sizes", () => {
    const content = readFileSync(join(root, "src", "app", "api", "images", "route.ts"), "utf8");
    expect(content).toContain("MAX_SEARCH_TERM_GROUPS");
    expect(content).toContain("MAX_QUERY_LENGTH");
  });

  it("images route strips control characters from queries", () => {
    const content = readFileSync(join(root, "src", "app", "api", "images", "route.ts"), "utf8");
    expect(content).toMatch(/\\x00-\\x1f/);
  });
});

// ── Manual creations server-side persistence tests ──

describe("Source code — manual creations use server-side persistence", () => {
  const root = join(__dirname, "..", "..");

  it("manual-creations route uses server-side store", () => {
    const content = readFileSync(join(root, "src", "app", "api", "manual-creations", "route.ts"), "utf8");
    expect(content).toContain("getManualCreationsState");
    expect(content).toContain("setManualCreationsState");
  });

  it("manual-creations-store persists to data directory", () => {
    const content = readFileSync(join(root, "src", "lib", "manual-creations-store.ts"), "utf8");
    expect(content).toContain("manual-creations.json");
  });
});

// ── .env.example documentation ──

describe(".env.example — documents all environment variables", () => {
  const root = join(__dirname, "..", "..");
  const envExample = readFileSync(join(root, ".env.example"), "utf8");

  it("documents ENCRYPTION_KEY", () => {
    expect(envExample).toContain("ENCRYPTION_KEY");
    expect(envExample).toContain("openssl rand -hex 32");
  });

  it("does not contain actual secret values", () => {
    const lines = envExample.split("\n").filter((l) => !l.startsWith("#") && l.includes("="));
    for (const line of lines) {
      const value = line.split("=")[1]?.trim();
      // Values should be empty or commented out
      expect(value).toBeFalsy();
    }
  });
});
