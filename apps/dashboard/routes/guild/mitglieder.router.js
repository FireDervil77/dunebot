/**
 * Kern-Seite „Mitglieder“ je Guild (G-12, K382, 2026-11-14).
 *
 * Routes: /guild/:guildId/mitglieder/*
 *
 *   GET /                 → Mitglieder der Guild (vom Bot), Suche `?q=`, Seiten zu 50
 *   GET /:userId          → Profil eines Mitglieds: Profilkarte und Profilabschnitte
 *   GET /:userId/karte    → die Profilkarte `kern:profil` als Bild, wie `/profile` sie zeichnet
 *
 * Recht `CORE.MITGLIEDER.VIEW`. Welche Abschnitte der Betrachter sieht,
 * entscheidet `Profil.abschnitte` (Ort `dashboard`): `alle` immer, `team` mit
 * dem Recht des Plugins (oder wenn er sich selbst ansieht und der Abschnitt
 * auch in Discord steht), `selbst` nur bei sich selbst. Moderation und
 * Automod brauchen ihr Recht also auch für das eigene Profil.
 *
 * Mitglieder, die den Server verlassen haben, haben keine Discord-Angaben und
 * keine Karte; was die Guild noch über sie hat, steht trotzdem da (Adresse mit
 * der ID, etwa aus einem Moderationsfall).
 *
 * Wächter: scripts/check-profil.js
 */

'use strict';

const express = require('express');
const router = express.Router({ mergeParams: true });
const { ServiceManager } = require('dunebot-core');
const { Profil, Bildkarte } = require('dunebot-sdk');
const { requirePermission } = require('../../middlewares/permissions.middleware');

const SEITE = 50;
const ID = /^\d{17,20}$/;
/** Liste aller Mitglieder: höchstens so lange (der Bot hat selbst 15 s). */
const FRIST_MS = 20_000;

/**
 * Kern-IPC an den Bot. Jeder Shard antwortet; gilt die Antwort des Shards,
 * der die Guild hat. Ohne Antwort: Fehler mit Grund.
 */
async function frageBot(event, payload) {
    const antworten = await ServiceManager.get('ipcServer').broadcast(`dashboard:${event}`, payload, true, { timeout: FRIST_MS });
    const innen = (antworten || []).map((h) => h?.data ?? h);
    const gut = innen.find((a) => a?.success);
    if (gut) return gut;
    const grund = innen.map((a) => a?.error).find(Boolean) || (antworten?.length ? 'keine Antwort' : 'Kein Bot verbunden');
    throw new Error(grund);
}

async function guildName(guildId) {
    const zeilen = await ServiceManager.get('dbService').query('SELECT guild_name FROM guilds WHERE _id = ?', [guildId]);
    return zeilen?.[0]?.guild_name || '';
}

/** Sprache der Guild wie im Bot (`guild.locale` = core `LOCALE`): für die Karte. */
async function spracheDerGuild(guildId) {
    const zeilen = await ServiceManager.get('dbService').query(
        "SELECT config_value FROM configs WHERE plugin_name = 'core' AND config_key = 'LOCALE' AND guild_id = ? AND context = 'shared'",
        [guildId]
    );
    return zeilen?.[0]?.config_value || 'de-DE';
}

/** Abschnitte für den angemeldeten Betrachter. */
function abschnitteFuer(req, guildId, userId, mitglied, sprache) {
    const betrachterId = String(req.session.user?.info?.id || '');
    const pm = ServiceManager.get('permissionManager');
    return Profil.abschnitte({
        guildId, userId, mitglied, sprache, ort: 'dashboard', betrachterId,
        darf: (recht) => pm.hasPermission(betrachterId, guildId, recht),
    });
}

// GET /mitglieder
router.get('/', requirePermission('CORE.MITGLIEDER.VIEW'), async (req, res) => {
    const guildId = res.locals.guildId;
    const Logger = ServiceManager.get('Logger');
    const q = String(req.query.q || '').trim().slice(0, 100);
    let liste = null;
    let fehler = null;
    try {
        liste = await frageBot('MITGLIEDER_LISTE', { guildId });
    } catch (err) {
        fehler = err.message;
        Logger.warn(`[Mitglieder] Liste in ${guildId}: ${err.message}`);
    }
    const alle = liste?.mitglieder || [];
    const klein = q.toLowerCase();
    const treffer = q
        ? alle.filter((m) => m.id === q || m.name.toLowerCase().includes(klein) || m.anzeige.toLowerCase().includes(klein))
        : alle;
    const seiten = Math.max(1, Math.ceil(treffer.length / SEITE));
    const seite = Math.min(seiten, Math.max(1, parseInt(req.query.seite, 10) || 1));
    // Wer eine ID sucht, die nicht (mehr) auf dem Server ist, kommt trotzdem
    // zu ihrem Profil: Moderationsfälle bleiben nach dem Verlassen.
    const nurId = ID.test(q) && !treffer.length ? q : null;

    await ServiceManager.get('themeManager').renderView(res, 'guild/mitglieder', {
        title: 'Mitglieder',
        activeMenu: `/guild/${guildId}/mitglieder`,
        guildId,
        q,
        nurId,
        fehler,
        vollstaendig: liste ? liste.vollstaendig : null,
        grund: liste?.grund || null,
        anzahl: liste?.anzahl ?? null,
        treffer: treffer.length,
        mitglieder: treffer.slice((seite - 1) * SEITE, seite * SEITE),
        seite,
        seiten,
    });
});

// GET /mitglieder/:userId
router.get('/:userId', requirePermission('CORE.MITGLIEDER.VIEW'), async (req, res) => {
    const guildId = res.locals.guildId;
    const userId = String(req.params.userId || '');
    const Logger = ServiceManager.get('Logger');
    if (!ID.test(userId)) return res.status(404).send('Dieses Mitglied gibt es nicht.');
    try {
        let mitglied = null;
        let botFehler = null;
        try {
            mitglied = (await frageBot('MITGLIED_PROFIL', { guildId, userId })).mitglied;
        } catch (err) {
            botFehler = err.message;
        }
        const sprache = res.locals.locale || 'de-DE';
        const { abschnitte, fehler } = await abschnitteFuer(req, guildId, userId, mitglied, sprache);
        for (const f of fehler) Logger.warn(`[Mitglieder] Abschnitt ${f.kennung} für ${userId} in ${guildId}: ${f.grund}`);
        await ServiceManager.get('themeManager').renderView(res, 'guild/mitglied', {
            title: 'Mitglieder',
            activeMenu: `/guild/${guildId}/mitglieder`,
            guildId,
            userId,
            mitglied,
            botFehler,
            selbst: String(req.session.user?.info?.id || '') === userId,
            abschnitte: abschnitte.map((a) => ({ ...a, felder: a.felder.map((f) => ({ titel: f.titel, text: Profil.feldText(f, 'dashboard', sprache, Profil.uebersetzer('core', sprache)) })) })),
            fehler,
        });
    } catch (err) {
        Logger.error(`[Mitglieder] Profil ${userId} in ${guildId}:`, err);
        res.status(500).send('Das Profil konnte nicht geladen werden.');
    }
});

// GET /mitglieder/:userId/karte
router.get('/:userId/karte', requirePermission('CORE.MITGLIEDER.VIEW'), async (req, res) => {
    const guildId = res.locals.guildId;
    const userId = String(req.params.userId || '');
    if (!ID.test(userId)) return res.status(404).type('text').send('Dieses Mitglied gibt es nicht.');
    try {
        const { mitglied } = await frageBot('MITGLIED_PROFIL', { guildId, userId });
        if (!mitglied) return res.status(404).type('text').send('Nicht mehr auf dem Server.');
        const sprache = await spracheDerGuild(guildId);
        const { abschnitte } = await abschnitteFuer(req, guildId, userId, mitglied, sprache);
        const guild = { id: guildId, name: await guildName(guildId) };
        const member = Profil.kartenMitglied(mitglied, guild);
        const bild = await Bildkarte.zeichneNutzung('core', 'kern:profil', { member, guild: member.guild, werte: Profil.kacheln(abschnitte) }, { guildId, sprache });
        res.set('Cache-Control', 'no-store');
        res.type(bild.typ === 'png' ? 'png' : 'jpeg').send(bild.puffer);
    } catch (err) {
        ServiceManager.get('Logger').error(`[Mitglieder] Karte ${userId} in ${guildId}:`, err);
        res.status(500).type('text').send(err.message);
    }
});

module.exports = router;
