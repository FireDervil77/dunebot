'use strict';

/**
 * `gameserver_content.veroeffentlicht` — wann diese Mod-Fassung erschien (E6/B.12).
 *
 * ── Wozu (Betreiber, 2026-09-13, Vorschlag A) ───────────────────────────────
 *
 * „Wenn wir die Spielversion nicht gegen die Mods pruefen koennen, haben wir
 * genau solche Probleme." Thunderstore fuehrt kein Feld fuer die Spielfassung;
 * das Erscheinungsdatum der Mod-Fassung ist der einzige Anhaltspunkt. Gegen den
 * Stand der Spieldateien gehalten, trennte es die Faelle vom 13.09. sauber:
 * TeleportEverything 2.9.1 war 216 Tage aelter und stuerzte ab, Jotunn 2.30.0
 * war zwei Tage alt und lief.
 *
 * ── Warum die Spalte und nicht ein Abruf ────────────────────────────────────
 *
 * Die Liste eines Servers wird bei jedem Oeffnen des Reiters gezeichnet. Das
 * Datum dort frisch zu holen hiesse eine Thunderstore-Abfrage JE MOD je
 * Seitenaufbau — dieselbe Ueberlegung, aus der „Auf Aktualisierungen pruefen"
 * ein Knopf ist und kein Automatismus. Was auf DIESEM Server liegt, ist unsere
 * Sache; der Katalog moeglicher Mods bleibt bei der Quelle.
 *
 * ── DATE, nicht DATETIME ────────────────────────────────────────────────────
 *
 * Gebraucht wird der Tag: Der Stand der Spieldateien kommt aus der Logzeile von
 * BepInEx und traegt keine Zeitzone (helpers/BepInExLog.js). Eine Uhrzeit
 * danebenzustellen, die man nicht vergleichen kann, waere eine Genauigkeit, die
 * es nicht gibt. Gelesen wird die Spalte mit DATE_FORMAT als Zeichenkette —
 * eine Zeichenkette hinein, eine heraus, und kein Treiber rechnet unterwegs in
 * eine Zeitzone um.
 */
module.exports = {
    description: 'gameserver_content.veroeffentlicht — Erscheinungstag der Mod-Fassung (E6/B.12)',

    async up(db) {
        // Erst nachsehen, dann aendern: `ADD COLUMN IF NOT EXISTS` kennt MySQL
        // nicht, und ein Fehlschlag mitten in einer Migration laesst die
        // Tabelle halb umgebaut zurueck.
        const [vorhanden] = await db.query("SHOW COLUMNS FROM gameserver_content LIKE 'veroeffentlicht'");
        if (vorhanden) return;

        await db.query(`
            ALTER TABLE gameserver_content
              ADD COLUMN veroeffentlicht DATE DEFAULT NULL
              COMMENT 'Erscheinungstag DIESER Fassung laut Quelle (Thunderstore date_created)'
              AFTER fassung
        `);
    },

    async down(db) {
        const [vorhanden] = await db.query("SHOW COLUMNS FROM gameserver_content LIKE 'veroeffentlicht'");
        if (!vorhanden) return;
        await db.query('ALTER TABLE gameserver_content DROP COLUMN veroeffentlicht');
    }
};
