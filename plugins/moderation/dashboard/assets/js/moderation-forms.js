/**
 * Moderation - Formulare absenden
 *
 * Nicht angehakte Kontrollkaestchen tauchen in FormData gar nicht auf. Der
 * Server saehe das Feld dann nie und liesse den alten Wert stehen - eine
 * abgeschaltete DM-Benachrichtigung waere also nie abgeschaltet worden.
 * Deshalb bekommt jedes leere Kaestchen hier ein verstecktes Feld mit '0'.
 *
 * Die Protokoll-Ereignisse sind davon ausgenommen: die gehoeren als Liste
 * zusammen und werden am Stueck uebertragen.
 */
(function () {
    'use strict';

    document.addEventListener('DOMContentLoaded', function () {
        document.querySelectorAll('form[data-moderation-form]').forEach(function (form) {
            form.addEventListener('submit', function () {
                kaestchenNachreichen(form);
                ereignisseNachreichen(form);
            });
        });
    });

    /**
     * Fuer jedes nicht angehakte Kaestchen ein verstecktes '0' nachreichen.
     *
     * @param {HTMLFormElement} form Das Formular
     */
    function kaestchenNachreichen(form) {
        form.querySelectorAll('input[type="checkbox"]:not([data-moderation-liste])').forEach(function (kaestchen) {
            if (kaestchen.checked || !kaestchen.name) return;

            const versteckt = document.createElement('input');
            versteckt.type = 'hidden';
            versteckt.name = kaestchen.name;
            versteckt.value = '0';
            form.appendChild(versteckt);
        });
    }

    /**
     * Angehakte Protokoll-Ereignisse als ein JSON-Feld nachreichen.
     *
     * Nur wenn die Seite solche Kaestchen ueberhaupt zeigt - sonst wuerde ein
     * leeres Feld die gespeicherte Auswahl loeschen.
     *
     * @param {HTMLFormElement} form Das Formular
     */
    function ereignisseNachreichen(form) {
        const kaestchen = form.querySelectorAll('input[data-moderation-liste="modlog_events"]');
        if (kaestchen.length === 0) return;

        const gewaehlt = [];
        kaestchen.forEach(function (k) {
            if (k.checked) gewaehlt.push(k.value);
            k.disabled = true;
        });

        const versteckt = document.createElement('input');
        versteckt.type = 'hidden';
        versteckt.name = 'modlog_events';
        versteckt.value = JSON.stringify(gewaehlt);
        form.appendChild(versteckt);
    }
})();
