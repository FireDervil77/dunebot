'use strict';

/**
 * Die Inhalte eines Servers — Mods und der Lader, der sie traegt (E6/B.12).
 *
 * Alles, was `gameserver_content` liest oder schreibt, steht hier. Die Routen
 * bleiben damit lesbar, und die drei Bedingungen fuer „Lader ist scharf" stehen
 * an EINER Stelle statt in jeder Abfrage neu.
 *
 * ── Was hier NICHT ist ──────────────────────────────────────────────────────
 *
 * Ein Verzeichnis der moeglichen Mods eines Spiels. Das haben Thunderstore und
 * Modrinth als API; ein handgepflegter Katalog waere in einer Woche veraltet.
 * Hier steht, was auf EINEM Server liegt.
 */

const { ServiceManager } = require('dunebot-core');

/** Der Lader ist die erste Zeile, kein Sonderfall. */
const ART_LADER = 'loader';
const ART_MOD = 'mod';

/**
 * Alles, was zu einem Server gehoert — auch das Entfernte.
 *
 * Entfernte Zeilen bleiben stehen (Entscheidung des Betreibers, 2026-09-08:
 * „dann ist das ganze ein lernender Prozess den man ueberblicken kann"), sie
 * gehoeren aber nicht in dieselbe Liste wie das Laufende. Deshalb getrennt
 * zurueckgegeben statt vom Aufrufer gefiltert.
 *
 * @param {number|string} serverId
 * @returns {Promise<{lader: object|null, mods: Array, entfernt: Array}>}
 */
async function fuerServer(serverId) {
    const dbService = ServiceManager.get('dbService');

    const zeilen = await dbService.query(
        `SELECT id, art, quelle, kennung, name, fassung, aktiv, reihenfolge,
                ablage, dateien, client_side, status, fehler, installiert_am, created_at
           FROM gameserver_content
          WHERE server_id = ?
          ORDER BY art = 'loader' DESC, reihenfolge ASC, id ASC`,
        [serverId]
    );

    const laufend = (zeilen || []).filter(z => z.status !== 'entfernt');

    return {
        lader:    laufend.find(z => z.art === ART_LADER) || null,
        mods:     laufend.filter(z => z.art === ART_MOD),
        entfernt: (zeilen || []).filter(z => z.status === 'entfernt'),
    };
}

/**
 * Ist der Lader dieses Servers scharf?
 *
 * **Drei Bedingungen, nicht eine.** Ohne alle drei waere jeder Server mit
 * irgendeinem Eintrag „modifiziert" — auch einer, bei dem die Installation
 * fehlschlug oder der ihn abgeschaltet hat. Dieselbe Abfrage steht in
 * `StartPayload.js`; sie ist der Schalter, der mit dem Startbefehl mitgeht.
 *
 * @param {number|string} serverId
 * @returns {Promise<boolean>}
 */
async function laderAktiv(serverId) {
    const dbService = ServiceManager.get('dbService');
    const [zeile] = await dbService.query(
        `SELECT id FROM gameserver_content
          WHERE server_id = ? AND art = ? AND aktiv = 1 AND status = 'installiert'
          LIMIT 1`,
        [serverId, ART_LADER]
    );
    return Boolean(zeile);
}

/**
 * Eine Zeile anlegen oder wiederbeleben.
 *
 * `UNIQUE (server_id, quelle, kennung)` heisst: Derselbe Mod zweimal ist kein
 * Zustand. Wer ihn nach dem Entfernen erneut hochlaedt, bekommt **dieselbe
 * Zeile zurueck** — mit neuer Fassung und neuem Stand. Ein zweiter Eintrag
 * waere die Sorte Doppelung, die man erst bemerkt, wenn zwei Fassungen
 * desselben Mods im Ordner liegen.
 *
 * @param {object} daten
 * @returns {Promise<number>} Kennung der Zeile
 */
async function eintragen(daten) {
    const dbService = ServiceManager.get('dbService');

    const ergebnis = await dbService.query(
        `INSERT INTO gameserver_content
             (server_id, guild_id, art, quelle, kennung, name, fassung,
              aktiv, reihenfolge, ablage, dateien, client_side, status, fehler, installiert_am)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
             name           = VALUES(name),
             fassung        = VALUES(fassung),
             aktiv          = 1,
             ablage         = VALUES(ablage),
             dateien        = VALUES(dateien),
             client_side    = VALUES(client_side),
             status         = VALUES(status),
             fehler         = VALUES(fehler),
             installiert_am = VALUES(installiert_am)`,
        [
            daten.serverId, String(daten.guildId), daten.art, daten.quelle,
            daten.kennung, daten.name || null, daten.fassung || null,
            Number(daten.reihenfolge) || 0,
            daten.ablage || null,
            // Die genaue Liste — ohne sie muss das Entfernen raten, und bei
            // einem Mod aus mehreren Dateien heisst Raten „der ganze Ordner".
            Array.isArray(daten.dateien) && daten.dateien.length
                ? JSON.stringify(daten.dateien) : null,
            daten.clientSide ? 1 : 0,
            daten.status || 'geplant',
            daten.fehler || null,
            daten.status === 'installiert' ? new Date() : null,
        ]
    );

    if (ergebnis.insertId) return ergebnis.insertId;

    // Bei ON DUPLICATE KEY ist insertId 0 — die vorhandene Zeile suchen.
    const [zeile] = await dbService.query(
        'SELECT id FROM gameserver_content WHERE server_id = ? AND quelle = ? AND kennung = ?',
        [daten.serverId, daten.quelle, daten.kennung]
    );
    return zeile ? zeile.id : null;
}

/**
 * Eine Zeile auf „entfernt" setzen — sie bleibt stehen.
 *
 * Kein DELETE: Der Rueckweg auf eine vorige Fassung ist Teil von B.12, und im
 * Nachhinein sichtbar zu haben, welcher Mod wann dazukam, ist die Frage, die
 * nach einem kaputten Server als erste gestellt wird.
 *
 * @returns {Promise<object|null>} Die Zeile VOR der Aenderung — der Aufrufer
 *                                 braucht `ablage`, um die Dateien zu entfernen
 */
async function entfernen(id, serverId) {
    const dbService = ServiceManager.get('dbService');

    const [vorher] = await dbService.query(
        'SELECT * FROM gameserver_content WHERE id = ? AND server_id = ?', [id, serverId]);
    if (!vorher) return null;

    await dbService.query(
        "UPDATE gameserver_content SET status = 'entfernt', aktiv = 0 WHERE id = ?", [id]);
    return vorher;
}

/**
 * An- oder abschalten, ohne zu entfernen (B.12).
 *
 * Eine entfernte Zeile laesst sich nicht anschalten: Ihre Dateien liegen nicht
 * mehr da, und ein `aktiv = 1` daneben waere eine Behauptung.
 */
async function schalten(id, serverId, aktiv) {
    const dbService = ServiceManager.get('dbService');
    const ergebnis = await dbService.query(
        `UPDATE gameserver_content SET aktiv = ?
          WHERE id = ? AND server_id = ? AND status <> 'entfernt'`,
        [aktiv ? 1 : 0, id, serverId]
    );
    return ergebnis.affectedRows > 0;
}

/**
 * Die geschriebenen Dateien einer Zeile.
 *
 * Alte Zeilen (vor dem 2026-09-11) haben keine Liste — dann ist sie leer, und
 * der Aufrufer muss selbst entscheiden, ob er mit `ablage` allein etwas
 * anfangen kann. Eine erfundene Liste waere schlimmer als keine.
 *
 * @returns {string[]}
 */
function dateienAus(zeile) {
    if (!zeile || !zeile.dateien) return [];
    try {
        const liste = typeof zeile.dateien === 'string' ? JSON.parse(zeile.dateien) : zeile.dateien;
        return Array.isArray(liste) ? liste.filter(d => typeof d === 'string' && d) : [];
    } catch {
        return [];
    }
}

/**
 * Die Seite, auf der dieser Inhalt bei seiner Quelle steht.
 *
 * ── Warum das Spiel in die Adresse gehoert ──────────────────────────────────
 *
 * Thunderstore ist nach Spielen getrennt. `thunderstore.io/package/<ns>/<name>/`
 * gibt es zwar — es leitet aber auf die Gemeinschaft um, in der das Paket
 * ZUERST erschien: Fuer `ValheimModding-Jotunn` landet man damit bei
 * **riskofrain2** (gemessen am 2026-09-12, HTTP 301). Richtig ist
 * `/c/<gemeinschaft>/p/<namensraum>/<name>/`, und die Gemeinschaft weiss nur
 * das Paket (`content.source_ids.thunderstore`).
 *
 * Deshalb steht die Adresse hier und nicht in der Ansicht: Die Ansicht kennt
 * das Spielpaket nicht.
 *
 * @param {object} zeile      Zeile aus gameserver_content
 * @param {string|null} gemeinschaft
 * @returns {string|null} null, wenn es keine Seite gibt (hochgeladene Datei)
 */
function paketAdresse(zeile, gemeinschaft) {
    if (!zeile || zeile.quelle !== 'thunderstore' || !gemeinschaft) return null;

    const kennung = String(zeile.kennung || '');
    const schnitt = kennung.indexOf('-');
    if (schnitt < 1 || schnitt === kennung.length - 1) return null;

    const namensraum = kennung.slice(0, schnitt);
    const name = kennung.slice(schnitt + 1);
    return 'https://thunderstore.io/c/' + encodeURIComponent(gemeinschaft)
         + '/p/' + encodeURIComponent(namensraum) + '/' + encodeURIComponent(name) + '/';
}

module.exports = {
    fuerServer, laderAktiv, eintragen, entfernen, schalten, dateienAus, paketAdresse,
    ART_LADER, ART_MOD,
};
