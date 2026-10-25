/*
 * Textregel im Browser (Stufe 9 S4): prüft ein Text- oder Passwortfeld schon
 * beim Tippen und sagt es dort, wo getippt wird.
 *
 * Die Rechnung ist dieselbe wie in helpers/Textregel.js (`fehlerNachRegel`);
 * scripts/check-textregel.js lädt diese Datei und vergleicht beide an einer
 * Tabelle. Entschieden wird trotzdem im Server — das hier ist Vorprüfung.
 *
 * Ein Feld nimmt teil mit `data-fb-regel='{"muster":…,"mindestens":…,
 * "hinweis":…,"beschrieben":…}'`; die Meldung landet im nächsten
 * `[data-fb-regel-meldung]` desselben Elternteils. `setCustomValidity` sorgt
 * dafür, dass ein Formular mit falschem Wert gar nicht erst abschickt.
 */
(function (global) {
  'use strict';

  function fehlerNachRegel(regel, wert) {
    if (!regel) return null;
    var text = wert === undefined || wert === null ? '' : String(wert);
    if (text === '') return null;
    if (regel.mindestens !== null && text.length < regel.mindestens) {
      return regel.beschrieben
        ? 'erfüllt die Vorgabe nicht — ' + regel.hinweis
        : 'mindestens ' + regel.mindestens + ' Zeichen, es sind ' + text.length;
    }
    if (regel.muster) {
      var ausdruck;
      try {
        ausdruck = new RegExp('^(?:' + regel.muster + ')$');
      } catch (e) {
        return 'die Prüfregel im Paket ist kein gültiger Ausdruck';
      }
      if (!ausdruck.test(text)) return 'erfüllt die Vorgabe nicht — ' + regel.hinweis;
    }
    return null;
  }

  function regelVon(feld) {
    try { return JSON.parse(feld.getAttribute('data-fb-regel')); } catch (e) { return null; }
  }

  /** Prüft ein Feld, zeigt das Ergebnis am Feld und liefert den Fehler oder null. */
  function pruefe(feld) {
    var fehler = fehlerNachRegel(regelVon(feld), feld.value);
    feld.setCustomValidity(fehler || '');
    feld.style.borderColor = fehler ? 'var(--fb-danger, #dc3545)' : '';
    var meldung = feld.parentNode && feld.parentNode.querySelector('[data-fb-regel-meldung]');
    if (meldung) {
      meldung.textContent = fehler || '';
      meldung.hidden = !fehler;
    }
    return fehler;
  }

  /** Alle Felder unter `wurzel`; liefert das erste falsche oder null. */
  function pruefeAlle(wurzel) {
    var erstes = null;
    (wurzel || document).querySelectorAll('[data-fb-regel]').forEach(function (feld) {
      if (pruefe(feld) && !erstes) erstes = feld;
    });
    return erstes;
  }

  global.fbTextregel = { fehlerNachRegel: fehlerNachRegel, pruefe: pruefe, pruefeAlle: pruefeAlle };

  if (typeof document === 'undefined') return;
  function anbinden() {
    document.querySelectorAll('[data-fb-regel]').forEach(function (feld) {
      feld.addEventListener('input', function () { pruefe(feld); });
      // Ein vorhandener falscher Wert (z. B. aus einer älteren Paketfassung)
      // soll gleich beim Öffnen auffallen, nicht erst beim Speichern.
      if (feld.value) pruefe(feld);
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', anbinden);
  else anbinden();
})(typeof window !== 'undefined' ? window : globalThis);
