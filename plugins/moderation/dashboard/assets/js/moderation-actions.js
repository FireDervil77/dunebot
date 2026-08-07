/**
 * Moderation - geschuetzte Rollen, Kanalregeln, Notizen und Faelle
 *
 * Ersetzt den Inline-Block, der bis zum 2026-08-07 unten in der Tab-Seite
 * stand. Das CSRF-Token haengt der Theme-Helfer von selbst an `fetch`.
 */
(function () {
    'use strict';

    /** Basisadresse des Plugins in dieser Guild, aus dem Seitenrumpf gelesen. */
    function basis() {
        const wurzel = document.querySelector('[data-moderation-basis]');
        return wurzel ? wurzel.dataset.moderationBasis : '';
    }

    /** Text aus den Sprachdaten der Seite, mit Rueckfall. */
    function text(schluessel, ersatz) {
        const wurzel = document.querySelector('[data-moderation-texte]');
        if (!wurzel) return ersatz;
        try {
            return JSON.parse(wurzel.dataset.moderationTexte)[schluessel] || ersatz;
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
            throw new Error(inhalt.error || inhalt.message || text('FEHLER', 'Die Aktion ist fehlgeschlagen'));
        }
        return inhalt;
    }

    function fehlerMelden(err) {
        melden(err.message || text('FEHLER', 'Die Aktion ist fehlgeschlagen'), 'error');
    }

    // ==================== Geschuetzte Rollen ====================

    window.addProtectedRole = function () {
        const rolleId = document.getElementById('protectedRoleSelect')?.value;
        if (!rolleId) return melden(text('AUSWAHL_FEHLT', 'Bitte zuerst eine Rolle auswaehlen.'), 'warning');

        anfrage('POST', '/protected-roles', { role_id: rolleId })
            .then(function () { window.location.reload(); })
            .catch(fehlerMelden);
    };

    window.removeProtectedRole = function (rolleId) {
        if (!window.confirm(text('ROLLE_ENTFERNEN', 'Diese Rolle wirklich aus dem Schutz nehmen?'))) return;

        anfrage('DELETE', '/protected-roles/' + rolleId)
            .then(function () {
                melden(text('ROLLE_ENTFERNT', 'Rolle entfernt.'));
                document.getElementById('protected-role-' + rolleId)?.remove();
            })
            .catch(fehlerMelden);
    };

    // ==================== Kanalregeln ====================

    window.addChannelRule = function () {
        const kanal = document.getElementById('crChannelSelect')?.value;
        if (!kanal) return melden(text('KANAL_FEHLT', 'Bitte zuerst einen Kanal auswaehlen.'), 'warning');

        anfrage('POST', '/channel-rules', {
            channel_id: kanal,
            max_warn_limit: document.getElementById('crWarnLimit')?.value || null,
            max_warn_action: document.getElementById('crWarnAction')?.value || null,
            automod_exempt: document.getElementById('crAutomodExempt')?.checked ? 1 : 0,
            notes: document.getElementById('crNotes')?.value || null
        })
            .then(function () { window.location.reload(); })
            .catch(fehlerMelden);
    };

    window.removeChannelRule = function (id) {
        if (!window.confirm(text('REGEL_LOESCHEN', 'Diese Kanalregel wirklich loeschen?'))) return;

        anfrage('DELETE', '/channel-rules/' + id)
            .then(function () {
                melden(text('REGEL_GELOESCHT', 'Kanalregel geloescht.'));
                document.getElementById('channel-rule-' + id)?.remove();
            })
            .catch(fehlerMelden);
    };

    // ==================== Notizen ====================

    window.addNote = function () {
        const mitglied = (document.getElementById('noteUserId')?.value || '').trim();
        const notiz = (document.getElementById('noteText')?.value || '').trim();

        if (!mitglied || !notiz) {
            return melden(text('NOTIZ_UNVOLLSTAENDIG', 'Mitglieds-ID und Text sind erforderlich.'), 'warning');
        }

        anfrage('POST', '/notes', { user_id: mitglied, note: notiz })
            .then(function () { window.location.reload(); })
            .catch(fehlerMelden);
    };

    window.deleteNote = function (id) {
        if (!window.confirm(text('NOTIZ_LOESCHEN', 'Diese Notiz wirklich loeschen?'))) return;

        anfrage('DELETE', '/notes/' + id)
            .then(function () {
                melden(text('NOTIZ_GELOESCHT', 'Notiz geloescht.'));
                document.getElementById('note-' + id)?.remove();
            })
            .catch(fehlerMelden);
    };

    /** Notizen nach Mitglied filtern - rein im Browser, die Liste steht schon da. */
    window.filterNotes = function () {
        const suche = (document.getElementById('noteSearchUserId')?.value || '').trim();

        document.querySelectorAll('[data-note-user]').forEach(function (zeile) {
            const passt = !suche || zeile.dataset.noteUser.includes(suche);
            zeile.style.display = passt ? '' : 'none';
        });
    };

    // ==================== Faelle ====================

    /** Nach Art filtern: laedt die Seite mit dem gewaehlten Wert neu. */
    document.addEventListener('DOMContentLoaded', function () {
        const auswahl = document.getElementById('logTypeFilter');
        if (!auswahl) return;

        auswahl.addEventListener('change', function () {
            const ziel = new URL(window.location.href);
            if (auswahl.value) {
                ziel.searchParams.set('art', auswahl.value);
            } else {
                ziel.searchParams.delete('art');
            }
            ziel.searchParams.delete('seite');
            window.location.href = ziel.toString();
        });
    });
})();
