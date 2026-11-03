/**
 * Ein Auge an jedem Kennwortfeld (2026-11-03).
 *
 * Der Betreiber: „dann bräuchte es an allen Passwortfeldern ein Auge, um sie
 * sichtbar machen zu können." Kennwortfelder entstehen an vielen Stellen, aus
 * Paket-Einstellungen vom Typ `password`, in der Werkbank auch erst per Skript.
 * Statt jede Vorlage einzeln umzubauen, stattet dieses Skript jedes
 * `input[type=password]` im Guild-Bereich aus, auch später eingefügte. Ein neues
 * Feld braucht dafür nichts.
 *
 * Ein Tabler-Feld (`.form-control`) bekommt den Knopf in einer `.input-group`: Steht
 * es schon in einer, kommt er dahinter, sonst wird es in eine gelegt. Felder im
 * eigenen Stil, etwa `.fb-feld` im Server-Panel, bekommen das Auge rechts ins Feld:
 * Eine Tabler-Gruppe sähe dort fremd aus, und ihr `width:100%` sprengte die Zeile.
 * In `.form-floating` bleibt alles, wie es ist: Dort hängt das Label am Feld, eine
 * Gruppe darum zerlegte es.
 *
 * Eine Hülle, die dieses Skript anlegt, trägt `data-kennwort-huelle`. Wer vom Feld aus
 * etwas „daneben" sucht, muss über sie hinweg (`textregel.js` sucht so seine Meldung).
 */
(function (wurzel) {
    'use strict';

    var ZEIGEN = 'Kennwort anzeigen';
    var VERBERGEN = 'Kennwort verbergen';

    function ausstatten(input, doc) {
        if (!input || input.tagName !== 'INPUT' || input.type !== 'password') return false;
        if (input.dataset.auge) return false;
        var eltern = input.parentNode;
        if (!eltern || (eltern.classList && eltern.classList.contains('form-floating'))) return false;
        input.dataset.auge = '1';
        var tabler = input.classList.contains('form-control');

        var gruppe = eltern;
        if (tabler && !(eltern.classList && eltern.classList.contains('input-group'))) {
            gruppe = doc.createElement('div');
            gruppe.className = 'input-group' + (input.classList.contains('form-control-sm') ? ' input-group-sm' : '');
            gruppe.setAttribute('data-kennwort-huelle', '');
            eltern.insertBefore(gruppe, input);
            gruppe.appendChild(input);
        } else if (!tabler) {
            gruppe = doc.createElement('span');
            gruppe.style.position = 'relative';
            gruppe.style.display = 'block';
            gruppe.setAttribute('data-kennwort-huelle', '');
            eltern.insertBefore(gruppe, input);
            gruppe.appendChild(input);
            input.style.paddingRight = '34px';
        }

        var knopf = doc.createElement('button');
        knopf.type = 'button';
        if (tabler) {
            knopf.className = 'btn btn-outline-secondary';
        } else {
            knopf.style.cssText = 'position:absolute;right:4px;top:50%;transform:translateY(-50%);'
                + 'border:0;background:transparent;padding:4px 6px;line-height:1;color:var(--fb-text-muted, #667382);cursor:pointer';
        }
        knopf.setAttribute('aria-label', ZEIGEN);
        knopf.setAttribute('aria-pressed', 'false');
        knopf.title = ZEIGEN;
        knopf.disabled = Boolean(input.disabled);
        var symbol = doc.createElement('i');
        symbol.className = 'fa-solid fa-eye';
        symbol.setAttribute('aria-hidden', 'true');
        knopf.appendChild(symbol);

        knopf.addEventListener('click', function () {
            var offen = input.type === 'password';
            input.type = offen ? 'text' : 'password';
            symbol.className = offen ? 'fa-solid fa-eye-slash' : 'fa-solid fa-eye';
            knopf.setAttribute('aria-pressed', offen ? 'true' : 'false');
            knopf.setAttribute('aria-label', offen ? VERBERGEN : ZEIGEN);
            knopf.title = offen ? VERBERGEN : ZEIGEN;
        });

        // Hinter das Feld, nicht ans Ende: Eine vorhandene Gruppe kann rechts schon
        // einen Knopf tragen, etwa „Kopieren".
        gruppe.insertBefore(knopf, input.nextSibling);
        return true;
    }

    function durchsuche(knoten, doc) {
        if (!knoten || knoten.nodeType !== 1) return;
        if (knoten.matches && knoten.matches('input[type="password"]')) ausstatten(knoten, doc);
        if (knoten.querySelectorAll) {
            var felder = knoten.querySelectorAll('input[type="password"]');
            for (var i = 0; i < felder.length; i++) ausstatten(felder[i], doc);
        }
    }

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { ausstatten: ausstatten, durchsuche: durchsuche };
        return;
    }

    function starte() {
        durchsuche(wurzel.document.body, wurzel.document);
        // Später eingefügte Felder, und solche, die erst per Skript zum Kennwort werden.
        new wurzel.MutationObserver(function (aenderungen) {
            aenderungen.forEach(function (a) {
                if (a.type === 'attributes') durchsuche(a.target, wurzel.document);
                else for (var i = 0; i < a.addedNodes.length; i++) durchsuche(a.addedNodes[i], wurzel.document);
            });
        }).observe(wurzel.document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['type'] });
    }

    if (wurzel.document.readyState === 'loading') wurzel.document.addEventListener('DOMContentLoaded', starte);
    else starte();
})(typeof window !== 'undefined' ? window : this);
