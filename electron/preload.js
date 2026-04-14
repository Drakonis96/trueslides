const { contextBridge, ipcRenderer } = require("electron");

// Expose a minimal API to the renderer.
contextBridge.exposeInMainWorld("electron", {
  isElectron: true,

  // Display management for presenter mode
  getDisplays: () => ipcRenderer.invoke("get-displays"),
  openAudienceWindow: () => ipcRenderer.invoke("open-audience-window"),
  closeAudienceWindow: () => ipcRenderer.invoke("close-audience-window"),

  // Listen for audience window closed event
  onAudienceWindowClosed: (callback) => {
    const handler = () => callback();
    ipcRenderer.on("audience-window-closed", handler);
    return () => ipcRenderer.removeListener("audience-window-closed", handler);
  },
});
