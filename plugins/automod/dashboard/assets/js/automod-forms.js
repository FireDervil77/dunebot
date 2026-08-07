/**
 * AutoMod - Formulare absenden
 *
 * Ein Formular schickt nur an, was der Browser mitgibt. Nicht angehakte
 * Kontrollkaestchen tauchen in FormData gar nicht auf - der Server sieht das
 * Feld dann als `undefined` und laesst den alten Wert stehen. Ein abgeschalteter
 * Filter waere also nie abgeschaltet worden. Deshalb bekommt jedes leere
 * Kaestchen hier ein verstecktes Feld mit '0'.
 *
 * Seit dem Umbau auf eigene Seiten (2026-08-07) gilt: dieses Skript fasst nur
 * an, was auf der aktuellen Seite auch wirklich steht. Frueher haengte es
 * `active_keyword_lists` bedingungslos an - auf einer Seite ohne Stichwortlisten
 * waere das ein leeres Array gewesen und haette die Auswahl geloescht.
 */
(function () {
    'use strict';

    document.addEventListener('DOMContentLoaded', function () {
        document.querySelectorAll('form[data-automod-form]').forEach(vorbereiten);
    });

    /**
     * Haengt sich vor das Absenden eines AutoMod-Formulars.
     *
     * @param {HTMLFormElement} form Das Formular
     */
    function vorbereiten(form) {
        form.addEventListener('submit', function () {
            kaestchenNachreichen(form);
            mehrfachauswahlNachreichen(form);
            stichwortlistenNachreichen(form);
        });
    }

    /**
     * Fuer jedes nicht angehakte Kaestchen ein verstecktes '0' nachreichen.
     *
     * Kaestchen, die zu einer Liste gehoeren (`data-automod-liste`), bleiben
     * aussen vor - die werden als Ganzes uebertragen.
     *
     * @param {HTMLFormElement} form Das Formular
     */
    function kaestchenNachreichen(form) {
        form.querySelectorAll('input[type="checkbox"]:not([data-automod-liste])').forEach(function (kaestchen) {
            if (kaestchen.checked || !kaestchen.name) return;

            const verstecktes = document.createElement('input');
            verstecktes.type = 'hidden';
            verstecktes.name = kaestchen.name;
            verstecktes.value = '0';
            form.appendChild(verstecktes);
        });
    }

    /**
     * Mehrfachauswahl als einzelne Felder nachreichen.
     *
     * @param {HTMLFormElement} form Das Formular
     */
    function mehrfachauswahlNachreichen(form) {
        form.querySelectorAll('select[multiple]').forEach(function (auswahl) {
            if (!auswahl.name) return;

            const gewaehlt = Array.from(auswahl.selectedOptions).map(function (o) { return o.value; });

            // Ein leeres Feld schicken, damit eine geleerte Auswahl auch
            // wirklich als "leer" ankommt und nicht als "nicht mitgeschickt".
            const versteckt = document.createElement('input');
            versteckt.type = 'hidden';
            versteckt.name = auswahl.name;
            versteckt.value = JSON.stringify(gewaehlt);
            form.appendChild(versteckt);

            auswahl.disabled = true;
        });
    }

    /**
     * Angehakte Stichwortlisten als ein JSON-Feld nachreichen.
     *
     * Nur wenn die Seite solche Kaestchen ueberhaupt zeigt.
     *
     * @param {HTMLFormElement} form Das Formular
     */
    function stichwortlistenNachreichen(form) {
        const kaestchen = form.querySelectorAll('input[data-automod-liste="active_keyword_lists"]');
        if (kaestchen.length === 0) return;

        const gewaehlt = [];
        kaestchen.forEach(function (k) {
            if (k.checked) gewaehlt.push(k.value);
            k.disabled = true;
        });

        const versteckt = document.createElement('input');
        versteckt.type = 'hidden';
        versteckt.name = 'active_keyword_lists';
        versteckt.value = JSON.stringify(gewaehlt);
        form.appendChild(versteckt);
    }
})();
