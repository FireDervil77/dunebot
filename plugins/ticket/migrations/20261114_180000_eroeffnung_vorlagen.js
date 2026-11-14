'use strict';

/**
 * Ticket: die Eröffnungsnachricht jeder Kategorie zieht in die Kern-Vorlagen
 * um (K389, 2026-11-14).
 *
 *   ticket_categories.open_msg_title, open_msg_description, open_msg_footer
 *     → guild_vorlagen (anlass `ticket:eroeffnung`, stelle = ID der Kategorie)
 *
 * Braucht die Kern-Migration `20261114_170000_vorlagen_stelle` (Spalte
 * `stelle`); Kern-Migrationen laufen vor denen der Plugins.
 *
 * Bis hier galt je Feld: leer ⇒ Text aus der Sprachdatei des Bots. Die Vorlage
 * ist ein Ganzes, deshalb füllt die Migration leere Felder mit diesem Text
 * (Sprache der Guild aus `configs`, wie `guild.getT`). Eine Kategorie ohne
 * eigenen Text bekommt keine Zeile, sie sendet die Vorgabe wie vorher. Davor
 * steht die Erwähnung des Mitglieds, wie bisher als Nachrichtentext. Der Titel
 * stand in der Autorzeile, jetzt als Überschrift.
 *
 * **Platzhalter:** Die eigene Tabelle meinte mit `{member:name}` den
 * Anzeigenamen; im Kern ist das `{member:nick}` (`{member:name}` ist dort der
 * Benutzername). Die Migration schreibt um. `{member:tag}`, `{member:mention}`,
 * `{server}`, `{count}` und `{ticket:*}` bleiben, wie sie sind.
 *
 * Gemessen 2026-11-14: eine Kategorie („Dashboard“ in der Kontroll-Guild) mit
 * eigenem Titel und Text, ohne Fußzeile, ohne Platzhalter. Schon vorhandene
 * Vorlagen bleiben unberührt. Danach gehen die Spalten weg.
 *
 * Spalten über `SHOW COLUMNS`, nicht `information_schema`: so prüft
 * `scripts/check-vorlagen.js` die Migration an TEMPORARY-Tabellen.
 */

const Eroeffnung = require('../shared/eroeffnung');

const SPALTEN = ['open_msg_title', 'open_msg_description', 'open_msg_footer'];

function text(w) {
    if (typeof w !== 'string') return '';
    return w.replace(/\\n/g, '\n').replace(/\r\n?/g, '\n').trim().split('{member:name}').join('{member:nick}');
}

/**
 * Alte Felder einer Kategorie in eine Vorlage. null, wenn keines gesetzt ist.
 * @param {Object} zeile mit open_msg_*
 * @param {(k: string) => string} t Übersetzer der Guild
 */
function alsVorlage(zeile, t) {
    const titel = text(zeile.open_msg_title);
    const beschreibung = text(zeile.open_msg_description);
    const fusszeile = text(zeile.open_msg_footer);
    if (!titel && !beschreibung && !fusszeile) return null;
    const v = Eroeffnung.vorgabe(t);
    return {
        form: 'embed',
        text: v.text,
        titel: titel || v.titel,
        beschreibung: beschreibung || v.beschreibung,
        farbe: '',
        vorschaubild: '',
        bild: '',
        fusszeile: fusszeile || v.fusszeile,
        zeitstempel: false,
    };
}

async function spalten(db, tabelle) {
    const rows = await db.query(`SHOW COLUMNS FROM ${tabelle}`);
    return new Set((rows || []).map((r) => r.Field));
}

module.exports = {
    description: 'Eröffnungsnachricht je Kategorie nach guild_vorlagen (K389), Spalten weg',
    alsVorlage,

    async up(db) {
        const da = await spalten(db, 'ticket_categories');
        const alt = SPALTEN.filter((s) => da.has(s));
        if (!alt.length) return;

        const rows = await db.query(`SELECT id, guild_id, ${alt.join(', ')} FROM ticket_categories`);
        const sprachen = new Map();
        for (const r of rows || []) {
            const guildId = String(r.guild_id);
            if (!sprachen.has(guildId)) {
                const s = await db.query(
                    "SELECT config_value FROM configs WHERE plugin_name = 'core' AND context = 'shared' AND config_key = 'LOCALE' AND guild_id = ?",
                    [guildId]
                );
                sprachen.set(guildId, s?.[0]?.config_value || null);
            }
            const v = alsVorlage(r, Eroeffnung.texteAus(sprachen.get(guildId)));
            if (!v) continue;
            await db.query(
                'INSERT INTO guild_vorlagen (guild_id, anlass, stelle, inhalt) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE anlass = anlass',
                [guildId, Eroeffnung.EROEFFNUNG, String(r.id), JSON.stringify(v)]
            );
        }
        for (const s of alt) {
            await db.query(`ALTER TABLE ticket_categories DROP COLUMN ${s}`);
        }
    }
};
