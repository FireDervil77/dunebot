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
 * Stufe 2 (Probestart):
 *   POST /:kennung/start                Startteil + RAM/CPU speichern
 *   POST /:kennung/starten              speichern (wenn mitgeschickt) und starten
 *   POST /:kennung/stoppen              Stoppfolge des Entwurfs fahren
 *   POST /:kennung/eingabe              eine Zeile in die Konsole des Spiels
 *   POST /:kennung/ports                beobachteten Port übernehmen
 *   POST /:kennung/ports/:zweck/entfernen
 *   POST /:kennung/bereitschaftszeile   Konsolenzeile als ready_when.log_line
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

const RE_STOPP = /^(save|sigint|sigterm|sigkill|command:.+|rcon:.+)$/;
const SIGNALE = ['sigint', 'sigterm', 'sigkill'];

/**
 * Den Startteil aus dem Formular bauen — in der Form des Schemas.
 *
 *   Argumente   eine Zeile = EIN argv-Eintrag (`parts`), Verweise wie
 *               {{port:game}} bleiben darin stehen und werden erst beim Start
 *               eingesetzt. Keine Shell: Leerzeichen trennen nichts.
 *   Stoppfolge  eine Zeile = `schritt [frist] [beendet|weiter]`. Signale
 *               beenden immer; bei command:/rcon: sagt man es dazu, sonst
 *               meldet der Auftragsbau die fehlende Angabe als Lücke.
 */
function startAusFormular(b) {
    // Zahlen zählen mit — die Nutzlast kommt als JSON, nicht nur aus Textfeldern.
    const text = (k) => (typeof b[k] === 'string' ? b[k] : typeof b[k] === 'number' ? String(b[k]) : '');
    const zeilen = (k) => text(k).split(/\r?\n/).map(z => z.trim()).filter(Boolean);
    const start = { program: text('program').trim() };
    if (text('workdir').trim()) start.workdir = text('workdir').trim();

    const args = zeilen('args');
    if (args.length) start.args = args.map((z, i) => ({ key: `arg${i + 1}`, parts: [{ text: z }] }));

    const folge = zeilen('stop').map((z) => {
        const m = z.match(/^(.+?)(?:\s+(\d+))?(?:\s+(beendet|weiter))?$/);
        const step = m[1].trim();
        if (!RE_STOPP.test(step)) {
            throw new Error(`Stoppfolge: „${step}" — erlaubt sind sigint, sigterm, sigkill, command:…, rcon:…`);
        }
        const eintrag = { step };
        if (m[2]) eintrag.timeout_sec = Number(m[2]);
        if (m[3]) eintrag.terminates = m[3] === 'beendet';
        else if (SIGNALE.includes(step)) eintrag.terminates = true;
        return eintrag;
    });
    // Dieselbe Regel wie Job.Validate im Daemon und in fb-init: Ohne sigkill am
    // Ende wird der Auftrag gar nicht erst abgelegt. Hier gesagt, wo sie getippt
    // wird — nicht erst als „Beendet mit Code -1".
    if (!folge.length) throw new Error('Stoppfolge fehlt — mindestens „sigkill 10".');
    if (folge[folge.length - 1].step !== 'sigkill') {
        throw new Error('Die Stoppfolge muss mit sigkill enden (letztes Mittel), etwa „sigkill 10" als letzte Zeile.');
    }
    start.stop = { sequence: folge };

    const bereit = {};
    if (text('ready_port').trim()) bereit.port = text('ready_port').trim();
    if (text('log_line').trim()) bereit.log_line = text('log_line').trim();
    const frist = Number(text('timeout_sec'));
    if (Number.isInteger(frist) && frist > 0) bereit.timeout_sec = frist;
    if (Object.keys(bereit).length) start.ready_when = bereit;
    return start;
}

/** Die Gegenrichtung für die Vorbelegung des Formulars. */
function startAlsFormular(start) {
    const s = start || {};
    const argZeile = (a) => (a.parts ? a.parts.map(t => t.text).join('') : [].concat(a.form || []).join(' '));
    const stoppZeile = (e) => {
        const x = typeof e === 'string' ? { step: e } : e;
        return [x.step, x.timeout_sec || '', SIGNALE.includes(x.step) || x.terminates === undefined ? '' : (x.terminates ? 'beendet' : 'weiter')]
            .filter(v => v !== '').join(' ');
    };
    const log = s.ready_when?.log_line;
    return {
        program: s.program || '', workdir: s.workdir || '',
        args: (s.args || []).map(argZeile).join('\n'),
        // Leer: die übliche Folge vorschlagen — sichtbar im Feld, nicht still ergänzt.
        stop: (s.stop?.sequence || []).map(stoppZeile).join('\n') || 'sigint 30\nsigkill 10',
        ready_port: s.ready_when?.port || '',
        log_line: Array.isArray(log) ? log[0] : (log || ''),
        timeout_sec: s.ready_when?.timeout_sec || '',
    };
}

async function offeneSitzung(req, res) {
    const sitzung = await Sitzungen.laden(res.locals.guildId, req.params.kennung);
    if (!sitzung || sitzung.status !== 'offen') throw new Error('Sitzung nicht gefunden');
    return sitzung;
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
        const [liste, laeufe] = await Promise.all([Sitzungen.schritte(sitzung.id), Sitzungen.laeufe(sitzung.id)]);
        const maschine = (await Sitzungen.maschinen(guildId)).find(m => m.id === sitzung.rootserver_id) || null;
        const entwurf = Sitzungen.entwurfAlsPaket(sitzung, liste);
        return await renderView(res, 'guild/werkbank-sitzung', {
            guildId, sitzung, schritte: liste, maschine,
            schritttypen: Sitzungen.SCHRITTTYPEN,
            entwurf,
            ungenutztePorts: Sitzungen.ungenutztePorts(entwurf),
            startFormular: startAlsFormular(sitzung.entwurf?.start),
            werkbankTeil: Sitzungen.werkbankTeil(sitzung),
            laeufe,
            // Die Adresse trägt die Kennung und trifft keinen Menüpunkt — ohne
            // Angabe klappte die Seitenleiste zu (check-navigation-treffer).
            activeMenu: `/guild/${guildId}/plugins/werkbank`,
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

// ── Probestart (Stufe 2) ─────────────────────────────────────────────────────
router.post('/:kennung/start', requirePermission('WERKBANK.BAUEN'), async (req, res) => {
    try {
        const sitzung = await offeneSitzung(req, res);
        await Sitzungen.startSpeichern(sitzung, {
            start: startAusFormular(req.body || {}),
            memory_mb: req.body?.memory_mb, cpu_prozent: req.body?.cpu_prozent,
        });
        return res.json({ success: true });
    } catch (error) {
        return fehler(res, error, 'Startteil nicht gespeichert', 400);
    }
});

router.post('/:kennung/starten', requirePermission('WERKBANK.BAUEN'), async (req, res) => {
    try {
        const sitzung = await offeneSitzung(req, res);
        // Mit Formular: erst speichern — gestartet wird, was auf dem Bildschirm steht.
        if (req.body?.program !== undefined) {
            await Sitzungen.startSpeichern(sitzung, {
                start: startAusFormular(req.body),
                memory_mb: req.body.memory_mb, cpu_prozent: req.body.cpu_prozent,
            });
        }
        const ergebnis = await Sitzungen.starten(sitzung, await Sitzungen.schritte(sitzung.id));
        return res.json({ success: true, ...ergebnis });
    } catch (error) {
        return fehler(res, error, 'Nicht gestartet', 400);
    }
});

router.post('/:kennung/stoppen', requirePermission('WERKBANK.BAUEN'), async (req, res) => {
    try {
        await Sitzungen.stoppen(await offeneSitzung(req, res));
        return res.json({ success: true });
    } catch (error) {
        return fehler(res, error, 'Nicht gestoppt', 400);
    }
});

router.post('/:kennung/eingabe', requirePermission('WERKBANK.BAUEN'), async (req, res) => {
    try {
        await Sitzungen.eingabe(await offeneSitzung(req, res), req.body?.zeile);
        return res.json({ success: true });
    } catch (error) {
        return fehler(res, error, 'Eingabe nicht zugestellt', 400);
    }
});

router.post('/:kennung/ports', requirePermission('WERKBANK.BAUEN'), async (req, res) => {
    try {
        await Sitzungen.portUebernehmen(await offeneSitzung(req, res), {
            zweck: req.body?.zweck, protocol: req.body?.protocol, port: req.body?.port,
        });
        return res.json({ success: true });
    } catch (error) {
        return fehler(res, error, 'Port nicht übernommen', 400);
    }
});

router.post('/:kennung/ports/:zweck/entfernen', requirePermission('WERKBANK.BAUEN'), async (req, res) => {
    try {
        await Sitzungen.portEntfernen(await offeneSitzung(req, res), String(req.params.zweck));
        return res.json({ success: true });
    } catch (error) {
        return fehler(res, error, 'Port nicht entfernt', 400);
    }
});

router.post('/:kennung/bereitschaftszeile', requirePermission('WERKBANK.BAUEN'), async (req, res) => {
    try {
        await Sitzungen.bereitschaftszeile(await offeneSitzung(req, res), req.body?.zeile);
        return res.json({ success: true });
    } catch (error) {
        return fehler(res, error, 'Zeile nicht übernommen', 400);
    }
});

module.exports = router;
module.exports.schrittAusFormular = schrittAusFormular;
module.exports.startAusFormular = startAusFormular;
module.exports.startAlsFormular = startAlsFormular;
