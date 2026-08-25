/**
 * form-toast.js — die Client-Haelfte von FormAntwort.
 *
 * **Warum es das gibt.** Am 2026-08-25 fiel dem Betreiber auf, dass keine
 * Speicherroute des Streaming-Plugins ueber die Toasts geht. Nachgemessen war
 * Streaming zwar der einzige Ausreisser, aber der Grund lag nicht dort: Es gibt
 * im Haus **keinen gemeinsamen Helfer**. gameserver, discord und masterserver
 * schreiben ihr `fetch` und ihren `showToast`-Aufruf in jede einzelne Ansicht,
 * `discord-roles.ejs` baut sogar ein zweites `showToast` neben dem globalen.
 * Wer eine Speicherroute neu baut, hat die Wahl zwischen Abschreiben und dem
 * klassischen Weg.
 *
 * Ein Formular meldet sich mit `data-toast` an. Mehr ist nicht zu tun:
 *
 *     <form method="POST" action="..." data-toast>
 *
 * Optionen als Attribute:
 *
 *     data-toast-neuladen   nach dem Toast die Seite neu laden
 *     data-toast-frage="…"  vorher bestaetigen lassen
 *
 * **Der Rueckfall ist die halbe Miete.** Alles, was nicht sauber als JSON
 * zurueckkommt — eine Fehlerseite, ein Zeitablauf, eine abgelaufene Sitzung,
 * die auf die Anmeldung umleitet —, laesst das Formular ganz normal abschicken.
 * Der Nutzer landet dann dort, wo er ohne dieses Skript auch gelandet waere.
 * Ein Helfer, der im Fehlerfall schweigt, waere schlimmer als keiner: Man
 * drueckt Speichern, nichts passiert, und niemand erfaehrt warum.
 *
 * Den CSRF-Token braucht dieses Skript nicht selbst zu setzen — `csrf-helper.js`
 * patcht `window.fetch` und haengt `X-CSRF-Token` an jede zustandsaendernde
 * Anfrage gleicher Herkunft. Nachgesehen, nicht angenommen.
 */
(function () {
    'use strict';

    /** Muss zu `FormAntwort.KOPFZEILE` in der SDK passen. */
    var KOPFZEILE = 'X-Form-Toast';

    /**
     * Zeigt die Adresse auf denselben Server?
     *
     * @param {string} url Adresse
     * @returns {boolean} true bei gleicher Herkunft oder relativem Pfad
     */
    function gleicheHerkunft(url) {
        if (!url) return true;
        try {
            return new URL(url, window.location.href).origin === window.location.origin;
        } catch (e) {
            return false;
        }
    }

    /**
     * @param {string} art 'success' | 'error' | 'warning' | 'info'
     * @param {string} text Meldung
     */
    function melde(art, text) {
        if (!text) return;
        if (typeof window.showToast === 'function') {
            window.showToast(art === 'error' ? 'error' : art, text);
        } else {
            // Ohne global-toast.js bleibt nur der Notnagel. Schweigen waere
            // hier der schlimmere Ausgang.
            window.alert(text);
        }
    }

    /**
     * Knopf waehrend des Sendens sperren.
     *
     * Ohne das laesst sich zweimal speichern, bevor die erste Antwort da ist —
     * beim klassischen Weg verhindert das die Weiterleitung von selbst, hier
     * nicht mehr.
     *
     * @param {HTMLFormElement} form Formular
     * @param {boolean} an true = gesperrt
     */
    function knopfSperren(form, an) {
        var knoepfe = form.querySelectorAll('button[type="submit"], input[type="submit"]');
        for (var i = 0; i < knoepfe.length; i++) {
            knoepfe[i].disabled = an;
        }
    }

    document.addEventListener('submit', function (e) {
        var form = e.target;
        if (!(form instanceof HTMLFormElement)) return;
        if (!form.hasAttribute('data-toast')) return;

        // **Nur die eigene Herkunft.** Ein `data-toast` an einem Formular, das
        // woandershin sendet, waere ein Weg, Sitzungsdaten mit unserem
        // CSRF-Token an einen fremden Server zu schicken. Kommt heute nirgends
        // vor - genau deshalb steht die Zeile hier und nicht erst, wenn es
        // vorkommt.
        if (!gleicheHerkunft(form.action)) return;

        var frage = form.getAttribute('data-toast-frage');
        if (frage && !window.confirm(frage)) {
            e.preventDefault();
            return;
        }

        // Ohne fetch bleibt der klassische Weg — und der funktioniert.
        if (!window.fetch || !window.FormData) return;

        // **Dateien gehen nur klassisch.** Ein Datei-Upload braucht
        // `multipart/form-data`; das liest `express.urlencoded()` nicht, und
        // ein eigener Parser gehoert nicht in diesen Helfer. Lieber gar nicht
        // abfangen als halb.
        if (String(form.enctype || '').indexOf('multipart') >= 0) return;
        if (form.querySelector('input[type="file"]')) return;

        e.preventDefault();

        // **Nicht die FormData selbst senden.**
        //
        // Genau daran ist die erste Fassung am 2026-08-25 im Betrieb
        // gescheitert: Wer `body: new FormData(...)` schickt, laesst den
        // Browser `multipart/form-data` kodieren. `express.urlencoded()`
        // versteht das nicht, `req.body` bleibt `undefined`, und die Route
        // stirbt an "Cannot read properties of undefined". Der Nutzer sieht
        // "hat technisch nicht geklappt" und im Protokoll steht ein
        // TypeError, der nichts mit der Sache zu tun hat.
        //
        // Ein klassisches Formular sendet `application/x-www-form-urlencoded`
        // — also senden wir das auch. Der Sinn dieses Helfers ist, dass die
        // Route BEIDE Wege gleich sieht.
        var koerper = new URLSearchParams();
        new FormData(form).forEach(function (wert, name) { koerper.append(name, wert); });

        var kopf = { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' };
        kopf[KOPFZEILE] = '1';

        knopfSperren(form, true);

        /** Der Rueckfall: ganz normal abschicken, als gaebe es dieses Skript nicht. */
        function klassisch() {
            knopfSperren(form, false);
            form.removeAttribute('data-toast');   // sonst faengt der Zuhoerer erneut ab
            form.submit();
        }

        window.fetch(form.action, {
            method: (form.method || 'POST').toUpperCase(),
            body: koerper,
            headers: kopf,
            credentials: 'same-origin',
            redirect: 'follow'
        }).then(function (antwort) {
            var typ = antwort.headers.get('content-type') || '';
            if (!antwort.ok || typ.indexOf('application/json') < 0) {
                // Fehlerseite, Anmeldung, Zeitablauf — nicht raten, sondern
                // den Nutzer dorthin bringen, wo er ohnehin gelandet waere.
                klassisch();
                return null;
            }
            return antwort.json();
        }).then(function (d) {
            if (!d) return;   // klassisch() hat uebernommen

            knopfSperren(form, false);
            melde(d.art || (d.success ? 'success' : 'error'), d.message);

            // **Nur auf den eigenen Server wechseln.** `geheZu` kommt zwar
            // aus unserem Code, aber eine offene Weiterleitung entsteht immer
            // dann, wenn irgendwann jemand eine Eingabe durchreicht. Die
            // Pruefung kostet nichts und schliesst die Tuer, bevor sie
            // aufgeht.
            if (d.geheZu) {
                if (gleicheHerkunft(d.geheZu)) window.location.assign(d.geheZu);
                else melde('error', 'Weiterleitung auf einen fremden Server abgelehnt.');
                return;
            }

            // Neuladen nur bei Erfolg: Nach einem abgelehnten Formular waere
            // es die schlechteste aller Antworten — die Eingabe waere weg und
            // der Toast gleich mit.
            if (d.success && form.hasAttribute('data-toast-neuladen')) {
                window.location.reload();
            }
        }).catch(function () {
            klassisch();
        });
    });
}());
