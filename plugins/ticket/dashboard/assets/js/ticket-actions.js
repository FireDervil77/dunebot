/**
 * Ticket - Einstellungen, Kategorien, Textbausteine und Transkripte
 *
 * Ersetzt den Inline-Block, der bis zum 2026-08-07 unten in der Tab-Seite
 * stand. Das CSRF-Token haengt der Theme-Helfer von selbst an `fetch`.
 */
(function () {
    'use strict';

    /** Basisadresse des Plugins in dieser Guild. */
    function basis() {
        const wurzel = document.querySelector('[data-ticket-basis]');
        return wurzel ? wurzel.dataset.ticketBasis : '';
    }

    /** Text aus den Sprachdaten der Seite, mit Rueckfall. */
    function text(schluessel, ersatz) {
        const wurzel = document.querySelector('[data-ticket-texte]');
        if (!wurzel) return ersatz;
        try {
            return JSON.parse(wurzel.dataset.ticketTexte)[schluessel] || ersatz;
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

    /** Gewaehlte Werte einer Mehrfachauswahl. */
    function gewaehlte(id) {
        const feld = document.getElementById(id);
        return feld ? Array.from(feld.selectedOptions).map(o => o.value) : [];
    }

    /** Eine Mehrfachauswahl auf die uebergebenen Werte setzen. */
    function setzeAuswahl(id, werte) {
        const feld = document.getElementById(id);
        if (!feld) return;
        const gesucht = (werte || []).map(String);
        Array.from(feld.options).forEach(o => { o.selected = gesucht.includes(String(o.value)); });
    }

    // ==================== Einstellungen ====================

    document.addEventListener('DOMContentLoaded', function () {
        const form = document.getElementById('ticketSettingsForm');
        if (!form) return;

        form.addEventListener('submit', function (e) {
            e.preventDefault();
            const daten = new FormData(form);

            anfrage('PUT', '/settings', {
                log_channel: daten.get('log_channel') || null,
                ticket_limit: daten.get('ticket_limit'),
                embed_color_create: daten.get('embed_color_create'),
                embed_color_close: daten.get('embed_color_close')
            })
                .then(function () { melden(text('GESPEICHERT', 'Gespeichert.')); })
                .catch(fehlerMelden);
        });
    });

    // ==================== Kategorien ====================

    /** Die gerenderten Kategorien, fuer das Bearbeiten ohne zweite Abfrage. */
    function kategorien() {
        const knoten = document.getElementById('categoriesData');
        if (!knoten) return [];
        try {
            return JSON.parse(knoten.textContent) || [];
        } catch {
            return [];
        }
    }

    /** Den Dialog oeffnen - leer beim Anlegen, gefuellt beim Bearbeiten. */
    window.openCategoryModal = function (kategorie) {
        const form = document.getElementById('categoryForm');
        if (!form) return;

        form.reset();
        document.getElementById('catId').value = kategorie ? kategorie.id : '';
        document.getElementById('categoryModalTitel').textContent =
            kategorie ? kategorie.name : document.getElementById('categoryModalTitel').textContent;

        if (kategorie) {
            document.getElementById('catName').value = kategorie.name || '';
            document.getElementById('catDescription').value = kategorie.description || '';
            document.getElementById('catStyle').value = kategorie.channel_style || 'NUMBER';
            document.getElementById('catButtonLabel').value = kategorie.button_label || 'Ticket erstellen';
            document.getElementById('catButtonEmoji').value = kategorie.button_emoji || '🎫';
            document.getElementById('catMaxOpen').value = kategorie.max_open_per_user || 1;
            document.getElementById('catOpenTitle').value = kategorie.open_msg_title || '';
            document.getElementById('catOpenDescription').value = kategorie.open_msg_description || '';
            document.getElementById('catActive').checked = Boolean(kategorie.is_active);
            setzeAuswahl('catStaffRoles', kategorie.staff_roles);
            setzeAuswahl('catMemberRoles', kategorie.member_roles);
        } else {
            document.getElementById('catActive').checked = true;
        }

        const dialog = document.getElementById('categoryModal');
        if (dialog && window.bootstrap) {
            window.bootstrap.Modal.getOrCreateInstance(dialog).show();
        }
    };

    window.editCategory = function (id) {
        const kategorie = kategorien().find(k => Number(k.id) === Number(id));
        if (!kategorie) return melden(text('FEHLER', 'Die Aktion ist fehlgeschlagen'), 'error');
        window.openCategoryModal(kategorie);
    };

    window.deleteCategory = function (id, name) {
        const frage = text('KAT_LOESCHEN', 'Kategorie "{name}" wirklich loeschen?').replace('{name}', name);
        if (!window.confirm(frage)) return;

        anfrage('DELETE', '/categories/' + id)
            .then(function () {
                melden(text('KAT_GELOESCHT', 'Kategorie geloescht.'));
                document.querySelector(`[data-category-id="${id}"]`)?.remove();
            })
            .catch(fehlerMelden);
    };

    document.addEventListener('DOMContentLoaded', function () {
        const form = document.getElementById('categoryForm');
        if (!form) return;

        form.addEventListener('submit', function (e) {
            e.preventDefault();

            const id = document.getElementById('catId').value;
            const name = document.getElementById('catName').value.trim();
            if (!name) return melden(text('KAT_UNVOLLSTAENDIG', 'Ein Name ist erforderlich.'), 'warning');

            const rumpf = {
                name,
                description: document.getElementById('catDescription').value.trim() || null,
                channel_style: document.getElementById('catStyle').value,
                staff_roles: gewaehlte('catStaffRoles'),
                member_roles: gewaehlte('catMemberRoles'),
                button_label: document.getElementById('catButtonLabel').value.trim() || 'Ticket erstellen',
                button_emoji: document.getElementById('catButtonEmoji').value.trim() || '🎫',
                max_open_per_user: document.getElementById('catMaxOpen').value,
                open_msg_title: document.getElementById('catOpenTitle').value.trim() || null,
                open_msg_description: document.getElementById('catOpenDescription').value.trim() || null,
                is_active: document.getElementById('catActive').checked
            };

            const methode = id ? 'PUT' : 'POST';
            const pfad = id ? '/categories/' + id : '/categories';

            anfrage(methode, pfad, rumpf)
                .then(function () { window.location.reload(); })
                .catch(fehlerMelden);
        });
    });

    // ==================== Textbausteine ====================

    window.addTag = function () {
        const name = (document.getElementById('tagName')?.value || '').trim();
        const inhalt = (document.getElementById('tagContent')?.value || '').trim();

        if (!name || !inhalt) {
            return melden(text('BAUSTEIN_UNVOLLSTAENDIG', 'Name und Inhalt sind erforderlich.'), 'warning');
        }

        anfrage('POST', '/tags', { name: name, content: inhalt })
            .then(function () { window.location.reload(); })
            .catch(fehlerMelden);
    };

    window.deleteTag = function (id) {
        if (!window.confirm(text('BAUSTEIN_LOESCHEN', 'Diesen Textbaustein wirklich loeschen?'))) return;

        anfrage('DELETE', '/tags/' + id)
            .then(function () {
                melden(text('BAUSTEIN_GELOESCHT', 'Textbaustein geloescht.'));
                document.getElementById('tag-' + id)?.remove();
            })
            .catch(fehlerMelden);
    };

    // ==================== Transkript ====================

    window.showTranscript = function (id) {
        anfrage('GET', '/tickets/api/' + id + '/transcript')
            .then(function (antwort) {
                const feld = document.getElementById('transcriptInhalt');
                if (feld) {
                    feld.textContent = typeof antwort.transcript === 'string'
                        ? antwort.transcript
                        : JSON.stringify(antwort.transcript, null, 2);
                }
                const dialog = document.getElementById('transcriptModal');
                if (dialog && window.bootstrap) {
                    window.bootstrap.Modal.getOrCreateInstance(dialog).show();
                }
            })
            .catch(function () {
                melden(text('KEIN_TRANSKRIPT', 'Fuer dieses Ticket gibt es kein Transkript.'), 'warning');
            });
    };
})();
