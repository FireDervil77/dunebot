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
 * Freigegebene Spieldateien (`/dl/`) bleiben http: Spielclients sprechen nichts
 * anderes, und Geheimhaltung braucht es dafür nicht (Absprache 2026-10-10).
 * Alles Unterschriebene läuft seit FireBus Etappe 2 über TLS: Jeder Daemon hat sein
 * eigenes Zertifikat, meldet es bei der Anmeldung (`rootserver.abruf_zertifikat`), und
 * das Dashboard vertraut genau diesem. Der Dateiweg steht damit neben dem Bus, die
 * Linie D aus dem Fahrplan: Lesen, Schreiben und Hochladen fahren nicht mehr im Befehl.
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

const crypto = require('crypto');
const https = require('https');
const { ServiceManager } = require('dunebot-core');

/** Genau das eine Zertifikat dieser Maschine. Der Name zählt nicht, die Adresse ist eine IP. */
function tlsOptionen(maschine) {
    return { ca: maschine.abruf_zertifikat, checkServerIdentity: () => undefined, minVersion: 'TLSv1.3' };
}

function fehlerMit(statusCode, meldung) {
    return Object.assign(new Error(meldung), { statusCode });
}

/**
 * Host, Port, Schlüssel und Zertifikat einer Maschine — oder ein Wurf mit Grund.
 *
 * @param {number|string} rootserverId
 * @returns {Promise<{host: string, abruf_port: number, api_key: string, abruf_zertifikat: string}>}
 */
async function maschineVon(rootserverId) {
    const [maschine] = await ServiceManager.get('dbService').query(
        'SELECT host, abruf_port, api_key, abruf_zertifikat FROM rootserver WHERE id = ?', [rootserverId]);
    if (!maschine?.abruf_port || !maschine.abruf_zertifikat) {
        throw fehlerMit(503, 'Die Maschine bietet keinen gesicherten Abruf an — der Daemon ist zu alt oder sein Abruf-Zuhörer läuft nicht.');
    }
    if (!maschine.api_key) throw fehlerMit(500, 'Für diese Maschine ist kein Schlüssel hinterlegt.');
    return maschine;
}

/** Was vom Daemon an den Browser weitergeht — nichts sonst. */
const DURCHGEREICHT = ['content-type', 'content-length', 'content-range', 'accept-ranges', 'last-modified', 'etag'];

/**
 * Der Kopf `Content-Disposition` für einen beliebigen Dateinamen.
 *
 * Sicherungen heißen immer gleich gebaut, Dateien aus dem Dateimanager nicht.
 * Ein Zeichen über Latin-1 (`€`, `→`) in einem Kopf lässt `setHeader` WERFEN,
 * und das mitten im Rückruf der Antwort. Darum zweimal: `filename` nur in
 * druckbarem ASCII, `filename*` (RFC 5987) mit dem echten Namen.
 */
function anhangKopf(name) {
    const echt = String(name);
    const ascii = echt.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
    const kodiert = encodeURIComponent(echt).replace(/['()*]/g,
        (z) => `%${z.charCodeAt(0).toString(16).toUpperCase()}`);
    return `attachment; filename="${ascii}"; filename*=UTF-8''${kodiert}`;
}

/**
 * Die unterschriebene Adresse einer Datei aus dem Dateimanager (F4a).
 *
 * Gegenstück: `DateiUnterschrift` im Daemon (`sicherungsabruf/datei.go`). Die
 * Zeile `datei` vorn trennt sie von der Unterschrift für `/sicherung`.
 * Fünf Minuten: Abgeholt wird sofort, vom Dashboard selbst; eine Fortsetzung
 * (Range) stellt der Browser als neue Anfrage und bekommt eine neue Adresse.
 *
 * @param {{host: string, abruf_port: number, api_key: string}} maschine
 * @param {number|string} serverId
 * @param {string} pfad wie der Dateimanager ihn nennt
 * @param {string} [zeile] `datei-schreiben` für PUT: Eine Adresse zum Lesen darf nie schreiben
 * @returns {string}
 */
function dateiAdresse(maschine, serverId, pfad, zeile = 'datei') {
    const bis = Math.floor(Date.now() / 1000) + 300;
    const unterschrift = crypto.createHmac('sha256', maschine.api_key)
        .update(`${zeile}\n${serverId}\n${pfad}\n${bis}`)
        .digest('hex');
    return `${gesichert(maschine)}/datei`
        + `?server=${encodeURIComponent(serverId)}&pfad=${encodeURIComponent(pfad)}`
        + `&bis=${bis}&sig=${unterschrift}`;
}

/** Der Anfang jeder unterschriebenen Adresse. */
function gesichert(maschine) {
    return `https://${wirtFuerBrowser(maschine)}:${maschine.abruf_port}`;
}

/** Die unterschriebene Adresse, um einen Inhalt abzulegen. Gegenstück: `InhaltUnterschrift`. */
function inhaltAdresse(maschine, { serverId, ziel, dateiname, entpacken, marker }) {
    const bis = Math.floor(Date.now() / 1000) + 300;
    const schalter = entpacken ? 1 : 0;
    const unterschrift = crypto.createHmac('sha256', maschine.api_key)
        .update(`inhalt\n${serverId}\n${ziel}\n${dateiname}\n${schalter}\n${marker}\n${bis}`)
        .digest('hex');
    const teil = encodeURIComponent;
    return `${gesichert(maschine)}/inhalt?server=${teil(serverId)}&ziel=${teil(ziel)}&dateiname=${teil(dateiname)}`
        + `&entpacken=${schalter}&marker=${teil(marker)}&bis=${bis}&sig=${unterschrift}`;
}

/**
 * Den Abruf beim Daemon holen und an `res` durchreichen.
 *
 * Antwortet der Daemon nicht mit 200/206, bekommt der Browser eine Fehlerseite
 * mit Grund (502), keine halbe Datei. Bricht der Browser ab, wird die Anfrage
 * beim Daemon abgebrochen.
 *
 * @param {string} adresse    die unterschriebene Adresse beim Daemon
 * @param {object} req,res    Express
 * @param {string} dateiname  für Content-Disposition
 * @param {object} maschine   wegen des Zertifikats
 * @returns {Promise<{status:number, bytes:number}|{fehler:string}>}
 */
function reicheDurch(adresse, req, res, dateiname, maschine) {
    return new Promise((fertig) => {
        let bytes = 0;
        const kopf = {};
        if (req.headers.range) kopf.Range = req.headers.range;

        const anfrage = https.get(adresse, { ...tlsOptionen(maschine), headers: kopf, timeout: 15000 }, (antwort) => {
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
            res.setHeader('Content-Disposition', anhangKopf(dateiname));
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

/**
 * Die ersten Bytes einer Datei beim Daemon holen (F4c).
 *
 * Für Logs: Der Ladestand braucht den Anfang. Eine Bereichsanfrage an `/datei`
 * holt nur, was gebraucht wird, ein kürzeres Log kommt ganz.
 *
 * @param {object} maschine wie `dateiAdresse`
 * @param {number|string} serverId
 * @param {string} pfad
 * @param {number} bytes wie viele höchstens
 * @returns {Promise<Buffer>}
 */
function leseAnfang(maschine, serverId, pfad, bytes) {
    return new Promise((fertig, nein) => {
        const anfrage = https.get(dateiAdresse(maschine, serverId, pfad), {
            ...tlsOptionen(maschine), headers: { Range: `bytes=0-${bytes - 1}` }, timeout: 15000,
        }, (antwort) => {
            if (antwort.statusCode !== 200 && antwort.statusCode !== 206) {
                antwort.resume();
                return nein(new Error(`Der Rootserver antwortete mit ${antwort.statusCode}.`));
            }
            const teile = [];
            let laenge = 0;
            antwort.on('data', (stueck) => {
                teile.push(stueck);
                laenge += stueck.length;
                // Ein Dienst, der den Bereich nicht kennt, schickte die ganze Datei.
                if (laenge >= bytes) antwort.destroy();
            });
            const ende = () => fertig(Buffer.concat(teile).subarray(0, bytes));
            antwort.on('end', ende);
            antwort.on('close', ende);
            antwort.on('error', (e) => { if (laenge < bytes) nein(e); });
        });
        anfrage.on('timeout', () => anfrage.destroy(new Error('der Rootserver antwortet nicht')));
        anfrage.on('error', nein);
    });
}

/**
 * Eine Datei lesen, ganz oder gar nicht.
 *
 * @param {number|string} rootserverId
 * @param {number|string} serverId
 * @param {string} pfad
 * @param {number} grenze Über dieser Größe gibt es einen Wurf mit 413. Der Inhalt
 *        landet im Speicher, große Dateien gehören in `reicheDurch`.
 * @returns {Promise<Buffer>}
 */
async function lies(rootserverId, serverId, pfad, grenze) {
    const maschine = await module.exports.maschineVon(rootserverId);
    return new Promise((fertig, nein) => {
        const anfrage = https.get(dateiAdresse(maschine, serverId, pfad), {
            ...tlsOptionen(maschine), timeout: 15000,
        }, (antwort) => {
            if (antwort.statusCode !== 200) {
                antwort.resume();
                return nein(fehlerMit(antwort.statusCode === 404 ? 404 : 502, antwort.statusCode === 404
                    ? `Datei nicht gefunden: ${pfad}` : `Der Rootserver antwortete mit ${antwort.statusCode}.`));
            }
            const zuGross = () => fehlerMit(413, `Datei zu groß (max ${Math.round(grenze / 1024 / 1024)} MB).`);
            if (Number(antwort.headers['content-length']) > grenze) {
                antwort.destroy();
                return nein(zuGross());
            }
            const teile = [];
            let laenge = 0;
            antwort.on('data', (stueck) => {
                teile.push(stueck);
                laenge += stueck.length;
                if (laenge > grenze) { antwort.destroy(); nein(zuGross()); }
            });
            antwort.on('end', () => fertig(Buffer.concat(teile)));
            antwort.on('error', nein);
        });
        anfrage.on('timeout', () => anfrage.destroy(new Error('der Rootserver antwortet nicht')));
        anfrage.on('error', nein);
    });
}

/** Ein PUT an den Abruf. Was der Daemon ablehnt, kommt mit seinem Grund als Wurf zurück. */
function sende(adresse, maschine, inhalt) {
    return new Promise((fertig, nein) => {
        const anfrage = https.request(adresse, {
            ...tlsOptionen(maschine), method: 'PUT', timeout: 120000,
            headers: { 'content-type': 'application/octet-stream', 'content-length': inhalt.length },
        }, (antwort) => {
            const teile = [];
            antwort.on('data', (stueck) => teile.push(stueck));
            antwort.on('error', nein);
            antwort.on('end', () => {
                const text = Buffer.concat(teile).toString('utf8').trim();
                if (antwort.statusCode >= 200 && antwort.statusCode < 300) return fertig(text);
                nein(fehlerMit(antwort.statusCode, antwort.statusCode === 422 && text
                    ? text : `Der Rootserver antwortete mit ${antwort.statusCode}.`));
            });
        });
        anfrage.on('timeout', () => anfrage.destroy(new Error('der Rootserver antwortet nicht')));
        anfrage.on('error', nein);
        anfrage.end(inhalt);
    });
}

/** Eine Datei schreiben. Die Regeln (Platzgrenze, geschützte Dateien) prüft der Daemon. */
async function schreibe(rootserverId, serverId, pfad, inhalt) {
    const maschine = await module.exports.maschineVon(rootserverId);
    await sende(dateiAdresse(maschine, serverId, pfad, 'datei-schreiben'), maschine, inhalt);
}

/**
 * Einen Mod oder Lader ablegen.
 *
 * @param {number|string} rootserverId
 * @param {{serverId: number|string, ziel: string, dateiname: string, entpacken: boolean, marker: string}} auftrag
 * @param {Buffer} inhalt
 * @returns {Promise<string[]>} die geschriebenen Pfade
 */
async function legeAb(rootserverId, auftrag, inhalt) {
    const maschine = await module.exports.maschineVon(rootserverId);
    const antwort = await sende(inhaltAdresse(maschine, auftrag), maschine, inhalt);
    return JSON.parse(antwort).dateien || [];
}

module.exports = { wirt, wirtFuerBrowser, basis, downloadAdresse, gibtFrei, reicheDurch, dateiAdresse, anhangKopf,
    leseAnfang, maschineVon, gesichert, lies, schreibe, legeAb };
