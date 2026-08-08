/**
 * Musik - Wiedergabe vom Dashboard aus steuern
 *
 * Jede Route reicht den Vorgang ueber IPC an den Bot weiter; der Ton lebt
 * dort, nicht hier.
 *
 * @module music/dashboard/routes/control
 */

const express = require('express');
const router = express.Router();
const { ServiceManager } = require('dunebot-core');
const { requirePermission } = require('../../../../apps/dashboard/middlewares/permissions.middleware');
const { zustandHolen, steuern, angemeldeterNutzer, fehler, auspacken } = require('./_shared');

/** Zustand abfragen - davon lebt die laufende Anzeige der Uebersicht. */
router.get('/state', requirePermission('MUSIC.VIEW'), async (req, res) => {
    try {
        res.json({ success: true, zustand: await zustandHolen(res.locals.guildId) });
    } catch (error) {
        fehler(res, error, 'Der Zustand konnte nicht gelesen werden');
    }
});

/** Die einfachen Vorgaenge ohne Beiwert. */
const EINFACH = ['pause', 'fortsetzen', 'stoppen', 'trennen', 'mischen'];

EINFACH.forEach(vorgang => {
    router.post(`/${vorgang}`, requirePermission('MUSIC.CONTROL'), (req, res) => {
        return steuern(res, res.locals.guildId, vorgang);
    });
});

router.post('/ueberspringen', requirePermission('MUSIC.CONTROL'), (req, res) => {
    return steuern(res, res.locals.guildId, 'ueberspringen', req.body.anzahl || 1);
});

router.post('/lautstaerke', requirePermission('MUSIC.CONTROL'), (req, res) => {
    const wert = parseInt(req.body.wert, 10);
    if (Number.isNaN(wert) || wert < 0 || wert > 200) {
        return res.status(400).json({ success: false, error: 'Die Lautstaerke muss zwischen 0 und 200 liegen' });
    }
    return steuern(res, res.locals.guildId, 'lautstaerke', wert);
});

router.post('/wiederholung', requirePermission('MUSIC.CONTROL'), (req, res) => {
    return steuern(res, res.locals.guildId, 'wiederholung', req.body.modus);
});

router.post('/filter', requirePermission('MUSIC.CONTROL'), (req, res) => {
    return steuern(res, res.locals.guildId, 'filter', req.body.name);
});

router.post('/dauerbetrieb', requirePermission('MUSIC.SETTINGS.EDIT'), (req, res) => {
    return steuern(res, res.locals.guildId, 'dauerbetrieb', Boolean(req.body.an));
});

router.post('/autoplay', requirePermission('MUSIC.SETTINGS.EDIT'), (req, res) => {
    return steuern(res, res.locals.guildId, 'autoplay', Boolean(req.body.an));
});

router.delete('/warteschlange/:position', requirePermission('MUSIC.CONTROL'), (req, res) => {
    const position = parseInt(req.params.position, 10);
    if (Number.isNaN(position) || position < 0) {
        return res.status(400).json({ success: false, error: 'Ungueltige Position' });
    }
    return steuern(res, res.locals.guildId, 'entfernen', position);
});

router.post('/verschieben', requirePermission('MUSIC.CONTROL'), (req, res) => {
    const von = parseInt(req.body.von, 10);
    const nach = parseInt(req.body.nach, 10);
    if (Number.isNaN(von) || Number.isNaN(nach)) {
        return res.status(400).json({ success: false, error: 'von und nach sind erforderlich' });
    }
    return steuern(res, res.locals.guildId, 'verschieben', { von, nach });
});

/**
 * Etwas in die Warteschlange legen.
 *
 * Setzt voraus, dass der Bot schon in einem Sprachkanal steht - vom Dashboard
 * aus laesst sich keiner betreten, weil dort niemand sitzt, dem man folgen
 * koennte.
 */
router.post('/hinzufuegen', requirePermission('MUSIC.PLAY'), async (req, res) => {
    const ipcServer = ServiceManager.get('ipcServer');
    const eingabe = String(req.body.eingabe || '').trim();

    if (!eingabe) return res.status(400).json({ success: false, error: 'Es fehlt eine Adresse oder ein Suchbegriff' });
    if (!ipcServer) return res.status(503).json({ success: false, error: 'Der Bot ist nicht erreichbar' });

    try {
        const ergebnis = auspacken(await ipcServer.broadcast('music:addTrack', {
            guildId: res.locals.guildId,
            eingabe,
            angefordertVon: angemeldeterNutzer(req, res),
            anfang: Boolean(req.body.anfang)
        }));

        if (!ergebnis.success) {
            return res.status(400).json({ success: false, error: ergebnis.error || 'Nichts gefunden' });
        }
        return res.json({ success: true, ...ergebnis });
    } catch (error) {
        fehler(res, error, 'Der Titel konnte nicht aufgenommen werden');
    }
});

module.exports = router;
