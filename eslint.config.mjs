// Só uma checagem: nome usado sem estar definido ou importado (ex.: rotinaViaArquivo, 15/11/2026).
// Roda no CI: npx eslint@9.15.0 js sw.js
export default [{
  files: ["js/**/*.js", "sw.js"],
  languageOptions: { ecmaVersion: 2024, sourceType: "module", globals: {
    window: "readonly", document: "readonly", navigator: "readonly", localStorage: "readonly", sessionStorage: "readonly",
    location: "readonly", history: "readonly", fetch: "readonly", console: "readonly", setTimeout: "readonly", clearTimeout: "readonly",
    setInterval: "readonly", clearInterval: "readonly", URL: "readonly", URLSearchParams: "readonly", Blob: "readonly", File: "readonly",
    FormData: "readonly", CustomEvent: "readonly", Event: "readonly", AbortController: "readonly", crypto: "readonly", TextEncoder: "readonly",
    TextDecoder: "readonly", atob: "readonly", btoa: "readonly", requestAnimationFrame: "readonly", cancelAnimationFrame: "readonly",
    matchMedia: "readonly", getComputedStyle: "readonly", performance: "readonly", queueMicrotask: "readonly", structuredClone: "readonly",
    Intl: "readonly", self: "readonly", caches: "readonly", clients: "readonly", Response: "readonly", Request: "readonly", Headers: "readonly",
    MutationObserver: "readonly", IntersectionObserver: "readonly", ResizeObserver: "readonly", HTMLElement: "readonly", Element: "readonly",
    Node: "readonly", alert: "readonly", confirm: "readonly", open: "readonly", scrollY: "readonly", innerWidth: "readonly", innerHeight: "readonly",
    globalThis: "readonly", DOMException: "readonly", XMLHttpRequest: "readonly", Image: "readonly", indexedDB: "readonly", screen: "readonly",
    visualViewport: "readonly", PointerEvent: "readonly", KeyboardEvent: "readonly", WebSocket: "readonly", Notification: "readonly", CSS: "readonly", ClipboardItem: "readonly"
  } },
  rules: { "no-undef": "error" }
}];
