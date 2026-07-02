/*! coi-serviceworker v0.1.7 - MIT License - https://github.com/gzuidhof/coi-serviceworker */
if (typeof window === "undefined") {
    // 1. Inside the Service Worker thread: Intercept network calls
    self.addEventListener("install", () => self.skipWaiting());
    self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

    self.addEventListener("fetch", (event) => {
        if (event.request.cache === "only-if-cached" && event.request.mode !== "same-origin") return;

        event.respondWith(
            fetch(event.request).then((response) => {
                if (response.status === 0) return response;

                // Clone headers and manually inject required security configurations
                const newHeaders = new Headers(response.headers);
                newHeaders.set("Cross-Origin-Embedder-Policy", "require-corp");
                newHeaders.set("Cross-Origin-Opener-Policy", "same-origin");

                return new Response(response.body, {
                    status: response.status,
                    statusText: response.statusText,
                    headers: newHeaders,
                });
            }).catch((e) => console.error("COI Service Worker fetch crash logic loop:", e))
        );
    });
} else {
    // 2. Inside the Window thread: Auto-register yourself and trigger a one-time setup refresh
    const reloadedBySelf = window.sessionStorage.getItem("coi-reloaded");
    if (!window.crossOriginIsolated && !reloadedBySelf) {
        navigator.serviceWorker.register(window.document.currentScript.src).then(() => {
            window.sessionStorage.setItem("coi-reloaded", "true");
            window.location.reload(); // Magical one-time kickstart refresh
        });
    } else {
        window.sessionStorage.removeItem("coi-reloaded");
    }
}