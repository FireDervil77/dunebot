/**
 * CSRF-Helper: Hängt das CSRF-Token automatisch an alle state-ändernden
 * Same-Origin-Requests an, damit Views/Scripts es nicht einzeln pflegen müssen.
 *
 * - fetch():  X-CSRF-Token Header
 * - XMLHttpRequest (jQuery $.ajax): X-CSRF-Token Header
 * - <form method="post">: verstecktes _csrf-Feld beim Submit
 *
 * Token-Quelle: <meta name="csrf-token"> (wird serverseitig in die Layouts gerendert)
 */
(function () {
    'use strict';

    function getToken() {
        var meta = document.querySelector('meta[name="csrf-token"]');
        return (meta && meta.content) || '';
    }

    function isStateChanging(method) {
        return !/^(GET|HEAD|OPTIONS)$/i.test(method || 'GET');
    }

    function isSameOrigin(url) {
        if (!url) return true; // relative/leere URL = same origin
        try {
            return new URL(url, window.location.href).origin === window.location.origin;
        } catch (e) {
            return false;
        }
    }

    // ── fetch() patchen ─────────────────────────────────────────────────────
    if (window.fetch) {
        var origFetch = window.fetch;
        window.fetch = function (input, init) {
            try {
                var method = (init && init.method) || (input && input.method) || 'GET';
                var url = typeof input === 'string' ? input : (input && input.url);

                if (isStateChanging(method) && isSameOrigin(url)) {
                    init = init || {};
                    var headers = new Headers(init.headers || (input && typeof input !== 'string' && input.headers) || undefined);
                    if (!headers.has('X-CSRF-Token')) {
                        headers.set('X-CSRF-Token', getToken());
                    }
                    init.headers = headers;
                }
            } catch (e) {
                // Der Helper darf niemals Requests kaputt machen
            }
            return origFetch.call(this, input, init);
        };
    }

    // ── XMLHttpRequest patchen (deckt jQuery $.ajax ab) ─────────────────────
    var origOpen = XMLHttpRequest.prototype.open;
    var origSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function (method, url) {
        this._csrfInject = isStateChanging(method) && isSameOrigin(url);
        return origOpen.apply(this, arguments);
    };

    XMLHttpRequest.prototype.send = function () {
        try {
            if (this._csrfInject) {
                this.setRequestHeader('X-CSRF-Token', getToken());
            }
        } catch (e) {
            // Header evtl. schon gesetzt — ignorieren
        }
        return origSend.apply(this, arguments);
    };

    // ── Klassische Form-Submits: verstecktes _csrf-Feld injizieren ──────────
    document.addEventListener('submit', function (e) {
        var form = e.target;
        if (!(form instanceof HTMLFormElement)) return;
        if (!isStateChanging(form.method)) return;
        if (!isSameOrigin(form.action)) return;
        if (form.querySelector('input[name="_csrf"]')) return;

        var input = document.createElement('input');
        input.type = 'hidden';
        input.name = '_csrf';
        input.value = getToken();
        form.appendChild(input);
    }, true); // capture-Phase: läuft vor dem eigentlichen Submit
})();
