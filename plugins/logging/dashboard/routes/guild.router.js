'use strict';

/**
 * Logging - Seiten (LG-1a/LG-1b Teil 1, K382, 2026-11-16).
 *
 *   /               → Weiterleitung auf /ereignisse
 *   /ereignisse     neueste zuerst, 50 je Seite, Filter Kategorie, Schwere,
 *                   Mitglied (ID); Vorher/Nachher lesbar
 *   /einstellungen  Kategorien und Arten an/aus, Bots ausschließen, Fristen
 *                   (Kern-Teil G-05)
 *
 * Suche, Details, Zeitachse, Ziele und Ausschlüsse je Mitglied/Rolle/Kanal
 * bauen LG-1d und LG-1f aus. Der Bot liest die Regeln 30 s zwischengespeichert.
 *
 * @module logging/routes/guild
 */

const express = require('express');
const router = express.Router();
const { ServiceManager } = require('dunebot-core');
const { requirePermission } = require('../../../../apps/dashboard/middlewares/permissions.middleware');
const { csrfProtection } = require('../../../../apps/dashboard/middlewares/security/csrf-protection.middleware');
const { KATEGORIEN, SCHWEREN } = require('../../shared/katalog');
const Regeln = require('../../shared/regeln');
const Anzeige = require('../../shared/anzeige');

const PRO_SEITE = 50;
const ID = /^\d{17,20}$/;

function makeTranslator(req, res) {
    return (key, options = {}) => {
        if (typeof req.translate === 'function') return req.translate(key, options);
        const i18n = ServiceManager.get('i18n');
        return i18n?.i18next ? i18n.i18next.t(key, { ...options, lng: res.locals?.locale || 'de-DE' }) : key;
    };
}

/** Rollen-Namen über den Bot; ohne Antwort bleiben die IDs, und die Seite sagt es. */
async function rollenNamen(guildId, ids) {
    if (!ids.length) return { namen: {}, fehlen: false };
    try {
        const antworten = await ServiceManager.get('ipcServer').broadcast('dashboard:GET_GUILD_ROLES_DETAILED', { guildId });
        const gut = (antworten || []).map((a) => a?.data ?? a).find((a) => a?.success && Array.isArray(a.roles));
        if (!gut) return { namen: {}, fehlen: true };
        return { namen: Object.fromEntries(gut.roles.map((r) => [String(r.id), r.name])), fehlen: false };
    } catch (error) {
        ServiceManager.get('Logger').warn(`[Logging] Rollen nicht geladen: ${error.message}`);
        return { namen: {}, fehlen: true };
    }
}

/**
 * Letzter bekannter Name je Mitglied aus `log_namen` – auch nach dem
 * Austritt lesbar. Ohne Zeile bleibt die ID stehen.
 */
async function mitgliedNamen(db, guildId, ids) {
    if (!ids.length) return {};
    const zeilen = await db.query(
        `SELECT mitglied_id, name, anzeigename, bot FROM log_namen
          WHERE guild_id = ? AND mitglied_id IN (${ids.map(() => '?').join(',')})
          ORDER BY zuletzt ASC`, [guildId, ...ids]);
    const namen = {};
    for (const z of zeilen) namen[String(z.mitglied_id)] = { name: z.name, anzeigename: z.anzeigename, bot: Boolean(z.bot) };
    return namen;
}

/** Kategorien, die der Betrachter sehen darf (Katalog `recht`, sonst LOGGING.VIEW). */
async function sichtbareKategorien(userId, guildId) {
    const pm = ServiceManager.get('permissionManager');
    const aus = [];
    for (const [k, v] of Object.entries(KATEGORIEN)) {
        if (!v.recht || await pm.hasPermission(userId, guildId, v.recht)) aus.push(k);
    }
    return aus;
}

router.get('/', (req, res) => res.redirect(`/guild/${encodeURIComponent(res.locals.guildId)}/plugins/logging/ereignisse`));

router.get('/ereignisse', requirePermission('LOGGING.VIEW'), async (req, res) => {
    const guildId = res.locals.guildId;
    const tr = makeTranslator(req, res);
    try {
        const db = ServiceManager.get('dbService');
        const kategorien = await sichtbareKategorien(String(req.session?.user?.info?.id || ''), guildId);
        const filter = {
            kategorie: kategorien.includes(String(req.query.kategorie)) ? String(req.query.kategorie) : '',
            schwere: SCHWEREN.includes(String(req.query.schwere)) ? String(req.query.schwere) : '',
            mitglied: ID.test(String(req.query.mitglied || '')) ? String(req.query.mitglied) : '',
        };
        const seite = Math.max(1, Math.min(1000, parseInt(req.query.seite, 10) || 1));
        const wo = ['guild_id = ?'];
        const werte = [guildId];
        if (filter.kategorie) { wo.push('kategorie = ?'); werte.push(filter.kategorie); }
        else if (kategorien.length) { wo.push(`kategorie IN (${kategorien.map(() => '?').join(',')})`); werte.push(...kategorien); }
        else wo.push('1 = 0');
        if (filter.schwere) { wo.push('schwere = ?'); werte.push(filter.schwere); }
        if (filter.mitglied) { wo.push('(akteur_id = ? OR betroffen_id = ?)'); werte.push(filter.mitglied, filter.mitglied); }
        const ereignisse = await db.query(
            `SELECT id, zeit, kategorie, art, schwere, quelle, akteur_id, betroffen_id, kanal_id, objekt_typ, objekt_id, objekt_name,
                    vorher, nachher, zuordnung
               FROM log_ereignisse WHERE ${wo.join(' AND ')}
              ORDER BY zeit DESC, id DESC LIMIT ? OFFSET ?`,
            [...werte, PRO_SEITE + 1, (seite - 1) * PRO_SEITE]);
        const weiter = ereignisse.length > PRO_SEITE;
        const liste = ereignisse.slice(0, PRO_SEITE).map((e) => ({ ...e, zeilen: Anzeige.zeilen(e) }));
        const listen = liste.map((e) => e.zeilen);
        const mitglieder = [...new Set([
            ...liste.flatMap((e) => [e.akteur_id, e.betroffen_id]).filter(Boolean).map(String),
            ...Anzeige.mitgliedIds(listen),
        ])];
        const [namen, rollen, gesamt] = await Promise.all([
            mitgliedNamen(db, guildId, mitglieder),
            rollenNamen(guildId, Anzeige.rollenIds(listen)),
            db.query('SELECT COUNT(*) AS n FROM log_ereignisse WHERE guild_id = ?', [guildId]),
        ]);
        await ServiceManager.get('themeManager').renderView(res, 'guild/logging-ereignisse', {
            tr, guildId, liste, namen, rollenNamen: rollen.namen, rollenNamenFehlen: rollen.fehlen,
            filter, kategorien, schweren: SCHWEREN, seite, weiter, gesamt: Number(gesamt[0]?.n || 0),
        });
    } catch (error) {
        ServiceManager.get('Logger').error('[Logging] Ereignisse nicht geladen:', error);
        res.locals.layout = ServiceManager.get('themeManager')?.getLayout('guild');
        return res.status(500).render('error', {
            status: 500, message: 'Logging',
            error: { status: 500, title: tr('logging:FEHLER.SEITE'), message: tr('logging:FEHLER.EREIGNISSE'), details: error.message },
        });
    }
});

router.get('/einstellungen', requirePermission('LOGGING.CONFIGURE'), async (req, res) => {
    const guildId = res.locals.guildId;
    const tr = makeTranslator(req, res);
    try {
        const regeln = await Regeln.lade(guildId, { frisch: true });
        await ServiceManager.get('themeManager').renderView(res, 'guild/logging-einstellungen', {
            tr, guildId, katalog: KATEGORIEN,
            an: Object.fromEntries(Object.keys(KATEGORIEN).map((k) => [k, Regeln.kategorieAn(regeln, k)])),
            artenAus: [...regeln.artenAus], bots: regeln.bots,
        });
    } catch (error) {
        ServiceManager.get('Logger').error('[Logging] Einstellungen nicht geladen:', error);
        res.locals.layout = ServiceManager.get('themeManager')?.getLayout('guild');
        return res.status(500).render('error', {
            status: 500, message: 'Logging',
            error: { status: 500, title: tr('logging:FEHLER.SEITE'), message: tr('logging:FEHLER.EINSTELLUNGEN'), details: error.message },
        });
    }
});

/**
 * Prüft die Eingabe gegen den Katalog. Rein, damit der Wächter es prüft.
 * Unbekannte Kategorien und Arten werfen; fehlende bleiben, wie sie sind.
 *
 * @returns {{kategorien: Array<[string, boolean]>, arten: Array<[string, boolean]>, bots: boolean|null}}
 */
function pruefeEinstellungen(body) {
    const b = body || {};
    const alleArten = new Set(Object.values(KATEGORIEN).flatMap((v) => v.arten));
    const kategorien = Object.entries(b.kategorien || {}).map(([k, w]) => {
        if (!KATEGORIEN[k]) throw Object.assign(new Error(`Kategorie ${k}`), { eingabe: true });
        return [k, w === true || w === 'true' || w === 1];
    });
    const arten = Object.entries(b.arten || {}).map(([a, w]) => {
        if (!alleArten.has(a)) throw Object.assign(new Error(`Art ${a}`), { eingabe: true });
        return [a, w === true || w === 'true' || w === 1];
    });
    const bots = b.bots === undefined ? null : (b.bots === true || b.bots === 'true' || b.bots === 1);
    return { kategorien, arten, bots };
}

router.put('/einstellungen', csrfProtection, requirePermission('LOGGING.CONFIGURE'), async (req, res) => {
    const guildId = res.locals.guildId;
    const tr = makeTranslator(req, res);
    try {
        const e = pruefeEinstellungen(req.body);
        const db = ServiceManager.get('dbService');
        const setze = (regel, ziel, aktiv) => db.query(
            `INSERT INTO log_regeln (guild_id, regel, ziel, aktiv) VALUES (?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE aktiv = VALUES(aktiv)`, [guildId, regel, ziel, aktiv ? 1 : 0]);
        for (const [k, an] of e.kategorien) await setze('kategorie', k, an);
        // Arten: nur „aus“ braucht eine Zeile; wieder an → Zeile weg.
        for (const [a, an] of e.arten) {
            if (an) await db.query("DELETE FROM log_regeln WHERE guild_id = ? AND regel = 'art' AND ziel = ?", [guildId, a]);
            else await setze('art', a, false);
        }
        if (e.bots !== null) await setze('bots', '', e.bots);
        Regeln.vergiss(guildId);
        return res.json({ success: true, message: tr('logging:EINSTELLUNGEN.GESPEICHERT') });
    } catch (error) {
        if (error?.eingabe) return res.status(400).json({ success: false, message: tr('logging:EINSTELLUNGEN.UNBEKANNT', { was: error.message }) });
        ServiceManager.get('Logger').error('[Logging] Einstellungen nicht gespeichert:', error);
        return res.status(500).json({ success: false, message: tr('logging:EINSTELLUNGEN.FEHLER') });
    }
});

module.exports = router;
module.exports.pruefeEinstellungen = pruefeEinstellungen;
