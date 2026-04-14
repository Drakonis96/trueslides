import "@testing-library/jest-dom";

// Polyfill ResizeObserver for jsdom
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class ResizeObserver {
    callback: ResizeObserverCallback;
    constructor(cb: ResizeObserverCallback) { this.callback = cb; }
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
