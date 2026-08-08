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
            // Das Nachziehen darf keine zweite Fehlermeldung ausloesen
            .then(() => zustandHolen().catch(() => {}))
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

    /**
     * Den laufenden Titel in eine Liste legen.
     *
     * Die Titeldaten holt sich der Server selbst aus dem Bot-Zustand - hier
     * geht nur die Listen-ID hinaus. Was der Browser schickt, darf nicht
     * bestimmen, was in der Datenbank landet.
     */
    window.musicAktuellInListe = function (listeId) {
        anfrage('POST', '/listen/api/' + listeId + '/aktuell')
            .then(function (antwort) {
                melden(text('IN_LISTE', 'In "{liste}" aufgenommen: {titel}')
                    .replace('{liste}', antwort.liste || '')
                    .replace('{titel}', antwort.titel || ''));
            })
            .catch(fehlerMelden);
    };

    /** Einen Eintrag aus dem Verlauf in eine Liste legen. */
    window.musicVerlaufInListe = function (listeId, verlaufId) {
        anfrage('POST', '/listen/api/' + listeId + '/verlauf/' + verlaufId)
            .then(function (antwort) {
                melden(text('IN_LISTE', 'In "{liste}" aufgenommen: {titel}')
                    .replace('{liste}', antwort.liste || '')
                    .replace('{titel}', antwort.titel || ''));
            })
            .catch(fehlerMelden);
    };

    // ==================== Trefferliste beim Tippen ====================

    /**
     * Ein Eingabefeld mit Vorschlaegen versehen.
     *
     * Gesucht wird im Bot - dieselbe Funktion, die Discord bei jedem
     * Tastendruck befragt, samt ihrem Zwischenspeicher.
     *
     * Der **Wert** eines Vorschlags ist die Adresse, nicht der Titel: so kommt
     * genau das ins Feld, was in der Liste stand. Eine zweite Suche beim
     * Abspielen koennte einen anderen Treffer liefern - denselben Grund hat
     * die Trefferliste im Discord.
     *
     * Faellt die Suche aus, bleibt die Liste leer. Das Feld muss weiter von
     * Hand benutzbar sein.
     *
     * @param {string} feldId ID des Eingabefeldes
     */
    function vorschlaegeAnhaengen(feldId) {
        const feld = document.getElementById(feldId);
        if (!feld) return;

        const liste = document.createElement('datalist');
        liste.id = feldId + '-vorschlaege';
        feld.setAttribute('list', liste.id);
        feld.setAttribute('autocomplete', 'off');
        feld.parentNode.appendChild(liste);

        let wecker = null;
        let zuletzt = '';

        feld.addEventListener('input', function () {
            const eingabe = feld.value.trim();

            // Adressen brauchen keine Suche, und unter drei Zeichen lohnt es
            // sich nicht - genau wie im Discord
            if (eingabe.length < 3 || /^https?:\/\//i.test(eingabe)) return;
            if (eingabe === zuletzt) return;
            zuletzt = eingabe;

            // Nicht bei jedem Tastendruck losschicken
            clearTimeout(wecker);
            wecker = setTimeout(function () {
                anfrage('GET', '/steuerung/vorschlaege?q=' + encodeURIComponent(eingabe))
                    .then(function (antwort) {
                        // Zwischenzeitlich weitergetippt: Antwort ist veraltet
                        if (feld.value.trim() !== eingabe) return;

                        liste.innerHTML = '';
                        (antwort.treffer || []).forEach(function (t) {
                            const eintrag = document.createElement('option');
                            eintrag.value = t.value;
                            eintrag.label = t.name;
                            eintrag.textContent = t.name;
                            liste.appendChild(eintrag);
                        });
                    })
                    .catch(function () { /* ohne Vorschlaege tippt man eben selbst */ });
            }, 350);
        });
    }

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
     *
     * @returns {Promise<boolean>} Ob gerade etwas laeuft
     */
    /** Kennung des zuletzt angezeigten Titels - erkennt den Wechsel. */
    let angezeigterTitel = null;

    async function zustandHolen() {
        if (!document.getElementById('music-spieler')) return false;

        const antwort = await anfrage('GET', '/steuerung/state');
        const z = antwort.zustand;
        const t = z.aktuell;

        // ────────────────────────────────────────────────────────────────────
        // Titelwechsel
        //
        // Hier wurden vorher nur Position und Balken nachgefuehrt. Beim
        // Ueberspringen sprang deshalb der Balken zurueck, waehrend Titel, Bild
        // und Quelle die des vorigen Titels blieben - bis jemand die Seite neu
        // lud. Das sah aus, als haette der Knopf nicht funktioniert.
        // ────────────────────────────────────────────────────────────────────
        const kennung = t ? String(t.url || t.title || '') : null;

        if (kennung !== angezeigterTitel) {
            // Von "es laeuft nichts" auf "es laeuft etwas" (oder umgekehrt)
            // aendert sich der ganze Aufbau der Karte, nicht nur ihr Inhalt.
            // Das baut der Server sauberer als wir hier - einmal neu laden.
            const hatteTitel = angezeigterTitel !== null;
            if (hatteTitel !== Boolean(t) && document.getElementById('music-titel') === null) {
                window.location.reload();
                return false;
            }

            angezeigterTitel = kennung;
            if (t) titelAnzeigen(t);
        }

        const positionFeld = document.getElementById('music-position');
        const balken = document.getElementById('music-balken');

        if (t && positionFeld) {
            positionFeld.textContent = `${dauer(t.positionSek)} / ${dauer(t.durationSec)}`;
        }
        if (t && balken) {
            balken.style.width = t.durationSec > 0
                ? Math.min(100, Math.round((t.positionSek / t.durationSec) * 100)) + '%'
                : '0%';
        }

        kopfzeileSetzen(z);

        return Boolean(t) && !z.pausiert;
    }

    /**
     * Titel, Bild und Quelle austauschen.
     *
     * @param {Object} t Der laufende Titel aus dem Zustand
     * @returns {void}
     */
    function titelAnzeigen(t) {
        const titel = document.getElementById('music-titel');
        if (titel) {
            titel.textContent = t.title || '';
            titel.href = t.herkunftUrl || t.url || '#';
        }

        const quelle = document.getElementById('music-quelle');
        if (quelle) quelle.textContent = t.source || '';

        const bild = document.getElementById('music-bild');
        if (bild) {
            if (t.thumbnail) {
                bild.style.backgroundImage = `url('${t.thumbnail}')`;
                bild.innerHTML = '';
            } else {
                // Kein Bild: das Notenzeichen zurueckholen, sonst bliebe das
                // Bild des vorigen Titels stehen.
                bild.style.backgroundImage = '';
                bild.innerHTML = '<i class="fa-solid fa-music"></i>';
            }
        }

        const balkenRahmen = document.getElementById('music-balken')?.parentElement;
        if (balkenRahmen) {
            balkenRahmen.style.visibility = t.durationSec > 0 ? '' : 'hidden';
        }
    }

    /**
     * Ueberschrift der Karte auf "Laeuft gerade" oder "Pausiert" setzen.
     *
     * @param {Object} z Zustand
     * @returns {void}
     */
    function kopfzeileSetzen(z) {
        const kopf = document.querySelector('#music-spieler .card-title');
        if (!kopf) return;

        const neu = z.pausiert ? text('PAUSIERT', 'Pausiert') : text('LAEUFT', 'Läuft gerade');
        if (kopf.textContent.trim() !== neu) kopf.textContent = neu;
    }

    /**
     * Den Fortschritt nachfuehren, aber nur so oft wie noetig.
     *
     * Ein fester Takt von einer Sekunde hat die Anfrage auch dann gestellt,
     * wenn gar nichts lief oder der Bot ueberhaupt nicht antwortete - jede
     * Anfrage ging als Rundruf ueber IPC und stand als Zeile im Bot-Protokoll.
     *
     * Deshalb: eine Sekunde nur bei laufender Wiedergabe, sonst fuenf, und bei
     * ausbleibender Antwort schrittweise bis auf dreissig Sekunden zurueck.
     * Ist die Seite im Hintergrund, ruht die Abfrage ganz.
     */
    function fortschrittVerfolgen() {
        const TAKT_LAEUFT = 1000;
        const TAKT_RUHT = 5000;
        const TAKT_MAX = 30000;

        let ruecklauf = TAKT_RUHT;
        let geplant = null;

        async function runde() {
            geplant = null;
            if (document.hidden) return planen(TAKT_RUHT);

            try {
                const laeuft = await zustandHolen();
                ruecklauf = TAKT_RUHT;
                planen(laeuft ? TAKT_LAEUFT : TAKT_RUHT);
            } catch {
                // Der Bot antwortet gerade nicht - langsamer nachfragen
                ruecklauf = Math.min(ruecklauf * 2, TAKT_MAX);
                planen(ruecklauf);
            }
        }

        /** Nur ein Wecker gleichzeitig, sonst laufen mehrere Ketten nebeneinander. */
        function planen(ms) {
            if (geplant !== null) window.clearTimeout(geplant);
            geplant = window.setTimeout(runde, ms);
        }

        // Kommt die Seite zurueck in den Vordergrund, sofort nachziehen
        document.addEventListener('visibilitychange', function () {
            if (!document.hidden) planen(0);
        });

        runde();
    }

    document.addEventListener('DOMContentLoaded', function () {
        // Beide Eingabefelder bekommen dieselbe Trefferliste - eines legt in
        // die Warteschlange, das andere in eine Wiedergabeliste
        vorschlaegeAnhaengen('music-eingabe');
        vorschlaegeAnhaengen('liste-eingabe');

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

        // Fortschritt nachfuehren, solange die Seite offen ist
        if (document.getElementById('music-spieler')) {
            fortschrittVerfolgen();
        }
    });
})();
