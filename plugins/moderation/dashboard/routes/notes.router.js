/**
 * Moderation - Mod-Notizen
 *
 * Interne Vermerke zu einem Mitglied. Sichtbar nur im Dashboard und ueber
 * `/note`, nie fuer das Mitglied selbst.
 *
 * @module moderation/routes/notes
 */

const express = require('express');
const router = express.Router();
const { ServiceManager } = require('dunebot-core');
const { requirePermission } = require('../../../../apps/dashboard/middlewares/permissions.middleware');
const { fehler } = require('./_shared');

/** Alle Notizen der Guild. */
router.get('/', requirePermission('MODERATION.NOTES.VIEW'), async (req, res) => {
    const grenze = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 500);

    try {
        const notizen = await ServiceManager.get('dbService').query(
            'SELECT * FROM moderation_notes WHERE guild_id = ? ORDER BY created_at DESC LIMIT ?',
            [res.locals.guildId, grenze]
        );
        res.json({ success: true, notes: notizen });
    } catch (error) {
        fehler(res, error, 'Notizen konnten nicht geladen werden');
    }
});

/** Notizen zu einem einzelnen Mitglied. */
router.get('/:userId', requirePermission('MODERATION.NOTES.VIEW'), async (req, res) => {
    try {
        const notizen = await ServiceManager.get('dbService').query(
            'SELECT * FROM moderation_notes WHERE guild_id = ? AND user_id = ? ORDER BY created_at DESC',
            [res.locals.guildId, req.params.userId]
        );
        res.json({ success: true, notes: notizen });
    } catch (error) {
        fehler(res, error, 'Notizen des Mitglieds konnten nicht geladen werden');
    }
});

router.post('/', requirePermission('MODERATION.NOTES.MANAGE'), async (req, res) => {
    const { user_id, note } = req.body;
    if (!user_id || !note) {
        return res.status(400).json({ success: false, error: 'user_id und note sind erforderlich' });
    }

    // Wer die Notiz angelegt hat - fuer die Spalte author_id
    const autor = res.locals.user?.id || req.session?.user?.info?.id || null;

    try {
        await ServiceManager.get('dbService').query(
            'INSERT INTO moderation_notes (guild_id, user_id, author_id, note) VALUES (?, ?, ?, ?)',
            [res.locals.guildId, user_id, autor, String(note).substring(0, 1000)]
        );
        res.json({ success: true });
    } catch (error) {
        fehler(res, error, 'Notiz konnte nicht angelegt werden');
    }
});

router.delete('/:noteId', requirePermission('MODERATION.NOTES.MANAGE'), async (req, res) => {
    const id = parseInt(req.params.noteId, 10);
    if (Number.isNaN(id)) return res.status(400).json({ success: false, error: 'Ungueltige ID' });

    try {
        await ServiceManager.get('dbService').query(
            'DELETE FROM moderation_notes WHERE id = ? AND guild_id = ?',
            [id, res.locals.guildId]
        );
        res.json({ success: true });
    } catch (error) {
        fehler(res, error, 'Notiz konnte nicht geloescht werden');
    }
});

module.exports = router;
