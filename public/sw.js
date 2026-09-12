/*
========================================
SERVICE WORKER — PUSH NOTIFICATIONS
========================================

This file must be served from the SITE ROOT
(https://netnaira.onrender.com/sw.js), not
from inside /public in the URL — a service
worker can only control pages at or below
the path it's served from. Since server.js
already does app.use(express.static("public")),
putting this at public/sw.js makes it
available at /sw.js automatically.

It does two things:
1. "push"           — a message arrived from
   the push service while the site wasn't
   open. Show it as an OS notification.
2. "notificationclick" — the user tapped the
   notification. Focus an existing tab if
   one is open, otherwise open a new one.
========================================
*/

self.addEventListener("push", (event) => {

    let data = {
        title: "NetNaira",
        body: "You have a new notification."
    };

    if (event.data) {

        try {
            data = event.data.json();
        } catch (error) {
            data.body = event.data.text();
        }

    }

    event.waitUntil(
        self.registration.showNotification(
            data.title || "NetNaira",
            {
                body: data.body,
                icon: "/favicon.png",
                badge: "/favicon.png",
                data: { url: "/dashboard.html" }
            }
        )
    );

});

self.addEventListener("notificationclick", (event) => {

    event.notification.close();

    const targetUrl =
        event.notification.data?.url || "/dashboard.html";

    event.waitUntil(
        self.clients
            .matchAll({ type: "window", includeUncontrolled: true })
            .then((clientList) => {

                for (const client of clientList) {

                    if (
                        client.url.includes(targetUrl) &&
                        "focus" in client
                    ) {
                        return client.focus();
                    }

                }

                if (self.clients.openWindow) {
                    return self.clients.openWindow(targetUrl);
                }

            })
    );

});

