'use strict';

/**
 * Leveling - Seiten (LV-1a, 2026-11-15).
 *
 *   /             → Weiterleitung auf /uebersicht
 *   /uebersicht   Regeln, die gerade gelten (Chat, Sprache, Belohnungen,
 *                 Level-up-Nachricht), und die ersten zehn der Rangliste
 *   /nachrichten  Level-up-Nachricht einstellen (LV-1f): wohin, wann, Vorlage
 *                 `leveling:aufstieg` (G-08), Rangkarte anhängen
 *
 * Die übrigen Einstellseiten (XP-Regeln, Stufen, Belohnungen, Ausschlüsse,
 * Datenverwaltung) kommen mit LV-1i.
 *
 * @module leveling/routes/guild
 */

const express = require('express');
const router = express.Router();
const { ServiceManager } = require('dunebot-core');
const { Fortschritt, Vorlage } = require('dunebot-sdk');
const { requirePermission } = require('../../../../apps/dashboard/middlewares/permissions.middleware');
const { csrfProtection } = require('../../../../apps/dashboard/middlewares/security/csrf-protection.middleware');
const Regeln = require('../../shared/regeln');
const Belohnungen = require('../../shared/belohnungen');
const Ausgabe = require('../../shared/ausgabe');

function makeTranslator(req, res) {
    return (key, options = {}) => {
        if (typeof req.translate === 'function') return req.translate(key, options);
        const i18n = ServiceManager.get('i18n');
        return i18n?.i18next ? i18n.i18next.t(key, { ...options, lng: res.locals?.locale || 'de-DE' }) : key;
    };
}

/**
 * Namen der Mitglieder über den Bot. Ohne Antwort bleiben die IDs stehen,
 * und die Seite sagt es (`namenFehlen`).
 *
 * @returns {Promise<{namen: Object<string, string>, fehlen: boolean}>}
 */
async function namenVon(guildId, ids) {
    if (!ids.length) return { namen: {}, fehlen: false };
    try {
        const antworten = await ServiceManager.get('ipcServer').broadcast('dashboard:GET_GUILD_MEMBERS', { guildId, userIds: ids });
        const gut = (antworten || []).find((a) => a?.success && a.members);
        if (!gut) return { namen: {}, fehlen: true };
        const namen = {};
        for (const [id, m] of Object.entries(gut.members)) if (m?.displayName || m?.username) namen[id] = m.displayName || m.username;
        return { namen, fehlen: false };
    } catch (error) {
        ServiceManager.get('Logger').warn(`[Leveling] Namen nicht geladen: ${error.message}`);
        return { namen: {}, fehlen: true };
    }
}

/**
 * Rollennamen über den Bot (wie im discord-Plugin). Ohne Antwort bleiben die
 * IDs stehen, und die Seite sagt es.
 *
 * @returns {Promise<{namen: Object<string, string>, fehlen: boolean}>}
 */
async function rollenNamen(guildId, ids) {
    if (!ids.length) return { namen: {}, fehlen: false };
    try {
        const antworten = await ServiceManager.get('ipcServer').broadcast('dashboard:GET_GUILD_ROLES_DETAILED', { guildId });
        const gut = (antworten || []).map((a) => a?.data ?? a).find((a) => a?.success && Array.isArray(a.roles));
        if (!gut) return { namen: {}, fehlen: true };
        return { namen: Object.fromEntries(gut.roles.map((r) => [String(r.id), r.name])), fehlen: false };
    } catch (error) {
        ServiceManager.get('Logger').warn(`[Leveling] Rollennamen nicht geladen: ${error.message}`);
        return { namen: {}, fehlen: true };
    }
}

/**
 * Textkanäle über den Bot (Kern-IPC `GET_GUILD_CHANNELS`, ohne Angabe nur
 * Textkanäle). Ohne Antwort bleibt die Liste leer, und die Seite sagt es.
 *
 * @returns {Promise<{liste: Array<{id: string, name: string}>, fehlen: boolean}>}
 */
async function textKanaele(guildId) {
    try {
        const antworten = await ServiceManager.get('ipcServer').broadcast('dashboard:GET_GUILD_CHANNELS', { guildId });
        const gut = (antworten || []).map((a) => a?.data ?? a).find((a) => a?.success !== false && Array.isArray(a?.channels) && a.channels.length);
        if (!gut) return { liste: [], fehlen: true };
        return { liste: gut.channels.map((k) => ({ id: String(k.id), name: String(k.name) })), fehlen: false };
    } catch (error) {
        ServiceManager.get('Logger').warn(`[Leveling] Kanäle nicht geladen: ${error.message}`);
        return { liste: [], fehlen: true };
    }
}

/** Sprache der Guild (Kern-Einstellung LOCALE) für die Vorgabe der Nachricht. */
async function spracheDerGuild(guildId) {
    const zeilen = await ServiceManager.get('dbService').query(
        "SELECT config_value FROM configs WHERE plugin_name = 'core' AND config_key = 'LOCALE' AND guild_id = ? AND context = 'shared'",
        [guildId]
    );
    return String(zeilen?.[0]?.config_value || 'de-DE').replace(/^"|"$/g, '');
}

router.get('/', requirePermission('LEVELING.VIEW'), (req, res) => {
    res.redirect(`/guild/${res.locals.guildId}/plugins/leveling/uebersicht`);
});

router.get('/uebersicht', requirePermission('LEVELING.VIEW'), async (req, res) => {
    const guildId = res.locals.guildId;
    const tr = makeTranslator(req, res);
    try {
        const [regeln, rangliste, stufen] = await Promise.all([
            Regeln.lade(guildId, { frisch: true }),
            Fortschritt.rangliste({ guildId, kennung: 'leveling:community', zeitraum: 'gesamt', seite: 1, proSeite: 10 }),
            Fortschritt.stufen({ guildId, kennung: 'leveling:community' }),
        ]);
        const { namen, fehlen } = await namenVon(guildId, rangliste.eintraege.map((e) => String(e.mitglied_id)));
        const belohnungen = regeln ? await Belohnungen.lade(guildId) : { belohnungen: [], vorherigeEntfernen: false };
        const rollen = await rollenNamen(guildId, belohnungen.belohnungen.map((b) => b.wert));
        const kanaele = regeln?.einstellungen?.ausgabe_kanal ? await textKanaele(guildId) : { liste: [], fehlen: false };
        await ServiceManager.get('themeManager').renderView(res, 'guild/leveling-uebersicht', {
            tr, guildId, regeln, rangliste, namen, namenFehlen: fehlen,
            stufenAnzahl: stufen.stufen.length, schablone: stufen.schablone,
            belohnungen, rollenNamen: rollen.namen, rollenNamenFehlen: rollen.fehlen,
            ausgabeKanalName: kanaele.liste.find((k) => String(k.id) === String(regeln?.einstellungen?.ausgabe_kanal))?.name || null,
            ausgabeKanalFehlt: Ausgabe.kanalFehlt(regeln?.einstellungen),
        });
    } catch (error) {
        ServiceManager.get('Logger').error('[Leveling] Übersicht nicht geladen:', error);
        res.locals.layout = ServiceManager.get('themeManager')?.getLayout('guild');
        return res.status(500).render('error', {
            status: 500,
            message: 'Leveling',
            error: { status: 500, title: tr('leveling:FEHLER.SEITE'), message: tr('leveling:FEHLER.UEBERSICHT'), details: error.message }
        });
    }
});

/**
 * Level-up-Nachricht (LV-1f, F-LV1): Modus, Level-Kanal, Meilensteine,
 * Rangkarte, Vorlage. Nur wer einstellen darf, sieht die Seite.
 */
router.get('/nachrichten', requirePermission('LEVELING.CONFIGURE'), async (req, res) => {
    const guildId = res.locals.guildId;
    const tr = makeTranslator(req, res);
    try {
        const regeln = await Regeln.lade(guildId, { frisch: true });
        const [kanaele, sprache] = await Promise.all([textKanaele(guildId), spracheDerGuild(guildId)]);
        const teil = await Vorlage.editor(guildId, Ausgabe.ANLASS, Ausgabe.vorgabe(Ausgabe.texteAus(sprache)));
        const e = regeln?.einstellungen || null;
        await ServiceManager.get('themeManager').renderView(res, 'guild/leveling-nachrichten', {
            tr, guildId, einstellungen: e, kanaele: kanaele.liste, kanaeleFehlen: kanaele.fehlen, teil,
            meilensteine: e ? Ausgabe.meilensteine(e.meilensteine) : [],
            kanalFehlt: Ausgabe.kanalFehlt(e), modi: Ausgabe.MODI,
        });
    } catch (error) {
        ServiceManager.get('Logger').error('[Leveling] Seite Nachrichten nicht geladen:', error);
        res.locals.layout = ServiceManager.get('themeManager')?.getLayout('guild');
        return res.status(500).render('error', {
            status: 500,
            message: 'Leveling',
            error: { status: 500, title: tr('leveling:FEHLER.SEITE'), message: tr('leveling:FEHLER.NACHRICHTEN'), details: error.message }
        });
    }
});

/**
 * Speichern: Einstellungen in `level_einstellungen`, Vorlage über
 * `Vorlage.speichere` (G-08). Erst alles prüfen, dann schreiben.
 */
router.put('/nachrichten', csrfProtection, requirePermission('LEVELING.CONFIGURE'), async (req, res) => {
    const guildId = res.locals.guildId;
    const tr = makeTranslator(req, res);
    const body = req.body || {};
    const nein = (schluessel, werte) => res.status(400).json({ success: false, message: tr(`leveling:NACHRICHTEN.${schluessel}`, werte) });
    try {
        const r = await Regeln.lade(guildId, { frisch: true });
        if (!r) return nein('NICHT_EINGERICHTET');
        const modus = String(body.ausgabe_modus || '');
        if (!Ausgabe.MODI.includes(modus)) return nein('FALSCHER_MODUS');
        const kanal = body.ausgabe_kanal ? String(body.ausgabe_kanal) : null;
        if (kanal && !/^\d{17,20}$/.test(kanal)) return nein('FALSCHER_KANAL');
        if (kanal) {
            const k = await textKanaele(guildId);
            if (!k.fehlen && !k.liste.some((x) => x.id === kanal)) return nein('FALSCHER_KANAL');
        }
        const nurMeilensteine = body.nur_meilensteine === true || body.nur_meilensteine === 'true';
        const meilensteine = Ausgabe.meilensteine(String(body.meilensteine ?? ''));
        if (nurMeilensteine && !meilensteine.length) return nein('MEILENSTEINE_FEHLEN');
        const karte = body.rangkarte_anhaengen === true || body.rangkarte_anhaengen === 'true';
        const vorlage = Vorlage.pruefe(body.vorlage);

        await Vorlage.speichere(guildId, Ausgabe.ANLASS, vorlage);
        await ServiceManager.get('dbService').query(
            `UPDATE level_einstellungen SET ausgabe_modus = ?, ausgabe_kanal = ?, nur_meilensteine = ?, meilensteine = ?, rangkarte_anhaengen = ?
             WHERE guild_id = ?`,
            [modus, kanal, nurMeilensteine ? 1 : 0, meilensteine.length ? JSON.stringify(meilensteine) : null, karte ? 1 : 0, guildId]
        );
        Regeln.vergiss(guildId);
        return res.json({ success: true, message: tr('leveling:NACHRICHTEN.GESPEICHERT'), kanalFehlt: modus === 'level_kanal' && !kanal });
    } catch (error) {
        if (error instanceof Vorlage.Eingabefehler) {
            return res.status(400).json({ success: false, message: Vorlage.alsText(tr, 'FEHLER', error) });
        }
        ServiceManager.get('Logger').error('[Leveling] Nachrichten nicht gespeichert:', error);
        return res.status(500).json({ success: false, message: tr('leveling:NACHRICHTEN.FEHLER') });
    }
});

module.exports = router;
