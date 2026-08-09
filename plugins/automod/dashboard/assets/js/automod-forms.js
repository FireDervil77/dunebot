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
 *
 * Am 2026-08-09 ist dieser Sammler entfallen: die Stichwortlisten liegen nicht
 * mehr als Kaestchenliste in einem Formular, sondern haben eine eigene Seite
 * mit eigenen Routen.
 *
 * ── Zwei Fehler in genau diesem Mechanismus (behoben 2026-08-08) ────────────
 *
 * Der Nutzer beschrieb es als "es dauert mehrmals, bis der Schalter ankommt".
 * Dahinter steckten zwei Dinge, die sich gegenseitig verschleiert haben:
 *
 * 1. **Reihenfolge.** `guild.js` haengt sich ebenfalls an `submit`, ruft
 *    `preventDefault()` und baut `FormData` **synchron** auf. Welcher der
 *    beiden Zuhoerer zuerst laeuft, entschied allein die Ladereihenfolge der
 *    Skripte. Lief `guild.js` zuerst, war die Momentaufnahme fertig, bevor hier
 *    ein einziges verstecktes Feld angehaengt war - Abschalten kam nie an.
 *    Deshalb haengt dieses Skript jetzt in der **Einfangphase am `document`**:
 *    die laeuft garantiert vor jedem Zuhoerer am Formular selbst.
 *
 * 2. **Altlasten.** Die versteckten Felder wurden angehaengt und nie wieder
 *    entfernt. Beim naechsten Absenden ohne Seitenneuladen stand die alte '0'
 *    immer noch im Formular - und weil sie **hinter** dem Kaestchen steht,
 *    gewinnt sie beim Einlesen. Wer einen Filter abschaltete, speicherte und
 *    ihn dann wieder anschaltete, schickte weiterhin '0'. Genau das erzeugte
 *    das "erst beim dritten Mal".
 *
 * Zusaetzlich werden abgeschaltete Bedienelemente nach dem Absenden wieder
 * freigegeben - sonst blieb eine Mehrfachauswahl nach dem ersten Speichern
 * ausgegraut und unbenutzbar, bis die Seite neu geladen wurde.
 */
(function () {
    'use strict';

    /** Kennzeichen an allem, was dieses Skript selbst angehaengt hat. */
    const MARKE = 'data-automod-nachgereicht';

    // Einfangphase am document: laeuft vor jedem Zuhoerer am Formular selbst,
    // unabhaengig davon, in welcher Reihenfolge die Skripte geladen wurden.
    document.addEventListener('submit', function (ereignis) {
        const form = ereignis.target;
        if (!(form instanceof HTMLFormElement)) return;
        if (!form.hasAttribute('data-automod-form')) return;

        aufraeumen(form);
        kaestchenNachreichen(form);
        mehrfachauswahlNachreichen(form);

        // Nach der Momentaufnahme alles wieder bedienbar machen.
        setTimeout(function () { freigeben(form); }, 0);
    }, true);

    /**
     * Alles entfernen, was ein frueheres Absenden angehaengt hat.
     *
     * @param {HTMLFormElement} form Das Formular
     */
    function aufraeumen(form) {
        form.querySelectorAll('[' + MARKE + ']').forEach(function (element) {
            element.remove();
        });
    }

    /**
     * Ein gekennzeichnetes verstecktes Feld anhaengen.
     *
     * @param {HTMLFormElement} form Das Formular
     * @param {string} name Feldname
     * @param {string} wert Feldwert
     */
    function nachreichen(form, name, wert) {
        const versteckt = document.createElement('input');
        versteckt.type = 'hidden';
        versteckt.name = name;
        versteckt.value = wert;
        versteckt.setAttribute(MARKE, '');
        form.appendChild(versteckt);
    }

    /**
     * Voruebergehend abgeschaltete Bedienelemente wieder freigeben.
     *
     * @param {HTMLFormElement} form Das Formular
     */
    function freigeben(form) {
        form.querySelectorAll('[data-automod-stillgelegt]').forEach(function (element) {
            element.disabled = false;
            element.removeAttribute('data-automod-stillgelegt');
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
            nachreichen(form, kaestchen.name, '0');
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
            nachreichen(form, auswahl.name, JSON.stringify(gewaehlt));

            // Stilllegen, damit die Auswahl nicht zusaetzlich einzeln
            // mitgeschickt wird - direkt nach der Momentaufnahme wieder frei.
            auswahl.disabled = true;
            auswahl.setAttribute('data-automod-stillgelegt', '');
        });
    }

})();
