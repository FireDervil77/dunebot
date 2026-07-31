/**
 * PublicStatus – das Anzeigemodell für die öffentliche Statusseite (E5)
 *
 * Der Endpunkt ist ohne Anmeldung erreichbar, deshalb entscheidet sich hier,
 * welche Daten das Haus verlassen. Die Regel ist eine Weißliste: Aufgenommen
 * wird, was aufgenommen werden soll – nicht „alles außer".
 *
 * Was **nie** hinausgeht, auch wenn es im Snapshot steht:
 *   - `uid`, `steamid`, `platform_id` – dauerhafte Kennungen. Ein Spielername
 *     ist flüchtig, eine SteamID identifiziert dieselbe Person über Jahre und
 *     über Server hinweg.
 *   - `ping` je Spieler – erlaubt grobe Rückschlüsse auf den Standort.
 *   - Interne Adressen, Ports fremder Dienste, Umgebungsvariablen, Fehlertexte.
 *
 * Die Connect-Adresse ist die einzige Ausnahme: Sie ist der Sinn der Sache und
 * ohnehin öffentlich, sonst könnte niemand beitreten.
 *
 * @module helpers/PublicStatus
 */

'use strict';

const crypto = require('crypto');

/** Felder eines Spielers, die öffentlich sein dürfen. */
const OEFFENTLICHE_SPIELERFELDER = ['name'];

/**
 * Erzeugt ein Token für die öffentliche Adresse.
 *
 * 24 Byte als Hex sind 48 Zeichen – zu lang für die Spalte (32). Base64url
 * liefert 32 Zeichen aus 24 Byte und bleibt URL-tauglich.
 *
 * @returns {string}
 */
function neuesToken() {
    return crypto.randomBytes(24).toString('base64url');
}

/**
 * Holt einen Wert über einen Punktpfad; `source` darf eine Liste sein.
 * Gleiche Regel wie im Dashboard und im Discord-Panel.
 *
 * @param {object} data
 * @param {string|string[]} source
 * @returns {*}
 */
function feldWert(data, source) {
    for (const pfad of [].concat(source || [])) {
        const wert = String(pfad).split('.')
            .reduce((acc, key) => (acc == null ? acc : acc[key]), data);
        if (wert != null && wert !== '') return wert;
    }
    return null;
}

/**
 * Baut die öffentliche Antwort.
 *
 * @param {object} args
 * @param {object} args.server - id, name, status, game_name, public_status_players
 * @param {object} args.snapshot - Zeile aus gameserver_status (bereits geparst)
 * @param {object} args.display - display-Block des Addons (E2)
 * @returns {object} JSON-taugliches Anzeigemodell
 */
function baueAntwort({ server, snapshot, display }) {
    const online = !!snapshot?.online;

    // Die Feldquellen aus display.fields zeigen auf die Query-Form.
    const daten = {
        map:     snapshot?.map ?? null,
        ping:    snapshot?.ping_ms ?? null,
        version: snapshot?.version ?? null,
        connect: snapshot?.extra?.connect ?? null,
        extra:   snapshot?.extra || {},
    };

    // Nur Felder, die das Addon vorsieht, und nur mit Wert – dieselbe Regel wie
    // überall sonst: Ein leeres Feld behauptet, der Wert fehle gerade.
    const felder = [];
    for (const feld of display?.fields || []) {
        const wert = feldWert(daten, feld.source || feld.key);
        if (wert == null || wert === '') continue;
        if (feld.hide_when === 'zero' && Number(wert) === 0) continue;
        felder.push({ key: feld.key, label: feld.label || feld.key, value: wert });
    }

    const antwort = {
        name:            server.name,
        game:            server.game_name || null,
        online,
        players_current: snapshot?.players_current ?? null,
        players_max:     snapshot?.players_max ?? null,
        map:             daten.map,
        version:         daten.version,
        connect:         daten.connect,
        fields:          felder,
        source:          snapshot?.source || 'none',
        updated_at:      snapshot?.queried_at ? new Date(snapshot.queried_at).toISOString() : null,
    };

    // Spielernamen nur auf ausdrücklichen Wunsch – und selbst dann nur die
    // Namen, nie die Kennungen aus dem Snapshot.
    if (server.public_status_players && online) {
        antwort.players = (snapshot?.players || [])
            .map(spieler => {
                const gefiltert = {};
                for (const feld of OEFFENTLICHE_SPIELERFELDER) {
                    if (spieler?.[feld]) gefiltert[feld] = spieler[feld];
                }
                return gefiltert.name ? gefiltert.name : null;
            })
            .filter(Boolean);
    }

    return antwort;
}

module.exports = {
    neuesToken,
    baueAntwort,
    feldWert,
    OEFFENTLICHE_SPIELERFELDER,
};
