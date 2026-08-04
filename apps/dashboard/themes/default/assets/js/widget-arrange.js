/**
 * Widgets direkt im Dashboard anordnen
 *
 * Bis hierher lag das Sortieren auf einer eigenen Seite unter
 * `/themes/widgets`. Das ist der falsche Ort: Man ordnet etwas dort an, wo man
 * es sieht. Dieses Skript schaltet das Dashboard selbst in einen Anordnen-Modus
 * — Karten lassen sich zwischen den Bereichen ziehen und ausblenden.
 *
 * Erwartet im Markup:
 *   [data-widget-area="<id>"]   — ein Bereich (die Zeile)
 *   [data-widget-id="<id>"]     — die Huelle einer Karte darin
 *
 * Gespeichert wird ueber POST /guild/:guildId/themes/widgets — dieselbe Route,
 * die die alte Seite benutzt. Der CSRF-Token kommt aus csrf-helper.js, das
 * `fetch` global erweitert.
 *
 * @author FireDervil
 */
(function () {
    'use strict';

    var wurzel = document.querySelector('[data-widget-arrange]');
    if (!wurzel || typeof Sortable === 'undefined') return;

    var guildId   = wurzel.dataset.guildId;
    var bereiche  = Array.prototype.slice.call(document.querySelectorAll('[data-widget-area]'));
    var sortierer = [];
    var aktiv     = false;
    var geaendert = false;

    var knopfAnordnen = document.getElementById('widget-arrange-toggle');
    var leiste        = document.getElementById('widget-arrange-bar');
    var knopfSpeichern = document.getElementById('widget-arrange-save');
    var knopfAbbrechen = document.getElementById('widget-arrange-cancel');

    // ── Modus ein- und ausschalten ──────────────────────────────────────────
    function modusSetzen(an) {
        aktiv = an;
        document.body.classList.toggle('widget-arrange-active', an);
        if (leiste) leiste.classList.toggle('d-none', !an);
        if (knopfAnordnen) {
            knopfAnordnen.classList.toggle('active', an);
            knopfAnordnen.setAttribute('aria-pressed', an ? 'true' : 'false');
        }

        versteckteZeigen(an);

        if (an) {
            sortiererStarten();
            huellenAusstatten();
            verwaisteMelden();
        } else {
            sortierer.forEach(function (s) { s.destroy(); });
            sortierer = [];
            document.querySelectorAll('.widget-arrange-tools').forEach(function (el) { el.remove(); });
        }
    }

    function sortiererStarten() {
        // Ebenfalls frisch: sonst laesst sich in einen Bereich, der beim
        // Seitenaufbau leer war, nichts hineinziehen.
        bereiche = Array.prototype.slice.call(document.querySelectorAll('[data-widget-area]'));

        bereiche.forEach(function (bereich) {
            sortierer.push(new Sortable(bereich, {
                group: 'dashboard-widgets',   // erlaubt das Ziehen zwischen Bereichen
                animation: 150,
                handle: '.widget-arrange-griff',
                ghostClass: 'widget-arrange-ghost',
                onSort: function () { geaendert = true; huellenAusstatten(); standAnzeigen(); }
            }));
        });
    }

    /**
     * Sichtbarkeit einer Karte setzen — die einzige Stelle, die das tut.
     * Ausserhalb des Anordnen-Modus verschwindet eine ausgeblendete Karte
     * ganz; im Modus bleibt sie blass stehen, damit man sie zurueckholen kann.
     *
     * @param {string} id
     * @param {boolean} sichtbar
     */
    function sichtbarkeitSetzen(id, sichtbar) {
        var huelle = document.querySelector('[data-widget-id="' + CSS.escape(id) + '"]');
        if (!huelle) return;

        huelle.dataset.widgetHidden = sichtbar ? '0' : '1';
        huelle.hidden = !sichtbar && !aktiv;
        huelle.style.opacity = sichtbar ? '' : '.4';

        var auge = huelle.querySelector('.widget-arrange-hide i');
        if (auge) auge.className = sichtbar ? 'fa-solid fa-eye' : 'fa-solid fa-eye-slash';

        var haken = document.querySelector('.widget-visibility-toggle[data-widget-target="' + CSS.escape(id) + '"]');
        if (haken) haken.checked = sichtbar;

        geaendert = true;
        standAnzeigen();
    }

    /**
     * Erlaubte Breiten im 12er-Raster. Nur Teiler von 12, damit Zeilen
     * aufgehen und keine halben Luecken entstehen.
     */
    var BREITEN = [3, 4, 6, 12];

    /** Aktuelle Breite einer Huelle aus ihrer col-md-Klasse lesen. */
    function breiteLesen(huelle) {
        var treffer = /\bcol-md-(\d+)\b/.exec(huelle.className);
        return treffer ? parseInt(treffer[1], 10) : 12;
    }

    /**
     * Breite einer Karte um eine Stufe aendern.
     *
     * @param {HTMLElement} huelle
     * @param {number} richtung - -1 schmaler, +1 breiter
     */
    function breiteAendern(huelle, richtung) {
        var jetzt = breiteLesen(huelle);
        var i = BREITEN.indexOf(jetzt);
        if (i === -1) {
            // Unbekannte Breite auf die naechstgroessere aus der Liste ziehen
            i = BREITEN.findIndex(function (b) { return b >= jetzt; });
            if (i === -1) i = BREITEN.length - 1;
        }

        var neu = BREITEN[Math.min(BREITEN.length - 1, Math.max(0, i + richtung))];
        if (neu === jetzt) return;

        huelle.className = huelle.className.replace(/\bcol-md-\d+\b/, 'col-md-' + neu);
        huelle.dataset.widgetSize = String(neu);
        geaendert = true;
        standAnzeigen();
    }

    /** Im Anordnen-Modus werden auch ausgeblendete Karten gezeigt. */
    function versteckteZeigen(zeigen) {
        document.querySelectorAll('[data-widget-hidden="1"]').forEach(function (huelle) {
            huelle.hidden = !zeigen;
            huelle.style.opacity = '.4';
        });
    }

    // ── Griff und Werkzeuge an jede Karte ───────────────────────────────────
    /**
     * Jeder Karte ihre Werkzeugleiste geben.
     *
     * Wird nicht nur beim Einschalten gerufen, sondern auch nach jedem
     * Verschieben — sonst steht eine Karte, die den Bereich gewechselt hat,
     * ohne Werkzeuge da.
     *
     * Jede Huelle wird einzeln abgesichert: Vorher hing alles an einer
     * Schleife, und ein Fehler bei einer Karte liess alle folgenden leer
     * ausgehen.
     */
    function huellenAusstatten() {
        document.querySelectorAll('[data-widget-area] > [data-widget-id]').forEach(function (huelle) {
            try {
                if (huelle.querySelector(':scope > .widget-arrange-tools')) return;

                var werkzeuge = document.createElement('div');
                werkzeuge.className = 'widget-arrange-tools';
                werkzeuge.innerHTML =
                    '<button type="button" class="btn btn-sm btn-secondary widget-arrange-griff" title="Verschieben">' +
                    '  <i class="fa-solid fa-up-down-left-right"></i>' +
                    '</button>' +
                    '<button type="button" class="btn btn-sm btn-secondary widget-arrange-schmaler" title="Schmaler">' +
                    '  <i class="fa-solid fa-left-right"></i><i class="fa-solid fa-minus ms-1 small"></i>' +
                    '</button>' +
                    '<button type="button" class="btn btn-sm btn-secondary widget-arrange-breiter" title="Breiter">' +
                    '  <i class="fa-solid fa-left-right"></i><i class="fa-solid fa-plus ms-1 small"></i>' +
                    '</button>' +
                    '<button type="button" class="btn btn-sm btn-secondary widget-arrange-hide" title="Ausblenden">' +
                    '  <i class="fa-solid ' + (huelle.dataset.widgetHidden === '1' ? 'fa-eye-slash' : 'fa-eye') + '"></i>' +
                    '</button>';

                huelle.style.position = 'relative';
                huelle.prepend(werkzeuge);
            } catch (fehler) {
                console.warn('[Anordnen] Werkzeuge fuer eine Karte uebersprungen:', fehler);
            }
        });
    }

    function standAnzeigen() {
        if (knopfSpeichern) knopfSpeichern.disabled = !geaendert;
    }

    /**
     * Karten melden, die in keinem Bereich haengen.
     *
     * Ein einziges ueberzaehliges </div> in einer Widget-Vorlage schliesst die
     * Zeile im Browser zu frueh — die folgenden Huellen stehen danach *neben*
     * dem Bereich statt darin. Sie bekommen dann keine Werkzeuge, lassen sich
     * nicht ziehen und fehlen beim Speichern. Vorher passierte das lautlos;
     * jetzt sagt es die Konsole.
     */
    function verwaisteMelden() {
        var verwaist = Array.prototype.slice
            .call(document.querySelectorAll('[data-widget-id][data-widget-hidden]'))
            .filter(function (huelle) { return !huelle.closest('[data-widget-area]'); })
            .map(function (huelle) { return huelle.dataset.widgetId; });

        if (verwaist.length) {
            console.warn(
                '[Anordnen] Diese Karten haengen in keinem Bereich und lassen sich ' +
                'weder ziehen noch speichern — meist ein ueberzaehliges </div> in der ' +
                'Vorlage der Karte davor:', verwaist
            );
        }
    }

    // ── Aktuellen Stand einsammeln ──────────────────────────────────────────
    function standSammeln() {
        var widgets = [];

        // Bewusst frisch abfragen: `bereiche` stammt vom Seitenaufbau. Wird
        // waehrend des Anordnens etwas nachgezeichnet, ginge sonst ein ganzer
        // Bereich beim Speichern verloren.
        var aktuelleBereiche = Array.prototype.slice.call(
            document.querySelectorAll('[data-widget-area]')
        );

        aktuelleBereiche.forEach(function (bereich) {
            var areaId = bereich.dataset.widgetArea;
            if (!areaId) return;

            Array.prototype.slice.call(bereich.children).forEach(function (huelle, i) {
                var id = huelle.dataset.widgetId;
                if (!id) return;
                widgets.push({
                    widget_id: id,
                    area: areaId,
                    position: (i + 1) * 10,
                    size: breiteLesen(huelle),
                    visible: huelle.dataset.widgetHidden !== '1'
                });
            });
        });

        return widgets;
    }

    // ── Speichern ───────────────────────────────────────────────────────────
    function speichern() {
        var widgets = standSammeln();
        knopfSpeichern.disabled = true;

        fetch('/guild/' + guildId + '/themes/widgets', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ widgets: widgets })
        })
            .then(function (r) { return r.json(); })
            .then(function (d) {
                if (d && d.success) {
                    window.location.reload();
                } else {
                    melden('error', (d && d.message) || 'Anordnung konnte nicht gespeichert werden.');
                    knopfSpeichern.disabled = false;
                }
            })
            .catch(function () {
                melden('error', 'Netzwerkfehler beim Speichern.');
                knopfSpeichern.disabled = false;
            });
    }

    /** Nutzt das Toast-System, wenn es da ist — sonst schlicht. */
    function melden(art, text) {
        if (window.showToast) return window.showToast(art, text);
        if (window.toastr && window.toastr[art]) return window.toastr[art](text);
        alert(text);
    }

    // ── Verdrahten ──────────────────────────────────────────────────────────
    // Ein Zuhoerer am Dokument statt einer pro Knopf: Karten, die Sortable
    // verschiebt, bringen ihre Bedienung damit automatisch mit.
    document.addEventListener('click', function (e) {
        var knopf = e.target.closest('.widget-arrange-tools button');
        if (!knopf) return;

        var huelle = knopf.closest('[data-widget-id]');
        if (!huelle) return;
        e.preventDefault();

        if (knopf.classList.contains('widget-arrange-hide')) {
            sichtbarkeitSetzen(huelle.dataset.widgetId, huelle.dataset.widgetHidden === '1');
        } else if (knopf.classList.contains('widget-arrange-schmaler')) {
            breiteAendern(huelle, -1);
        } else if (knopf.classList.contains('widget-arrange-breiter')) {
            breiteAendern(huelle, +1);
        }
    });

    if (knopfAnordnen) {
        knopfAnordnen.addEventListener('click', function () { modusSetzen(!aktiv); });
    }
    if (knopfAbbrechen) {
        knopfAbbrechen.addEventListener('click', function () {
            if (geaendert) { window.location.reload(); return; }
            modusSetzen(false);
        });
    }
    if (knopfSpeichern) {
        knopfSpeichern.addEventListener('click', speichern);
        knopfSpeichern.disabled = true;
    }

    // Haken in der Ansicht-anpassen-Klappe
    document.querySelectorAll('.widget-visibility-toggle').forEach(function (haken) {
        haken.addEventListener('change', function () {
            sichtbarkeitSetzen(this.dataset.widgetTarget, this.checked);
            // Ohne den Modus gibt es keinen Speichern-Knopf — also einblenden
            if (!aktiv) modusSetzen(true);
        });
    });
})();
