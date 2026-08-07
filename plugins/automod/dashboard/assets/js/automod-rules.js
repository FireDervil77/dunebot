/**
 * AutoMod - Regeln, Ausnahmen und Eskalation pflegen
 *
 * Ersetzt die Inline-Bloecke, die bis zum 2026-08-07 unten in der Tab-Seite
 * standen. Statt jQuery und `$.ajax` laeuft alles ueber `fetch`; das
 * CSRF-Token haengt der Theme-Helfer von selbst an.
 *
 * Die Schaltflaechen rufen weiterhin `window.<name>(...)` per `onclick` auf -
 * die Views sind serverseitig gerendert, das bleibt der kuerzeste Weg.
 */
(function () {
    'use strict';

    /** Basisadresse des Plugins in dieser Guild, aus dem Seitenrumpf gelesen. */
    function basis() {
        const wurzel = document.querySelector('[data-automod-basis]');
        return wurzel ? wurzel.dataset.automodBasis : '';
    }

    /** Text aus den Sprachdaten der Seite, mit Rueckfall. */
    function text(schluessel, ersatz) {
        const wurzel = document.querySelector('[data-automod-texte]');
        if (!wurzel) return ersatz;
        try {
            const texte = JSON.parse(wurzel.dataset.automodTexte);
            return texte[schluessel] || ersatz;
        } catch {
            return ersatz;
        }
    }

    /** Meldung anzeigen - toastr, falls vorhanden. */
    function melden(nachricht, art) {
        if (window.toastr && typeof window.toastr[art || 'success'] === 'function') {
            window.toastr[art || 'success'](nachricht);
        } else {
            window.alert(nachricht);
        }
    }

    /**
     * Anfrage an eine JSON-Route des Plugins.
     *
     * @param {string} methode GET, POST, PUT oder DELETE
     * @param {string} pfad Pfad unterhalb der Plugin-Basis
     * @param {Object} [daten] Rumpf der Anfrage
     * @returns {Promise<Object>} Antwort des Servers
     */
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
            throw new Error(inhalt.message || text('FEHLER', 'Die Aktion ist fehlgeschlagen'));
        }
        return inhalt;
    }

    /** Fehler einheitlich melden. */
    function fehlerMelden(err) {
        melden(err.message || text('FEHLER', 'Die Aktion ist fehlgeschlagen'), 'error');
    }

    /** Zeile ausblenden und entfernen. */
    function zeileEntfernen(auswahl) {
        const knoten = document.querySelector(auswahl);
        if (knoten) knoten.remove();
    }

    // ==================== Ausnahmen ====================

    window.addExemption = function (typ, zielId) {
        if (!zielId) return melden(text('AUSWAHL_FEHLT', 'Bitte zuerst etwas auswaehlen.'), 'warning');

        anfrage('POST', '/exemptions', { type: typ, target_id: zielId })
            .then(function () {
                melden(text('AUSNAHME_ANGELEGT', 'Ausnahme hinzugefuegt.'));
                window.location.reload();
            })
            .catch(fehlerMelden);
    };

    window.deleteExemption = function (id) {
        if (!window.confirm(text('AUSNAHME_LOESCHEN', 'Ausnahme wirklich entfernen?'))) return;

        anfrage('DELETE', '/exemptions/' + id)
            .then(function () {
                melden(text('AUSNAHME_ENTFERNT', 'Ausnahme entfernt.'));
                zeileEntfernen('[data-exemption-id="' + id + '"]');
            })
            .catch(fehlerMelden);
    };

    // ==================== Regex-Regeln ====================

    window.addRegexRule = function () {
        const name = (document.getElementById('regex-new-name')?.value || '').trim();
        const muster = (document.getElementById('regex-new-pattern')?.value || '').trim();
        const aktion = document.getElementById('regex-new-action')?.value;

        if (!name || !muster) {
            return melden(text('REGEX_UNVOLLSTAENDIG', 'Name und Muster sind erforderlich.'), 'warning');
        }

        anfrage('POST', '/regex-rules', { name: name, pattern: muster, action: aktion })
            .then(function () {
                melden(text('REGEL_ANGELEGT', 'Regel erstellt.'));
                window.location.reload();
            })
            .catch(fehlerMelden);
    };

    window.toggleRegexRule = function (id, aktiv) {
        anfrage('PUT', '/regex-rules/' + id, { enabled: aktiv })
            .then(function () {
                melden(aktiv
                    ? text('REGEL_AKTIV', 'Regel aktiviert.')
                    : text('REGEL_INAKTIV', 'Regel deaktiviert.'));
            })
            .catch(fehlerMelden);
    };

    window.deleteRegexRule = function (id) {
        if (!window.confirm(text('REGEL_LOESCHEN', 'Regel wirklich loeschen?'))) return;

        anfrage('DELETE', '/regex-rules/' + id)
            .then(function () {
                melden(text('REGEL_GELOESCHT', 'Regel geloescht.'));
                zeileEntfernen('#regex-rule-' + id);
            })
            .catch(fehlerMelden);
    };

    // ==================== Eskalation ====================

    window.addEscalation = function () {
        const schwelle = parseInt(document.getElementById('esc-new-threshold')?.value, 10);
        const aktion = document.getElementById('esc-new-action')?.value;
        const dauer = parseInt(document.getElementById('esc-new-duration')?.value, 10) || null;

        if (!schwelle || schwelle < 1) {
            return melden(text('SCHWELLE_UNGUELTIG', 'Bitte eine gueltige Schwelle eingeben.'), 'warning');
        }

        anfrage('POST', '/escalation', {
            threshold: schwelle,
            action: aktion,
            duration: aktion === 'TIMEOUT' ? dauer : null
        })
            .then(function () {
                melden(text('STUFE_ANGELEGT', 'Eskalationsstufe hinzugefuegt.'));
                window.location.reload();
            })
            .catch(fehlerMelden);
    };

    window.deleteEscalation = function (id) {
        if (!window.confirm(text('STUFE_LOESCHEN', 'Eskalationsstufe wirklich loeschen?'))) return;

        anfrage('DELETE', '/escalation/' + id)
            .then(function () {
                melden(text('STUFE_GELOESCHT', 'Eskalationsstufe geloescht.'));
                zeileEntfernen('#esc-row-' + id);
            })
            .catch(fehlerMelden);
    };

    window.createDefaultEscalation = function () {
        if (!window.confirm(text('STANDARD_ESKALATION', 'Standard-Eskalation anlegen? Bestehende Stufen bleiben erhalten.'))) return;

        anfrage('POST', '/escalation/defaults')
            .then(function () {
                melden(text('STANDARD_ANGELEGT', 'Standard-Eskalation angelegt.'));
                window.location.reload();
            })
            .catch(fehlerMelden);
    };

    /** Das Dauer-Feld gibt es nur bei Timeout. */
    window.toggleEscDuration = function () {
        const aktion = document.getElementById('esc-new-action')?.value;
        const gruppe = document.getElementById('esc-duration-group');
        if (gruppe) gruppe.style.display = aktion === 'TIMEOUT' ? '' : 'none';
    };

    // ==================== Kombinations-Regeln ====================

    let bedingungsZaehler = 0;

    /** Die Bedingungstypen liegen als JSON im Seitenrumpf. */
    function bedingungsTypen() {
        const wurzel = document.querySelector('[data-automod-bedingungen]');
        if (!wurzel) return {};
        try {
            return JSON.parse(wurzel.dataset.automodBedingungen);
        } catch {
            return {};
        }
    }

    window.addCompoundCondition = function () {
        const behaelter = document.getElementById('compoundConditions');
        if (!behaelter) return;

        const typen = bedingungsTypen();
        const id = bedingungsZaehler++;

        const zeile = document.createElement('div');
        zeile.className = 'row g-2 mb-2 align-items-end';
        zeile.id = 'compound-condition-' + id;

        const typAuswahl = Object.keys(typen)
            .map(function (schluessel) {
                return '<option value="' + schluessel + '">' + schluessel + '</option>';
            })
            .join('');

        zeile.innerHTML =
            '<div class="col-md-4">' +
              '<select class="form-select" data-bedingung="typ">' + typAuswahl + '</select>' +
            '</div>' +
            '<div class="col-md-3">' +
              '<select class="form-select" data-bedingung="operator">' +
                '<option value="=">=</option><option value="!=">!=</option>' +
                '<option value="&gt;">&gt;</option><option value="&lt;">&lt;</option>' +
                '<option value="contains">contains</option>' +
              '</select>' +
            '</div>' +
            '<div class="col-md-4">' +
              '<input type="text" class="form-control" data-bedingung="wert" placeholder="Wert">' +
            '</div>' +
            '<div class="col-md-1">' +
              '<button type="button" class="btn btn-outline-danger w-100" ' +
                'onclick="document.getElementById(\'compound-condition-' + id + '\').remove()">' +
                '<i class="fa-solid fa-xmark"></i>' +
              '</button>' +
            '</div>';

        behaelter.appendChild(zeile);
    };

    window.saveCompoundRule = function () {
        const name = (document.getElementById('compoundName')?.value || '').trim();
        const beschreibung = (document.getElementById('compoundDesc')?.value || '').trim();
        const verknuepfung = document.getElementById('compoundLogic')?.value;
        const aktion = document.getElementById('compoundAction')?.value;
        const dauer = parseInt(document.getElementById('compoundDuration')?.value, 10) || null;

        const bedingungen = Array.from(document.querySelectorAll('#compoundConditions .row'))
            .map(function (zeile) {
                return {
                    type: zeile.querySelector('[data-bedingung="typ"]')?.value,
                    operator: zeile.querySelector('[data-bedingung="operator"]')?.value,
                    value: zeile.querySelector('[data-bedingung="wert"]')?.value
                };
            })
            .filter(function (b) { return b.type && b.value !== ''; });

        if (!name || bedingungen.length === 0) {
            return melden(text('KOMBI_UNVOLLSTAENDIG', 'Name und mindestens eine Bedingung sind erforderlich.'), 'warning');
        }

        anfrage('POST', '/compound-rules', {
            name: name,
            description: beschreibung,
            conditions: bedingungen,
            logic: verknuepfung,
            action: aktion,
            duration: aktion === 'TIMEOUT' ? dauer : null
        })
            .then(function () {
                melden(text('REGEL_ANGELEGT', 'Regel erstellt.'));
                window.location.reload();
            })
            .catch(fehlerMelden);
    };

    window.toggleCompoundRule = function (id, aktiv) {
        anfrage('PUT', '/compound-rules/' + id, { enabled: aktiv })
            .then(function () {
                window.location.reload();
            })
            .catch(fehlerMelden);
    };

    window.deleteCompoundRule = function (id) {
        if (!window.confirm(text('KOMBI_LOESCHEN', 'Kombinations-Regel wirklich loeschen?'))) return;

        anfrage('DELETE', '/compound-rules/' + id)
            .then(function () {
                melden(text('REGEL_GELOESCHT', 'Regel geloescht.'));
                zeileEntfernen('#compound-rule-' + id);
            })
            .catch(fehlerMelden);
    };

    // Timeout-Dauer nur zeigen, wenn die Aktion sie braucht
    document.addEventListener('DOMContentLoaded', function () {
        const aktionsFeld = document.getElementById('compoundAction');
        const dauerFeld = document.getElementById('compoundDurationWrap');

        if (aktionsFeld && dauerFeld) {
            const pruefen = function () {
                dauerFeld.style.display = aktionsFeld.value === 'TIMEOUT' ? '' : 'none';
            };
            aktionsFeld.addEventListener('change', pruefen);
            pruefen();
        }

        if (document.getElementById('esc-new-action')) {
            window.toggleEscDuration();
        }
    });
})();
