'use strict';

/**
 * Leveling: Level-up-Nachricht senden (LV-1f, F-LV1, 2026-11-15).
 *
 * Gerufen nach jedem Aufstieg im Bot (`nachbuchung.js`: Chat, Sprache,
 * `/xp`). Was gilt, steht in `shared/ausgabe.js`; hier nur Discord:
 *
 *   1. Einstellungen da, Modus nicht „aus“, Meilenstein erreicht?
 *   2. Ziel: Kanal (Level-Kanal oder der Kanal der XP) oder Direktnachricht.
 *   3. Vorlage `leveling:aufstieg` füllen (G-08), gepingt wird nur das
 *      Mitglied; auf Wunsch die Rangkarte als Bild (G-10).
 *
 * Eine Level-up-Nachricht darf ausfallen, die Buchung nie (Konzept §12):
 * Jeder Fehler endet im Log, nichts wirft. Damit ein fehlender Kanal oder ein
 * fehlendes Recht das Log nicht füllt, meldet der Bot ihn je Guild höchstens
 * einmal in der Stunde.
 *
 * @module leveling/bot/ausgabe
 */

const { ServiceManager } = require('dunebot-core');
const { Vorlage } = require('dunebot-sdk');
const { PermissionFlagsBits } = require('discord.js');
const Regeln = require('../shared/regeln');
const Ausgabe = require('../shared/ausgabe');
const Karte = require('./karte');

const STUNDE_MS = 3_600_000;
/** `${guild}|${grund}` → zuletzt gemeldet (ms) */
const gemeldet = new Map();

const log = () => ServiceManager.get('Logger');

function warneSelten(guildId, grund, text) {
    const k = `${guildId}|${grund}`;
    const jetzt = Date.now();
    if (jetzt - (gemeldet.get(k) || 0) < STUNDE_MS) return;
    gemeldet.set(k, jetzt);
    log().warn(`[Leveling] Level-up-Nachricht in ${guildId} nicht gesendet: ${text}`);
}

/**
 * Der Kanal, wenn der Bot dort schreiben darf; sonst null mit Grund.
 * @returns {{kanal: import('discord.js').TextBasedChannel|null, grund: string|null, bilder: boolean}}
 */
function kanalPruefen(guild, id) {
    const kanal = guild.channels.cache.get(String(id));
    if (!kanal || !kanal.isTextBased?.()) return { kanal: null, grund: `Kanal ${id} gibt es nicht (mehr) oder er nimmt keine Nachrichten`, bilder: false };
    const ich = guild.members.me;
    const rechte = ich ? kanal.permissionsFor(ich) : null;
    if (!rechte?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages])) {
        return { kanal: null, grund: `dem Bot fehlt in #${kanal.name} „Kanal ansehen“ oder „Nachrichten senden“`, bilder: false };
    }
    return { kanal, grund: null, bilder: rechte.has(PermissionFlagsBits.AttachFiles) };
}

/**
 * Die Nachricht für ein Mitglied, wie die Guild sie eingestellt hat.
 *
 * @param {import('discord.js').GuildMember} member
 * @param {object} ergebnis aus `Fortschritt.buche`
 * @param {{karte: boolean}} o
 * @returns {Promise<object|null>}
 */
async function baue(member, ergebnis, { karte }) {
    const guild = member.guild;
    let s = null;
    let anhaenge = [];
    const gespeichert = await Vorlage.lade(guild.id, Ausgabe.ANLASS);
    const vorlage = gespeichert || Ausgabe.vorgabe((k) => guild.getT(k));
    const text = Object.keys(Vorlage.FELDER).map((f) => vorlage[f] || '').join(' ');
    if (karte || text.includes('{rang}')) s = await Karte.standUndPlatz(guild.id, member.id);
    if (karte) {
        const bild = await Karte.zeichne(member, s);
        if (bild) anhaenge = [bild];
    }
    const kontext = { member, guild, extra: Ausgabe.platzhalter(ergebnis, { rang: s?.platz ?? null }) };
    const mit = { guildId: guild.id, erwaehnen: [member.id], anhaenge };
    let { nachricht } = await Vorlage.fuelle(vorlage, kontext, mit);
    if (!nachricht) ({ nachricht } = await Vorlage.fuelle(Ausgabe.vorgabe((k) => guild.getT(k)), kontext, mit));
    return nachricht;
}

/**
 * Nach einem Aufstieg melden, wenn die Guild es so eingestellt hat.
 *
 * @param {object} a
 * @param {import('discord.js').Guild} a.guild
 * @param {string} a.mitglied Discord-ID
 * @param {object} a.ergebnis aus `Fortschritt.buche` (aufstieg, level, vorher …)
 * @param {string|null} [a.kanal] wo die XP entstanden
 * @returns {Promise<{gesendet: boolean, grund: string|null}>}
 */
async function beiAufstieg({ guild, mitglied, ergebnis, kanal = null }) {
    try {
        if (!guild || !ergebnis?.aufstieg) return { gesendet: false, grund: 'kein_aufstieg' };
        const r = await Regeln.lade(String(guild.id));
        const e = r?.einstellungen;
        if (!e) return { gesendet: false, grund: 'nicht_eingerichtet' };
        const soll = Ausgabe.sollMelden(e, ergebnis.vorher, ergebnis);
        if (!soll.ja) return { gesendet: false, grund: soll.grund };
        const z = Ausgabe.ziel(e, { kanal });
        if (z.art === 'keine') return { gesendet: false, grund: z.grund };

        const member = guild.members.cache.get(String(mitglied)) || await guild.members.fetch(String(mitglied)).catch(() => null);
        if (!member) return { gesendet: false, grund: 'kein_mitglied' };

        if (z.art === 'direkt') {
            const nachricht = await baue(member, ergebnis, { karte: Boolean(Number(e.rangkarte_anhaengen)) });
            if (!nachricht) return { gesendet: false, grund: 'leer' };
            // Geschlossene Direktnachrichten sind kein Fehler der Guild.
            const ok = await member.send(nachricht).then(() => true, (err) => {
                log().debug(`[Leveling] Direktnachricht an ${member.id} nicht zugestellt: ${err.message}`);
                return false;
            });
            return { gesendet: ok, grund: ok ? null : 'direkt_zu' };
        }

        const k = kanalPruefen(guild, z.kanal);
        if (!k.kanal) {
            warneSelten(guild.id, `kanal:${z.kanal}`, k.grund);
            return { gesendet: false, grund: 'kanal_gesperrt' };
        }
        const nachricht = await baue(member, ergebnis, { karte: Boolean(Number(e.rangkarte_anhaengen)) && k.bilder });
        if (!nachricht) return { gesendet: false, grund: 'leer' };
        await k.kanal.send(nachricht);
        return { gesendet: true, grund: null };
    } catch (error) {
        warneSelten(guild?.id, 'fehler', error?.message || String(error));
        return { gesendet: false, grund: 'fehler' };
    }
}

module.exports = { beiAufstieg, kanalPruefen };
