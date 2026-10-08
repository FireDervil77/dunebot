/**
 * Nach dem Neuladen wieder dort stehen, wo man war.
 *
 * **Warum es das braucht (2026-10-08).** Im Panel rollt nicht das Fenster,
 * sondern der Inhaltsbereich (`.page > .page-wrapper`, siehe guild.css: „Das
 * Fenster selbst scrollt nicht mehr"). Der Browser merkt sich beim Neuladen
 * aber nur die Position des FENSTERS — also stand jede Seite, die nach dem
 * Speichern neu lädt, wieder ganz oben. Betreiber, an der Werkbank (29 solche
 * Stellen auf einer Seite): „das Speichern bringt einen immer wieder an den
 * Top der Seite".
 *
 * Gemerkt wird je Adresse samt `#…` (ein Reiter ist eine eigene Stelle), in
 * `sessionStorage`: nur dieses Browserfenster, nur diese Sitzung.
 *
 * Wiederhergestellt wird nur nach NEULADEN und nach Vor/Zurück — wer eine
 * Seite über einen Verweis neu betritt, beginnt oben, wie überall sonst.
 *
 * Auf schmalen Bildschirmen rollt das Fenster selbst; dort hat der Kasten
 * keinen eigenen Rollbalken, und der Browser tut, was er immer tat.
 */
(function () {
    'use strict';

    var VORSATZ = 'fb-rollstand:';
    function schluessel() { return VORSATZ + location.pathname + location.search + location.hash; }
    function kasten() { return document.querySelector('.page > .page-wrapper'); }

    function merke() {
        var k = kasten();
        if (!k) return;
        try {
            if (k.scrollTop > 0) sessionStorage.setItem(schluessel(), String(Math.round(k.scrollTop)));
            else sessionStorage.removeItem(schluessel());
        } catch (e) { /* Speicher gesperrt oder voll: dann eben oben */ }
    }

    function art() {
        try {
            var n = performance.getEntriesByType('navigation')[0];
            return n ? n.type : '';
        } catch (e) { return ''; }
    }

    function stelleHer() {
        var k = kasten();
        if (!k) return;
        var wert = null;
        try { wert = sessionStorage.getItem(schluessel()); } catch (e) { /* nichts gemerkt */ }
        var ziel = Number(wert);
        if (!wert || !isFinite(ziel) || ziel <= 0) return;
        k.scrollTop = ziel;
    }

    // `pagehide` feuert auch dort, wo `beforeunload` es nicht tut (Mobilgeräte,
    // Zwischenspeicher für Vor/Zurück).
    window.addEventListener('pagehide', merke);

    if (art() === 'reload' || art() === 'back_forward') {
        // Zweimal: gleich, wenn der Aufbau steht — und noch einmal, wenn Bilder
        // und nachgeladene Teile die Höhe verändert haben.
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', stelleHer);
        else stelleHer();
        window.addEventListener('load', stelleHer);
    }
})();
