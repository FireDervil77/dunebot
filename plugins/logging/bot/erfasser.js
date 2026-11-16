'use strict';

/**
 * Logging: Erfasser – vom Gateway-Ereignis zur Zeile (LG-1b, K382, 2026-11-16).
 *
 * Jeder Handler unter `bot/events/` baut ein Ereignis (Kategorie aus der Art,
 * Schwere, Akteur, Betroffener, Kanal, Objekt, Vorher/Nachher) und gibt es
 * hierher. Hier geschieht in dieser Reihenfolge:
 *
 *   1. Kategorie in keiner Guild an → sofort zurück, ohne Abfrage
 *      (`Regeln.irgendwoAn`, Minutenstand im Speicher)
 *   2. Logging in dieser Guild an → hat der Kern schon geprüft
 *      (`PluginManager.emit` ruft nur Plugins, die dort an sind)
 *   3. Regeln der Guild (30 s zwischengespeichert): Kategorie, Art,
 *      Ausschlüsse, „kritisch geht nie verloren“ (`Regeln.darf`)
 *   4. Zeile in `log_ereignisse`, Namen in `log_namen`
 *
 * Zwischen 1 und 3 fragt der Zuordner (LG-1c, `zuordner.js`) nach dem
 * Täter: Arten, zu denen Discord einen Audit-Eintrag schreibt, warten bis zu
 * 5 s darauf. Die Zeit der Zeile ist die Ankunft des Ereignisses, nicht das
 * Ende des Wartens. Ein Täter aus dem Audit-Log zählt für die Ausschlüsse
 * (Mitglied, Bots) wie jeder andere. Zugestellt wird mit LG-1d.
 *
 * Fehler landen im Log und nie beim Aufrufer: Ein Logging-Fehler darf kein
 * anderes Plugin stören, das auf dasselbe Gateway-Ereignis hört.
 *
 * @module logging/bot/erfasser
 */

const crypto = require('crypto');
const { ServiceManager } = require('dunebot-core');
const Regeln = require('../shared/regeln');
const { zuordner } = require('./zuordner');
const { kategorieVon, SCHWEREN } = require('../shared/katalog');

const ID = /^\d{5,20}$/;
const id = (w) => (w != null && ID.test(String(w)) ? String(w) : null);
const kurz = (w, n) => (w == null ? null : String(w).slice(0, n));

/**
 * Fachlich eindeutig je Guild: Dasselbe Gateway-Ereignis zweimal (zweiter
 * Shard, Wiederverbindung) ergibt eine Zeile. Die Zeit geht auf die Sekunde
 * genau ein, damit zwei gleiche Änderungen hintereinander zwei Zeilen sind.
 */
function schluessel(guildId, e, zeit) {
    const roh = [guildId, e.art, e.objekt?.id || '', e.betroffen || '', JSON.stringify(e.vorher ?? null),
        JSON.stringify(e.nachher ?? null), Math.floor(zeit.getTime() / 1000)].join('|');
    return crypto.createHash('sha1').update(roh).digest('hex');
}

/**
 * Ereignis in eine Zeile. Rein, damit der Wächter es prüft.
 *
 * @returns {Array} Werte in der Spaltenfolge von `EINFUEGEN`
 */
function zeile(guildId, e, zeit = new Date()) {
    const kategorie = kategorieVon(e.art);
    if (!kategorie) throw new Error(`Art ${e.art} steht in keiner Kategorie (shared/katalog.js)`);
    const schwere = SCHWEREN.includes(e.schwere) ? e.schwere : 'info';
    const json = (w) => (w == null ? null : JSON.stringify(w));
    return [
        String(guildId), zeit, kategorie, e.art, schwere, 'discord',
        id(e.akteur), id(e.betroffen), id(e.kanal),
        kurz(e.objekt?.typ, 32), id(e.objekt?.id), kurz(e.objekt?.name, 200),
        json(e.vorher), json(e.nachher),
        e.akteur && e.zuordnung ? e.zuordnung : 'unbekannt',
        schluessel(guildId, e, zeit),
    ];
}

const EINFUEGEN = `INSERT INTO log_ereignisse
    (guild_id, zeit, kategorie, art, schwere, quelle, akteur_id, betroffen_id, kanal_id,
     objekt_typ, objekt_id, objekt_name, vorher, nachher, zuordnung, schluessel)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE id = id`;

/**
 * Name und Anzeigename zur Zeit des Ereignisses. Gleicher Name → nur
 * `zuletzt` rückt vor; neuer Name → neue Zeile, die alte bleibt als Verlauf.
 *
 * @param {Array<{id: string, name: string, anzeigename?: string, bot?: boolean}>} namen
 */
async function merkeNamen(db, guildId, namen) {
    for (const n of namen || []) {
        if (!id(n?.id) || !n.name) continue;
        await db.query(
            `INSERT INTO log_namen (guild_id, mitglied_id, name, anzeigename, bot) VALUES (?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE zuletzt = CURRENT_TIMESTAMP(3)`,
            [String(guildId), String(n.id), kurz(n.name, 100), kurz(n.anzeigename || '', 100), n.bot ? 1 : 0]);
    }
}

/**
 * Ein Ereignis erfassen.
 *
 * @param {string} guildId
 * @param {object} e Ereignis: art, schwere, akteur, betroffen, kanal, objekt {typ, id, name}, vorher, nachher, zuordnung
 * @param {{rollen?: string[], kanaele?: string[], akteurIstBot?: boolean, namen?: Array}} [kontext]
 * @param {{zuordnen?: object}} [o] Zuordner (Wächter setzt einen eigenen)
 * @returns {Promise<{gespeichert: boolean, grund: string|null}>}
 */
async function erfasse(guildId, e, kontext = {}, { zuordnen = zuordner } = {}) {
    const zeit = new Date();
    try {
        if (!guildId) return { gespeichert: false, grund: 'keine_guild' };
        if (!kategorieVon(e.art)) throw new Error(`Art ${e.art} steht in keiner Kategorie (shared/katalog.js)`);
        if (!await Regeln.irgendwoAn(kategorieVon(e.art))) return { gespeichert: false, grund: 'nirgends_an' };
        const z = await zuordnen.ordneZu(String(guildId), e);
        if (z.akteur) {
            e = z.e;
            kontext = {
                ...kontext,
                akteurIstBot: z.akteur.bot ?? kontext.akteurIstBot,
                namen: [...(kontext.namen || []), z.akteur.name].filter(Boolean),
            };
        }
        // Ein Kick benennt die Art um (mitglied.verlassen → mitglied.gekickt), Kategorie bleibt.
        const kategorie = kategorieVon(e.art);
        if (!kategorie) throw new Error(`Art ${e.art} steht in keiner Kategorie (shared/katalog.js)`);
        const regeln = await Regeln.lade(String(guildId));
        const urteil = Regeln.darf(regeln, {
            kategorie, art: e.art, schwere: e.schwere, akteur: e.akteur, betroffen: e.betroffen,
            rollen: kontext.rollen, kanaele: kontext.kanaele, akteurIstBot: kontext.akteurIstBot,
        });
        if (!urteil.erlaubt) return { gespeichert: false, grund: urteil.grund };
        const db = ServiceManager.get('dbService');
        await db.query(EINFUEGEN, zeile(guildId, e, zeit));
        await merkeNamen(db, guildId, kontext.namen);
        return { gespeichert: true, grund: null };
    } catch (error) {
        ServiceManager.get('Logger').error(`[Logging] ${e?.art || 'Ereignis'} in ${guildId} nicht erfasst:`, error);
        return { gespeichert: false, grund: 'fehler' };
    }
}

/** Name eines Mitglieds oder Nutzers für `log_namen`. Partials ohne Nutzer liefern nichts. */
function nameVon(m) {
    const u = m?.user || m;
    if (!u?.id || !u.username) return null;
    return { id: u.id, name: u.username, anzeigename: m?.displayName || u.globalName || '', bot: Boolean(u.bot) };
}

/** Rollen-IDs eines Mitglieds ohne @everyone. */
function rollenVon(m) {
    const cache = m?.roles?.cache;
    if (!cache) return [];
    return [...cache.keys()].filter((r) => String(r) !== String(m.guild?.id)).map(String);
}

module.exports = { erfasse, zeile, schluessel, merkeNamen, nameVon, rollenVon, EINFUEGEN };
