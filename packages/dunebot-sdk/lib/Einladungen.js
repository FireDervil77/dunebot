'use strict';

/**
 * Einladungs-Erkennung im Kern (G-16, K382, 2026-11-16).
 *
 * Bis 2026-11-16 hatte nur greeting einen eigenen Tracker
 * (`plugins/greeting/bot/inviteTracker.js`), gefüllt nur in Guilds mit
 * greeting, ohne Vanity, ohne Kennzeichen der Unsicherheit, und
 * `member.inviterData` setzte niemand: `{inviter:*}` stand immer auf „NA“.
 *
 *     const { Einladungen } = require('dunebot-sdk');
 *     const b = await Einladungen.beitritt(member);     // im Bot, beim Beitritt
 *     // → { art, einladung, einlader, sicherheit, beigetreten_am }
 *     const z = await Einladungen.vonMitglied(guildId, userId);  // überall
 *     const n = await Einladungen.anzahl(guildId, einladerId);   // überall
 *
 * # Erkennen
 *
 * Je Guild steht im Speicher der Zählerstand jeder Einladung und der
 * Vanity-URL. Beim Beitritt holt der Bot den neuen Stand und vergleicht:
 *
 *   gestiegen      Zähler einer Einladung ist höher (auch eine neue mit Zähler)
 *   aufgebraucht   eine Einladung fehlt jetzt, hatte eine Höchstzahl und stand
 *                  einen Beitritt davor (Discord löscht sie dann); abgelaufene
 *                  zählen nicht
 *   vanity         Zähler der Vanity-URL ist gestiegen
 *
 * Genau ein Treffer um genau eins ⇒ `eindeutig`. Mehr als einer (zwei
 * Beitritte zugleich) ⇒ `mehrdeutig`; Einladung und Einlader stehen dann nur,
 * wenn alle Treffer sie teilen. Keiner, kein Speicher, keine Berechtigung
 * („Server verwalten“ fehlt) ⇒ `unbekannt`. Ein Bot kommt über OAuth, nicht
 * über eine Einladung: `art: oauth`, `eindeutig`, kein Vergleich.
 *
 * Vanity ist `eindeutig` ohne Einlader (Betreiber 2026-11-16, abweichend vom
 * Wortlaut in baustellen.md G-16).
 *
 * Erkennungen einer Guild laufen nacheinander, jede vergleicht mit dem Stand
 * der vorigen. `beitritt` liefert für denselben Beitritt dasselbe Versprechen:
 * Kern-Ereignis und greeting können in beliebiger Reihenfolge fragen,
 * erkannt, geschrieben und gemeldet wird einmal.
 *
 * # Schreiben
 *
 * Nur hier, nur im Bot: `mitglied_beitritte` (eine Zeile je Guild und
 * Mitglied, Migration `migrations/kern/20261116_090000_mitglied_beitritte.js`)
 * und das Ereignis `kern.mitglied.beigetreten`.
 */

const sm = () => require('dunebot-core').ServiceManager;
const db = () => sm().get('dbService');
const log = () => sm().get('Logger');

const ART = Object.freeze({ EINLADUNG: 'einladung', VANITY: 'vanity', OAUTH: 'oauth', UNBEKANNT: 'unbekannt' });
const SICHERHEIT = Object.freeze({ EINDEUTIG: 'eindeutig', MEHRDEUTIG: 'mehrdeutig', UNBEKANNT: 'unbekannt' });

/** Einlader nach „Meine Daten löschen“ (Datenauskunft anonymisiert zu '0'). */
const ANONYM = '0';

/** Wie lange `beitritt` dasselbe Versprechen zurückgibt. */
const MERKEN_MS = 5 * 60 * 1000;

/**
 * Speicher je Guild.
 * @type {Map<string, {einladungen: Map<string, {uses: number, maxUses: number, einlader: string|null, ablauf: number|null}>, vanity: {code: string, uses: number}|null}>}
 */
const speicher = new Map();

/** Letzte Erkennung je Guild (Kette, damit sie nacheinander laufen). */
const ketten = new Map();

/** Versprechen je Beitritt `guild:mitglied:zeit`. */
const laufend = new Map();

function eintragAus(einladung) {
    return {
        uses: einladung.uses || 0,
        maxUses: einladung.maxUses || 0,
        einlader: einladung.inviterId || einladung.inviter?.id || null,
        ablauf: einladung.expiresTimestamp || null,
    };
}

async function holeStand(guild) {
    const einladungen = new Map();
    for (const e of (await guild.invites.fetch({ cache: false })).values()) einladungen.set(e.code, eintragAus(e));
    let vanity = null;
    if (guild.vanityURLCode) {
        try {
            const v = await guild.fetchVanityData();
            vanity = { code: v.code, uses: v.uses || 0 };
        } catch (err) {
            log().warn(`[Einladungen] Vanity-Zähler von ${guild.id} nicht lesbar: ${err.message}`);
        }
    }
    return { einladungen, vanity };
}

/**
 * Stand einer Guild neu holen (Start, Bot kommt neu dazu).
 * @param {import('discord.js').Guild} guild
 * @returns {Promise<boolean>} ob der Stand gelesen werden konnte
 */
async function fuelle(guild) {
    try {
        speicher.set(guild.id, await holeStand(guild));
        return true;
    } catch (err) {
        speicher.delete(guild.id);
        // Meist fehlt „Server verwalten“; dann bleibt jeder Beitritt `unbekannt`.
        log().warn(`[Einladungen] Einladungen von ${guild.name} (${guild.id}) nicht lesbar, Beitritte dort bleiben unbekannt: ${err.message}`);
        return false;
    }
}

/**
 * Alle Guilds des Clients nacheinander füllen.
 * @param {import('discord.js').Client} client
 * @returns {Promise<{gelesen: number, ohne: number}>}
 */
async function fuelleAlle(client) {
    let gelesen = 0;
    let ohne = 0;
    for (const guild of client.guilds.cache.values()) {
        if (await fuelle(guild)) gelesen++;
        else ohne++;
    }
    return { gelesen, ohne };
}

/** Guild verlassen: Stand weg. */
function vergiss(guildId) {
    speicher.delete(String(guildId));
    ketten.delete(String(guildId));
}

/** `inviteCreate`: neue Einladung in den Stand. */
function angelegt(einladung) {
    const s = einladung.guild?.id && speicher.get(einladung.guild.id);
    if (s) s.einladungen.set(einladung.code, eintragAus(einladung));
}

/**
 * `inviteDelete`: von Hand gelöscht oder abgelaufen. Aufgebrauchte löscht
 * Discord erst nach dem Beitritt; die braucht der Vergleich noch, deshalb
 * bleibt eine Einladung, die einen Beitritt vor ihrer Höchstzahl stand.
 */
function geloescht(einladung) {
    const s = einladung.guild?.id && speicher.get(einladung.guild.id);
    if (!s) return;
    const alt = s.einladungen.get(einladung.code);
    if (alt && alt.maxUses > 0 && alt.uses + 1 >= alt.maxUses) return;
    s.einladungen.delete(einladung.code);
}

/**
 * Vergleich zweier Stände (rein, ohne Discord).
 * @returns {{art: string, einladung: string|null, einlader: string|null, sicherheit: string}}
 */
function vergleiche(alt, neu, jetzt = Date.now()) {
    const treffer = [];
    let schritte = 0;
    for (const [code, e] of neu.einladungen) {
        const vorher = alt.einladungen.get(code)?.uses ?? 0;
        if (e.uses > vorher) {
            treffer.push({ art: ART.EINLADUNG, einladung: code, einlader: e.einlader });
            schritte += e.uses - vorher;
        }
    }
    for (const [code, e] of alt.einladungen) {
        if (neu.einladungen.has(code)) continue;
        const abgelaufen = e.ablauf && e.ablauf <= jetzt;
        if (!abgelaufen && e.maxUses > 0 && e.uses + 1 >= e.maxUses) {
            treffer.push({ art: ART.EINLADUNG, einladung: code, einlader: e.einlader });
            schritte += 1;
        }
    }
    if (neu.vanity && neu.vanity.uses > (alt.vanity?.code === neu.vanity.code ? alt.vanity.uses : neu.vanity.uses)) {
        treffer.push({ art: ART.VANITY, einladung: neu.vanity.code, einlader: null });
        schritte += neu.vanity.uses - alt.vanity.uses;
    }

    if (!treffer.length) return { art: ART.UNBEKANNT, einladung: null, einlader: null, sicherheit: SICHERHEIT.UNBEKANNT };
    if (treffer.length === 1 && schritte === 1) return { ...treffer[0], sicherheit: SICHERHEIT.EINDEUTIG };
    const gleich = (f) => (treffer.every(t => t[f] === treffer[0][f]) ? treffer[0][f] : null);
    return {
        art: gleich('art') || ART.UNBEKANNT,
        einladung: gleich('einladung'),
        einlader: gleich('einlader'),
        sicherheit: SICHERHEIT.MEHRDEUTIG,
    };
}

async function erkenne(guild) {
    const alt = speicher.get(guild.id);
    if (!alt) {
        // Ohne Vergleichsstand nicht zuzuordnen, aber der nächste Beitritt.
        await fuelle(guild);
        return { art: ART.UNBEKANNT, einladung: null, einlader: null, sicherheit: SICHERHEIT.UNBEKANNT };
    }
    let neu;
    try {
        neu = await holeStand(guild);
    } catch (err) {
        log().warn(`[Einladungen] Beitritt in ${guild.id} nicht zuzuordnen: ${err.message}`);
        return { art: ART.UNBEKANNT, einladung: null, einlader: null, sicherheit: SICHERHEIT.UNBEKANNT };
    }
    speicher.set(guild.id, neu);
    return vergleiche(alt, neu);
}

/** Erkennungen einer Guild nacheinander. */
function nacheinander(guildId, fn) {
    const vorher = ketten.get(guildId) || Promise.resolve();
    const jetzt = vorher.catch(() => null).then(fn);
    ketten.set(guildId, jetzt);
    jetzt.finally(() => { if (ketten.get(guildId) === jetzt) ketten.delete(guildId); }).catch(() => null);
    return jetzt;
}

async function schreibe(member, b) {
    await db().query(
        `INSERT INTO mitglied_beitritte
            (guild_id, mitglied_id, art, einladung, einlader_id, sicherheit, beigetreten_am, verlassen_am)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
         ON DUPLICATE KEY UPDATE art = VALUES(art), einladung = VALUES(einladung),
            einlader_id = VALUES(einlader_id), sicherheit = VALUES(sicherheit),
            beigetreten_am = VALUES(beigetreten_am), verlassen_am = NULL`,
        [member.guild.id, member.id, b.art, b.einladung, b.einlader, b.sicherheit, b.beigetreten_am]
    );
}

async function melde(member, b) {
    const Ereignisse = require('../ereignisse');
    const daten = { art: b.art, sicherheit: b.sicherheit };
    if (b.einladung) daten.einladung = b.einladung;
    if (b.einlader) daten.einlader = b.einlader;
    await Ereignisse.melde('kern.mitglied.beigetreten', {
        guild_id: member.guild.id,
        schluessel: `${member.id}:${b.beigetreten_am.getTime()}`,
        akteur: member.id,
        daten,
        zeit: b.beigetreten_am,
    });
}

async function verarbeite(member) {
    const beigetreten_am = new Date(member.joinedTimestamp || Date.now());
    const erkannt = member.user?.bot
        ? { art: ART.OAUTH, einladung: null, einlader: null, sicherheit: SICHERHEIT.EINDEUTIG }
        : await nacheinander(member.guild.id, () => erkenne(member.guild));
    const b = { ...erkannt, beigetreten_am };

    // Schreiben und Melden getrennt: Scheitert eins, steht das andere trotzdem,
    // und der Aufrufer bekommt die Erkennung in jedem Fall.
    try {
        await schreibe(member, b);
    } catch (err) {
        log().error(`[Einladungen] Beitritt von ${member.id} in ${member.guild.id} nicht gespeichert:`, err);
    }
    try {
        await melde(member, b);
    } catch (err) {
        log().error(`[Einladungen] kern.mitglied.beigetreten für ${member.id} in ${member.guild.id} nicht gemeldet:`, err);
    }
    if (b.sicherheit !== SICHERHEIT.UNBEKANNT) {
        log().debug(`[Einladungen] ${member.guild.id}: ${member.id} über ${b.art} ${b.einladung || ''} (${b.sicherheit})`);
    }
    return b;
}

/**
 * Beitritt erkennen, speichern und melden. Nur im Bot.
 * Für denselben Beitritt kommt dasselbe Versprechen zurück.
 *
 * @param {import('discord.js').GuildMember} member
 * @returns {Promise<{art: string, einladung: string|null, einlader: string|null, sicherheit: string, beigetreten_am: Date}>}
 */
function beitritt(member) {
    const schluessel = `${member.guild.id}:${member.id}:${member.joinedTimestamp || ''}`;
    let p = laufend.get(schluessel);
    if (!p) {
        p = verarbeite(member);
        laufend.set(schluessel, p);
        setTimeout(() => laufend.delete(schluessel), MERKEN_MS).unref?.();
    }
    return p;
}

/**
 * Mitglied hat die Guild verlassen: Zeitpunkt setzen, ab dem die Frist läuft.
 * @param {string} guildId
 * @param {string} mitgliedId
 */
async function verlassen(guildId, mitgliedId) {
    await db().query(
        'UPDATE mitglied_beitritte SET verlassen_am = NOW(3) WHERE guild_id = ? AND mitglied_id = ? AND verlassen_am IS NULL',
        [String(guildId), String(mitgliedId)]
    );
}

/**
 * Letzter Beitritt eines Mitglieds, oder `null`. Geht überall.
 * @returns {Promise<{art, einladung, einlader, sicherheit, beigetreten_am, verlassen_am}|null>}
 */
async function vonMitglied(guildId, mitgliedId) {
    const zeilen = await db().query(
        'SELECT art, einladung, einlader_id, sicherheit, beigetreten_am, verlassen_am FROM mitglied_beitritte WHERE guild_id = ? AND mitglied_id = ?',
        [String(guildId), String(mitgliedId)]
    );
    const z = zeilen?.[0];
    if (!z) return null;
    return {
        art: z.art,
        einladung: z.einladung,
        einlader: z.einlader_id && z.einlader_id !== ANONYM ? z.einlader_id : null,
        sicherheit: z.sicherheit,
        beigetreten_am: z.beigetreten_am,
        verlassen_am: z.verlassen_am,
    };
}

/**
 * Wie viele über Einladungen dieses Mitglieds kamen und noch da sind.
 * Gezählt wird nur, was eindeutig erkannt wurde, und erst seit G-16.
 * @returns {Promise<number>}
 */
async function anzahl(guildId, einladerId) {
    if (!einladerId || einladerId === ANONYM) return 0;
    const zeilen = await db().query(
        `SELECT COUNT(*) AS n FROM mitglied_beitritte
          WHERE guild_id = ? AND einlader_id = ? AND sicherheit = ? AND verlassen_am IS NULL`,
        [String(guildId), String(einladerId), SICHERHEIT.EINDEUTIG]
    );
    return Number(zeilen?.[0]?.n || 0);
}

module.exports = {
    ART,
    SICHERHEIT,
    beitritt,
    verlassen,
    vonMitglied,
    anzahl,
    fuelle,
    fuelleAlle,
    vergiss,
    angelegt,
    geloescht,
    vergleiche,
};
