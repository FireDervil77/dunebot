'use strict';

/**
 * Drei Wege zu „Server ansehen" werden einer.
 *
 * Entschieden am 2026-08-18: *„Heute führen DREI Einträge zu Spielarten von
 * ‚Server ansehen': die Plugin-Wurzel, NAV.DASHBOARD und NAV.SERVERS. Daraus
 * wird einer."* Der Betreiber am 2026-08-19, als die neue Übersicht stand:
 * *„ist die Übersichtsseite die neue automatisch das Dashboard? wäre sinnvoll
 * oder?"* — Ja. Eine zweite Seite daneben wäre dieselbe Auskunft in schlechter.
 *
 * „Meine Addons" entfällt mit der Entscheidung gegen private Pakete (E4):
 * Es gibt nur EINEN Katalog.
 *
 * ── Warum das eine Migration braucht und nicht bloss eine Codeänderung ──────
 *
 * `NavigationManager.registerNavigation()` fügt nur hinzu, was noch fehlt — es
 * löscht nie (nachgelesen: es sammelt `newItems` und schreibt nur die).
 * Ein Eintrag, den man aus dem Code nimmt, bleibt in `guild_nav_items` stehen
 * und wird weiter angezeigt. Genau daran hing schon einmal eine Phantom-Guild
 * in der Navigation.
 *
 * Gelöscht wird über die URL, nicht über den Titel: Der Titel ist ein
 * Übersetzungsschlüssel und kann sich ändern, die URL ist die Kennung.
 */

const WEG = [
    '%/plugins/gameserver/dashboard',
    '%/plugins/gameserver/addons/my-addons',
];

module.exports = {
    async up(db) {
        // dbService.query() liefert die ZEILEN direkt — nicht [rows, fields].
        // (Diese Verwechslung hat am 2026-08-19 eine Migration reihenweise
        //  scheitern lassen; siehe 20260819_170000.)
        for (const muster of WEG) {
            const zeilen = await db.query(
                'SELECT id, url FROM guild_nav_items WHERE url LIKE ?', [muster]);
            if (!zeilen || zeilen.length === 0) continue;
            await db.query('DELETE FROM guild_nav_items WHERE url LIKE ?', [muster]);
        }

        // „Server" nach oben: Es ist der Einstieg, nicht der vierte Punkt.
        //
        // Die Spalte heisst `sort_order`, nicht `order` — nachgesehen, nicht
        // geraten. Ein `order` waere durchgelaufen wie die Migration von
        // 17:00 Uhr und haette dasselbe Bild ergeben: scheinbar erledigt,
        // tatsaechlich nie gelaufen.
        await db.query(
            "UPDATE guild_nav_items SET sort_order = 10 WHERE url LIKE '%/plugins/gameserver/servers'");
        await db.query(
            "UPDATE guild_nav_items SET sort_order = 20 WHERE url LIKE '%/plugins/gameserver/addons'");
    },

    /**
     * Zurück gibt es die Einträge NICHT.
     *
     * Sie wiederherzustellen hiesse, sie für jede Guild neu zu erfinden — mit
     * Reihenfolge, Recht und Symbol, die hier niemand kennt. Wer sie
     * zurückwill, nimmt die Zeilen im Code wieder auf; `registerNavigation`
     * legt sie beim nächsten Start von selbst an. Genau dafür ist es gebaut.
     */
    async down() {},
};
