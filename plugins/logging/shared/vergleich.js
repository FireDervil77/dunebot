'use strict';

/**
 * Logging: Vorher/Nachher und Rechte-Unterschiede (LG-1b, K382, 2026-11-16).
 *
 * Rein, ohne Discord-Client: Die Erfasser geben einfache Werte hinein
 * (Bitfelder als Text oder BigInt, Überschreibungen als Liste). So prüft
 * `scripts/check-logging.js` jede Regel ohne Bot.
 *
 * Inhalte stehen hier nie: Kanalthema und Servername sind Einstellungen der
 * Guild, kein Text eines Mitglieds.
 *
 * @module logging/shared/vergleich
 */

const { PermissionsBitField } = require('discord.js');
const { GEFAEHRLICHE_RECHTE } = require('./katalog');

/**
 * Felder, die sich geändert haben. Gleich bleibende fallen weg; `null` und
 * `undefined` gelten als gleich.
 *
 * @param {object} alt
 * @param {object} neu
 * @param {string[]} felder
 * @returns {{vorher: object, nachher: object}|null} null, wenn nichts anders ist
 */
function unterschied(alt, neu, felder) {
    const vorher = {};
    const nachher = {};
    for (const f of felder) {
        const a = alt?.[f] ?? null;
        const b = neu?.[f] ?? null;
        if (JSON.stringify(a) !== JSON.stringify(b)) {
            vorher[f] = a;
            nachher[f] = b;
        }
    }
    return Object.keys(nachher).length ? { vorher, nachher } : null;
}

/** Bitfeld → sortierte Namen der Rechte. */
function rechteNamen(bits) {
    if (bits == null) return [];
    return new PermissionsBitField(BigInt(bits)).toArray().sort();
}

/**
 * Was ist an Rechten dazugekommen, was weggefallen?
 *
 * @returns {{neu: string[], weg: string[]}}
 */
function rechteUnterschied(alt, neu) {
    const a = new Set(rechteNamen(alt));
    const b = new Set(rechteNamen(neu));
    return { neu: [...b].filter((x) => !a.has(x)), weg: [...a].filter((x) => !b.has(x)) };
}

/**
 * Überschreibungen eines Kanals vorher/nachher lesbar machen: je Ziel (Rolle
 * oder Mitglied), was erlaubt/verboten dazukam oder wegfiel. Ein Ziel, das
 * neu dazukam oder ganz verschwand, steht mit `zustand` drin.
 *
 * @param {Array<{id: string, type: number|string, allow: string|bigint, deny: string|bigint}>} alt
 * @param {Array<{id: string, type: number|string, allow: string|bigint, deny: string|bigint}>} neu
 * @returns {Array<{ziel: string, typ: 'rolle'|'mitglied', zustand: 'neu'|'weg'|'geaendert',
 *                  erlaubt: {neu: string[], weg: string[]}, verboten: {neu: string[], weg: string[]}}>}
 */
function ueberschreibungen(alt, neu) {
    const typ = (t) => (Number(t) === 1 || t === 'member' ? 'mitglied' : 'rolle');
    const karte = (liste) => new Map((liste || []).map((o) => [String(o.id), o]));
    const a = karte(alt);
    const b = karte(neu);
    const aus = [];
    for (const id of new Set([...a.keys(), ...b.keys()])) {
        const vor = a.get(id);
        const nach = b.get(id);
        const erlaubt = rechteUnterschied(vor?.allow ?? 0n, nach?.allow ?? 0n);
        const verboten = rechteUnterschied(vor?.deny ?? 0n, nach?.deny ?? 0n);
        const zustand = !vor ? 'neu' : !nach ? 'weg' : 'geaendert';
        if (zustand === 'geaendert' && !erlaubt.neu.length && !erlaubt.weg.length && !verboten.neu.length && !verboten.weg.length) continue;
        aus.push({ ziel: id, typ: typ((nach || vor).type), zustand, erlaubt, verboten });
    }
    return aus.sort((x, y) => x.ziel.localeCompare(y.ziel));
}

/**
 * Schwere einer Rechte-Änderung:
 *
 *   kritisch  Administrator kommt dazu (Rolle oder Überschreibung), oder ein
 *             gefährliches Recht kommt bei @everyone dazu (Ziel = Guild-ID)
 *   warnung   sonst jede Rechte-Änderung
 *
 * @param {{neu: string[]}} erlaubt Was an erlaubten Rechten dazukam
 * @param {boolean} istEveryone
 */
function rechteSchwere(erlaubt, istEveryone) {
    const neu = erlaubt?.neu || [];
    if (neu.includes('Administrator')) return 'kritisch';
    if (istEveryone && neu.some((r) => GEFAEHRLICHE_RECHTE.includes(r))) return 'kritisch';
    return 'warnung';
}

/** Schwerste von mehreren Schweren. */
function schwerste(...schweren) {
    const rang = { info: 0, warnung: 1, kritisch: 2 };
    return schweren.filter(Boolean).reduce((m, s) => (rang[s] > rang[m] ? s : m), 'info');
}

/**
 * Rollen vorher/nachher → dazu und weg.
 *
 * @param {string[]} alt
 * @param {string[]} neu
 */
function rollenUnterschied(alt, neu) {
    const a = new Set((alt || []).map(String));
    const b = new Set((neu || []).map(String));
    return { dazu: [...b].filter((x) => !a.has(x)).sort(), weg: [...a].filter((x) => !b.has(x)).sort() };
}

module.exports = { unterschied, rechteNamen, rechteUnterschied, ueberschreibungen, rechteSchwere, schwerste, rollenUnterschied };
