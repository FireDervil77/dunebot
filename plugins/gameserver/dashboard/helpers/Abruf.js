'use strict';

/**
 * Unter welcher Adresse eine Maschine Dateien per HTTP hergibt.
 *
 * Zwei Dinge holt ein Browser oder ein Spielclient direkt bei der Maschine,
 * am Dashboard vorbei: Sicherungen (unterschrieben, `/sicherung`) und, seit dem
 * 2026-10-10, was ein Paket für Spieler freigibt (`files.public`, `/dl/`).
 * Beide brauchen dieselbe Antwort auf „wie heisst die Maschine von aussen?" —
 * die steht hier, an einer Stelle.
 *
 *   Wirt   der geprüfte Name, wenn es einen gibt, sonst die IP. `fqdn_gilt`
 *          setzt ausschliesslich eine Messung beim Verbinden des Daemons.
 *   Port   der, auf dem der Daemon WIRKLICH lauscht (`abruf_port`, von ihm
 *          gemeldet). 0 oder leer heisst: der Dienst läuft nicht.
 *
 * http, nicht https: Der Dienst des Daemons hat kein Zertifikat. Für
 * Sicherungen trägt die Unterschrift, für freigegebene Spieldateien braucht es
 * keine Geheimhaltung (Absprache 2026-10-10).
 */

/** Name oder IP, unter der die Maschine erreichbar ist — oder ''. */
function wirt(maschine) {
    if (!maschine) return '';
    const name = maschine.fqdn_gilt && maschine.fqdn ? String(maschine.fqdn) : String(maschine.host || '');
    return name.trim();
}

/**
 * Für einen Link, den ein BROWSER öffnet: immer die IP.
 *
 * Seit dem 2026-10-28 öffnet kein Browser mehr den Abruf einer Sicherung
 * direkt (siehe reicheDurch) — die Regel bleibt für die Verbindung vom
 * Dashboard zum Daemon, und für jeden späteren Browser-Link.
 *
 * Gemessen 2026-10-28: firenetworks.de sendet `Strict-Transport-Security:
 * …; includeSubDomains; preload` (Apache und app.js). Jeder Browser, der die
 * Seite kennt, zwingt damit `node1.firenetworks.de:9350` auf https — der
 * Dienst des Daemons spricht nur http, der Download lief ins Leere
 * („ERR_CONNECTION_TIMED_OUT" beim Betreiber). Seit `fqdn_gilt` für 54
 * gesetzt ist, nahm der Link den Namen; am 2026-09-19, als er noch die IP
 * nahm, ging es. Eine IP fällt unter keine HSTS-Regel.
 *
 * Spielclients (FastDL, `basis`) kennen kein HSTS — dort bleibt der Name.
 */
function wirtFuerBrowser(maschine) {
    return maschine ? String(maschine.host || '').trim() : '';
}

/**
 * `http://wirt:port` — oder null, wenn die Maschine nichts ausliefert.
 * Eine IPv6-Adresse gehört in eckige Klammern.
 */
function basis(maschine) {
    const w = wirt(maschine);
    const port = Number(maschine && maschine.abruf_port);
    if (!w || !Number.isInteger(port) || port < 1 || port > 65535) return null;
    // Nur, was in eine Adresse gehört — der Daemon prüft dieselbe Form noch einmal.
    if (!/^[A-Za-z0-9.:-]{1,253}$/.test(w)) return null;
    return `http://${w.includes(':') ? `[${w}]` : w}:${port}`;
}

/** Die Adresse, unter der Spieler die freigegebenen Dateien eines Servers finden. */
function downloadAdresse(maschine, kennung) {
    const b = basis(maschine);
    return b && /^[a-z0-9][a-z0-9-]{0,62}$/.test(String(kennung)) ? `${b}/dl/${kennung}` : null;
}

/** Gibt das Paket überhaupt etwas frei? */
function gibtFrei(paket) {
    return Array.isArray(paket?.files?.public) && paket.files.public.length > 0;
}

// ── Sicherungen durch das Dashboard ausliefern (2026-10-28) ─────────────────
//
// Bis heute leitete der Knopf „Herunterladen" den Browser zum Daemon um
// (http://<maschine>:9350/sicherung?…). Drei Dinge standen dem im Weg, und
// zwei davon hat nicht der Betreiber in der Hand:
//   - HSTS auf firenetworks.de (includeSubDomains) machte aus dem Namen https;
//   - eine https-Seite, die einen http-Download anstößt, sperren die Browser
//     („unsicherer Download") — bei JEDEM Betreiber, auch mit IP;
//   - der Port musste von außen offen sein (auf 54 war er es nicht).
// Ein Zertifikat je Rootserver bräuchte einen Namen und DNS-Einträge — für
// fremde Betreiber ohne Domain ginge es gar nicht (Betreiber: „dann weg 1").
//
// Jetzt holt das Dashboard die unterschriebene Adresse selbst ab und reicht
// den Strom durch, ohne Zwischenspeicher. Für den Browser ist es dieselbe
// https-Seite. Bereichsanfragen (Range → 206) gehen mit, damit ein
// abgebrochener Download weiterlaufen kann — der Daemon kann sie (ServeFile).

const http = require('http');

/** Was vom Daemon an den Browser weitergeht — nichts sonst. */
const DURCHGEREICHT = ['content-type', 'content-length', 'content-range', 'accept-ranges', 'last-modified', 'etag'];

/**
 * Den Abruf beim Daemon holen und an `res` durchreichen.
 *
 * Antwortet der Daemon nicht mit 200/206, bekommt der Browser eine Fehlerseite
 * mit Grund (502), keine halbe Datei. Bricht der Browser ab, wird die Anfrage
 * beim Daemon abgebrochen.
 *
 * @param {string} adresse    die unterschriebene http-Adresse beim Daemon
 * @param {object} req,res    Express
 * @param {string} dateiname  für Content-Disposition
 * @returns {Promise<{status:number, bytes:number}|{fehler:string}>}
 */
function reicheDurch(adresse, req, res, dateiname) {
    return new Promise((fertig) => {
        let bytes = 0;
        const kopf = {};
        if (req.headers.range) kopf.Range = req.headers.range;

        const anfrage = http.get(adresse, { headers: kopf, timeout: 15000 }, (antwort) => {
            if (antwort.statusCode !== 200 && antwort.statusCode !== 206) {
                antwort.resume();
                const grund = antwort.statusCode === 404
                    ? 'Die Datei liegt nicht beim Rootserver.'
                    : `Der Rootserver antwortete mit ${antwort.statusCode}.`;
                if (!res.headersSent) res.status(502).json({ success: false, message: grund });
                return fertig({ fehler: grund });
            }
            // Ab hier fließt die Datei; Leerlauf über zwei Minuten ist ein Abbruch.
            anfrage.setTimeout(120000);
            res.status(antwort.statusCode);
            for (const k of DURCHGEREICHT) {
                if (antwort.headers[k]) res.setHeader(k, antwort.headers[k]);
            }
            res.setHeader('Content-Disposition', `attachment; filename="${String(dateiname).replace(/["\\\r\n]/g, '_')}"`);
            res.setHeader('Cache-Control', 'no-store, no-transform');
            res.setHeader('X-Content-Type-Options', 'nosniff');
            antwort.on('data', (stueck) => { bytes += stueck.length; });
            antwort.on('end', () => fertig({ status: antwort.statusCode, bytes }));
            antwort.on('error', (e) => { res.destroy(e); fertig({ fehler: e.message }); });
            antwort.pipe(res);
        });
        anfrage.on('timeout', () => anfrage.destroy(new Error('der Rootserver antwortet nicht')));
        anfrage.on('error', (e) => {
            if (!res.headersSent) {
                res.status(502).json({ success: false, message: `Der Rootserver ist nicht erreichbar: ${e.message}` });
            } else {
                res.destroy(e);
            }
            fertig({ fehler: e.message });
        });
        // Der Browser bricht ab → die Leitung zum Daemon auch.
        res.on('close', () => { if (!res.writableFinished) anfrage.destroy(); });
    });
}

module.exports = { wirt, wirtFuerBrowser, basis, downloadAdresse, gibtFrei, reicheDurch };
