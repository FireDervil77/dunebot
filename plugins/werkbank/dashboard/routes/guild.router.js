/**
 * Werkbank — Sitzungen und Schritte (Stufe 1).
 *
 *   GET  /                              Sitzungen, neue anlegen
 *   POST /sitzungen                     anlegen → { kennung }
 *   GET  /events?sitzung=<kennung>      Live-Ausgabe (SSE, Namensraum `werkbank`)
 *   GET  /:kennung                      eine Sitzung: Schritte, Ausgabe, Entwurf
 *   POST /:kennung/schritte             einen Schritt ausführen
 *   POST /:kennung/schritte/:id/herausnehmen
 *   POST /:kennung/verwerfen            Volume löschen, Sitzung schließen
 *
 * @module werkbank/routes/guild
 */

const express = require('express');
const router = express.Router({ mergeParams: true });
const { ServiceManager } = require('dunebot-core');
const { requirePermission } = require('../../../../apps/dashboard/middlewares/permissions.middleware');
const { renderView, renderFehler, fehler } = require('./_shared');
const Sitzungen = require('../helpers/Sitzungen');

function nutzerId(req, res) {
    return res.locals.user?.id || req.session?.user?.info?.id || null;
}

/**
 * Aus dem Formular einen Schritt bauen — nur die Felder, die zum Typ gehören.
 *
 * Alles andere fällt weg, statt beim Daemon als unbekanntes Feld ignoriert zu
 * werden: Was hier nicht steht, soll im Entwurf auch nicht stehen. Zahlen und
 * Ja/Nein kommen als Text aus dem Formular und werden hier umgewandelt.
 */
function schrittAusFormular(b) {
    const text = (k) => (typeof b[k] === 'string' ? b[k] : '');
    const zahl = (k) => (b[k] === '' || b[k] === undefined ? undefined : Number(b[k]));
    const janein = (k) => b[k] === true || b[k] === 'true' || b[k] === 'on' || b[k] === '1';
    const s = { type: String(b.type || '') };
    const beschreibung = text('beschreibung').trim();
    if (beschreibung) s.description = { de: beschreibung };

    switch (s.type) {
        case 'script':
            s.script = text('script');
            if (text('reason').trim()) s.reason = { de: text('reason').trim() };
            break;
        case 'mkdir':
            s.path = text('path').trim();
            break;
        case 'download':
            s.url = text('url').trim();
            s.target = text('target').trim();
            s.checksum = text('checksum').trim().toLowerCase();
            break;
        case 'extract':
            s.archive = text('archive').trim();
            if (text('target').trim()) s.target = text('target').trim();
            if (zahl('strip_components') !== undefined) s.strip_components = zahl('strip_components');
            s.delete_archive = janein('delete_archive');
            break;
        case 'template':
            s.file = text('file').trim();
            s.content = text('content');
            s.only_if_missing = janein('only_if_missing');
            break;
        case 'steamcmd':
            s.app = zahl('app');
            if (text('branch').trim()) s.branch = text('branch').trim();
            s.validate = janein('validate');
            break;
    }
    return s;
}

// ── Übersicht ────────────────────────────────────────────────────────────────
router.get('/', requirePermission('WERKBANK.VIEW'), async (req, res) => {
    const guildId = res.locals.guildId;
    try {
        const [sitzungen, images, maschinen] = await Promise.all([
            Sitzungen.liste(guildId), Sitzungen.waehlbareImages(), Sitzungen.maschinen(guildId),
        ]);
        return await renderView(res, 'guild/werkbank-uebersicht', { guildId, sitzungen, images, maschinen });
    } catch (error) {
        return renderFehler(res, error, 'Die Werkbank konnte nicht geladen werden');
    }
});

router.post('/sitzungen', requirePermission('WERKBANK.BAUEN'), async (req, res) => {
    try {
        const kennung = await Sitzungen.anlegen({
            guildId: res.locals.guildId, userId: nutzerId(req, res),
            name: req.body?.name, rootserverId: req.body?.rootserver_id, image: req.body?.image,
        });
        return res.json({ success: true, kennung });
    } catch (error) {
        return fehler(res, error, 'Sitzung nicht angelegt', 400);
    }
});

// ── Live-Ausgabe ─────────────────────────────────────────────────────────────
router.get('/events', requirePermission('WERKBANK.VIEW'), (req, res) => {
    const sseManager = ServiceManager.get('sseManager');
    const kennung = String(req.query.sitzung || '');
    if (!Sitzungen.RE_KENNUNG.test(kennung)) {
        return res.status(400).json({ success: false, message: 'sitzung fehlt' });
    }
    const clientId = `werkbank-${nutzerId(req, res) || 'anon'}-${Date.now()}`;
    sseManager.addClient(res.locals.guildId, clientId, res, {
        // Nur die eigene Sitzung — und nur Werkbank-Ereignisse: Über dieselbe
        // Guild laufen auch Messwerte der Gameserver.
        filter: (m) => m.namespace === 'werkbank' && m.data?.sitzung_id === kennung,
        metadata: { source: 'werkbank', sitzung: kennung },
    });
});

// ── Eine Sitzung ─────────────────────────────────────────────────────────────
router.get('/:kennung', requirePermission('WERKBANK.VIEW'), async (req, res) => {
    const guildId = res.locals.guildId;
    try {
        const sitzung = await Sitzungen.laden(guildId, req.params.kennung);
        if (!sitzung || sitzung.status !== 'offen') {
            return res.redirect(`/guild/${guildId}/plugins/werkbank`);
        }
        const liste = await Sitzungen.schritte(sitzung.id);
        const maschine = (await Sitzungen.maschinen(guildId)).find(m => m.id === sitzung.rootserver_id) || null;
        return await renderView(res, 'guild/werkbank-sitzung', {
            guildId, sitzung, schritte: liste, maschine,
            schritttypen: Sitzungen.SCHRITTTYPEN,
            entwurf: Sitzungen.entwurfAlsPaket(sitzung, liste),
        });
    } catch (error) {
        return renderFehler(res, error, 'Die Sitzung konnte nicht geladen werden');
    }
});

router.post('/:kennung/schritte', requirePermission('WERKBANK.BAUEN'), async (req, res) => {
    try {
        const sitzung = await Sitzungen.laden(res.locals.guildId, req.params.kennung);
        if (!sitzung || sitzung.status !== 'offen') throw new Error('Sitzung nicht gefunden');
        const ergebnis = await Sitzungen.schrittAusfuehren({ sitzung, schritt: schrittAusFormular(req.body || {}) });
        return res.json({ success: true, ...ergebnis });
    } catch (error) {
        return fehler(res, error, 'Schritt nicht ausgeführt', 400);
    }
});

router.post('/:kennung/schritte/:id/herausnehmen', requirePermission('WERKBANK.BAUEN'), async (req, res) => {
    try {
        const sitzung = await Sitzungen.laden(res.locals.guildId, req.params.kennung);
        if (!sitzung) throw new Error('Sitzung nicht gefunden');
        await Sitzungen.herausnehmen(sitzung, Number(req.params.id));
        return res.json({ success: true });
    } catch (error) {
        return fehler(res, error, 'Schritt nicht herausgenommen', 400);
    }
});

router.post('/:kennung/verwerfen', requirePermission('WERKBANK.BAUEN'), async (req, res) => {
    try {
        const sitzung = await Sitzungen.laden(res.locals.guildId, req.params.kennung);
        if (!sitzung) throw new Error('Sitzung nicht gefunden');
        await Sitzungen.verwerfen(sitzung);
        return res.json({ success: true });
    } catch (error) {
        return fehler(res, error, 'Sitzung nicht verworfen', 400);
    }
});

module.exports = router;
module.exports.schrittAusFormular = schrittAusFormular;
