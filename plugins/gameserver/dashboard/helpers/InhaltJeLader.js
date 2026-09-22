'use strict';

/**
 * Der Inhaltsvertrag haengt am gewaehlten Lader (Minecraft, Stufe 3).
 *
 * ── Warum es diese Datei gibt ───────────────────────────────────────────────
 *
 * Bis zum 2026-09-22 hatte ein Paket GENAU EINEN Inhaltsvertrag: ein Lader, ein
 * Ablageort, ein Katalograum. Das passt auf Valheim (BepInEx, Thunderstore,
 * `game/BepInEx/plugins`) und bricht bei Minecraft in jedem Punkt:
 *
 *   Paper     Plugins nach `plugins/`, Modrinth-Raum `paper`
 *   Fabric    Mods    nach `mods/`,    Modrinth-Raum `fabric`
 *   NeoForge  Mods    nach `mods/`,    Modrinth-Raum `neoforge`
 *   Vanilla   nichts — es gibt keinen Ort, an den ein Mod gehoerte
 *
 * ── Warum aufloesen und nicht ueberall nachsehen ────────────────────────────
 *
 * `content` wird an ZWOELF Stellen gelesen (`routes/inhalte.js`, `index.js`,
 * die Startnutzlast) und ausserdem vom Daemon. Jede einzelne um ein „welcher
 * Lader?" zu ergaenzen waere der sichere Weg in zwei Wahrheiten: Eine Stelle
 * wird vergessen, und sie faellt nicht auf, weil ein fehlender Pfad wie „keine
 * Mods" aussieht.
 *
 * Deshalb wird EINMAL aufgeloest, direkt nachdem das Paket aus der Datenbank
 * kommt. Danach sieht jeder Leser einen gewoehnlichen `content`-Block — den des
 * gewaehlten Laders. Die Leser bleiben, wie sie sind.
 *
 * Dasselbe gilt fuer den Daemon: Er bekommt das aufgeloeste Paket, nicht die
 * Auswahl. Sonst muesste er dieselbe Regel ein zweites Mal kennen.
 *
 * ── Die Form im Paket ───────────────────────────────────────────────────────
 *
 *   "content": {
 *     "supported": true,
 *     "by_setting": "loader",
 *     "variants": {
 *       "vanilla":  { "supported": false },
 *       "paper":    { "sources": [...], "source_ids": {...}, "path": "plugins" },
 *       ...
 *     }
 *   }
 *
 * Alles ausserhalb von `variants` gilt fuer alle (z. B. `needs_restart`), die
 * Variante gewinnt ueber dem Gemeinsamen.
 */

/**
 * Loest `content.variants` gegen die Werte des Servers auf.
 *
 * Unveraendert zurueck kommt jedes Paket ohne `variants` — also jedes heutige
 * ausser Minecraft. Diese Funktion ist damit ueberall einsetzbar, wo ein Paket
 * herkommt, ohne zu fragen, ob sie zustaendig ist.
 *
 * @param {object|null} paket Das Paket, wie es in der Datenbank steht
 * @param {object} werte      `paket_werte` des Servers (Schluessel → Wert)
 * @returns {object|null}     Dasselbe Paket mit aufgeloestem `content`
 */
function loeseInhaltAuf(paket, werte = {}) {
    const inhalt = paket && paket.content;
    if (!inhalt || !inhalt.variants) return paket;

    const schluessel = inhalt.by_setting;
    if (!schluessel) {
        // Varianten ohne die Angabe, WAS sie auswaehlt, sind unbenutzbar. Nicht
        // raten: Ein falsch geratener Ablageort legt Mods dorthin, wo das Spiel
        // sie nie sieht — und niemand sieht es der Zeile an.
        return { ...paket, content: { supported: false } };
    }

    const wert = String(werte?.[schluessel] ?? '');
    const variante = inhalt.variants[wert];

    // Kein Treffer heisst NICHT „nimm die erste". Ein Server ohne gesetzten
    // Lader (oder mit einem, den dieses Paket nicht mehr kennt) bekommt keine
    // Inhalte — und die Oberflaeche sagt das, statt still den falschen Raum zu
    // oeffnen.
    const gemeinsam = { ...inhalt };
    delete gemeinsam.variants;
    delete gemeinsam.by_setting;

    if (!variante) {
        return { ...paket, content: { ...gemeinsam, supported: false } };
    }
    return { ...paket, content: { ...gemeinsam, ...variante } };
}

module.exports = { loeseInhaltAuf };
