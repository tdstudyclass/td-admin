// সবসময় নতুন কোড নেয় (cache নেই), শুধু "Install" সমর্থনের জন্য
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {});
