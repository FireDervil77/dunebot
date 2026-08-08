/**
 * Musik - Wiedergabelisten
 *
 * @module music/dashboard/routes/playlists
 */

const express = require('express');
const router = express.Router();
const { ServiceManager } = require('dunebot-core');
const { requirePermission } = require('../../../../apps/dashboard/middlewares/permissions.middleware');
const { MusicPlaylists, MusicHistory } = require('../../shared/models');
const { angemeldeterNutzer, fehler, auspacken, zustandHolen } = require('./_shared');

/**
 * Einen fertigen Titel in eine Liste legen.
 *
 * Fuer alles, was schon aufgeloest **vorliegt** - der laufende Titel, ein
 * Eintrag aus dem Verlauf. Der Umweg ueber `music:resolve` waere hier nicht nur
 * verschwendet, sondern gefaehrlich: eine zweite Suche kann einen **anderen**
 * Treffer liefern als den, den der Nutzer gerade sieht.
 *
 * Die Titeldaten kommen ausdruecklich **nicht** vom Browser, sondern werden
 * hier aus Verlauf oder Bot-Zustand geholt. Sonst koennte sich jeder beliebige
 * Zeilen in fremde Listen schreiben.
 *
 * @param {Object} res Express-Antwort
 * @param {number} listenId Ziel-Liste
 * @param {Object|null} titel Aufgeloester Titel
 * @param {string|null} nutzer Wer es veranlasst hat
 */
async function titelAblegen(res, listenId, titel, nutzer) {
    if (!titel) return res.status(404).json({ success: false, error: 'Diesen Titel gibt es nicht' });
    if (!titel.url) {
        return res.status(400).json({ success: false, error: 'Zu diesem Titel steht keine Quelle fest' });
    }

    const liste = await MusicPlaylists.getWithTracks(listenId, res.locals.guildId);
    if (!liste) return res.status(404).json({ success: false, error: 'Liste nicht gefunden' });

    await MusicPlaylists.addTracks(listenId, [titel], nutzer);
    return res.json({ success: true, aufgenommen: 1, liste: liste.name, titel: titel.title });
}

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

    const ipcServer = ServiceManager.get('ipcServer');
    if (!ipcServer) return res.status(503).json({ success: false, error: 'Der Bot ist nicht erreichbar' });

    try {
        const liste = await MusicPlaylists.getWithTracks(id, res.locals.guildId);
        if (!liste) return res.status(404).json({ success: false, error: 'Liste nicht gefunden' });

        const nutzer = angemeldeterNutzer(req, res);

        // Aufgeloest wird im Bot: dort liegen die Spotify-Zugangsdaten, und
        // sie sollen nicht in zwei .env-Dateien gepflegt werden muessen.
        const ergebnis = auspacken(await ipcServer.broadcast('music:resolve', {
            guildId: res.locals.guildId,
            eingabe,
            angefordertVon: nutzer
        }));

        if (!ergebnis.success || !Array.isArray(ergebnis.titel)) {
            return res.status(400).json({ success: false, error: ergebnis.error || 'Dazu habe ich nichts gefunden' });
        }

        await MusicPlaylists.addTracks(id, ergebnis.titel, nutzer);
        res.json({ success: true, aufgenommen: ergebnis.titel.length, quelle: ergebnis.quelle });
    } catch (error) {
        fehler(res, error, 'Die Titel konnten nicht aufgenommen werden');
    }
});

/**
 * Den laufenden Titel in eine Liste legen.
 *
 * Das war die Luecke im Player: man sah, was laeuft, und hatte keinen Weg, es
 * zu behalten.
 */
router.post('/:id/aktuell', requirePermission('MUSIC.PLAYLISTS.MANAGE'), async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ success: false, error: 'Ungueltige ID' });

    try {
        const zustand = await zustandHolen(res.locals.guildId);
        if (!zustand.botErreichbar) {
            return res.status(503).json({ success: false, error: 'Der Bot ist nicht erreichbar' });
        }
        if (!zustand.aktuell) {
            return res.status(400).json({ success: false, error: 'Gerade laeuft nichts' });
        }

        return await titelAblegen(res, id, zustand.aktuell, angemeldeterNutzer(req, res));
    } catch (error) {
        fehler(res, error, 'Der Titel konnte nicht aufgenommen werden');
    }
});

/**
 * Einen Eintrag aus dem Verlauf in eine Liste legen.
 *
 * Das Gegenstueck zu `/music history <Nummer>` im Discord - nur legt es den
 * Titel in eine Liste statt in die Warteschlange.
 */
router.post('/:id/verlauf/:verlaufId', requirePermission('MUSIC.PLAYLISTS.MANAGE'), async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const verlaufId = parseInt(req.params.verlaufId, 10);
    if (Number.isNaN(id) || Number.isNaN(verlaufId)) {
        return res.status(400).json({ success: false, error: 'Ungueltige ID' });
    }

    try {
        const e = await MusicHistory.getById(res.locals.guildId, verlaufId);

        // Der Verlauf spricht Unterstriche, die Listen sprechen Binnenmajuskel
        const titel = e ? {
            title: e.title, url: e.url, source: e.source,
            durationSec: e.duration_sec, thumbnail: e.thumbnail
        } : null;

        return await titelAblegen(res, id, titel, angemeldeterNutzer(req, res));
    } catch (error) {
        fehler(res, error, 'Der Titel konnte nicht aufgenommen werden');
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
            const ergebnis = auspacken(await ipcServer.broadcast('music:addTrack', {
                guildId: res.locals.guildId,
                eingabe: t.url,
                angefordertVon: angemeldeterNutzer(req, res),
                anfang: false
            }));

            if (ergebnis.success) aufgenommen += ergebnis.aufgenommen || 0;
            else if (aufgenommen === 0) {
                // Schon der erste ging nicht durch - meist steht der Bot in
                // keinem Sprachkanal. Dann brechen wir gleich ab.
                return res.status(400).json({ success: false, error: ergebnis.error || 'Aufnahme fehlgeschlagen' });
            }
        }

        res.json({ success: true, aufgenommen });
    } catch (error) {
        fehler(res, error, 'Die Liste konnte nicht abgespielt werden');
    }
});

module.exports = router;
