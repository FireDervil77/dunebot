/**
 * Admin: Spiele-Marktplatz (Anker der Spielpakete in addon_marketplace)
 *
 * Endpoints:
 *   GET    /admin/addons              — Übersicht
 *   GET    /admin/addons/imagestand   — je Paket: angeheftetes Image gegen den neuesten Bau (JSON)
 *   GET    /admin/addons/umzug        — je Paket: der jüngste Umzug auf einen neuen Bau (JSON)
 *   POST   /admin/addons/umzug        — Pakete umziehen: prüfen und als neue Fassung in `test` einliefern
 *   POST   /admin/addons/umzug/freigeben          — alle umgezogenen Fassungen freigeben
 *   POST   /admin/addons/umzug/:kennung/abbrechen — einen wartenden oder hängenden Umzug beenden
 *   GET    /admin/addons/:id          — Detail: Name, Beschreibung, Tags, Freigabe
 *   PUT    /admin/addons/:id          — Name, Beschreibung, Tags speichern
 *   POST   /admin/addons/:id/fassungen/:fassungId/freigeben      — Paketfassung test → stable
 *   POST   /admin/addons/:id/fassungen/:fassungId/zuruecknehmen  — Paketfassung stable → test
 *   DELETE /admin/addons/:id          — Löschen (nie den Anker eines Pakets)
 *   GET    /admin/addons/:id/entfernen — was am Entfernen eines Spielpakets hängt (JSON)
 *   POST   /admin/addons/:id/entfernen — das Paket samt Fassungen, Anker, Tags und Werkbank-Sitzungen entfernen
 *
 * Bis zum 2026-09-26 standen hier auch Egg-Import (Pelican-Repositories),
 * Anlegen, JSON-Einfügen, ein game_data-Editor und ein Test-Knopf, der nur
 * einen Zeitstempel setzte. Alles davon schrieb FIREBOT_v2 — seit dem
 * 2026-09-10 startet der Daemon nur Server mit Spielpaket. Neue Spiele
 * entstehen in der Werkbank (Egg-Rückbau B, Baustelle 166).
 *
 * Bis zum 2026-10-08 gab es dazu `POST /:id/approve` („SuperAdmin Approval"):
 * Es setzte `status`, `trust_level` und `visibility`. Der Prüfablauf dahinter
 * (draft → pending_review → approved) ist nie gelaufen — die Einlieferung legt
 * jeden Anker als `approved`/`public` an, und die Vertrauensstufe wurde für
 * den einzigen Autor ohnehin auf `official` überschrieben. Was ein Spiel
 * freigibt, ist die Freigabe einer Fassung; eine zweite daneben war eine
 * Auskunft, die nichts bedeutete.
 *
 * @author FireDervil
 */

'use strict';

const express = require('express');
const router = express.Router();
const { ServiceManager } = require('dunebot-core');

// Die Freigabe einer Paketfassung (Baustelle 172). Die Regel — was freigegeben
// werden darf und was ein Server danach bekommt — steht im Gameserver-Plugin an
// EINER Stelle; hier ist nur der Knopf. Er gehört in den Adminbereich, weil eine
// Freigabe alle Guilds betrifft, nicht die, in der gerade jemand sitzt.
const Paketfassung = require('../../../../plugins/gameserver/dashboard/helpers/Paketfassung');
// Hängt ein Paket am neuesten Bau seines Images? (Baustelle 177.) Gleicher Ort,
// gleicher Grund: Ein Image-Stand betrifft alle Guilds.
const Imagestand = require('../../../../plugins/gameserver/dashboard/helpers/Imagestand');
// Ein Paket auf den neuesten Bau umziehen, ohne die Handgriffe in der Werkbank.
// Die Kette selbst gehört der Werkbank (ihre Sitzungen, ihr Prüfdurchlauf);
// hier sind die Knöpfe — aus demselben Grund wie die Freigabe: alle Guilds.
const Umzug = require('../../../../plugins/werkbank/dashboard/helpers/Umzug');
const WerkbankSitzungen = require('../../../../plugins/werkbank/dashboard/helpers/Sitzungen');
// Ein Paket ganz entfernen (Baustelle 178) — samt seiner Werkbank-Sitzungen.
const PaketEntfernen = require('../../../../plugins/gameserver/dashboard/helpers/PaketEntfernen');

// Tags kommen aus der Tag-Bibliothek (helpers/Tags.js) — nicht mehr aus dem
// Kommafeld `addon_marketplace.tags`.
const Tags = require('../../helpers/Tags');

// ─────────────────────────────────────────────────────────────────────────────
// GET /admin/addons — Übersicht
// ─────────────────────────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
    const Logger       = ServiceManager.get('Logger');
    const dbService    = ServiceManager.get('dbService');
    const themeManager = ServiceManager.get('themeManager');

    res.locals.layout = themeManager.getLayout('guild');

    try {
        const addons = await dbService.query(
            'SELECT id, name, slug, created_at FROM addon_marketplace ORDER BY name ASC');

        // Freigegeben oder Entwurf — aus den Fassungen, nicht aus einer Spalte am
        // Anker. Ein Fehler hier darf nicht wie „alles Entwürfe" aussehen: Dann
        // bleibt die Spalte leer, und die Seite sagt, warum.
        let freigabeFehler = null;
        try {
            const stand = await Paketfassung.freigabeJePaket(dbService);
            for (const a of addons) a.freigabe = stand[a.id] || { fassungen: 0, freigegeben: null };
        } catch (err) {
            freigabeFehler = err.message;
            Logger.error('[Addons] Freigabestand laden fehlgeschlagen:', err);
        }

        const stats = {
            total:       addons.length,
            freigegeben: freigabeFehler ? null : addons.filter(a => a.freigabe.freigegeben).length,
            entwuerfe:   freigabeFehler ? null : addons.filter(a => !a.freigabe.freigegeben).length,
        };

        await themeManager.renderView(res, 'admin/addons/index', { addons, stats, freigabeFehler, pageTitle: 'Spiele-Marktplatz' });

    } catch (err) {
        Logger.error('[Addons] Fehler Übersicht:', err);
        res.status(500).render('error', { message: 'Fehler beim Laden der Addons', error: err });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /admin/addons/imagestand — welche Pakete liegen hinter dem neuesten Bau?
// ─────────────────────────────────────────────────────────────────────────────
//
// Eigene Abfrage statt Teil der Übersicht: Sie fragt einen Daemon, und der
// zieht ein Image, das ihm fehlt — das kann dauern. Die Liste soll sofort
// stehen; die Spalte füllt sich nach.
//
// MUSS vor `/:id` stehen — sonst wäre „imagestand" eine Kennung.
//
// Immer 200, auch ohne Daemon: `fehler` sagt, warum nichts verglichen wurde,
// und jedes Paket steht dann auf „unbekannt". Ein 500 sähe auf der Seite aus
// wie eine leere Spalte.
router.get('/imagestand', async (req, res) => {
    const Logger    = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    try {
        const stand = await Imagestand.stand(dbService);
        // Umgezogen wird in der Werkbank, und die gibt es in der Guild des Betreibers.
        const werkbank = process.env.CONTROL_GUILD_ID ? `/guild/${process.env.CONTROL_GUILD_ID}/plugins/werkbank` : null;
        return res.json({ success: true, ...stand, werkbank });
    } catch (err) {
        Logger.error('[Addons] Image-Stand laden fehlgeschlagen:', err);
        return res.status(500).json({ success: false, message: `Der Image-Stand ließ sich nicht laden: ${err.message}` });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// Umzug auf den neuesten Bau (2026-10-10) — MUSS ebenfalls vor `/:id` stehen.
//
// Umgezogen wird in der Guild des Betreibers: Dort gibt es die Werkbank, ihre
// Sitzungen und die Maschinen, auf denen ein Prüfdurchlauf laufen darf.
// ─────────────────────────────────────────────────────────────────────────────
function umzugsGuild() {
    const guildId = process.env.CONTROL_GUILD_ID;
    if (!guildId) throw new Error('CONTROL_GUILD_ID ist nicht gesetzt — ohne die Guild des Betreibers gibt es keine Werkbank, in der umgezogen wird.');
    return guildId;
}

router.get('/umzug', async (req, res) => {
    try {
        const guildId = umzugsGuild();
        const [stand, maschinen] = await Promise.all([Umzug.stand(), WerkbankSitzungen.maschinen(guildId)]);
        return res.json({ success: true, ...stand,
            maschinen: maschinen.map(m => ({ id: m.id, name: m.name, online: m.online })),
            werkbank: `/guild/${guildId}/plugins/werkbank` });
    } catch (err) {
        ServiceManager.get('Logger').error('[Addons] Umzugsstand laden fehlgeschlagen:', err);
        return res.status(500).json({ success: false, message: `Der Stand der Umzüge ließ sich nicht laden: ${err.message}` });
    }
});

router.post('/umzug', async (req, res) => {
    const Logger    = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    try {
        const guildId = umzugsGuild();
        // Umgezogen wird nur, was wirklich zurückliegt — das entscheidet der
        // Image-Stand hier, nicht die Liste aus dem Browser. Ein „Umzug" auf
        // den Bau, an dem das Paket schon hängt, wäre eine Fassung ohne Inhalt.
        const image = await Imagestand.stand(dbService);
        if (image.fehler) throw new Error(image.fehler);
        const zurueck = new Set(image.pakete.filter(p => p.stand === Imagestand.STAND.neuerBau).map(p => Number(p.paket_id)));
        const gewuenscht = req.body?.pakete === 'alle'
            ? [...zurueck]
            : (Array.isArray(req.body?.pakete) ? req.body.pakete.map(Number) : []);
        const paketIds = gewuenscht.filter(id => zurueck.has(id));
        if (!paketIds.length) {
            throw new Error(gewuenscht.length
                ? 'Keines der gewählten Pakete liegt hinter dem neuesten Bau.'
                : 'Kein Paket liegt hinter dem neuesten Bau — es gibt nichts umzuziehen.');
        }
        const maschinen = await WerkbankSitzungen.maschinen(guildId);
        const maschine = req.body?.rootserver_id
            ? maschinen.find(m => String(m.id) === String(req.body.rootserver_id))
            : maschinen.find(m => m.online);
        if (!maschine) throw new Error('Keine Maschine der Betreiber-Guild ist erreichbar — der Prüfdurchlauf braucht eine.');
        if (!maschine.online) throw new Error(`Der Daemon von „${maschine.name}" ist nicht erreichbar.`);

        const nutzer = res.locals.user || {};
        const ergebnis = await Umzug.anstossen({
            paketIds, guildId, rootserverId: maschine.id,
            userId: nutzer.id || null,
            autor: nutzer.username || nutzer.global_name || null,
        });
        Logger.info(`[Addons] Umzug angestoßen auf „${maschine.name}": ${ergebnis.vorgemerkt.map(v => `${v.slug} ${v.von}→${v.nach}`).join(', ') || 'nichts'}`
            + (ergebnis.abgelehnt.length ? ` — abgelehnt: ${ergebnis.abgelehnt.map(a => `${a.slug} (${a.grund})`).join('; ')}` : ''));
        const n = ergebnis.vorgemerkt.length;
        return res.status(n ? 200 : 400).json({
            success: n > 0, ...ergebnis, maschine: maschine.name,
            message: n
                ? `${n} Paket${n === 1 ? ' zieht' : 'e ziehen'} um — ein Prüfdurchlauf nach dem anderen auf „${maschine.name}".`
                    + (ergebnis.abgelehnt.length ? ` Nicht vorgemerkt: ${ergebnis.abgelehnt.map(a => `${a.slug} (${a.grund})`).join('; ')}` : '')
                : `Nichts vorgemerkt: ${ergebnis.abgelehnt.map(a => `${a.slug} (${a.grund})`).join('; ')}`,
        });
    } catch (err) {
        return res.status(400).json({ success: false, message: err.message });
    }
});

// Der Freigabe-Klick für alle umgezogenen Fassungen auf einmal. Er bleibt ein
// Klick (Betreiber, 2026-10-09: „unsere Handschranke") — was freigebbar ist,
// entscheidet Umzug.stand(), und jede einzelne Freigabe geht durch dieselbe
// Regel wie der Knopf auf der Detailseite (Paketfassung.freigeben).
router.post('/umzug/freigeben', async (req, res) => {
    try {
        const r = await Umzug.freigeben({ userId: res.locals.user?.id || null });
        ServiceManager.get('Logger').info(`[Addons] Umgezogene Fassungen freigegeben: ${r.freigegeben.map(f => `${f.slug} ${f.version}`).join(', ') || 'keine'}`);
        if (!r.freigegeben.length && !r.nicht.length) {
            return res.status(400).json({ success: false, message: 'Es gibt keine umgezogene Fassung, die auf ihre Freigabe wartet.' });
        }
        return res.json({
            success: r.freigegeben.length > 0, ...r,
            message: (r.freigegeben.length ? `Freigegeben: ${r.freigegeben.map(f => `${f.slug} ${f.version}`).join(', ')}. Server auf „stable" nehmen sie beim nächsten Start.` : 'Nichts freigegeben.')
                + (r.nicht.length ? ` Nicht freigegeben: ${r.nicht.map(f => `${f.slug} ${f.version} (${f.grund})`).join('; ')}` : ''),
        });
    } catch (err) {
        return res.status(400).json({ success: false, message: err.message });
    }
});

router.post('/umzug/:kennung/abbrechen', async (req, res) => {
    try {
        if (!WerkbankSitzungen.RE_KENNUNG.test(String(req.params.kennung || ''))) throw new Error('Diese Kennung gibt es nicht.');
        await Umzug.abbrechen(req.params.kennung);
        return res.json({ success: true, message: 'Der Umzug ist abgebrochen.' });
    } catch (err) {
        return res.status(400).json({ success: false, message: err.message });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /admin/addons/:id — Detail + Edit
// ─────────────────────────────────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
    const Logger       = ServiceManager.get('Logger');
    const dbService    = ServiceManager.get('dbService');
    const themeManager = ServiceManager.get('themeManager');

    res.locals.layout = themeManager.getLayout('guild');

    try {
        const rows = await dbService.query(
            'SELECT * FROM addon_marketplace WHERE id = ?',
            [req.params.id]
        );

        if (!rows.length) {
            return res.status(404).render('error', { message: 'Addon nicht gefunden' });
        }

        const addon = rows[0];

        // Die Tags dieses Spiels und die ganze Bibliothek für die Vorschläge.
        // Ein Fehler hier darf nicht so aussehen, als hätte das Spiel keine Tags
        // — sonst speichert der nächste Klick eine leere Liste darüber.
        let alleTags = [], tagsFehler = null;
        try {
            addon.tags = await Tags.fuer(dbService, 'spiel', addon.id);
            alleTags = await Tags.alle(dbService);
        } catch (err) {
            addon.tags = [];
            tagsFehler = err.message;
            Logger.error('[Addons] Tags laden fehlgeschlagen:', err);
        }

        // Fassungen des Pakets (packages.id = addon_marketplace.id) und wie viele
        // Server welchem Kanal folgen. Ein Spiel ohne Paket hat keine — dann
        // bleibt die Karte bei einem Satz. Ein Fehler hier kostet die Karte,
        // nicht die Seite, wird aber gezeigt statt verschluckt.
        let fassungen = [], serverJeKanal = { stable: 0, test: 0 }, fassungenFehler = null;
        try {
            fassungen = await Paketfassung.fassungenZuPaket(dbService, addon.id);
            serverJeKanal = await Paketfassung.serverJeKanal(dbService, addon.id);
        } catch (err) {
            fassungenFehler = err.message;
            Logger.error('[Addons] Fassungen laden fehlgeschlagen:', err);
        }

        await themeManager.renderView(res, 'admin/addons/edit', {
            addon, alleTags, tagsFehler, fassungen, serverJeKanal, fassungenFehler, pageTitle: `Edit: ${addon.name}`,
        });

    } catch (err) {
        Logger.error('[Addons] Detail laden fehlgeschlagen:', err);
        res.status(500).render('error', { message: 'Fehler beim Laden', error: err });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// PUT /admin/addons/:id — Name, Beschreibung, Tags
//
// Der Slug bleibt fest: Über ihn findet die Einlieferung ihren Anker. Wer ihn
// hier änderte, legte beim nächsten Einliefern einen zweiten Anker an und
// trennte den ersten lautlos vom Paket.
// ─────────────────────────────────────────────────────────────────────────────
router.put('/:id', async (req, res) => {
    const Logger    = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    const { id }    = req.params;

    try {
        const { name, description, tags } = req.body;

        if (!name) {
            return res.status(400).json({ success: false, message: 'name ist erforderlich' });
        }

        // Erst prüfen, dann schreiben: Ein Tag, das nicht passt, soll nicht den
        // halben Eintrag speichern. `tags` fehlt in der Nutzlast (undefined) heisst
        // „nicht anfassen" — eine leere Liste heisst „keine Tags".
        if (tags !== undefined) Tags.bereinige(tags);

        await dbService.query(`
            UPDATE addon_marketplace
            SET name = ?, description = ?, updated_at = NOW()
            WHERE id = ?
        `, [name, description || '', id]);

        if (tags !== undefined) await Tags.setze(dbService, 'spiel', id, tags);

        Logger.info(`[Addons] Aktualisiert: ID ${id} → ${name}`);
        res.json({ success: true, message: 'Addon gespeichert' });

    } catch (err) {
        Logger.error('[Addons] Update fehlgeschlagen:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ────────────────────────────────────────────────────────
// POST /admin/addons/:id/fassungen/:fassungId/freigeben
// POST /admin/addons/:id/fassungen/:fassungId/zuruecknehmen
//
// Eine Paketfassung freigeben (test → stable) oder die Freigabe zurücknehmen.
// Freigegeben wird nur, was einen grünen Prüfdurchlauf hat (E-17) — die Prüfung
// steht in Paketfassung.js und kommt von dort als Satz zurück.
// ────────────────────────────────────────────────────────
router.post('/:id/fassungen/:fassungId/freigeben', async (req, res) => {
    const Logger    = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    try {
        const f = await Paketfassung.freigeben(dbService, {
            paketId: req.params.id, fassungId: req.params.fassungId,
            // `res.locals.user` IST schon `session.user.info` (auth.middleware).
            // Bis zum 2026-10-10 stand hier `.info.id` — immer leer; alle 20
            // Freigaben bis dahin tragen deshalb kein `released_by`.
            userId: res.locals.user?.id || null,
        });
        Logger.info(`[Addons] Paketfassung freigegeben: Paket ${req.params.id}, Fassung ${f.version}`);
        res.json({ success: true, message: `Fassung ${f.version} ist freigegeben. Server auf „stable" nehmen sie beim nächsten Start.` });
    } catch (err) {
        res.status(400).json({ success: false, message: err.message });
    }
});

router.post('/:id/fassungen/:fassungId/zuruecknehmen', async (req, res) => {
    const Logger    = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    try {
        const f = await Paketfassung.zuruecknehmen(dbService, {
            paketId: req.params.id, fassungId: req.params.fassungId,
        });
        Logger.info(`[Addons] Freigabe zurückgenommen: Paket ${req.params.id}, Fassung ${f.version}`);
        res.json({
            success: true,
            message: f.nochFreigegeben
                ? `Freigabe von ${f.version} zurückgenommen. Server auf „stable" nehmen die vorige freigegebene Fassung.`
                : `Freigabe von ${f.version} zurückgenommen. Es ist keine Fassung mehr freigegeben — Server auf „stable" lassen sich nicht starten, bis wieder eine freigegeben ist.`,
        });
    } catch (err) {
        res.status(400).json({ success: false, message: err.message });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// ───────────────────────────────────────────────────────────────────
// GET/POST /admin/addons/:id/entfernen — ein Spielpaket ganz entfernen
// ───────────────────────────────────────────────────────────────────
//
// Baustelle 178 (2026-10-09). `DELETE /:id` weist den Anker eines Pakets ab;
// hier geht das Paket SAMT Anker — mit seinen Fassungen, Tags und den
// Werkbank-Sitzungen, die zu ihm gehören. Im Adminbereich, weil ein Paket
// allen Guilds gehört.
//
// Regel und Reihenfolge stehen im Gameserver-Plugin (helpers/PaketEntfernen.js,
// Paketfassung.entfernen); hier sind nur die beiden Adressen. GET zeigt, was
// mitginge; POST verlangt den Namen des Pakets als Gegenprobe.

router.get('/:id/entfernen', async (req, res) => {
    const Logger    = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    try {
        return res.json({ success: true, ...(await PaketEntfernen.vorschau(dbService, req.params.id)) });
    } catch (err) {
        Logger.error('[Addons] Vorschau zum Entfernen fehlgeschlagen:', err);
        return res.status(500).json({ success: false, message: err.message });
    }
});

router.post('/:id/entfernen', async (req, res) => {
    const Logger    = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    try {
        const e = await PaketEntfernen.entfernen(dbService, { paketId: req.params.id, slug: req.body?.slug });
        Logger.info(`[Addons] Paket entfernt: ${e.slug} (ID ${req.params.id}) — ${e.weg.fassungen} Fassung(en), `
            + `${e.sitzungen.length} Werkbank-Sitzung(en)${e.sitzungen.length ? ': ' + e.sitzungen.join(', ') : ''}`);
        return res.json({ success: true, message: `„${e.slug}" ist entfernt: ${e.weg.fassungen} Fassung(en), ${e.sitzungen.length} Werkbank-Sitzung(en).`, ...e });
    } catch (err) {
        Logger.error('[Addons] Paket entfernen fehlgeschlagen:', err);
        return res.status(400).json({ success: false, message: err.message, sitzungen: err.sitzungen || [] });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
    const Logger    = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');

    try {
        const count = await dbService.query(
            'SELECT COUNT(*) as n FROM gameservers WHERE addon_marketplace_id = ?',
            [req.params.id]
        );
        if (count[0].n > 0) {
            return res.status(400).json({
                success: false,
                message: `${count[0].n} Server nutzen dieses Addon — zuerst Server löschen`,
            });
        }

        // Der Anker eines Spielpakets (packages.id = addon_marketplace.id) wird
        // hier nie gelöscht: Ohne ihn ist das Paket wählbar, aber nicht mehr
        // anlegbar (Fremdschlüssel gameservers → addon_marketplace).
        const paket = await dbService.query('SELECT slug FROM packages WHERE id = ?', [req.params.id]);
        if (paket.length) {
            return res.status(400).json({
                success: false,
                message: `Das ist der Anker des Spielpakets „${paket[0].slug}" — ohne ihn lässt sich kein Server mehr anlegen. Das ganze Paket entfernt „Paket entfernen" (POST /admin/addons/${req.params.id}/entfernen).`,
            });
        }

        await dbService.query('DELETE FROM addon_marketplace WHERE id = ?', [req.params.id]);
        Logger.info(`[Addons] Gelöscht: ID ${req.params.id}`);
        res.json({ success: true, message: 'Addon gelöscht' });

    } catch (err) {
        Logger.error('[Addons] Löschen fehlgeschlagen:', err);
        if (err.code === 'ER_ROW_IS_REFERENCED_2') {
            return res.status(400).json({
                success: false,
                message: 'Addon wird noch von einem Server referenziert',
            });
        }
        res.status(500).json({ success: false, message: err.message });
    }
});

module.exports = router;
