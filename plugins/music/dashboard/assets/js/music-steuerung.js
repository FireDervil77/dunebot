/**
 * Musik - Steuerung vom Dashboard aus
 *
 * Der Ton lebt im Bot-Vorgang; hier gehen nur Anweisungen ueber die
 * JSON-Routen hinaus. Das CSRF-Token haengt der Theme-Helfer an `fetch`.
 */
(function () {
    'use strict';

    /** Basisadresse des Plugins in dieser Guild. */
    function basis() {
        const wurzel = document.querySelector('[data-music-basis]');
        return wurzel ? wurzel.dataset.musicBasis : '';
    }

    /** Text aus den Sprachdaten der Seite, mit Rueckfall. */
    function text(schluessel, ersatz) {
        const wurzel = document.querySelector('[data-music-texte]');
        if (!wurzel) return ersatz;
        try {
            return JSON.parse(wurzel.dataset.musicTexte)[schluessel] || ersatz;
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

    /** Anfrage an eine JSON-Route des Plugins. */
    async function anfrage(methode, pfad, daten) {
        const antwort = await fetch(basis() + pfad, {
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
            throw new Error(inhalt.error || text('FEHLER', 'Die Aktion ist fehlgeschlagen'));
        }
        return inhalt;
    }

    function fehlerMelden(err) {
        melden(err.message || text('FEHLER', 'Die Aktion ist fehlgeschlagen'), 'error');
    }

    // ==================== Steuerung ====================

    /**
     * Einen einfachen Vorgang ausloesen.
     *
     * @param {string} vorgang pause, fortsetzen, ueberspringen, mischen
     */
    window.musicSteuern = function (vorgang) {
        anfrage('POST', '/steuerung/' + vorgang)
            .then(zustandHolen)
            .catch(fehlerMelden);
    };

    window.musicStoppen = function () {
        if (!window.confirm(text('STOPPEN_FRAGE', 'Wiedergabe beenden und Warteschlange leeren?'))) return;
        anfrage('POST', '/steuerung/stoppen').then(() => window.location.reload()).catch(fehlerMelden);
    };

    window.musicTrennen = function () {
        if (!window.confirm(text('TRENNEN_FRAGE', 'Den Sprachkanal wirklich verlassen?'))) return;
        anfrage('POST', '/steuerung/trennen').then(() => window.location.reload()).catch(fehlerMelden);
    };

    window.musicEntfernen = function (position) {
        anfrage('DELETE', '/steuerung/warteschlange/' + position)
            .then(function () {
                melden(text('ENTFERNT', 'Entfernt.'));
                window.location.reload();
            })
            .catch(fehlerMelden);
    };

    window.musicVerschieben = function (von, nach) {
        anfrage('POST', '/steuerung/verschieben', { von: von, nach: nach })
            .then(() => window.location.reload())
            .catch(fehlerMelden);
    };

    /**
     * Etwas in die Warteschlange legen.
     *
     * @param {boolean} anfang Vorne einreihen
     */
    window.musicHinzufuegen = function (anfang) {
        const feld = document.getElementById('music-eingabe');
        const eingabe = (feld?.value || '').trim();

        if (!eingabe) return melden(text('EINGABE_FEHLT', 'Gib eine Adresse oder einen Suchbegriff ein.'), 'warning');

        anfrage('POST', '/steuerung/hinzufuegen', { eingabe: eingabe, anfang: Boolean(anfang) })
            .then(function (antwort) {
                melden(text('AUFGENOMMEN', '{anzahl} Titel aufgenommen.').replace('{anzahl}', antwort.aufgenommen ?? 1));
                if (feld) feld.value = '';
                window.location.reload();
            })
            .catch(fehlerMelden);
    };

    // ==================== Wiedergabelisten ====================

    window.musicListeAnlegen = function () {
        const name = (document.getElementById('listeName')?.value || '').trim();
        if (!name) return melden(text('LISTE_NAME_FEHLT', 'Die Liste braucht einen Namen.'), 'warning');

        anfrage('POST', '/listen/api', {
            name: name,
            description: (document.getElementById('listeBeschreibung')?.value || '').trim() || null
        })
            .then(() => window.location.reload())
            .catch(fehlerMelden);
    };

    window.musicListeLoeschen = function (id, name) {
        const frage = text('LISTE_LOESCHEN', 'Liste "{name}" wirklich loeschen?').replace('{name}', name);
        if (!window.confirm(frage)) return;

        anfrage('DELETE', '/listen/api/' + id)
            .then(function () {
                melden(text('LISTE_GELOESCHT', 'Liste geloescht.'));
                window.location.href = basis() + '/listen';
            })
            .catch(fehlerMelden);
    };

    window.musicListeAbspielen = function (id) {
        anfrage('POST', '/listen/api/' + id + '/abspielen')
            .then(function (antwort) {
                melden(text('AUFGENOMMEN', '{anzahl} Titel aufgenommen.').replace('{anzahl}', antwort.aufgenommen ?? 0));
            })
            .catch(fehlerMelden);
    };

    window.musicListeTitelHinzufuegen = function (id) {
        const feld = document.getElementById('liste-eingabe');
        const eingabe = (feld?.value || '').trim();

        if (!eingabe) return melden(text('EINGABE_FEHLT', 'Gib eine Adresse oder einen Suchbegriff ein.'), 'warning');

        anfrage('POST', '/listen/api/' + id + '/titel', { eingabe: eingabe })
            .then(() => window.location.reload())
            .catch(fehlerMelden);
    };

    window.musicListenTitelEntfernen = function (listeId, titelId) {
        if (!window.confirm(text('TITEL_ENTFERNEN', 'Diesen Titel aus der Liste nehmen?'))) return;

        anfrage('DELETE', '/listen/api/' + listeId + '/titel/' + titelId)
            .then(function () {
                melden(text('ENTFERNT', 'Entfernt.'));
                document.getElementById('listentitel-' + titelId)?.remove();
            })
            .catch(fehlerMelden);
    };

    // ==================== Laufende Anzeige ====================

    /** Sekunden als m:ss. */
    function dauer(sek) {
        if (!sek || sek <= 0) return 'live';
        const m = Math.floor(sek / 60);
        const s = sek % 60;
        return m + ':' + String(s).padStart(2, '0');
    }

    /**
     * Zustand holen und Fortschritt nachfuehren.
     *
     * Nur auf der Uebersicht - anderswo gibt es die Anzeigefelder nicht.
     */
    async function zustandHolen() {
        if (!document.getElementById('music-spieler')) return;

        try {
            const antwort = await anfrage('GET', '/steuerung/state');
            const z = antwort.zustand;
            const t = z.aktuell;

            const positionFeld = document.getElementById('music-position');
            const balken = document.getElementById('music-balken');

            if (t && positionFeld) {
                positionFeld.textContent = `${dauer(t.positionSek)} / ${dauer(t.durationSec)}`;
            }
            if (t && balken && t.durationSec > 0) {
                balken.style.width = Math.min(100, Math.round((t.positionSek / t.durationSec) * 100)) + '%';
            }
        } catch {
            // Der Bot antwortet gerade nicht - beim naechsten Mal wieder
        }
    }

    document.addEventListener('DOMContentLoaded', function () {
        // Lautstaerke erst beim Loslassen senden, nicht bei jeder Bewegung
        const regler = document.getElementById('music-lautstaerke');
        const anzeige = document.getElementById('music-lautstaerke-wert');

        if (regler) {
            regler.addEventListener('input', function () {
                if (anzeige) anzeige.textContent = regler.value;
            });
            regler.addEventListener('change', function () {
                anfrage('POST', '/steuerung/lautstaerke', { wert: parseInt(regler.value, 10) })
                    .catch(fehlerMelden);
            });
        }

        const wiederholung = document.getElementById('music-wiederholung');
        if (wiederholung) {
            wiederholung.addEventListener('change', function () {
                anfrage('POST', '/steuerung/wiederholung', { modus: wiederholung.value }).catch(fehlerMelden);
            });
        }

        const filter = document.getElementById('music-filter');
        if (filter) {
            filter.addEventListener('change', function () {
                anfrage('POST', '/steuerung/filter', { name: filter.value })
                    .then(function () { melden(text('GESPEICHERT', 'Gespeichert.')); })
                    .catch(fehlerMelden);
            });
        }

        const dauerbetrieb = document.getElementById('music-dauerbetrieb');
        if (dauerbetrieb) {
            dauerbetrieb.addEventListener('change', function () {
                anfrage('POST', '/steuerung/dauerbetrieb', { an: dauerbetrieb.checked }).catch(fehlerMelden);
            });
        }

        const autoplay = document.getElementById('music-autoplay');
        if (autoplay) {
            autoplay.addEventListener('change', function () {
                anfrage('POST', '/steuerung/autoplay', { an: autoplay.checked }).catch(fehlerMelden);
            });
        }

        // Zeitraum im Verlauf
        const zeitraum = document.getElementById('music-zeitraum');
        if (zeitraum) {
            zeitraum.addEventListener('change', function () {
                const ziel = new URL(window.location.href);
                ziel.searchParams.set('tage', zeitraum.value);
                window.location.href = ziel.toString();
            });
        }

        // Eingabefeld: Enter statt Klick
        ['music-eingabe', 'liste-eingabe'].forEach(function (id) {
            const feld = document.getElementById(id);
            if (!feld) return;
            feld.addEventListener('keydown', function (e) {
                if (e.key !== 'Enter') return;
                e.preventDefault();
                if (id === 'music-eingabe') {
                    window.musicHinzufuegen(false);
                } else {
                    const karte = feld.closest('[data-liste-id]');
                    if (karte) window.musicListeTitelHinzufuegen(parseInt(karte.dataset.listeId, 10));
                }
            });
        });

        // Fortschritt jede Sekunde nachfuehren, solange die Seite offen ist
        if (document.getElementById('music-spieler')) {
            setInterval(zustandHolen, 1000);
        }
    });
})();
