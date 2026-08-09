/**
 * AutoMod — Stichwortlisten
 *
 * **Ein Bestand je Guild**, am 2026-08-09 so entschieden. Er wird beim ersten
 * Einschalten aus den mitgelieferten Vorlagen befüllt und gehört ab dann der
 * Guild. Die Dateien sind nur noch Vorlage — für das Befüllen und für den
 * ausdrücklichen Abgleich, der zeigt, was aus der Vorlage im eigenen Bestand
 * fehlt. Nichts wird automatisch zurückgeschrieben.
 *
 * **Jede schreibende Route stösst danach den Bot an.** Ohne das bliebe die
 * Bearbeitung eine Anzeige ohne Wirkung: der Bot hält die Listen im Speicher
 * und würde eine Änderung erst nach einem Neustart bemerken.
 *
 * @module automod/routes/keywords
 */

const express = require('express');
const router = express.Router({ mergeParams: true });
const { ServiceManager } = require('dunebot-core');
const { requirePermission } = require('../../../../apps/dashboard/middlewares/permissions.middleware');
const { AutoModKeywordLists } = require('../../shared/models');
const { TREFFERARTEN } = require('../../shared/stichwortTreffer');
const { fehler } = require('./_shared');

/**
 * Den Bot wissen lassen, dass sich etwas geändert hat.
 *
 * Bewusst ohne `await` auf ein Ergebnis und ohne Fehlerwurf: Das Speichern hat
 * geklappt, auch wenn der Bot gerade nicht antwortet. Es wird aber protokolliert
 * — ein dauerhaft stiller Bot hiesse, dass Änderungen erst beim nächsten
 * Neustart wirken, und das soll auffallen.
 *
 * @param {string} guildId
 */
async function botAnstossen(guildId) {
    const Logger = ServiceManager.get('Logger');
    const ipcServer = ServiceManager.get('ipcServer');

    if (!ipcServer) {
        Logger.warn('[AutoMod] Kein IPC-Server — Stichwortlisten wirken erst nach einem Bot-Neustart');
        return;
    }

    try {
        await ipcServer.broadcast('automod:keywordsChanged', { guildId });
    } catch (err) {
        Logger.warn(`[AutoMod] Bot nicht erreichbar, Stichwortlisten wirken verzögert: ${err.message}`);
    }
}

/** Trefferart aus einer Anfrage lesen, mit Rückfall auf die Vorgabe. */
const leseTrefferart = (wert) => TREFFERARTEN.includes(wert) ? wert : 'word';

// ── Eigene Listen ────────────────────────────────────────────────────────

// POST /listen → neue Liste
router.post('/listen', requirePermission('AUTOMOD.KEYWORDS.MANAGE'), async (req, res) => {
    const guildId = res.locals.guildId;
    const name = String(req.body?.name || '').trim();
    const beschreibung = String(req.body?.description || '').trim() || null;

    if (!name) {
        return res.status(400).json({ success: false, message: 'Der Name darf nicht leer sein' });
    }
    if (name.length > 100) {
        return res.status(400).json({ success: false, message: 'Der Name ist zu lang (höchstens 100 Zeichen)' });
    }

    try {
        const id = await AutoModKeywordLists.createList(guildId, name, beschreibung);
        await botAnstossen(guildId);
        return res.json({ success: true, id });
    } catch (error) {
        // Der eindeutige Schlüssel auf (guild_id, name) schlägt zu, wenn es die
        // Liste schon gibt — das ist kein Serverfehler, sondern eine Eingabe.
        if (error?.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ success: false, message: 'Eine Liste mit diesem Namen gibt es bereits' });
        }
        return fehler(res, error, 'Die Liste konnte nicht angelegt werden');
    }
});

// PUT /listen/:listId → umbenennen, beschreiben, an/aus
router.put('/listen/:listId', requirePermission('AUTOMOD.KEYWORDS.MANAGE'), async (req, res) => {
    const guildId = res.locals.guildId;
    const listId = Number(req.params.listId);

    if (!Number.isInteger(listId)) {
        return res.status(400).json({ success: false, message: 'Ungültige Listen-ID' });
    }

    const felder = {};
    if (req.body?.name !== undefined) felder.name = String(req.body.name).trim();
    if (req.body?.description !== undefined) felder.description = String(req.body.description).trim() || null;
    if (req.body?.enabled !== undefined) felder.enabled = Boolean(req.body.enabled);

    if (felder.name === '') {
        return res.status(400).json({ success: false, message: 'Der Name darf nicht leer sein' });
    }

    try {
        const geaendert = await AutoModKeywordLists.updateList(guildId, listId, felder);
        if (!geaendert) {
            return res.status(404).json({ success: false, message: 'Liste nicht gefunden' });
        }
        await botAnstossen(guildId);
        return res.json({ success: true });
    } catch (error) {
        if (error?.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ success: false, message: 'Eine Liste mit diesem Namen gibt es bereits' });
        }
        return fehler(res, error, 'Die Liste konnte nicht geändert werden');
    }
});

// DELETE /listen/:listId
router.delete('/listen/:listId', requirePermission('AUTOMOD.KEYWORDS.MANAGE'), async (req, res) => {
    const guildId = res.locals.guildId;
    const listId = Number(req.params.listId);

    if (!Number.isInteger(listId)) {
        return res.status(400).json({ success: false, message: 'Ungültige Listen-ID' });
    }

    try {
        const geloescht = await AutoModKeywordLists.deleteList(guildId, listId);
        if (!geloescht) {
            return res.status(404).json({ success: false, message: 'Liste nicht gefunden' });
        }
        await botAnstossen(guildId);
        return res.json({ success: true });
    } catch (error) {
        return fehler(res, error, 'Die Liste konnte nicht gelöscht werden');
    }
});

// ── Einträge ─────────────────────────────────────────────────────────────

// POST /listen/:listId/eintraege
router.post('/listen/:listId/eintraege', requirePermission('AUTOMOD.KEYWORDS.MANAGE'), async (req, res) => {
    const guildId = res.locals.guildId;
    const listId = Number(req.params.listId);
    const stichwort = String(req.body?.keyword || '').trim();
    const trefferart = leseTrefferart(req.body?.match_type);

    if (!Number.isInteger(listId)) {
        return res.status(400).json({ success: false, message: 'Ungültige Listen-ID' });
    }
    if (!stichwort) {
        return res.status(400).json({ success: false, message: 'Das Stichwort darf nicht leer sein' });
    }
    if (stichwort.length > 190) {
        return res.status(400).json({ success: false, message: 'Das Stichwort ist zu lang (höchstens 190 Zeichen)' });
    }

    try {
        const angelegt = await AutoModKeywordLists.addKeyword(guildId, listId, stichwort, trefferart);
        if (!angelegt) {
            return res.status(404).json({ success: false, message: 'Liste nicht gefunden' });
        }
        await botAnstossen(guildId);
        return res.json({ success: true });
    } catch (error) {
        return fehler(res, error, 'Das Stichwort konnte nicht gespeichert werden');
    }
});

// DELETE /eintraege/:keywordId
router.delete('/eintraege/:keywordId', requirePermission('AUTOMOD.KEYWORDS.MANAGE'), async (req, res) => {
    const guildId = res.locals.guildId;
    const keywordId = Number(req.params.keywordId);

    if (!Number.isInteger(keywordId)) {
        return res.status(400).json({ success: false, message: 'Ungültige Eintrags-ID' });
    }

    try {
        const geloescht = await AutoModKeywordLists.removeKeyword(guildId, keywordId);
        if (!geloescht) {
            return res.status(404).json({ success: false, message: 'Eintrag nicht gefunden' });
        }
        await botAnstossen(guildId);
        return res.json({ success: true });
    } catch (error) {
        return fehler(res, error, 'Der Eintrag konnte nicht gelöscht werden');
    }
});

// ── Trefferart eines Eintrags ────────────────────────────────────────────

// PUT /eintraege/:keywordId
router.put('/eintraege/:keywordId', requirePermission('AUTOMOD.KEYWORDS.MANAGE'), async (req, res) => {
    const guildId = res.locals.guildId;
    const keywordId = Number(req.params.keywordId);
    const trefferart = leseTrefferart(req.body?.match_type);

    if (!Number.isInteger(keywordId)) {
        return res.status(400).json({ success: false, message: 'Ungültige Eintrags-ID' });
    }

    try {
        const geaendert = await AutoModKeywordLists.setMatchType(guildId, keywordId, trefferart);
        if (!geaendert) {
            return res.status(404).json({ success: false, message: 'Eintrag nicht gefunden' });
        }
        await botAnstossen(guildId);
        return res.json({ success: true });
    } catch (error) {
        return fehler(res, error, 'Die Trefferart konnte nicht geändert werden');
    }
});

// ── Abgleich mit den Vorlagen ────────────────────────────────────────────

// GET /abgleich → was steht in den Vorlagen, das im eigenen Bestand fehlt?
router.get('/abgleich', requirePermission('AUTOMOD.VIEW'), async (req, res) => {
    const guildId = res.locals.guildId;

    try {
        const offen = await AutoModKeywordLists.vergleicheMitVorlage(guildId);
        return res.json({ success: true, offen });
    } catch (error) {
        return fehler(res, error, 'Der Abgleich konnte nicht durchgeführt werden');
    }
});

// POST /abgleich/:templateId → fehlende Wörter dieser Vorlage übernehmen
router.post('/abgleich/:templateId', requirePermission('AUTOMOD.KEYWORDS.MANAGE'), async (req, res) => {
    const guildId = res.locals.guildId;
    const templateId = String(req.params.templateId || '').trim();

    if (!templateId) {
        return res.status(400).json({ success: false, message: 'Ungültige Vorlage' });
    }

    try {
        const uebernommen = await AutoModKeywordLists.uebernehmeAusVorlage(guildId, templateId);
        if (uebernommen > 0) await botAnstossen(guildId);
        return res.json({ success: true, uebernommen });
    } catch (error) {
        return fehler(res, error, 'Die Wörter konnten nicht übernommen werden');
    }
});

module.exports = router;
