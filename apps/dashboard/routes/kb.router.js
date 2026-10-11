'use strict';

/**
 * Wissensdatenbank — die öffentliche Seite unter `/kb` (2026-10-11).
 *
 *   GET /kb                       Startseite: Text, Suche, die Bereiche als Kacheln
 *   GET /kb/suche?q=…             Suche über die veröffentlichten Artikel
 *   GET /kb/<bereich>             die Artikel eines Bereichs
 *   GET /kb/<bereich>/<artikel>   ein Artikel — oder Titel und Kurztext mit Schloss
 *
 * Dazu die alten Adressen: `/docs` und `/docs/…` leiten dauerhaft (301) auf
 * die neue Stelle (Entscheidung E-5, `docs/wissensdatenbank/STAND.md`).
 *
 * Wer was lesen darf, entscheidet `helpers/Wissen.js` — hier steht keine
 * eigene Fassung der Regel. Eingehängt wird der Router von
 * `frontend.router.js`, hinter dessen Vorarbeit für Menü, Fußzeile und Layout.
 */

const express = require('express');
const { ServiceManager } = require('dunebot-core');
const Wissen = require('../helpers/Wissen');

/**
 * @param {object} o
 * @param {(res: import('express').Response, status: number) => Promise<void>} o.fehlerseite
 *        die Fehlerseite der öffentlichen Seiten (frontend.router.js)
 * @returns {{ kb: import('express').Router, alt: import('express').Router }}
 */
module.exports = function wissensRouter({ fehlerseite }) {
    const kb = express.Router();
    const alt = express.Router();

    /** Rahmen jeder Seite: Sprache, Anmeldung, die Bereiche für die Seitenleiste. */
    async function rahmen(req, res) {
        const locale = res.locals.locale || 'de-DE';
        const angemeldet = Wissen.istAngemeldet(req);
        return { locale, angemeldet, bereiche: await Wissen.bereiche(locale) };
    }

    async function zeige(res, daten) {
        const themeManager = ServiceManager.get('themeManager');
        res.locals.layout = themeManager.getLayout('frontend');
        await themeManager.renderView(res, 'frontend/kb', {
            ansicht: 'start', bereich: null, artikelListe: [], artikel: null, inhaltHtml: '',
            suchbegriff: '', treffer: [], ...daten,
        });
    }

    const mitFehlerseite = (name, fn) => async (req, res) => {
        try {
            await fn(req, res);
        } catch (fehler) {
            ServiceManager.get('Logger').error(`[Wissensdatenbank] ${name}:`, fehler);
            await fehlerseite(res, 500);
        }
    };

    kb.get('/', mitFehlerseite('Startseite', async (req, res) => {
        const r = await rahmen(req, res);
        const start = await Wissen.artikel(Wissen.START.bereich, Wissen.START.artikel, r.locale);
        await zeige(res, {
            ...r, ansicht: 'start',
            title: start?.titel || 'Wissensdatenbank',
            artikel: start,
            inhaltHtml: start ? Wissen.rendere(start.inhalt) : '',
        });
    }));

    kb.get('/suche', mitFehlerseite('Suche', async (req, res) => {
        const r = await rahmen(req, res);
        const suchbegriff = String(req.query.q || '').trim().slice(0, 80);
        await zeige(res, {
            ...r, ansicht: 'suche', suchbegriff,
            title: 'Wissensdatenbank',
            treffer: await Wissen.suche(suchbegriff, r.locale, r.angemeldet),
        });
    }));

    kb.get('/:bereich', mitFehlerseite('Bereich', async (req, res) => {
        const r = await rahmen(req, res);
        const bereich = await Wissen.bereich(req.params.bereich, r.locale);
        if (!bereich) return fehlerseite(res, 404);
        await zeige(res, {
            ...r, ansicht: 'bereich', bereich,
            title: bereich.titel,
            artikelListe: await Wissen.artikelImBereich(bereich.id, r.locale, r.angemeldet),
        });
    }));

    kb.get('/:bereich/:artikel', mitFehlerseite('Artikel', async (req, res) => {
        const r = await rahmen(req, res);
        const bereich = await Wissen.bereich(req.params.bereich, r.locale);
        const artikel = bereich ? await Wissen.artikel(req.params.bereich, req.params.artikel, r.locale) : null;
        const sichtbar = Wissen.sichtbarkeit(artikel, r.angemeldet);
        // Ein Entwurf ist außen nicht da — dieselbe Antwort wie bei einem Artikel, den es nie gab.
        if (!artikel || sichtbar === 'nichts') return fehlerseite(res, 404);
        // Die Startseite hat EINE Adresse.
        if (artikel.istStartseite) return res.redirect(301, '/kb');
        await zeige(res, {
            ...r, ansicht: 'artikel', bereich,
            title: artikel.titel,
            artikel: { ...artikel, sichtbar },
            // Mit Schloss geht der Inhalt gar nicht erst in die Ansicht.
            inhaltHtml: sichtbar === 'ganz' ? Wissen.rendere(artikel.inhalt) : '',
            artikelListe: await Wissen.artikelImBereich(bereich.id, r.locale, r.angemeldet),
        });
    }));

    // ── Die alten Adressen ──────────────────────────────────────────────────
    alt.get('/', (req, res) => res.redirect(301, '/kb'));
    alt.get('/{*docPath}', (req, res) => {
        const pfad = Array.isArray(req.params.docPath) ? req.params.docPath.join('/') : String(req.params.docPath || '');
        res.redirect(301, Wissen.neueAdresse(pfad));
    });

    return { kb, alt };
};
