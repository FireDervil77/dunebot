/**
 * AutoMod - Protokoll
 *
 * Neu am 2026-08-07 zusammen mit der Protokollseite.
 */
(function () {
    'use strict';

    /** Basisadresse des Plugins in dieser Guild. */
    function basis() {
        const wurzel = document.querySelector('[data-automod-basis]');
        return wurzel ? wurzel.dataset.automodBasis : '';
    }

    /** Text aus den Sprachdaten der Seite, mit Rueckfall. */
    function text(schluessel, ersatz) {
        const wurzel = document.querySelector('[data-automod-texte]');
        if (!wurzel) return ersatz;
        try {
            return JSON.parse(wurzel.dataset.automodTexte)[schluessel] || ersatz;
        } catch {
            return ersatz;
        }
    }

    /** Meldung anzeigen. */
    function melden(nachricht, art) {
        if (window.toastr && typeof window.toastr[art || 'success'] === 'function') {
            window.toastr[art || 'success'](nachricht);
        } else {
            window.alert(nachricht);
        }
    }

    /** Anfrage an die Protokoll-Routen. */
    async function anfrage(methode, pfad, daten) {
        const antwort = await fetch(basis() + '/protokoll/api' + pfad, {
            method: methode,
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
            body: daten ? JSON.stringify(daten) : undefined
        });

        let inhalt = {};
        try {
            inhalt = await antwort.json();
        } catch {
            inhalt = {};
        }

        if (!antwort.ok || inhalt.success === false) {
            throw new Error(inhalt.message || text('FEHLER', 'Die Aktion ist fehlgeschlagen'));
        }
        return inhalt;
    }

    /** Strikes eines Mitglieds zuruecksetzen. */
    window.automodStrikesZuruecksetzen = function (mitgliedId) {
        if (!window.confirm(text('STRIKES_ZURUECKSETZEN_FRAGE', 'Strikes dieses Mitglieds wirklich zuruecksetzen?'))) return;

        anfrage('POST', '/strikes/' + mitgliedId + '/reset')
            .then(function () {
                melden(text('STRIKES_ZURUECKGESETZT', 'Strikes zurueckgesetzt.'));
                const zeile = document.querySelector('[data-strike-member="' + mitgliedId + '"]');
                if (zeile) zeile.remove();
            })
            .catch(function (err) { melden(err.message, 'error'); });
    };

    /** Alte Eintraege loeschen. */
    window.automodProtokollAufraeumen = function () {
        const feld = document.getElementById('cleanup-tage');
        const tage = parseInt(feld?.value, 10) || 30;

        const frage = text('AUFRAEUMEN_FRAGE', 'Eintraege aelter als {tage} Tage endgueltig loeschen?')
            .replace('{tage}', tage);
        if (!window.confirm(frage)) return;

        anfrage('POST', '/cleanup', { tage: tage })
            .then(function (antwort) {
                const meldung = text('AUFGERAEUMT', '{logs} Verstoesse und {events} Raid-Ereignisse geloescht.')
                    .replace('{logs}', antwort.geloescht.logs)
                    .replace('{events}', antwort.geloescht.ereignisse);
                melden(meldung);
                window.location.reload();
            })
            .catch(function (err) { melden(err.message, 'error'); });
    };

    // Zeitraum wechseln: laedt die Seite mit dem gewaehlten Wert neu, damit
    // Statistik und Listen zusammenpassen.
    document.addEventListener('DOMContentLoaded', function () {
        const auswahl = document.getElementById('protokoll-zeitraum');
        if (!auswahl) return;

        auswahl.addEventListener('change', function () {
            const ziel = new URL(window.location.href);
            ziel.searchParams.set('tage', auswahl.value);
            window.location.href = ziel.toString();
        });
    });
})();
