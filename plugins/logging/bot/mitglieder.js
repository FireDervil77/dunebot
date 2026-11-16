'use strict';

/**
 * Logging: Mitglieder und Bots (3.3, 3.7; LG-1b, K382, 2026-11-16).
 *
 * Jede Funktion bekommt die Argumente des Gateway-Ereignisses und gibt eine
 * Liste von Ereignissen zurück (eine Änderung am Mitglied kann mehrere sein:
 * Spitzname und Rollen zugleich). `melde*` erfasst sie dann.
 *
 * Ein Bot als Mitglied fällt unter „Bots“ (3.7), nicht unter „Mitglieder“.
 *
 * Grenzen, die die Seite nennt statt sie zu verdecken:
 *   - Wer kickte, bannte oder Rollen gab, steht erst mit LG-1c fest
 *     (Audit-Log). Bis dahin `akteur` leer.
 *   - Ein ungecachtes Mitglied kommt bei `guildMemberUpdate` mit leerem
 *     altem Stand (G-13). Dann ist der Vorher-Stand unbekannt, und es wird
 *     nichts erfasst ([[check-partials]]).
 *   - Ein Bann-Grund ist Text eines Moderators; Stufe 1 speichert keinen
 *     Text. Er kommt mit dem Audit-Eintrag (LG-1c) als Teil der Moderation.
 *
 * @module logging/bot/mitglieder
 */

const { erfasse, nameVon, rollenVon } = require('./erfasser');
const { rollenUnterschied, rechteNamen, schwerste } = require('../shared/vergleich');

const iso = (t) => (t ? new Date(t).toISOString() : null);
const art = (m, name) => `${m?.user?.bot ? 'bot' : 'mitglied'}.${name}`;

/** Ereignis „beigetreten“. */
function beigetreten(member) {
    return [{
        art: art(member, 'beigetreten'), schwere: 'info', betroffen: member.id,
        objekt: { typ: 'mitglied', id: member.id },
        nachher: { konto_erstellt: iso(member.user?.createdTimestamp), bot: Boolean(member.user?.bot) },
    }];
}

/** Ereignis „verlassen“. Als Partial ohne Beitrittszeit und Rollen. */
function verlassen(member) {
    const vorher = member.partial ? null : { beigetreten_am: iso(member.joinedTimestamp), rollen: rollenVon(member) };
    return [{ art: art(member, 'verlassen'), schwere: 'info', betroffen: member.id, objekt: { typ: 'mitglied', id: member.id }, vorher }];
}

/**
 * Schwere einer Rollenvergabe: Administrator → kritisch, ein gefährliches
 * Recht → warnung, sonst info.
 *
 * @param {string[]} dazu Rollen-IDs
 * @param {(id: string) => any} rolle Rolle zur ID (mit `permissions.bitfield`)
 */
function rollenSchwere(dazu, rolle) {
    const { GEFAEHRLICHE_RECHTE } = require('../shared/katalog');
    let s = 'info';
    for (const r of dazu) {
        const namen = rechteNamen(rolle(r)?.permissions?.bitfield ?? 0n);
        if (namen.includes('Administrator')) s = schwerste(s, 'kritisch');
        else if (namen.some((n) => GEFAEHRLICHE_RECHTE.includes(n))) s = schwerste(s, 'warnung');
    }
    return s;
}

/** Änderungen an einem Mitglied. Altes Mitglied als Partial → nichts. */
function geaendert(alt, neu) {
    if (!alt || alt.partial) return [];
    const aus = [];
    const objekt = { typ: 'mitglied', id: neu.id };
    const bot = Boolean(neu.user?.bot);

    if ((alt.nickname ?? null) !== (neu.nickname ?? null)) {
        aus.push({ art: art(neu, 'spitzname'), schwere: 'info', betroffen: neu.id, objekt,
            vorher: { spitzname: alt.nickname ?? null }, nachher: { spitzname: neu.nickname ?? null } });
    }
    if (!bot && (alt.avatar ?? null) !== (neu.avatar ?? null)) {
        aus.push({ art: 'mitglied.avatar', schwere: 'info', betroffen: neu.id, objekt,
            vorher: { avatar: alt.avatar ?? null }, nachher: { avatar: neu.avatar ?? null } });
    }
    const r = rollenUnterschied(rollenVon(alt), rollenVon(neu));
    if (r.dazu.length || r.weg.length) {
        const rolle = (id) => neu.guild?.roles?.cache?.get(id);
        aus.push({ art: art(neu, 'rollen'), schwere: rollenSchwere(r.dazu, rolle), betroffen: neu.id, objekt,
            nachher: { dazu: r.dazu, weg: r.weg } });
    }
    if (!bot) {
        const vorBis = alt.communicationDisabledUntilTimestamp || null;
        const nachBis = neu.communicationDisabledUntilTimestamp || null;
        if (nachBis && nachBis > Date.now() && nachBis !== vorBis) {
            aus.push({ art: 'mitglied.timeout', schwere: 'warnung', betroffen: neu.id, objekt,
                vorher: { bis: iso(vorBis) }, nachher: { bis: iso(nachBis) } });
        } else if (vorBis && !nachBis) {
            aus.push({ art: 'mitglied.timeout_ende', schwere: 'info', betroffen: neu.id, objekt, vorher: { bis: iso(vorBis) } });
        }
        const vorBoost = alt.premiumSinceTimestamp || null;
        const nachBoost = neu.premiumSinceTimestamp || null;
        if (Boolean(vorBoost) !== Boolean(nachBoost)) {
            aus.push({ art: 'mitglied.boost', schwere: 'info', betroffen: neu.id, objekt,
                vorher: { seit: iso(vorBoost) }, nachher: { seit: iso(nachBoost) } });
        }
    }
    return aus;
}

function gebannt(ban) {
    return [{ art: 'mitglied.gebannt', schwere: 'warnung', betroffen: ban.user?.id, objekt: { typ: 'mitglied', id: ban.user?.id } }];
}

function entbannt(ban) {
    return [{ art: 'mitglied.entbannt', schwere: 'info', betroffen: ban.user?.id, objekt: { typ: 'mitglied', id: ban.user?.id } }];
}

/**
 * Ereignisse erfassen; Kontext aus dem Mitglied: seine Rollen für den
 * Rollen-Ausschluss, sein Name für `log_namen`.
 */
async function melde(guildId, ereignisse, mitglied) {
    const n = nameVon(mitglied);
    const kontext = { rollen: rollenVon(mitglied), namen: n ? [n] : [] };
    for (const e of ereignisse) await erfasse(guildId, e, kontext);
}

module.exports = { beigetreten, verlassen, geaendert, gebannt, entbannt, rollenSchwere, melde };
