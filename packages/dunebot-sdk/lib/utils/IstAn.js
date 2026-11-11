'use strict';

/**
 * Liest einen Schalter aus `configs` als echtes An oder Aus (K365, 2026-11-11).
 *
 * `getConfigs()` liefert jeden Wert als Text, so wie er in der Tabelle steht.
 * Die Einstellungsseite schreibt `"1"` und `"0"`, die Vorgaben beim Anlegen
 * einer Guild ebenfalls. Gelesen wurde bis dahin mit `wert ?? true` — und
 * `"0"` ist ein nicht leerer Text, also wahr: Der Schalter „Slash-Befehle“
 * liess sich umlegen und tat nichts.
 *
 * Fehlt der Wert (keine Zeile, leer), gilt `vorgabe`. Ein Wert, der weder an
 * noch aus bedeutet, gilt ebenfalls als `vorgabe` — geraten wird nicht.
 *
 * @param {unknown} wert
 * @param {boolean} [vorgabe=true]
 * @returns {boolean}
 */
function istAn(wert, vorgabe = true) {
    if (wert === true || wert === 1) return true;
    if (wert === false || wert === 0) return false;
    if (typeof wert !== 'string') return vorgabe;
    const text = wert.trim().toLowerCase();
    if (text === '1' || text === 'true' || text === 'on') return true;
    if (text === '0' || text === 'false' || text === 'off') return false;
    return vorgabe;
}

module.exports = istAn;
