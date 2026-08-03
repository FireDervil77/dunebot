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

        if (an) {
            sortiererStarten();
            huellenAusstatten();
        } else {
            sortierer.forEach(function (s) { s.destroy(); });
            sortierer = [];
            document.querySelectorAll('.widget-arrange-tools').forEach(function (el) { el.remove(); });
        }
    }

    function sortiererStarten() {
        bereiche.forEach(function (bereich) {
            sortierer.push(new Sortable(bereich, {
                group: 'dashboard-widgets',   // erlaubt das Ziehen zwischen Bereichen
                animation: 150,
                handle: '.widget-arrange-griff',
                ghostClass: 'widget-arrange-ghost',
                onSort: function () { geaendert = true; standAnzeigen(); }
            }));
        });
    }

    // ── Griff und Ausblenden-Knopf an jede Karte ────────────────────────────
    function huellenAusstatten() {
        document.querySelectorAll('[data-widget-area] > [data-widget-id]').forEach(function (huelle) {
            if (huelle.querySelector('.widget-arrange-tools')) return;

            var werkzeuge = document.createElement('div');
            werkzeuge.className = 'widget-arrange-tools';
            werkzeuge.innerHTML =
                '<button type="button" class="btn btn-sm btn-secondary widget-arrange-griff" title="Verschieben">' +
                '  <i class="fa-solid fa-up-down-left-right"></i>' +
                '</button>' +
                '<button type="button" class="btn btn-sm btn-secondary widget-arrange-hide" title="Ausblenden">' +
                '  <i class="fa-solid fa-eye"></i>' +
                '</button>';

            huelle.style.position = 'relative';
            huelle.prepend(werkzeuge);

            werkzeuge.querySelector('.widget-arrange-hide').addEventListener('click', function () {
                var versteckt = huelle.dataset.widgetHidden === '1';
                huelle.dataset.widgetHidden = versteckt ? '0' : '1';
                huelle.style.opacity = versteckt ? '' : '.4';
                this.querySelector('i').className = versteckt ? 'fa-solid fa-eye' : 'fa-solid fa-eye-slash';
                geaendert = true;
                standAnzeigen();
            });
        });
    }

    function standAnzeigen() {
        if (knopfSpeichern) knopfSpeichern.disabled = !geaendert;
    }

    // ── Aktuellen Stand einsammeln ──────────────────────────────────────────
    function standSammeln() {
        var widgets = [];

        bereiche.forEach(function (bereich) {
            var areaId = bereich.dataset.widgetArea;
            if (!areaId || areaId === 'unbekannt') return;

            Array.prototype.slice.call(bereich.children).forEach(function (huelle, i) {
                var id = huelle.dataset.widgetId;
                if (!id) return;
                widgets.push({
                    widget_id: id,
                    area: areaId,
                    position: (i + 1) * 10,
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
})();
