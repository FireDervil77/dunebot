/**
 * Bootstrap unter seinem gewohnten Namen verfügbar machen.
 *
 * Tabler bringt Bootstrap vollständig mit, exportiert es aber unter seinem
 * eigenen Namen: `window.tabler.bootstrap`. Ein globales `window.bootstrap`,
 * wie es das alte Theme über bootstrap.bundle.min.js anlegte, gibt es nicht.
 *
 * Im Bestand greifen 24 Stellen in 19 Dateien darauf zu — meist in dieser Form:
 *
 *     return (el && window.bootstrap) ? bootstrap.Modal.getOrCreateInstance(el) : null;
 *
 * Die Prüfung schlägt unter Tabler fehl, die Funktion gibt `null` zurück, und
 * der Aufruf daneben (`?.show()`) tut still gar nichts. Für den Benutzer sieht
 * das aus wie ein Knopf ohne Wirkung: kein Dialog, keine Fehlermeldung, nichts
 * in der Konsole. Betroffen waren unter anderem „Rolle erstellen", „Rolle
 * löschen" und die Bestätigungsdialoge in mehreren Plugins.
 *
 * Diese eine Zuweisung erledigt alle 24 Stellen. Die Alternative wäre, 19
 * Dateien einzeln umzuschreiben — mehr Fläche, mehr Gelegenheit für Fehler,
 * und beim nächsten hinzugefügten Dialog steht das Problem wieder da.
 *
 * Vorhandenes wird nicht überschrieben: Lädt jemand echtes Bootstrap dazu,
 * behält dieses den Vorrang.
 */
(function () {
    'use strict';

    if (window.bootstrap) return;

    if (window.tabler && window.tabler.bootstrap) {
        window.bootstrap = window.tabler.bootstrap;
        return;
    }

    // Tabler noch nicht geladen? Dann beim DOM-Start erneut versuchen.
    document.addEventListener('DOMContentLoaded', function () {
        if (!window.bootstrap && window.tabler && window.tabler.bootstrap) {
            window.bootstrap = window.tabler.bootstrap;
        }
    });
})();
