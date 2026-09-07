/**
 * Giveaway - Verlosungen anlegen und steuern
 *
 * Ersetzt den Inline-Block, der bis zum 2026-08-07 unten in der Tab-Seite
 * stand. Das CSRF-Token haengt der Theme-Helfer von selbst an `fetch`.
 */
(function () {
    'use strict';

    /** Basisadresse des Plugins in dieser Guild. */
    function basis() {
        const wurzel = document.querySelector('[data-giveaway-basis]');
        return wurzel ? wurzel.dataset.giveawayBasis : '';
    }

    /**
     * Was der Stream-Weg pruefen kann.
     *
     * Kommt aus der Losquelle ueber den Seitenkopf. Ist die Liste leer, gibt
     * es das Streaming-Plugin hier nicht - dann bleibt die Wegauswahl weg,
     * statt eine Auswahl anzubieten, deren zweite Haelfte nichts enthaelt.
     */
    function streamArten() {
        const wurzel = document.querySelector('[data-giveaway-bedingungen]');
        if (!wurzel) return [];
        try {
            const liste = JSON.parse(wurzel.dataset.giveawayBedingungen);
            return Array.isArray(liste) ? liste : [];
        } catch {
            return [];
        }
    }

    /** Text aus den Sprachdaten der Seite, mit Rueckfall. */
    function text(schluessel, ersatz) {
        const wurzel = document.querySelector('[data-giveaway-texte]');
        if (!wurzel) return ersatz;
        try {
            return JSON.parse(wurzel.dataset.giveawayTexte)[schluessel] || ersatz;
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

    // ==================== Verlosung steuern ====================

    /** Bestaetigungstext je Vorgang. */
    const FRAGEN = {
        end:    ['VERLOSUNG_BEENDEN', 'Diese Verlosung jetzt beenden und Gewinner ziehen?'],
        reroll: ['NEU_ZIEHEN', 'Einen neuen Gewinner ziehen?'],
        delete: ['VERLOSUNG_LOESCHEN', 'Diese Verlosung endgueltig loeschen?']
    };

    window.giveawayAction = function (id, vorgang) {
        const frage = FRAGEN[vorgang];
        if (frage && !window.confirm(text(frage[0], frage[1]))) return;

        const methode = vorgang === 'delete' ? 'DELETE' : 'POST';
        const pfad = vorgang === 'delete' ? '/' + id : '/' + id + '/' + vorgang;

        anfrage(methode, pfad)
            .then(function () { window.location.reload(); })
            .catch(fehlerMelden);
    };

    // ==================== Anlegen ====================

    /** Anforderungen aus den dynamisch angelegten Zeilen einsammeln. */
    function leseAnforderungen() {
        return Array.from(document.querySelectorAll('#requirementsContainer [data-anforderung]'))
            .map(function (zeile) {
                const art = zeile.querySelector('[data-anforderung-art]');
                const wert = zeile.querySelector('[data-anforderung-wert]');
                return {
                    weg: zeile.querySelector('[data-anforderung-weg]')?.value || 'discord',
                    type: art?.value,
                    // **Eine Bedingung ohne Eingabefeld hat trotzdem einen Wert.**
                    // "Nur Abonnenten" braucht nichts eingetippt; ohne diese
                    // Zeile fiele sie unten aus dem Filter und waere lautlos
                    // weg - die Verlosung stuende dann offen fuer alle.
                    value: (wert && !wert.disabled) ? wert.value : '1'
                };
            })
            .filter(function (a) { return a.type && a.value; });
    }

    let anforderungZaehler = 0;

    window.addRequirement = function () {
        const behaelter = document.getElementById('requirementsContainer');
        if (!behaelter) return;

        const id = anforderungZaehler++;
        const zeile = document.createElement('div');
        zeile.className = 'row g-2 mb-2';
        zeile.id = 'anforderung-' + id;
        zeile.setAttribute('data-anforderung', '');

        // **Der Discord-Weg heisst `role`, nicht `required_role`.**
        // Hier stand bis zum 2026-09-07 `required_role`. Die Spalte war ein
        // ENUM('role','min_account_age','min_server_age') und die Datenbank
        // laeuft mit STRICT_TRANS_TABLES - eine Rollenbedingung aus dem
        // Dashboard haette also beim Anlegen geworfen, nachdem die Verlosung
        // schon geschrieben war. `checkRequirements` kennt ebenfalls nur
        // `role`; selbst ohne den Wurf haette die Bedingung nie gegriffen.
        const discordArten = [
            ['min_account_age', text('ANF_KONTOALTER', 'Mindestalter des Kontos (Tage)')],
            ['min_server_age',  text('ANF_SERVERZEIT', 'Mindestzeit auf dem Server (Tage)')],
            ['role',            text('ANF_ROLLE', 'Rolle erforderlich (ID)')]
        ];

        const stream = streamArten();

        /** Die Auswahl der Arten fuer einen Weg neu aufbauen. */
        function artenSetzen(weg) {
            const auswahl = zeile.querySelector('[data-anforderung-art]');
            const wert = zeile.querySelector('[data-anforderung-wert]');
            const liste = weg === 'stream'
                ? stream.map(function (b) { return [b.art, b.label, b.eingabe, b.hinweis]; })
                : discordArten.map(function (d) { return [d[0], d[1], 'zahl_oder_text']; });

            auswahl.innerHTML = liste.map(function (a) {
                return '<option value="' + a[0] + '" data-eingabe="' + (a[2] || '') + '">' + a[1] + '</option>';
            }).join('');
            wertfeldSetzen();
        }

        /** Braucht die gewaehlte Art ueberhaupt eine Eingabe? */
        function wertfeldSetzen() {
            const gewaehlt = zeile.querySelector('[data-anforderung-art]')?.selectedOptions?.[0];
            const wert = zeile.querySelector('[data-anforderung-wert]');
            const hinweisFeld = zeile.querySelector('[data-anforderung-hinweis]');
            const ohneEingabe = gewaehlt?.dataset.eingabe === 'keine';

            wert.disabled = ohneEingabe;
            wert.value = ohneEingabe ? '' : wert.value;
            wert.placeholder = ohneEingabe
                ? text('ANF_OHNE_WERT', 'kein Wert nötig')
                : text('ANF_WERT', 'Wert');

            const art = stream.find(function (b) { return b.art === gewaehlt?.value; });
            hinweisFeld.textContent = art?.hinweis || '';
        }

        zeile.innerHTML =
            (stream.length
                ? '<div class="col-3">' +
                    '<select class="form-select" data-anforderung-weg>' +
                      '<option value="discord">' + text('ANF_WEG_DISCORD', 'Discord') + '</option>' +
                      '<option value="stream">' + text('ANF_WEG_STREAM', 'Twitch-Chat') + '</option>' +
                    '</select>' +
                  '</div>'
                : '') +
            '<div class="' + (stream.length ? 'col-4' : 'col-5') + '">' +
              '<select class="form-select" data-anforderung-art></select>' +
            '</div>' +
            '<div class="' + (stream.length ? 'col-3' : 'col-5') + '">' +
              '<input type="text" class="form-control" data-anforderung-wert>' +
            '</div>' +
            '<div class="col-2">' +
              '<button type="button" class="btn btn-outline-danger w-100" ' +
                'onclick="document.getElementById(\'anforderung-' + id + '\').remove()">' +
                '<i class="fa-solid fa-xmark"></i>' +
              '</button>' +
            '</div>' +
            '<div class="col-12"><div class="form-hint" data-anforderung-hinweis></div></div>';

        behaelter.appendChild(zeile);

        artenSetzen('discord');
        zeile.querySelector('[data-anforderung-weg]')?.addEventListener('change', function (e) {
            artenSetzen(e.target.value);
        });
        zeile.querySelector('[data-anforderung-art]').addEventListener('change', wertfeldSetzen);
    };

    /** Felder aus einer Vorlage vorbelegen. */
    window.fillFromTemplate = function (rohConfig) {
        if (!rohConfig) return;

        let config;
        try {
            config = JSON.parse(rohConfig);
        } catch {
            return;
        }

        const form = document.getElementById('createGiveawayForm');
        if (!form) return;

        if (config.prize) form.querySelector('[name="prize"]').value = config.prize;
        if (config.duration) form.querySelector('[name="duration"]').value = String(config.duration);
        if (config.winner_count) form.querySelector('[name="winner_count"]').value = config.winner_count;
        if (config.claim_duration_ms) form.querySelector('[name="claim_duration"]').value = String(config.claim_duration_ms);
    };

    // ==================== Vorlagen und Sperrliste ====================

    window.deleteTemplate = function (id) {
        if (!window.confirm(text('VORLAGE_LOESCHEN', 'Diese Vorlage wirklich loeschen?'))) return;

        anfrage('DELETE', '/templates/' + id)
            .then(function () {
                melden(text('VORLAGE_GELOESCHT', 'Vorlage geloescht.'));
                document.getElementById('template-' + id)?.remove();
            })
            .catch(fehlerMelden);
    };

    window.removeBlacklist = function (mitgliedId) {
        if (!window.confirm(text('SPERRE_AUFHEBEN', 'Diese Sperre wirklich aufheben?'))) return;

        anfrage('DELETE', '/blacklist/' + mitgliedId)
            .then(function () {
                melden(text('SPERRE_AUFGEHOBEN', 'Sperre aufgehoben.'));
                document.getElementById('blacklist-' + mitgliedId)?.remove();
            })
            .catch(fehlerMelden);
    };

    // ==================== Formulare ====================

    document.addEventListener('DOMContentLoaded', function () {
        // Neue Verlosung
        const anlegen = document.getElementById('createGiveawayForm');
        if (anlegen) {
            anlegen.addEventListener('submit', function (e) {
                e.preventDefault();
                const daten = new FormData(anlegen);

                anfrage('POST', '/create', {
                    channel_id: daten.get('channel_id'),
                    prize: daten.get('prize'),
                    duration: daten.get('duration'),
                    winner_count: daten.get('winner_count'),
                    allowed_roles: Array.from(anlegen.querySelector('[name="allowed_roles"]')?.selectedOptions || [])
                        .map(function (o) { return o.value; }),
                    scheduled_start: daten.get('scheduled_start') || null,
                    claim_duration: daten.get('claim_duration') || null,
                    teilnahme: daten.get('teilnahme') || 'discord',
                    requirements: leseAnforderungen()
                })
                    .then(function () { window.location.reload(); })
                    .catch(fehlerMelden);
            });
        }

        // Neue Vorlage
        const vorlage = document.getElementById('createTemplateForm');
        if (vorlage) {
            vorlage.addEventListener('submit', function (e) {
                e.preventDefault();
                const daten = new FormData(vorlage);

                anfrage('POST', '/templates', {
                    name: daten.get('template_name'),
                    config: {
                        prize: daten.get('template_prize') || null,
                        duration: parseInt(daten.get('template_duration'), 10) || null,
                        winner_count: parseInt(daten.get('template_winners'), 10) || 1,
                        claim_duration_ms: parseInt(daten.get('template_claim'), 10) || null
                    }
                })
                    .then(function () { window.location.reload(); })
                    .catch(fehlerMelden);
            });
        }

        // Sperrliste
        const sperren = document.getElementById('addBlacklistForm');
        if (sperren) {
            sperren.addEventListener('submit', function (e) {
                e.preventDefault();
                const daten = new FormData(sperren);

                anfrage('POST', '/blacklist', {
                    user_id: daten.get('user_id'),
                    reason: daten.get('reason') || null
                })
                    .then(function () { window.location.reload(); })
                    .catch(fehlerMelden);
            });
        }

        // Restzeit laufend nachfuehren
        countdownStarten();
    });

    /** Zeigt bei allen `data-countdown`-Feldern die verbleibende Zeit. */
    function countdownStarten() {
        const felder = document.querySelectorAll('[data-countdown]');
        if (felder.length === 0) return;

        const aktualisieren = function () {
            const jetzt = Date.now();
            felder.forEach(function (feld) {
                const ziel = new Date(feld.dataset.countdown).getTime();
                const rest = ziel - jetzt;

                if (rest <= 0) {
                    feld.textContent = text('ABGELAUFEN', 'abgelaufen');
                    return;
                }

                const tage = Math.floor(rest / 86400000);
                const stunden = Math.floor((rest % 86400000) / 3600000);
                const minuten = Math.floor((rest % 3600000) / 60000);
                const sekunden = Math.floor((rest % 60000) / 1000);

                feld.textContent = tage > 0
                    ? `${tage} d ${stunden} h`
                    : (stunden > 0 ? `${stunden} h ${minuten} min` : `${minuten}:${String(sekunden).padStart(2, '0')}`);
            });
        };

        aktualisieren();
        setInterval(aktualisieren, 1000);
    }
})();
