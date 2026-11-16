'use strict';

/**
 * Logging: Sprache (3.2; LG-1b Teil 2, K382, 2026-11-16).
 *
 * Aus `voiceStateUpdate(alt, neu)`: Beitritt, Verlassen, Wechsel, vom Server
 * stumm/taub, selbst stumm/taub, Kamera, Bildschirm, Bühne (Sprecher ja/nein),
 * Hand gehoben. Kein Ton, nie.
 *
 * Akteur: Beitritt und alles „selbst“ tut das Mitglied → sicher. Verlassen
 * und Wechsel können auch ein Moderator sein (Trennen, Verschieben), vom
 * Server stumm/taub ist es immer → Akteur offen bis LG-1c.
 *
 * Selbst stumm/taub, Kamera, Bildschirm und Hand heben sind ohne Zeile aus
 * (Katalog `aus`): Sie geschehen oft und sagen wenig.
 *
 * @module logging/bot/sprache
 */

const { erfasse, nameVon, rollenVon } = require('./erfasser');
const { ketteVon } = require('./nachrichten');

/** Ein Schalter am Sprachzustand: Feld in discord.js → Art und Feldname im Ereignis. */
const SCHALTER = [
    ['serverMute', 'sprache.server_stumm', 'stumm', false],
    ['serverDeaf', 'sprache.server_taub', 'taub', false],
    ['selfMute', 'sprache.selbst_stumm', 'stumm', true],
    ['selfDeaf', 'sprache.selbst_taub', 'taub', true],
    ['selfVideo', 'sprache.kamera', 'kamera', true],
    ['streaming', 'sprache.bildschirm', 'bildschirm', true],
];

function aenderungen(alt, neu) {
    const id = neu?.id || alt?.id;
    if (!id) return [];
    const vorK = alt?.channelId || null;
    const nachK = neu?.channelId || null;
    const objekt = { typ: 'mitglied', id };
    const selbst = { akteur: id, zuordnung: 'sicher' };
    if (!vorK && nachK) return [{ art: 'sprache.beigetreten', schwere: 'info', ...selbst, betroffen: id, kanal: nachK, objekt, nachher: { kanal: nachK } }];
    if (vorK && !nachK) return [{ art: 'sprache.verlassen', schwere: 'info', betroffen: id, kanal: vorK, objekt, vorher: { kanal: vorK } }];
    if (!vorK || !nachK) return [];
    if (vorK !== nachK) {
        return [{ art: 'sprache.gewechselt', schwere: 'info', betroffen: id, kanal: nachK, objekt, vorher: { kanal: vorK }, nachher: { kanal: nachK } }];
    }
    const aus = [];
    for (const [feld, art, name, vonSelbst] of SCHALTER) {
        const a = Boolean(alt?.[feld]);
        const b = Boolean(neu?.[feld]);
        if (a === b) continue;
        aus.push({ art, schwere: 'info', ...(vonSelbst ? selbst : {}), betroffen: id, kanal: nachK, objekt,
            vorher: { [name]: a }, nachher: { [name]: b } });
    }
    // Bühne: `suppress` false heißt „spricht“. Nur in Bühnenkanälen bedeutsam;
    // in normalen Kanälen bleibt es false und ändert sich nicht.
    if (Boolean(alt?.suppress) !== Boolean(neu?.suppress)) {
        aus.push({ art: 'sprache.buehne', schwere: 'info', betroffen: id, kanal: nachK, objekt,
            vorher: { sprecher: !alt?.suppress }, nachher: { sprecher: !neu?.suppress } });
    }
    if (!alt?.requestToSpeakTimestamp && neu?.requestToSpeakTimestamp) {
        aus.push({ art: 'sprache.meldung', schwere: 'info', ...selbst, betroffen: id, kanal: nachK, objekt });
    }
    return aus;
}

async function melde(guildId, ereignisse, alt, neu) {
    if (!ereignisse.length) return;
    const zustand = neu?.channelId ? neu : alt;
    const mitglied = neu?.member || alt?.member;
    const n = nameVon(mitglied);
    const kontext = {
        rollen: rollenVon(mitglied), kanaele: ketteVon(zustand?.channel || { id: zustand?.channelId }),
        akteurIstBot: Boolean(mitglied?.user?.bot), namen: n ? [n] : [],
    };
    await Promise.all(ereignisse.map((e) => erfasse(guildId, e, kontext)));
}

module.exports = { aenderungen, melde };
