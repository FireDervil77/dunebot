'use strict';

/**
 * Streaming - Abonnenten und ihre Rolle (Stufe 12b).
 *
 * **Warum das der staerkste Punkt des Vorhabens ist:** Discords eingebaute
 * Twitch-Verknuepfung kann genau das und tut es unzuverlaessig. Es ist das
 * Aergernis, das jeder Streamer kennt — und der einzige Punkt, an dem wir
 * gegen den Marktfuehrer nicht nachbauen, sondern etwas besser machen.
 *
 * ## Drei Kennungen, und man darf sie nicht verwechseln
 *
 *   Kanal      — wessen Abonnenten (streaming_streamers.kanal_id)
 *   Abonnent   — ein TWITCH-Konto (streaming_subscribers.konto_id)
 *   Mitglied   — ein DISCORD-Benutzer (user_connections.user_id)
 *
 * Die dritte ergibt sich aus der zweiten, aber **erst beim Vergeben** und
 * jederzeit widerrufbar. Wer abonniert, ohne sein Konto verknuepft zu haben,
 * steht trotzdem in `streaming_subscribers` — und bekommt die Rolle in dem
 * Moment, in dem er sich verknuepft. Umgekehrt verliert er sie, wenn er die
 * Verknuepfung loest, ohne dass sein Abonnement endet.
 *
 * ## Der Kern redet mit niemandem
 *
 * Hier steht das Urteil, nicht die Ausfuehrung. Wer den Bot fragen muss,
 * bekommt einen Auftrag in `streaming_outbox` — dieselbe Trennung wie bei der
 * Live-Rolle.
 *
 * ## Nur zurueck, was wir gaben
 *
 * Der Abgleich vergibt und nimmt ausschliesslich ueber `streaming_role_grants`.
 * Am 2026-08-25 hat ein Abgleich vier Mitgliedern eine Rolle weggenommen, die
 * sie aus einem anderen Grund trugen. Diese Buchfuehrung ist die Lehre daraus,
 * und sie gilt hier genauso.
 *
 * @module streaming/dashboard/kern/abonnenten
 */

const { ServiceManager } = require('dunebot-core');

/** @returns {Object} Datenbankdienst */
function db() {
    return ServiceManager.get('dbService');
}

/** @returns {Object} Logger */
function log() {
    return ServiceManager.get('Logger');
}

/**
 * **Die Entscheidung, getrennt von der Ausfuehrung.**
 *
 * Drei Mengen, und die dritte ist die wichtigste:
 *
 *   geben   — soll die Rolle haben, hat sie laut Buchfuehrung nicht
 *   nehmen  — hat sie laut Buchfuehrung von UNS, soll sie nicht mehr haben
 *   fremd   — traegt sie, aber nicht von uns: **nicht anfassen**
 *
 * Ohne die dritte Menge nimmt ein Abgleich jedem die Rolle weg, der sie aus
 * einem anderen Grund traegt. Genau das ist am 2026-08-25 passiert.
 *
 * Reine Rechnung: keine Datenbank, kein Discord, vollstaendig durchspielbar.
 *
 * @param {Array<string>} sollen Discord-Kennungen, die die Rolle haben sollen
 * @param {Array<string>} vergeben Discord-Kennungen, denen WIR sie gaben
 * @returns {{geben: Array<string>, nehmen: Array<string>}} Auftraege
 */
function vergleichen(sollen, vergeben) {
    const soll = new Set((sollen || []).map(String));
    const ist = new Set((vergeben || []).map(String));

    return {
        geben: [...soll].filter(m => !ist.has(m)),
        nehmen: [...ist].filter(m => !soll.has(m))
    };
}

/**
 * Wer hat fuer diesen Kanal belegt, dass er ihm gehoert?
 *
 * **Das ist der Eigentumsnachweis, ohne `besitzer_id`.** Die Spalte ist bis
 * heute leer (Baustelle 72); gebraucht wird sie hier auch nicht: Ein Konto
 * gehoert laut `user_connections` hoechstens einem Discord-Benutzer, und die
 * Kanalkennung IST die Kontokennung. Wer also `twitch/12345` verknuepft hat,
 * hat damit belegt, dass ihm der Kanal `12345` gehoert.
 *
 * @param {Object} streamer Zeile aus streaming_streamers
 * @returns {Promise<string|null>} Discord-Kennung oder null
 */
async function kanalInhaber(streamer) {
    const zeilen = await db().query(
        'SELECT user_id FROM user_connections WHERE plattform = ? AND konto_id = ? LIMIT 1',
        [streamer.plattform, String(streamer.kanal_id)]);
    return zeilen[0] ? String(zeilen[0].user_id) : null;
}

/**
 * Welches Discord-Mitglied steckt hinter einem Twitch-Konto?
 *
 * @param {string} plattform Anbieter
 * @param {string} kontoId Kontokennung
 * @returns {Promise<string|null>} Discord-Kennung oder null
 */
async function mitgliedFuer(plattform, kontoId) {
    const zeilen = await db().query(
        'SELECT user_id FROM user_connections WHERE plattform = ? AND konto_id = ? LIMIT 1',
        [plattform, String(kontoId)]);
    return zeilen[0] ? String(zeilen[0].user_id) : null;
}

/**
 * Die Ziele, die fuer diesen Streamer eine Abonnenten-Rolle vergeben wollen.
 *
 * @param {number} streamerId Streamer
 * @returns {Promise<Array<Object>>} Ziele
 */
async function zieleMitRolle(streamerId) {
    return await db().query(`
        SELECT id, guild_id, abo_rolle_id
          FROM streaming_targets
         WHERE streamer_id = ? AND aktiv = 1 AND abo_rolle_id IS NOT NULL AND abo_rolle_id <> ''
    `, [streamerId]);
}

/**
 * Einen Rollenauftrag je Ziel schreiben.
 *
 * **`grund: 'abo'` ist kein Schmuck.** Der Ausgang prueft bei einem
 * `rolle_geben` sonst nach, ob der Streamer gerade live ist — richtig fuer die
 * Live-Rolle, falsch fuer diese hier: Ein Abonnement gilt auch nachts um vier.
 *
 * @param {number} streamerId Streamer
 * @param {string} mitgliedId Discord-Mitglied
 * @param {'geben'|'nehmen'} richtung Richtung
 * @returns {Promise<number>} geschriebene Auftraege
 */
async function auftragSchreiben(streamerId, mitgliedId, richtung) {
    const ziele = await zieleMitRolle(streamerId);
    let geschrieben = 0;

    for (const ziel of ziele) {
        await db().query(`
            INSERT INTO streaming_outbox (target_id, guild_id, aktion, nutzlast)
            VALUES (?, ?, ?, ?)
        `, [ziel.id, ziel.guild_id, `rolle_${richtung}`,
            JSON.stringify({
                grund: 'abo',
                streamer_id: streamerId,
                mitglied_id: mitgliedId,
                rolle_id: ziel.abo_rolle_id
            })]);
        geschrieben++;
    }

    return geschrieben;
}

/**
 * Ein Abonnement vermerken und die Rolle veranlassen.
 *
 * @param {Object} streamer Streamer
 * @param {Object} person { kontoId, kontoName, stufe, geschenkt }
 * @returns {Promise<string>} Klartext fuers Protokoll
 */
async function aufnehmen(streamer, person) {
    if (!person?.kontoId) return 'Ereignis ohne Konto';

    await db().query(`
        INSERT INTO streaming_subscribers (streamer_id, konto_id, konto_name, stufe, geschenkt, gesehen_am)
        VALUES (?, ?, ?, ?, ?, NOW())
        ON DUPLICATE KEY UPDATE
            konto_name = VALUES(konto_name), stufe = VALUES(stufe),
            geschenkt = VALUES(geschenkt), gesehen_am = NOW()
    `, [streamer.id, person.kontoId, person.kontoName, person.stufe, person.geschenkt ? 1 : 0]);

    const mitglied = await mitgliedFuer(streamer.plattform, person.kontoId);
    if (!mitglied) {
        // **Kein Fehler, und trotzdem eine Zeile wert.** Ohne Verknuepfung
        // koennen wir niemandem etwas geben. Wer das nicht protokolliert,
        // sucht spaeter nach einer Rolle, die nie vergeben werden konnte.
        return `${person.kontoName || person.kontoId} abonniert - kein verknuepftes Discord-Konto, keine Rolle`;
    }

    const n = await auftragSchreiben(streamer.id, mitglied, 'geben');
    return `${person.kontoName || person.kontoId} abonniert - ${n} Rollenauftrag/-auftraege`;
}

/**
 * Ein beendetes Abonnement vermerken und die Rolle abziehen.
 *
 * @param {Object} streamer Streamer
 * @param {Object} person { kontoId, kontoName }
 * @returns {Promise<string>} Klartext fuers Protokoll
 */
async function entfernen(streamer, person) {
    if (!person?.kontoId) return 'Ereignis ohne Konto';

    await db().query(
        'DELETE FROM streaming_subscribers WHERE streamer_id = ? AND konto_id = ?',
        [streamer.id, person.kontoId]);

    const mitglied = await mitgliedFuer(streamer.plattform, person.kontoId);
    if (!mitglied) return `${person.kontoName || person.kontoId} nicht mehr Abonnent - kein verknuepftes Konto`;

    const n = await auftragSchreiben(streamer.id, mitglied, 'nehmen');
    return `${person.kontoName || person.kontoId} nicht mehr Abonnent - ${n} Rollenauftrag/-auftraege`;
}

/**
 * Der Abgleich: Wer sollte die Rolle tragen, und wer traegt sie von uns?
 *
 * Vorsichtsmassnahme gegen ein verlorenes `channel.subscription.end` — dann
 * bliebe die Rolle sonst fuer immer. Und der Weg, auf dem jemand seine Rolle
 * bekommt, der sein Konto erst NACH dem Abonnieren verknuepft hat.
 *
 * @param {Object} streamer Streamer
 * @returns {Promise<{geben: number, nehmen: number, grund: string}>} Bilanz
 */
async function abgleichen(streamer) {
    const ziele = await zieleMitRolle(streamer.id);
    if (!ziele.length) return { geben: 0, nehmen: 0, grund: 'kein Ziel mit Abonnenten-Rolle' };

    const abonnenten = await db().query(
        'SELECT konto_id FROM streaming_subscribers WHERE streamer_id = ?', [streamer.id]);

    // Twitch -> Discord uebersetzen. Wer nicht verknuepft ist, faellt hier
    // heraus - er steht weiter als Abonnent, bekommt aber keine Rolle.
    const sollen = [];
    for (const a of abonnenten) {
        const m = await mitgliedFuer(streamer.plattform, a.konto_id);
        if (m) sollen.push(m);
    }

    let geben = 0;
    let nehmen = 0;

    for (const ziel of ziele) {
        const vergeben = await db().query(
            'SELECT mitglied_id FROM streaming_role_grants WHERE guild_id = ? AND rolle_id = ?',
            [ziel.guild_id, ziel.abo_rolle_id]);

        const urteil = vergleichen(sollen, vergeben.map(v => v.mitglied_id));

        for (const richtung of ['geben', 'nehmen']) {
            for (const mitglied of urteil[richtung]) {
                await db().query(`
                    INSERT INTO streaming_outbox (target_id, guild_id, aktion, nutzlast)
                    VALUES (?, ?, ?, ?)
                `, [ziel.id, ziel.guild_id, `rolle_${richtung}`,
                    JSON.stringify({
                        grund: 'abo', streamer_id: streamer.id,
                        mitglied_id: mitglied, rolle_id: ziel.abo_rolle_id
                    })]);
                if (richtung === 'geben') geben++; else nehmen++;
            }
        }
    }

    if (geben || nehmen) {
        log().info(`[Streaming/Abos] Abgleich ${streamer.login}: ${geben} zu geben, ${nehmen} zu nehmen`);
    }
    return { geben, nehmen, grund: 'abgeglichen' };
}

module.exports = {
    vergleichen, kanalInhaber, mitgliedFuer, zieleMitRolle,
    auftragSchreiben, aufnehmen, entfernen, abgleichen
};
