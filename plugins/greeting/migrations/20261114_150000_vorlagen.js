'use strict';

/**
 * Greeting: Nachrichten ziehen in die Kern-Vorlagen um (G-08, 2026-11-14,
 * F-G10 Punkt 3 A).
 *
 * Vorher standen je Guild vier Nachrichten als Text plus Embed-JSON in
 * `greeting_settings` (`welcome_*`, `dm_welcome_*`, `farewell_*`, `boost_*`
 * jeweils `_content` und `_embed`). Jetzt steht jede als eine Vorlage in
 * `guild_vorlagen` (Kern-Migration `20261114_150000_vorlagen`):
 *
 *   welcome    → greeting:willkommen
 *   dm_welcome → greeting:direktnachricht
 *   farewell   → greeting:abschied
 *   boost      → greeting:boost
 *
 * Feld für Feld: Text → text, title → titel, description → beschreibung,
 * color → farbe, thumbnail (an) → vorschaubild `{member:avatar}`, image →
 * bild, footer.text → fusszeile, timestamp → zeitstempel. Mit sichtbarem
 * Embed wird die Form `embed`, sonst `text`. Damit sieht jede Nachricht aus
 * wie vorher. Ein `\n` als Zeichenfolge (so speicherte die alte Route
 * Zeilenumbrüche) wird zum echten Umbruch.
 *
 * Autor und Felder des Embeds kannte kein Formular. Steht dort doch etwas,
 * bricht die Migration ab, statt es zu verlieren. Ebenso, wenn eine Einladung
 * ein eigenes Embed trägt (`greeting_invite_mappings.welcome_embed`, nie
 * gesetzt): Eine Einladung ersetzt seit G-08 nur den Nachrichtentext.
 *
 * Danach gehen die alten Spalten weg. Schon vorhandene Vorlagen bleiben
 * unberührt (falls jemand nach einem Teil-Lauf gespeichert hat).
 *
 * Spalten über `SHOW COLUMNS`, nicht `information_schema`: so prüft
 * `scripts/check-vorlagen.js` die Migration an TEMPORARY-Tabellen.
 */

const ARTEN = [
    ['welcome', 'greeting:willkommen'],
    ['dm_welcome', 'greeting:direktnachricht'],
    ['farewell', 'greeting:abschied'],
    ['boost', 'greeting:boost'],
];

function json(roh) {
    if (!roh) return {};
    if (typeof roh === 'object') return roh;
    try { return JSON.parse(roh) || {}; } catch { return {}; }
}

function text(w) {
    return typeof w === 'string' ? w.replace(/\\n/g, '\n').replace(/\r\n?/g, '\n').trim() : '';
}

/**
 * Alte Felder in eine Vorlage. null, wenn nichts darin steht.
 * @returns {Object|null}
 */
function alsVorlage(inhalt, embed) {
    const e = json(embed);
    const farbe = typeof e.color === 'string' && /^#[0-9a-f]{6}$/i.test(e.color.trim()) ? e.color.trim().toLowerCase() : '';
    const vorschaubild = e.thumbnail === true ? '{member:avatar}' : text(e.thumbnail);
    const v = {
        form: 'text',
        text: text(inhalt),
        titel: text(e.title),
        beschreibung: text(e.description),
        farbe,
        vorschaubild,
        bild: text(e.image),
        fusszeile: text(e.footer && e.footer.text),
        zeitstempel: e.timestamp === true,
    };
    // Sichtbar war das Embed, sobald eines dieser Felder gesetzt war
    // (wie in buildGreeting vor G-08; die Farbe allein zeigte nichts).
    const sichtbar = v.titel || v.beschreibung || v.vorschaubild || v.bild || v.fusszeile || v.zeitstempel;
    if (sichtbar) v.form = 'embed';
    else v.farbe = '';
    if (!v.text && !sichtbar) return null;
    return v;
}

async function spalten(db, tabelle) {
    const rows = await db.query(`SHOW COLUMNS FROM ${tabelle}`);
    return new Set((rows || []).map((r) => r.Field));
}

module.exports = {
    description: 'Nachrichten nach guild_vorlagen (G-08), alte Spalten weg',
    alsVorlage,

    async up(db) {
        const da = await spalten(db, 'greeting_settings');
        const alt = ARTEN.flatMap(([a]) => [`${a}_content`, `${a}_embed`]).filter((s) => da.has(s));

        if (alt.length) {
            const rows = await db.query(`SELECT guild_id, ${alt.join(', ')} FROM greeting_settings`);
            const verlust = [];
            const neu = [];
            for (const r of rows || []) {
                for (const [art, anlass] of ARTEN) {
                    const e = json(r[`${art}_embed`]);
                    const autor = e.author && (e.author.name || e.author.iconURL);
                    const felder = Array.isArray(e.fields) && e.fields.length > 0;
                    const fussIcon = e.footer && e.footer.iconURL;
                    if (autor || felder || fussIcon) verlust.push(`${r.guild_id}/${art}`);
                    const v = alsVorlage(r[`${art}_content`], r[`${art}_embed`]);
                    if (v) neu.push([String(r.guild_id), anlass, JSON.stringify(v)]);
                }
            }
            if (verlust.length) {
                throw new Error(`greeting G-08: Autor, Felder oder Fußzeilen-Bild im Embed gingen verloren: ${verlust.join(', ')}. Nicht umgezogen.`);
            }
            for (const zeile of neu) {
                await db.query(
                    'INSERT INTO guild_vorlagen (guild_id, anlass, inhalt) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE anlass = anlass',
                    zeile
                );
            }
        }

        const einladung = await spalten(db, 'greeting_invite_mappings');
        if (einladung.has('welcome_embed')) {
            const mit = await db.query('SELECT guild_id, invite_code FROM greeting_invite_mappings WHERE welcome_embed IS NOT NULL');
            if ((mit || []).length) {
                throw new Error(`greeting G-08: Einladungen mit eigenem Embed (${mit.map((m) => `${m.guild_id}/${m.invite_code}`).join(', ')}). Nicht umgezogen.`);
            }
            await db.query('ALTER TABLE greeting_invite_mappings DROP COLUMN welcome_embed');
        }

        for (const s of alt) {
            await db.query(`ALTER TABLE greeting_settings DROP COLUMN ${s}`);
        }
    }
};
