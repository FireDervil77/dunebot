/**
 * Musik - Wiedergabelisten
 *
 * @module music/dashboard/routes/playlists
 */

const express = require('express');
const router = express.Router();
const { ServiceManager } = require('dunebot-core');
const { requirePermission } = require('../../../../apps/dashboard/middlewares/permissions.middleware');
const { MusicPlaylists, MusicSettings } = require('../../shared/models');
const { aufloesen } = require('../../bot/quellen');
const { angemeldeterNutzer, fehler } = require('./_shared');

router.get('/', requirePermission('MUSIC.VIEW'), async (req, res) => {
    try {
        res.json({ success: true, listen: await MusicPlaylists.getAll(res.locals.guildId) });
    } catch (error) {
        fehler(res, error, 'Die Wiedergabelisten konnten nicht geladen werden');
    }
});

router.post('/', requirePermission('MUSIC.PLAYLISTS.MANAGE'), async (req, res) => {
    const name = String(req.body.name || '').trim();
    if (!name) return res.status(400).json({ success: false, error: 'Ein Name ist erforderlich' });

    try {
        const id = await MusicPlaylists.create(res.locals.guildId, {
            name,
            description: req.body.description || null,
            createdBy: angemeldeterNutzer(req, res)
        });
        res.json({ success: true, id });
    } catch (error) {
        // Der eindeutige Schluessel auf (guild_id, name) faengt Doppelte ab
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ success: false, error: 'Diese Liste gibt es bereits' });
        }
        fehler(res, error, 'Die Liste konnte nicht angelegt werden');
    }
});

router.put('/:id', requirePermission('MUSIC.PLAYLISTS.MANAGE'), async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ success: false, error: 'Ungueltige ID' });

    try {
        const erfolg = await MusicPlaylists.update(id, res.locals.guildId, req.body);
        if (!erfolg) return res.status(404).json({ success: false, error: 'Liste nicht gefunden' });
        res.json({ success: true });
    } catch (error) {
        fehler(res, error, 'Die Liste konnte nicht geaendert werden');
    }
});

router.delete('/:id', requirePermission('MUSIC.PLAYLISTS.MANAGE'), async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ success: false, error: 'Ungueltige ID' });

    try {
        const erfolg = await MusicPlaylists.delete(id, res.locals.guildId);
        if (!erfolg) return res.status(404).json({ success: false, error: 'Liste nicht gefunden' });
        res.json({ success: true });
    } catch (error) {
        fehler(res, error, 'Die Liste konnte nicht geloescht werden');
    }
});

/**
 * Titel an eine Liste haengen.
 *
 * Die Eingabe wird hier aufgeloest, damit in der Liste fertige Titel stehen -
 * beim Abspielen soll nicht erst gesucht werden muessen.
 */
router.post('/:id/titel', requirePermission('MUSIC.PLAYLISTS.MANAGE'), async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const eingabe = String(req.body.eingabe || '').trim();

    if (Number.isNaN(id)) return res.status(400).json({ success: false, error: 'Ungueltige ID' });
    if (!eingabe) return res.status(400).json({ success: false, error: 'Es fehlt eine Adresse oder ein Suchbegriff' });

    try {
        const liste = await MusicPlaylists.getWithTracks(id, res.locals.guildId);
        if (!liste) return res.status(404).json({ success: false, error: 'Liste nicht gefunden' });

        const einstellungen = await MusicSettings.getSettings(res.locals.guildId);
        const nutzer = angemeldeterNutzer(req, res);
        const ergebnis = await aufloesen(eingabe, { angefordertVon: nutzer, einstellungen });

        if (ergebnis.titel.length === 0) {
            return res.status(400).json({ success: false, error: 'Dazu habe ich nichts gefunden' });
        }

        await MusicPlaylists.addTracks(id, ergebnis.titel, nutzer);
        res.json({ success: true, aufgenommen: ergebnis.titel.length, quelle: ergebnis.quelle });
    } catch (error) {
        fehler(res, error, 'Die Titel konnten nicht aufgenommen werden');
    }
});

router.delete('/:id/titel/:trackId', requirePermission('MUSIC.PLAYLISTS.MANAGE'), async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const trackId = parseInt(req.params.trackId, 10);

    if (Number.isNaN(id) || Number.isNaN(trackId)) {
        return res.status(400).json({ success: false, error: 'Ungueltige ID' });
    }

    try {
        // Ueber die Liste gehen, damit niemand fremde Guilds anfassen kann
        const liste = await MusicPlaylists.getWithTracks(id, res.locals.guildId);
        if (!liste) return res.status(404).json({ success: false, error: 'Liste nicht gefunden' });

        const erfolg = await MusicPlaylists.removeTrack(trackId, id);
        if (!erfolg) return res.status(404).json({ success: false, error: 'Titel nicht gefunden' });
        res.json({ success: true });
    } catch (error) {
        fehler(res, error, 'Der Titel konnte nicht entfernt werden');
    }
});

/**
 * Eine ganze Liste in die Warteschlange werfen.
 */
router.post('/:id/abspielen', requirePermission('MUSIC.PLAY'), async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const ipcServer = ServiceManager.get('ipcServer');

    if (Number.isNaN(id)) return res.status(400).json({ success: false, error: 'Ungueltige ID' });
    if (!ipcServer) return res.status(503).json({ success: false, error: 'Der Bot ist nicht erreichbar' });

    try {
        const liste = await MusicPlaylists.getWithTracks(id, res.locals.guildId);
        if (!liste) return res.status(404).json({ success: false, error: 'Liste nicht gefunden' });
        if (liste.tracks.length === 0) {
            return res.status(400).json({ success: false, error: 'Diese Liste ist leer' });
        }

        // Titel einzeln uebergeben - der Bot kennt die Datenbank nicht
        let aufgenommen = 0;
        for (const t of liste.tracks) {
            const antworten = await ipcServer.broadcast('music:addTrack', {
                guildId: res.locals.guildId,
                eingabe: t.url,
                angefordertVon: angemeldeterNutzer(req, res),
                anfang: false
            });
            if (antworten?.[0]?.success) aufgenommen += antworten[0].aufgenommen || 0;
            else if (aufgenommen === 0) {
                // Schon der erste ging nicht durch - meist steht der Bot in
                // keinem Sprachkanal. Dann brechen wir gleich ab.
                return res.status(400).json({ success: false, error: antworten?.[0]?.error || 'Aufnahme fehlgeschlagen' });
            }
        }

        res.json({ success: true, aufgenommen });
    } catch (error) {
        fehler(res, error, 'Die Liste konnte nicht abgespielt werden');
    }
});

module.exports = router;
