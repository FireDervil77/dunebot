/**
 * AutoMod — Stichwortlisten
 *
 * Bedient die Seite `automod-stichwoerter.ejs`. Alle Aenderungen laufen ueber
 * die JSON-Routen unter `.../plugins/automod/stichwoerter/`, jede davon stoesst
 * serverseitig den Bot an — ohne das wuerde eine Aenderung erst nach einem
 * Bot-Neustart wirken.
 *
 * Die Woerter stehen verdeckt, wie der Bot sie im Protokoll mit ||spoiler||
 * verbirgt. Es sind Beleidigungen; wer sie braucht, deckt sie auf.
 *
 * @author FireBot Team
 */
(function () {
    'use strict';

    const anker = document.querySelector('[data-automod-basis]');
    if (!anker) return;
    const basis = anker.getAttribute('data-automod-basis');

    /** Meldung anzeigen — toastr, falls vorhanden. */
    function melden(text, art) {
        if (window.toastr) toastr[art || 'success'](text);
        else if (art === 'error') alert(text);
    }

    /**
     * Anfrage an eine der JSON-Routen.
     *
     * @param {string} pfad Pfad unterhalb der Basis
     * @param {string} methode
     * @param {Object} [koerper]
     * @returns {Promise<Object|null>} Antwort oder null bei Fehler
     */
    async function anfrage(pfad, methode, koerper) {
        try {
            const antwort = await fetch(basis + pfad, {
                method: methode,
                headers: { 'Content-Type': 'application/json' },
                body: koerper ? JSON.stringify(koerper) : undefined
            });
            const daten = await antwort.json().catch(function () { return {}; });

            if (!antwort.ok || !daten.success) {
                melden(daten.message || 'Die Änderung konnte nicht gespeichert werden.', 'error');
                return null;
            }
            return daten;
        } catch (err) {
            melden('Keine Verbindung zum Server.', 'error');
            return null;
        }
    }

    // ── Verdeckte Woerter aufdecken ──────────────────────────────────────
    document.querySelectorAll('[data-automod-aufdecken-schalter]').forEach(function (knopf) {
        knopf.addEventListener('click', function () {
            const karte = knopf.closest('.card-body') || document;
            karte.querySelectorAll('[data-automod-aufdecken]').forEach(function (bereich) {
                bereich.classList.toggle('automod-verdeckt');
            });
        });
    });

    // ── Neue Liste ───────────────────────────────────────────────────────
    const anlegenKnopf = document.getElementById('neueListeAnlegen');
    if (anlegenKnopf) {
        anlegenKnopf.addEventListener('click', async function () {
            const name = (document.getElementById('neueListeName').value || '').trim();
            const beschreibung = (document.getElementById('neueListeBeschreibung').value || '').trim();

            if (!name) {
                melden('Bitte einen Namen angeben.', 'error');
                return;
            }

            const ergebnis = await anfrage('/listen', 'POST', { name: name, description: beschreibung });
            if (ergebnis) location.reload();
        });
    }

    // ── Liste an/aus ─────────────────────────────────────────────────────
    document.querySelectorAll('[data-automod-liste-schalter]').forEach(function (schalter) {
        schalter.addEventListener('change', async function () {
            const listId = schalter.getAttribute('data-automod-liste-schalter');
            const ergebnis = await anfrage('/listen/' + listId, 'PUT', { enabled: schalter.checked });

            // Bei einem Fehler zurueckschnappen, sonst zeigt der Schalter etwas
            // an, das der Server nicht gespeichert hat.
            if (!ergebnis) schalter.checked = !schalter.checked;
        });
    });

    // ── Liste loeschen ───────────────────────────────────────────────────
    document.querySelectorAll('[data-automod-liste-loeschen]').forEach(function (knopf) {
        knopf.addEventListener('click', async function () {
            const listId = knopf.getAttribute('data-automod-liste-loeschen');
            const name = knopf.getAttribute('data-automod-liste-name') || '';

            if (!confirm('Die Liste "' + name + '" mit allen Wörtern löschen?')) return;

            const ergebnis = await anfrage('/listen/' + listId, 'DELETE');
            if (ergebnis) {
                const karte = document.getElementById('liste-' + listId);
                if (karte) karte.remove();
                melden('Liste gelöscht.');
            }
        });
    });

    // ── Wort hinzufuegen ─────────────────────────────────────────────────
    document.querySelectorAll('[data-automod-wort-hinzufuegen]').forEach(function (knopf) {
        knopf.addEventListener('click', async function () {
            const listId = knopf.getAttribute('data-automod-wort-hinzufuegen');
            const feld = document.querySelector('[data-automod-neues-wort="' + listId + '"]');
            const artFeld = document.querySelector('[data-automod-neue-trefferart="' + listId + '"]');
            const wort = (feld.value || '').trim();

            if (!wort) return;

            const ergebnis = await anfrage('/listen/' + listId + '/eintraege', 'POST', {
                keyword: wort,
                match_type: artFeld ? artFeld.value : 'word'
            });

            if (ergebnis) location.reload();
        });
    });

    // Eingabetaste im Wortfeld wie ein Klick auf Hinzufuegen.
    document.querySelectorAll('[data-automod-neues-wort]').forEach(function (feld) {
        feld.addEventListener('keydown', function (ereignis) {
            if (ereignis.key !== 'Enter') return;
            ereignis.preventDefault();
            const listId = feld.getAttribute('data-automod-neues-wort');
            const knopf = document.querySelector('[data-automod-wort-hinzufuegen="' + listId + '"]');
            if (knopf) knopf.click();
        });
    });

    // ── Trefferart aendern ───────────────────────────────────────────────
    document.querySelectorAll('[data-automod-trefferart]').forEach(function (auswahl) {
        let vorher = auswahl.value;
        auswahl.addEventListener('change', async function () {
            const keywordId = auswahl.getAttribute('data-automod-trefferart');
            const ergebnis = await anfrage('/eintraege/' + keywordId, 'PUT', { match_type: auswahl.value });

            if (ergebnis) vorher = auswahl.value;
            else auswahl.value = vorher;
        });
    });

    // ── Eintrag loeschen ─────────────────────────────────────────────────
    document.querySelectorAll('[data-automod-eintrag-loeschen]').forEach(function (verweis) {
        verweis.addEventListener('click', async function (ereignis) {
            ereignis.preventDefault();
            const keywordId = verweis.getAttribute('data-automod-eintrag-loeschen');

            const ergebnis = await anfrage('/eintraege/' + keywordId, 'DELETE');
            if (ergebnis) {
                const marke = document.getElementById('eintrag-' + keywordId);
                if (marke) marke.remove();
            }
        });
    });

    // ── Aus der Vorlage uebernehmen ──────────────────────────────────────
    document.querySelectorAll('[data-automod-uebernehmen]').forEach(function (knopf) {
        knopf.addEventListener('click', async function () {
            const templateId = knopf.getAttribute('data-automod-uebernehmen');

            knopf.disabled = true;
            const ergebnis = await anfrage('/abgleich/' + encodeURIComponent(templateId), 'POST');

            if (!ergebnis) {
                knopf.disabled = false;
                return;
            }

            melden(ergebnis.uebernommen + ' Wort/Wörter übernommen.');
            location.reload();
        });
    });
})();
