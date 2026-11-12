/**
 * Welche GameDig-Protokolle spricht fb-probe selbst? (K259)
 *
 * fb-probe schickt genau eine Anfrage: A2S_INFO mit Challenge-Runde
 * (`firebot_daemon/internal/probe/a2s.go`). Bis 2026-11-12 galt als abfragbar
 * nur, wessen GameDig-Protokoll wörtlich `valve` heißt. GameDig kennt aber
 * Protokolle, die von `valve` ERBEN — 7 Days to Die (`sdtd`) hängt nur eine
 * Telnet-Runde hinten an, die Abfrage selbst ist dieselbe. Die Bereitschaft
 * von 7 Days endete deshalb bei „Port offen“ (Baustelle 220).
 *
 * Diese Datei ist die EINE Quelle: `scripts/erzeuge-a2s-kennungen.js` erzeugt
 * daraus die Tabelle des Daemons, die Werkbank liest daraus „belegbar“. Jedes
 * erbende Protokoll steht in genau einer der beiden Listen, mit Begründung —
 * das Erzeugerskript bricht ab, wenn GameDig ein neues mitbringt, das hier
 * fehlt. Aufgenommen wird nur, was GEMESSEN ist; „laut Code gleich“ reicht
 * nicht.
 */
'use strict';

/** GameDig-Protokoll → Beleg, dass eine schlichte A2S_INFO beantwortet wird. */
const SPRICHT_A2S = Object.freeze({
    valve: 'das Protokoll selbst',
    sdtd: 'gemessen 2026-11-02 an Server 231, Port 25009: protocol-valve antwortet; sdtd.js ruft super.run und hängt nur Telnet an',
});

/** Erbt von `valve`, wird aber NICHT aufgenommen — mit Grund. */
const ERBT_ABER_NICHT = Object.freeze({
    dayz: 'laut dayz.js dieselbe Info-Anfrage, aber an keinem Server gemessen',
    ffow: 'eigene Info-Anfrage (0x46 „LSQ“), andere Antwort',
    goldsrc: 'alte Info-Anfrage („details“, Antwort 0x6D), die a2s.go nicht liest',
    toxikk: 'eigener Ablauf (run überschrieben), nicht gemessen',
});

/** Spricht dieser Eintrag aus GameDigs Spieltabelle A2S, so wie fb-probe fragt? */
function sprichtA2S(eintrag) {
    const protokoll = eintrag && eintrag.options ? eintrag.options.protocol : undefined;
    return typeof protokoll === 'string' && Object.prototype.hasOwnProperty.call(SPRICHT_A2S, protokoll);
}

module.exports = { SPRICHT_A2S, ERBT_ABER_NICHT, sprichtA2S };
