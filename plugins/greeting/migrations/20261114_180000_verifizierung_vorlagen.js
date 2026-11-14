'use strict';

/**
 * Greeting: die zwei Nachrichten der Verifizierung ziehen in die Kern-Vorlagen
 * um (K389, 2026-11-14).
 *
 *   verification_message          → greeting:verifizierung_panel
 *   verification_success_message  → greeting:verifiziert
 *
 * **Panel:** Der Text war reiner Text oder JSON mit `title`, `description`,
 * `color` (dann ein Embed). Aus JSON wird die Form `embed` mit Überschrift,
 * Beschreibung und Farbe, sonst die Form `text`.
 *
 * **Bestätigung:** Gespeichert war nur die Beschreibung. Überschrift, Farbe,
 * Avatar rechts, Guild-Name als Fußzeile und Zeitpunkt waren fest im Code
 * (`buildSuccessEmbed`, Überschrift deutsch für jede Guild). Die Vorlage
 * bekommt diesen Aufbau mit, damit die Nachricht aussieht wie vorher. Nicht
 * mit: das Guild-Symbol neben der Fußzeile (eine Vorlage hat kein Fußzeilen-
 * Bild). Die Bestätigung per Reaktion (DM) sah etwas anders aus (Guild-Symbol
 * rechts, keine Fußzeile); seit K389 ist es dieselbe Nachricht.
 *
 * **Platzhalter:** Die eigene Tabelle kannte `{user:name}`, `{user:tag}`,
 * `{user:mention}`; der Kern hat dafür `{member:name}`, `{member:tag}`,
 * `{member:mention}` mit derselben Bedeutung (Benutzername, Tag, Erwähnung).
 * Die Migration schreibt sie um. Ein `\n` als Zeichenfolge wird zum Umbruch.
 *
 * Gemessen 2026-11-14: eine Bestätigung und ein Panel-Text, beide in der
 * Kontroll-Guild, beide reiner Text. Schon vorhandene Vorlagen bleiben
 * unberührt. Danach gehen die Spalten weg.
 *
 * Spalten über `SHOW COLUMNS`, nicht `information_schema`: so prüft
 * `scripts/check-vorlagen.js` die Migration an TEMPORARY-Tabellen.
 */

const UMBENANNT = Object.freeze([
    ['{user:name}', '{member:name}'],
    ['{user:tag}', '{member:tag}'],
    ['{user:mention}', '{member:mention}'],
]);

/** So sah die Bestätigung bis K389 aus, ohne die Beschreibung. */
const ERFOLG_AUFBAU = Object.freeze({
    form: 'embed',
    text: '',
    titel: '✅ Erfolgreich verifiziert!',
    farbe: '#57f287',
    vorschaubild: '{member:avatar}',
    bild: '',
    fusszeile: '{guild:name}',
    zeitstempel: true,
});

function text(w) {
    if (typeof w !== 'string') return '';
    let t = w.replace(/\\n/g, '\n').replace(/\r\n?/g, '\n').trim();
    for (const [alt, neu] of UMBENANNT) t = t.split(alt).join(neu);
    return t;
}

/** Panel-Text in eine Vorlage. null, wenn nichts darin steht. */
function panelAlsVorlage(roh) {
    if (typeof roh !== 'string' || !roh.trim()) return null;
    let e = null;
    try { e = JSON.parse(roh); } catch { e = null; }
    if (e && typeof e === 'object' && e.title) {
        const farbe = typeof e.color === 'string' && /^#[0-9a-f]{6}$/i.test(e.color.trim()) ? e.color.trim().toLowerCase() : '';
        return { form: 'embed', text: '', titel: text(e.title), beschreibung: text(e.description), farbe, vorschaubild: '', bild: '', fusszeile: '', zeitstempel: false };
    }
    const t = text(roh);
    return t ? { form: 'text', text: t, titel: '', beschreibung: '', farbe: '', vorschaubild: '', bild: '', fusszeile: '', zeitstempel: false } : null;
}

/** Bestätigung in eine Vorlage. null, wenn nichts darin steht. */
function erfolgAlsVorlage(roh) {
    const t = text(roh);
    return t ? { ...ERFOLG_AUFBAU, beschreibung: t } : null;
}

async function spalten(db, tabelle) {
    const rows = await db.query(`SHOW COLUMNS FROM ${tabelle}`);
    return new Set((rows || []).map((r) => r.Field));
}

module.exports = {
    description: 'Verifizierung: Panel-Text und Bestätigung nach guild_vorlagen (K389), Spalten weg',
    panelAlsVorlage,
    erfolgAlsVorlage,

    async up(db) {
        const da = await spalten(db, 'greeting_settings');
        const arten = [
            ['verification_message', 'greeting:verifizierung_panel', panelAlsVorlage],
            ['verification_success_message', 'greeting:verifiziert', erfolgAlsVorlage],
        ].filter(([spalte]) => da.has(spalte));
        if (!arten.length) return;

        const rows = await db.query(`SELECT guild_id, ${arten.map(([s]) => s).join(', ')} FROM greeting_settings`);
        for (const r of rows || []) {
            for (const [spalte, anlass, umwandeln] of arten) {
                const v = umwandeln(r[spalte]);
                if (!v) continue;
                await db.query(
                    'INSERT INTO guild_vorlagen (guild_id, anlass, inhalt) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE anlass = anlass',
                    [String(r.guild_id), anlass, JSON.stringify(v)]
                );
            }
        }
        for (const [spalte] of arten) {
            await db.query(`ALTER TABLE greeting_settings DROP COLUMN ${spalte}`);
        }
    }
};
