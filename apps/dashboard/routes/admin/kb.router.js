'use strict';

/**
 * Wissensdatenbank — die Verwaltung unter `/admin/kb` (2026-10-11).
 *
 * Ersetzt den Datei-Editor `/admin/docs`, der Markdown-Dateien in
 * `documentation/` schrieb. Bereiche und Artikel liegen in der Datenbank; was
 * gilt (Kürzel, Pflichtfelder, die Startseite, wer lesen darf), entscheidet
 * `helpers/Wissen.js` — dieser Router reicht nur durch und sagt den Satz
 * weiter, mit dem das Modul eine Eingabe abweist.
 *
 *   GET  /admin/kb                       Übersicht: Bereiche mit ihren Artikeln
 *   GET  /admin/kb/bereich/neu | /:id    Formular Bereich
 *   POST /admin/kb/bereich/speichern
 *   POST /admin/kb/bereich/:id/entfernen
 *   GET  /admin/kb/artikel/neu | /:id    Formular Artikel
 *   POST /admin/kb/artikel/speichern
 *   POST /admin/kb/artikel/:id/entfernen
 *   POST /admin/kb/vorschau              Markdown → HTML, wie die Seite es zeigt
 *
 * Hinter `CheckAuth` und `CheckAdmin` (eingehängt in admin.router.js).
 */

const { Router } = require('express');
const { ServiceManager } = require('dunebot-core');
const Wissen = require('../../helpers/Wissen');

const router = Router();
const MENUE = '/admin/kb';

const zeige = (res, ansicht, daten) =>
    ServiceManager.get('themeManager').renderView(res, ansicht, { activeMenu: MENUE, ...daten });

/** Fängt, was eine Seite beim Laden wirft — eine Verwaltungsseite hängt nie. */
const seite = (name, fn) => async (req, res) => {
    try {
        await fn(req, res);
    } catch (fehler) {
        ServiceManager.get('Logger').error(`[Admin/Wissensdatenbank] ${name}:`, fehler);
        res.status(500).send('Fehler beim Laden der Wissensdatenbank');
    }
};

/**
 * Schreibende Wege antworten mit JSON. Was `Wissen` abweist, ist eine Eingabe,
 * die nicht stimmt (400, der Satz geht an den Menschen) — alles andere ein
 * Fehler bei uns (500, der Satz bleibt im Log).
 */
const schreibe = (name, fn) => async (req, res) => {
    try {
        res.json({ success: true, ...(await fn(req, res)) });
    } catch (fehler) {
        const eingabe = fehler instanceof Wissen.Eingabefehler;
        if (!eingabe) ServiceManager.get('Logger').error(`[Admin/Wissensdatenbank] ${name}:`, fehler);
        res.status(eingabe ? 400 : 500).json({ success: false, message: eingabe ? fehler.message : 'Serverfehler — steht im Log.' });
    }
};

/** Der Satz zum Mitziehen der Verweise — nur, wenn es etwas zu sagen gibt. */
function zuVerweisen(bericht) {
    const v = bericht.verweise;
    if (!v) return '';
    if (!v.stellen) return ' Die Adresse hat sich geändert; auf die alte verwies kein Artikel.';
    return ` Die Adresse hat sich geändert: ${v.stellen} ${v.stellen === 1 ? 'Verweis' : 'Verweise'} in `
        + `${v.artikel} ${v.artikel === 1 ? 'Artikel zeigt' : 'Artikeln zeigen'} jetzt auf die neue.`;
}

/** Der Satz zur Hilfe im Dashboard, wenn ein anderer Artikel sein Plugin abgab. */
function zuHilfe(bericht) {
    const h = bericht.hilfe;
    if (!h) return '';
    return ` „Hilfe“ im Plugin ${h.plugin} zeigt jetzt hierher statt auf ${h.von}`
        + (h.entwurf ? ' — solange dieser Artikel Entwurf ist, führt sie zur Startseite von /kb.' : '.');
}

/** Die Plugins, die es gibt — für die Auswahl „Hilfe im Dashboard“ und die Prüfung beim Speichern. */
const pluginNamen = () => [...ServiceManager.get('pluginManager').availablePlugins].sort();

/**
 * Die Spielpakete für „Anleitung für Spiel“: [{ id, name, slug }].
 *
 * Die Tabelle gehört dem Gameserver-Plugin. Fehlt sie, gibt es keine Spiele
 * und keine Auswahl — die Wissensdatenbank hängt nicht an dem Plugin. Jeder
 * andere Fehler geht ins Log und weiter nach oben.
 */
async function spielListe() {
    try {
        return await ServiceManager.get('dbService').query('SELECT id, name, slug FROM addon_marketplace ORDER BY name');
    } catch (fehler) {
        if (fehler?.code === 'ER_NO_SUCH_TABLE') return [];
        throw fehler;
    }
}

/** Der Satz, wenn ein anderer Artikel die Anleitung eines Spiels abgab. */
function zuAnleitung(bericht, spiele) {
    const a = bericht.anleitung;
    if (!a) return '';
    const name = spiele.find(s => Number(s.id) === a.spiel)?.name || `#${a.spiel}`;
    return ` „Hilfe“ auf den Seiten der ${name}-Server zeigt jetzt hierher statt auf ${a.von}`
        + (a.entwurf ? ' — solange dieser Artikel Entwurf ist, auf den Steckbrief des Gameserver-Plugins.' : '.');
}

// ── Übersicht ────────────────────────────────────────────────────────────────
router.get('/', seite('Übersicht', async (req, res) => {
    await zeige(res, 'admin/kb/index', {
        title: 'Wissensdatenbank',
        bereiche: await Wissen.allesFuerVerwaltung(),
        start: Wissen.START,
        spiele: await spielListe(),
    });
}));

// ── Bereiche ─────────────────────────────────────────────────────────────────
router.get('/bereich/neu', seite('Bereich neu', async (req, res) => {
    await zeige(res, 'admin/kb/bereich', { title: 'Neuer Bereich', bereich: null, start: Wissen.START });
}));

router.get('/bereich/:id', seite('Bereich', async (req, res) => {
    const bereich = await Wissen.bereichRoh(req.params.id);
    if (!bereich) return res.redirect(MENUE);
    await zeige(res, 'admin/kb/bereich', { title: 'Bereich bearbeiten', bereich, start: Wissen.START });
}));

router.post('/bereich/speichern', schreibe('Bereich speichern', async (req) => {
    const bericht = {};
    const id = await Wissen.bereichSpeichern(req.body || {}, bericht);
    return { id, message: 'Bereich gespeichert.' + zuVerweisen(bericht) };
}));

router.post('/bereich/:id/entfernen', schreibe('Bereich entfernen', async (req) => {
    await Wissen.bereichEntfernen(req.params.id);
    return { message: 'Bereich entfernt.' };
}));

// ── Artikel ──────────────────────────────────────────────────────────────────
const bereichsWahl = async () => (await Wissen.allesFuerVerwaltung()).map(b => ({ id: b.id, kuerzel: b.kuerzel, titel: b.titel }));

router.get('/artikel/neu', seite('Artikel neu', async (req, res) => {
    const wahl = await bereichsWahl();
    if (!wahl.length) return res.redirect(MENUE + '/bereich/neu');
    await zeige(res, 'admin/kb/artikel', {
        title: 'Neuer Artikel', artikel: null, bereiche: wahl,
        vorgabeBereich: Number(req.query.bereich) || wahl[0].id, plugins: pluginNamen(), spiele: await spielListe(),
    });
}));

router.get('/artikel/:id', seite('Artikel', async (req, res) => {
    const artikel = await Wissen.artikelRoh(req.params.id);
    if (!artikel) return res.redirect(MENUE);
    await zeige(res, 'admin/kb/artikel', {
        title: 'Artikel bearbeiten', artikel, bereiche: await bereichsWahl(), vorgabeBereich: artikel.category_id,
        plugins: pluginNamen(), spiele: await spielListe(),
    });
}));

router.post('/artikel/speichern', schreibe('Artikel speichern', async (req) => {
    const autor = req.session?.user?.info?.global_name || req.session?.user?.info?.username || null;
    const bericht = {};
    const spiele = await spielListe();
    const id = await Wissen.artikelSpeichern(req.body || {}, autor, bericht, pluginNamen(), spiele.map(s => Number(s.id)));
    const a = await Wissen.artikelRoh(id);
    return { id, adresse: a.istStartseite ? '/kb' : `/kb/${a.bereich_slug}/${a.slug}`,
        message: 'Artikel gespeichert.' + zuVerweisen(bericht) + zuHilfe(bericht) + zuAnleitung(bericht, spiele) };
}));

router.post('/artikel/:id/entfernen', schreibe('Artikel entfernen', async (req) => {
    const a = await Wissen.artikelEntfernen(req.params.id);
    return { message: 'Artikel entfernt.'
        + (a.plugin ? ` Das Plugin ${a.plugin} hat jetzt keinen Hilfe-Artikel mehr — „Hilfe“ führt dort zur Startseite von /kb.` : '')
        + (a.spiel ? ` Das Spiel #${a.spiel} hat jetzt keine Anleitung mehr — „Hilfe“ führt auf seinen Serverseiten zum Steckbrief des Gameserver-Plugins.` : '') };
}));

// ── Vorschau: dieselbe Funktion, die die öffentliche Seite benutzt ───────────
router.post('/vorschau', schreibe('Vorschau', async (req) => {
    return { html: Wissen.rendere(String(req.body?.inhalt || '').slice(0, 500000)) };
}));

module.exports = router;
