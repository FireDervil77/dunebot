'use strict';

/**
 * Leveling - Seiten (LV-1a, 2026-11-15).
 *
 *   /             → Weiterleitung auf /uebersicht
 *   /uebersicht   Regeln, die gerade gelten (Chat, Sprache, Belohnungen,
 *                 Level-up-Nachricht), und die ersten zehn der Rangliste
 *   /nachrichten  Level-up-Nachricht einstellen (LV-1f): wohin, wann, Vorlage
 *                 `leveling:aufstieg` (G-08), Rangkarte anhängen
 *   /xp-regeln    XP je Quelle, Taktung, Spamschutz, Storno, Sprache (LV-1i)
 *   /stufen       Kern-Teil Stufentabelle (G-20) mit Kontrolltabelle (LV-1i)
 *   /belohnungen  Rolle je Stufe geben/abnehmen, vorherige entfernen (LV-1i)
 *   /ausschluesse Kanal- und Rollenregeln: ausschließen, nur diese, Faktor (LV-1i)
 *
 * Geprüft wird in `shared/einstellen.js`, hier nur gelesen und geschrieben.
 * Der Bot liest Regeln 30 s zwischengespeichert, Belohnungen frisch.
 * Rangliste und Datenverwaltung kommen mit LV-1i Teil 2.
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
const Einstellen = require('../../shared/einstellen');
const { KanalTypen } = require('dunebot-core');

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
 * Rollen der Guild über den Bot (wie im discord-Plugin): Name, Farbe, ob der
 * Bot sie vergeben kann. Ohne Antwort `fehlen: true`, und die Seite sagt es.
 *
 * @returns {Promise<{liste: Array<{id, name, hexColor, managed, editable, position, mitglieder}>, fehlen: boolean}>}
 */
async function rollenListe(guildId) {
    try {
        const antworten = await ServiceManager.get('ipcServer').broadcast('dashboard:GET_GUILD_ROLES_DETAILED', { guildId });
        const gut = (antworten || []).map((a) => a?.data ?? a).find((a) => a?.success && Array.isArray(a.roles));
        if (!gut) return { liste: [], fehlen: true };
        return {
            liste: gut.roles.map((r) => ({
                id: String(r.id), name: r.name, hexColor: r.hexColor, managed: Boolean(r.managed),
                editable: Boolean(r.editable), position: Number(r.position), mitglieder: Number(r.memberCount) || 0,
            })),
            fehlen: false,
        };
    } catch (error) {
        ServiceManager.get('Logger').warn(`[Leveling] Rollen nicht geladen: ${error.message}`);
        return { liste: [], fehlen: true };
    }
}

/** Rollennamen für die Übersicht. */
async function rollenNamen(guildId, ids) {
    if (!ids.length) return { namen: {}, fehlen: false };
    const r = await rollenListe(guildId);
    return { namen: Object.fromEntries(r.liste.map((x) => [x.id, x.name])), fehlen: r.fehlen };
}

/**
 * Kanäle für die Ausschlüsse: alle, in denen Leveling zählt (Text- und
 * Sprachkanäle mit Chat, Ankündigung, Bühne, Forum, Medien) und die
 * Kategorien darüber. Threads nicht: Wer den Kanal nimmt, meint sie mit.
 *
 * @returns {Promise<{liste: Array<{id, name, type, parentId, parentName}>, fehlen: boolean}>}
 */
async function alleKanaele(guildId) {
    const K = KanalTypen.KANAL;
    try {
        const antworten = await ServiceManager.get('ipcServer').broadcast('dashboard:GET_GUILD_CHANNELS', {
            guildId, types: [K.TEXT, K.VOICE, K.KATEGORIE, K.ANKUENDIGUNG, K.BUEHNE, K.FORUM, K.MEDIEN],
        });
        const gut = (antworten || []).map((a) => a?.data ?? a).find((a) => a?.success !== false && Array.isArray(a?.channels) && a.channels.length);
        if (!gut) return { liste: [], fehlen: true };
        return {
            liste: gut.channels.map((k) => ({
                id: String(k.id), name: String(k.name), type: Number(k.type),
                parentId: k.parentId ? String(k.parentId) : null, parentName: k.parentName || null,
            })),
            fehlen: false,
        };
    } catch (error) {
        ServiceManager.get('Logger').warn(`[Leveling] Kanäle nicht geladen: ${error.message}`);
        return { liste: [], fehlen: true };
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

// ---------------------------------------------------------------------------
// LV-1i: XP-Regeln, Stufen, Belohnungen, Ausschlüsse
// ---------------------------------------------------------------------------

/** Fehlerseite wie bei Übersicht und Nachrichten. */
function fehlerSeite(req, res, tr, schluessel, error) {
    ServiceManager.get('Logger').error(`[Leveling] Seite ${schluessel} nicht geladen:`, error);
    res.locals.layout = ServiceManager.get('themeManager')?.getLayout('guild');
    return res.status(500).render('error', {
        status: 500,
        message: 'Leveling',
        error: { status: 500, title: tr('leveling:FEHLER.SEITE'), message: tr(`leveling:FEHLER.${schluessel}`), details: error.message }
    });
}

/** Antwort auf eine Eingabe: 400 mit Text, sonst 500 mit Log. */
function antwortFehler(res, tr, error, was) {
    if (error instanceof Einstellen.Eingabefehler) {
        const w = { ...error.werte };
        if (w.feld) w.feld = tr(`leveling:EINSTELLEN.FELD_${String(w.feld).replace(/\./g, '_').toUpperCase()}`);
        return res.status(400).json({ success: false, message: tr(`leveling:EINSTELLEN.${error.schluessel}`, w) });
    }
    ServiceManager.get('Logger').error(`[Leveling] ${was} nicht gespeichert:`, error);
    return res.status(500).json({ success: false, message: tr('leveling:EINSTELLEN.FEHLER') });
}

const ZEILEN_ID = /^\d{1,10}$/;

/** XP je Quelle, Spamschutz, Storno, Sprache. */
router.get('/xp-regeln', requirePermission('LEVELING.CONFIGURE'), async (req, res) => {
    const guildId = res.locals.guildId;
    const tr = makeTranslator(req, res);
    try {
        const regeln = await Regeln.lade(guildId, { frisch: true });
        await ServiceManager.get('themeManager').renderView(res, 'guild/leveling-xp-regeln', {
            tr, guildId, regeln, grenzen: Einstellen.GRENZEN,
        });
    } catch (error) {
        return fehlerSeite(req, res, tr, 'XP_REGELN', error);
    }
});

router.put('/xp-regeln', csrfProtection, requirePermission('LEVELING.CONFIGURE'), async (req, res) => {
    const guildId = res.locals.guildId;
    const tr = makeTranslator(req, res);
    try {
        if (!await Regeln.lade(guildId, { frisch: true })) throw new Einstellen.Eingabefehler('NICHT_EINGERICHTET');
        const { quellen, einstellungen: e } = Einstellen.pruefeXp(req.body);
        const db = ServiceManager.get('dbService');
        for (const [quelle, q] of Object.entries(quellen)) {
            await db.query(
                `INSERT INTO level_quellen (guild_id, quelle, xp_von, xp_bis, taktung_s, aktiv) VALUES (?, ?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE xp_von = VALUES(xp_von), xp_bis = VALUES(xp_bis), taktung_s = VALUES(taktung_s), aktiv = VALUES(aktiv)`,
                [guildId, quelle, q.xp_von, q.xp_bis, q.taktung_s, q.aktiv]);
        }
        await db.query(
            `UPDATE level_einstellungen SET mindestlaenge = ?, gleiche_fenster_s = ?, storno_loeschen_min = ?, storno_automod = ?,
                    sprache_min_menschen = ?, sprache_stumm_zaehlt = ? WHERE guild_id = ?`,
            [e.mindestlaenge, e.gleiche_fenster_s, e.storno_loeschen_min, e.storno_automod, e.sprache_min_menschen, e.sprache_stumm_zaehlt, guildId]);
        Regeln.vergiss(guildId);
        return res.json({ success: true, message: tr('leveling:EINSTELLEN.GESPEICHERT') });
    } catch (error) {
        return antwortFehler(res, tr, error, 'XP-Regeln');
    }
});

/**
 * Stufen: Kern-Teil aus G-20 (Tabelle, Schablone, Rechner; ändern mit
 * `LEVELING.CONFIGURE`, das prüft der Kern), darunter die Kontrolltabelle
 * „Stufe ≈ Nachrichten, Zeit“. Ansehen darf, wer Leveling sieht.
 */
router.get('/stufen', requirePermission('LEVELING.VIEW'), async (req, res) => {
    const guildId = res.locals.guildId;
    const tr = makeTranslator(req, res);
    try {
        const regeln = await Regeln.lade(guildId, { frisch: true });
        await ServiceManager.get('themeManager').renderView(res, 'guild/leveling-stufen', {
            tr, guildId, raten: Einstellen.raten(regeln?.quellen),
        });
    } catch (error) {
        return fehlerSeite(req, res, tr, 'STUFEN', error);
    }
});

/** Belohnungsrollen je Stufe, mit „so viele haben die Stufe schon“. */
router.get('/belohnungen', requirePermission('LEVELING.REWARDS.MANAGE'), async (req, res) => {
    const guildId = res.locals.guildId;
    const tr = makeTranslator(req, res);
    try {
        const db = ServiceManager.get('dbService');
        const regeln = await Regeln.lade(guildId, { frisch: true });
        const [zeilen, stufen, rollen, verteilung] = await Promise.all([
            db.query(
                `SELECT id, stufe, art, wert FROM level_belohnungen WHERE guild_id = ? AND art IN ('rolle_geben', 'rolle_nehmen')
                 ORDER BY stufe, art, id`, [guildId]),
            Fortschritt.stufen({ guildId, kennung: 'leveling:community' }),
            rollenListe(guildId),
            db.query(
                `SELECT level, (prestige > 0) AS prestige, COUNT(*) AS n FROM fortschritt_stand
                 WHERE guild_id = ? AND kennung = 'leveling:community' GROUP BY level, (prestige > 0)`, [guildId]),
        ]);
        // Wie viele tragen die Stufe (oder höher)? Nach Prestige gilt die höchste.
        const erreicht = (stufe) => (verteilung || []).reduce((n, z) => n + ((Number(z.prestige) || Number(z.level) >= stufe) ? Number(z.n) : 0), 0);
        const belohnungen = (zeilen || []).map((z) => ({
            id: Number(z.id), stufe: Number(z.stufe), art: z.art, wert: String(z.wert), erreicht: erreicht(Number(z.stufe)),
        }));
        await ServiceManager.get('themeManager').renderView(res, 'guild/leveling-belohnungen', {
            tr, guildId, regeln, belohnungen, stufen: stufen.stufen,
            rollen: rollen.liste, rollenFehlen: rollen.fehlen,
            vorherigeEntfernen: Boolean(Number(regeln?.einstellungen?.vorherige_rollen_entfernen || 0)),
        });
    } catch (error) {
        return fehlerSeite(req, res, tr, 'BELOHNUNGEN', error);
    }
});

router.post('/belohnungen', csrfProtection, requirePermission('LEVELING.REWARDS.MANAGE'), async (req, res) => {
    const guildId = res.locals.guildId;
    const tr = makeTranslator(req, res);
    try {
        if (!await Regeln.lade(guildId, { frisch: true })) throw new Einstellen.Eingabefehler('NICHT_EINGERICHTET');
        const rollen = await rollenListe(guildId);
        const b = Einstellen.pruefeBelohnung(req.body, { rollen: rollen.fehlen ? null : rollen.liste, guildId });
        // Kein INSERT IGNORE: Das schluckt auch abgeschnittene Werte.
        try {
            await ServiceManager.get('dbService').query(
                'INSERT INTO level_belohnungen (guild_id, stufe, art, wert) VALUES (?, ?, ?, ?)', [guildId, b.stufe, b.art, b.wert]);
        } catch (err) {
            if (err?.code === 'ER_DUP_ENTRY') throw new Einstellen.Eingabefehler('SCHON_DA');
            throw err;
        }
        const text = [tr('leveling:BELOHNUNGEN.ANGELEGT')];
        if (b.warnung) text.push(tr(`leveling:EINSTELLEN.${b.warnung}`));
        return res.json({ success: true, message: text.join(' '), warnung: b.warnung });
    } catch (error) {
        return antwortFehler(res, tr, error, 'Belohnung');
    }
});

router.delete('/belohnungen/:id', csrfProtection, requirePermission('LEVELING.REWARDS.MANAGE'), async (req, res) => {
    const guildId = res.locals.guildId;
    const tr = makeTranslator(req, res);
    try {
        if (!ZEILEN_ID.test(String(req.params.id))) return res.status(400).json({ success: false, message: tr('leveling:EINSTELLEN.NICHT_GEFUNDEN') });
        const r = await ServiceManager.get('dbService').query(
            "DELETE FROM level_belohnungen WHERE id = ? AND guild_id = ? AND art IN ('rolle_geben', 'rolle_nehmen')", [Number(req.params.id), guildId]);
        if (!Number(r?.affectedRows)) return res.status(404).json({ success: false, message: tr('leveling:EINSTELLEN.NICHT_GEFUNDEN') });
        return res.json({ success: true, message: tr('leveling:BELOHNUNGEN.ENTFERNT') });
    } catch (error) {
        return antwortFehler(res, tr, error, 'Belohnung entfernen');
    }
});

router.put('/belohnungen/einstellungen', csrfProtection, requirePermission('LEVELING.REWARDS.MANAGE'), async (req, res) => {
    const guildId = res.locals.guildId;
    const tr = makeTranslator(req, res);
    try {
        const an = req.body?.vorherige_rollen_entfernen === true || req.body?.vorherige_rollen_entfernen === 'true';
        const r = await ServiceManager.get('dbService').query(
            'UPDATE level_einstellungen SET vorherige_rollen_entfernen = ? WHERE guild_id = ?', [an ? 1 : 0, guildId]);
        if (!Number(r?.affectedRows)) throw new Einstellen.Eingabefehler('NICHT_EINGERICHTET');
        Regeln.vergiss(guildId);
        return res.json({ success: true, message: tr('leveling:EINSTELLEN.GESPEICHERT') });
    } catch (error) {
        return antwortFehler(res, tr, error, 'Belohnungen');
    }
});

/** Kanal- und Rollenregeln mit „so viele Kanäle betroffen“. */
router.get('/ausschluesse', requirePermission('LEVELING.CONFIGURE'), async (req, res) => {
    const guildId = res.locals.guildId;
    const tr = makeTranslator(req, res);
    try {
        const [regeln, zeilen, kanaele, rollen] = await Promise.all([
            Regeln.lade(guildId, { frisch: true }),
            ServiceManager.get('dbService').query(
                'SELECT id, art, ziel_id, wirkung, faktor, quelle FROM level_regeln WHERE guild_id = ? ORDER BY art, wirkung, id', [guildId]),
            alleKanaele(guildId),
            rollenListe(guildId),
        ]);
        // DECIMAL kommt als Text.
        const liste = (zeilen || []).map((z) => ({ ...z, id: Number(z.id), ziel_id: String(z.ziel_id), faktor: z.faktor == null ? null : Number(z.faktor) }));
        await ServiceManager.get('themeManager').renderView(res, 'guild/leveling-ausschluesse', {
            tr, guildId, eingerichtet: Boolean(regeln), regeln: liste,
            kanaele: kanaele.liste, kanaeleFehlen: kanaele.fehlen, rollen: rollen.liste, rollenFehlen: rollen.fehlen,
            wirkung: kanaele.fehlen ? null : Einstellen.wirkungAufKanaele(liste, kanaele.liste),
            schluessel: Einstellen.regelSchluessel, quellen: Einstellen.QUELLEN, wirkungen: Einstellen.WIRKUNGEN,
        });
    } catch (error) {
        return fehlerSeite(req, res, tr, 'AUSSCHLUESSE', error);
    }
});

router.post('/ausschluesse', csrfProtection, requirePermission('LEVELING.CONFIGURE'), async (req, res) => {
    const guildId = res.locals.guildId;
    const tr = makeTranslator(req, res);
    try {
        if (!await Regeln.lade(guildId, { frisch: true })) throw new Einstellen.Eingabefehler('NICHT_EINGERICHTET');
        const art = String(req.body?.art || '');
        const [kanaele, rollen] = await Promise.all([
            art === 'kanal' ? alleKanaele(guildId) : { fehlen: true },
            art === 'rolle' ? rollenListe(guildId) : { fehlen: true },
        ]);
        const regel = Einstellen.pruefeRegel(req.body, {
            kanaele: kanaele.fehlen ? null : kanaele.liste, rollen: rollen.fehlen ? null : rollen.liste, guildId,
        });
        const db = ServiceManager.get('dbService');
        const vorhanden = await db.query('SELECT art, ziel_id, wirkung, quelle FROM level_regeln WHERE guild_id = ?', [guildId]);
        if (Einstellen.istDoppelt(regel, vorhanden)) throw new Einstellen.Eingabefehler('SCHON_DA');
        await db.query(
            'INSERT INTO level_regeln (guild_id, art, ziel_id, wirkung, faktor, quelle) VALUES (?, ?, ?, ?, ?, ?)',
            [guildId, regel.art, regel.ziel_id, regel.wirkung, regel.faktor, regel.quelle]);
        Regeln.vergiss(guildId);
        return res.json({ success: true, message: tr('leveling:AUSSCHLUESSE.ANGELEGT') });
    } catch (error) {
        return antwortFehler(res, tr, error, 'Regel');
    }
});

router.delete('/ausschluesse/:id', csrfProtection, requirePermission('LEVELING.CONFIGURE'), async (req, res) => {
    const guildId = res.locals.guildId;
    const tr = makeTranslator(req, res);
    try {
        if (!ZEILEN_ID.test(String(req.params.id))) return res.status(400).json({ success: false, message: tr('leveling:EINSTELLEN.NICHT_GEFUNDEN') });
        const r = await ServiceManager.get('dbService').query(
            'DELETE FROM level_regeln WHERE id = ? AND guild_id = ?', [Number(req.params.id), guildId]);
        if (!Number(r?.affectedRows)) return res.status(404).json({ success: false, message: tr('leveling:EINSTELLEN.NICHT_GEFUNDEN') });
        Regeln.vergiss(guildId);
        return res.json({ success: true, message: tr('leveling:AUSSCHLUESSE.ENTFERNT') });
    } catch (error) {
        return antwortFehler(res, tr, error, 'Regel entfernen');
    }
});

module.exports = router;
