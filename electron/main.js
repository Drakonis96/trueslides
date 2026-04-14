const { app, BrowserWindow, shell, screen, ipcMain } = require("electron");
const path = require("path");
const { spawn } = require("child_process");
const net = require("net");

// ── Configuration ──
const PORT = 3000;
const isDev = !app.isPackaged;

let mainWindow = null;
let audienceWindow = null;
let nextProcess = null;

// ── Helpers ──

/** Check whether a TCP port is already listening. */
function isPortReady(port) {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    sock.setTimeout(200);
    sock.once("connect", () => {
      sock.destroy();
      resolve(true);
    });
    sock.once("timeout", () => {
      sock.destroy();
      resolve(false);
    });
    sock.once("error", () => {
      resolve(false);
    });
    sock.connect(port, "127.0.0.1");
  });
}

/** Wait until the Next.js server is accepting connections. */
async function waitForNextServer(port, timeoutMs = 30_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await isPortReady(port)) return;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`Next.js server did not start within ${timeoutMs}ms`);
}

// ── Next.js lifecycle ──

function startNextServer() {
  if (isDev) {
    // In development, the dev server is started externally via `concurrently`.
    return;
  }

  // Production: run the standalone Next.js server bundled inside the app.
  const serverPath = path.join(process.resourcesPath, "standalone", "server.js");

  // Point the Next.js server at the correct public + static dirs
  const env = {
    ...process.env,
    NODE_ENV: "production",
    PORT: String(PORT),
    HOSTNAME: "127.0.0.1",
  };

  nextProcess = spawn(process.execPath, [serverPath], {
    cwd: path.join(process.resourcesPath, "standalone"),
    env,
    stdio: "pipe",
  });

  nextProcess.stdout?.on("data", (d) => process.stdout.write(d));
  nextProcess.stderr?.on("data", (d) => process.stderr.write(d));
  nextProcess.on("exit", (code) => {
    console.log(`Next.js server exited with code ${code}`);
    nextProcess = null;
  });
}

function stopNextServer() {
  if (nextProcess) {
    nextProcess.kill();
    nextProcess = null;
  }
}

// ── Window ──

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: "TrueSlides",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      // Increase memory limits for the renderer
      additionalArguments: ["--max-old-space-size=8192"],
    },
  });

  mainWindow.loadURL(`http://127.0.0.1:${PORT}`);

  // Handle window.open calls from the renderer (audience window)
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // Allow audience windows to open as managed BrowserWindows
    if (url.includes("audience=1")) {
      // Handled by IPC — deny the default popup, we create our own
      return { action: "deny" };
    }
    // External links → system browser
    if (url.startsWith("http")) shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
    closeAudienceWindow();
  });
}

// ── Audience window (presenter mode) ──

function closeAudienceWindow() {
  if (audienceWindow && !audienceWindow.isDestroyed()) {
    audienceWindow.close();
  }
  audienceWindow = null;
}

/**
 * Open the audience window on an external display (fullscreen) or as a large
 * popup if no external display is connected.
 */
function openAudienceWindow() {
  closeAudienceWindow();

  const displays = screen.getAllDisplays();
  const primaryDisplay = screen.getPrimaryDisplay();

  // Find an external (non-primary) display
  const externalDisplay = displays.find((d) => d.id !== primaryDisplay.id);

  const windowOptions = {
    title: "TrueSlides — Audience",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  };

  if (externalDisplay) {
    // Place fullscreen on the external display
    windowOptions.x = externalDisplay.bounds.x;
    windowOptions.y = externalDisplay.bounds.y;
    windowOptions.width = externalDisplay.bounds.width;
    windowOptions.height = externalDisplay.bounds.height;
    windowOptions.fullscreen = true;
  } else {
    // No external display — open a large popup on the primary screen
    windowOptions.width = 1280;
    windowOptions.height = 720;
  }

  audienceWindow = new BrowserWindow(windowOptions);
  audienceWindow.loadURL(`http://127.0.0.1:${PORT}?audience=1`);

  // Block external navigation / popups from the audience window
  audienceWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

  audienceWindow.on("closed", () => {
    audienceWindow = null;
    // Notify the presenter window that the audience window was closed
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("audience-window-closed");
    }
  });

  return {
    displayId: externalDisplay ? externalDisplay.id : primaryDisplay.id,
    isExternal: !!externalDisplay,
  };
}

// ── IPC handlers ──

function registerIpcHandlers() {
  // Return display information
  ipcMain.handle("get-displays", () => {
    const displays = screen.getAllDisplays();
    const primary = screen.getPrimaryDisplay();
    return displays.map((d) => ({
      id: d.id,
      label: d.label || `Display ${d.id}`,
      width: d.bounds.width,
      height: d.bounds.height,
      isPrimary: d.id === primary.id,
    }));
  });

  // Open audience window on external display
  ipcMain.handle("open-audience-window", () => {
    return openAudienceWindow();
  });

  // Close audience window
  ipcMain.handle("close-audience-window", () => {
    closeAudienceWindow();
    return true;
  });
}

// ── App lifecycle ──

app.whenReady().then(async () => {
  registerIpcHandlers();
  startNextServer();

  if (!isDev) {
    // Wait for the embedded server to be ready
    await waitForNextServer(PORT);
  }

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  stopNextServer();
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  closeAudienceWindow();
  stopNextServer();
});
