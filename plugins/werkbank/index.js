const WerkbankBotPlugin = require('./bot');
const WerkbankDashboardPlugin = require('./dashboard');

/**
 * Werkbank-Plugin für FireBot — Stufe 7 des Spielpaket-Vorhabens.
 *
 * Die Werkbank baut Spielpakete (FBPKG_v1): Schritte hinzufügen, die sofort in
 * einem eigenen Volume laufen, starten und beobachten, gegen ein frisches
 * Volume prüfen, in den Testzweig veröffentlichen. Sie erzeugt ein REZEPT,
 * kein Spiel-Image (Konzept B.4).
 *
 * Eigenes Plugin mit eigenem Regelsatz (W-1, Betreiber 2026-09-14): „Das würde
 * sich als Plugin wesentlich besser steuern lassen, als wenn wir das in die
 * Gameserver mit einbringen." Name `werkbank` (2026-09-24).
 *
 * Einstieg und Stand: docs/spielpakete/arbeitsplan/07-Werkbank.md
 */
module.exports = {
    bot: WerkbankBotPlugin,
    dashboard: WerkbankDashboardPlugin
};
