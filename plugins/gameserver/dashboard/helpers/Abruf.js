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
 * Für einen Link, den ein BROWSER öffnet (Sicherung herunterladen): immer die IP.
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

module.exports = { wirt, wirtFuerBrowser, basis, downloadAdresse, gibtFrei };
