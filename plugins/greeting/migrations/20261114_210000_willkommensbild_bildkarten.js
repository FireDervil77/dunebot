'use strict';

/**
 * Greeting: Das Aussehen des Willkommensbilds zieht in den Kern-Bereich
 * „Bildkarten“ (G-22, F-G11 Punkt 2, 2026-11-14).
 *
 * Vorher standen je Guild drei Spalten in `greeting_settings`:
 * `welcome_image_bg` (einer von sieben Hintergründen), `welcome_image_text`,
 * `welcome_image_color`. Jetzt stellt die Guild das Bild nur noch unter
 * Bildkarten ein, gespeichert in `guild_bildkarten` (Kern-Migration
 * `20261114_210000_bildkarten_einstellungen`), Karte `greeting:willkommen`.
 * In greeting bleibt `welcome_image_enabled` (Bild anhängen ja/nein).
 *
 * Abbildung wie bis 2026-11-14 in `shared/willkommensbild.js` `werte()`:
 * Hintergrund → drei Farben des Verlaufs (unbekannt = default), Farbe nur als
 * #rrggbb (sonst Vorgabe), leerer Text = Vorgabe. Gespeichert wird nur, was
 * von der Vorgabe der Vorlage abweicht; bleibt nichts, entsteht keine Zeile.
 * Eine schon vorhandene Zeile bleibt unberührt (Teil-Lauf, danach gespeichert).
 *
 * Ein Text über 255 Zeichen ginge nicht in die Vorlage: Dann bricht die
 * Migration ab, statt ihn zu kürzen. Danach gehen die drei Spalten weg.
 *
 * Spalten über `SHOW COLUMNS`, damit der Wächter die Migration an einer
 * Attrappe prüfen kann.
 */

/** Die sieben Hintergründe, Stand 2026-11-14 (jetzt `vorschlaege` der Vorlage). */
const HINTERGRUENDE = Object.freeze({
    default: ['#1a1a2e', '#16213e', '#0f3460'],
    dark: ['#0d0d0d', '#1a1a1a', '#2d2d2d'],
    blue: ['#0f0c29', '#302b63', '#24243e'],
    purple: ['#12011e', '#3c1053', '#6a0572'],
    green: ['#0a1a0a', '#1b4332', '#2d6a4f'],
    sunset: ['#2d1b69', '#6b2fa0', '#e94560'],
    ocean: ['#0a192f', '#172a45', '#1c4a6e'],
});

/** Vorgaben der Vorlage `greeting:willkommen`, Stand 2026-11-14. */
const VORGABE = Object.freeze({
    hintergrund1: '#1a1a2e', hintergrund2: '#16213e', hintergrund3: '#0f3460',
    akzent: '#5865f2', text: 'Welcome to the server!',
});

const SPALTEN = ['welcome_image_bg', 'welcome_image_text', 'welcome_image_color'];

/**
 * Eine Zeile aus `greeting_settings` → abweichende Werte der Vorlage.
 * @returns {Object} leer, wenn alles der Vorgabe entspricht
 */
function alsWerte(z = {}) {
    const bg = HINTERGRUENDE[z.welcome_image_bg] || HINTERGRUENDE.default;
    const farbe = String(z.welcome_image_color || '').trim();
    const voll = {
        hintergrund1: bg[0], hintergrund2: bg[1], hintergrund3: bg[2],
        akzent: /^#[0-9a-f]{6}$/i.test(farbe) ? farbe.toLowerCase() : VORGABE.akzent,
        text: String(z.welcome_image_text || '').trim() || VORGABE.text,
    };
    const aus = {};
    for (const [k, w] of Object.entries(voll)) if (w !== VORGABE[k]) aus[k] = w;
    return aus;
}

async function spalten(db, tabelle) {
    const rows = await db.query(`SHOW COLUMNS FROM ${tabelle}`);
    return new Set((rows || []).map((r) => r.Field));
}

module.exports = {
    description: 'Willkommensbild: Hintergrund, Text und Farbe nach guild_bildkarten (G-22), Spalten weg',
    alsWerte,
    HINTERGRUENDE,

    async up(db) {
        const da = await spalten(db, 'greeting_settings');
        const alt = SPALTEN.filter((s) => da.has(s));
        if (!alt.length) return;

        const rows = await db.query(`SELECT guild_id, ${alt.join(', ')} FROM greeting_settings`);
        const lang = (rows || []).filter((r) => String(r.welcome_image_text || '').trim().length > 255).map((r) => r.guild_id);
        if (lang.length) throw new Error(`greeting G-22: Text des Willkommensbilds länger als 255 Zeichen in ${lang.join(', ')}. Nicht umgezogen.`);

        for (const r of rows || []) {
            const werte = alsWerte(r);
            if (!Object.keys(werte).length) continue;
            await db.query(
                `INSERT INTO guild_bildkarten (guild_id, plugin, karte, vorlage, werte) VALUES (?, 'greeting', 'greeting:willkommen', NULL, ?)
                 ON DUPLICATE KEY UPDATE karte = karte`,
                [String(r.guild_id), JSON.stringify(werte)]
            );
        }
        for (const s of alt) {
            await db.query(`ALTER TABLE greeting_settings DROP COLUMN ${s}`);
        }
    }
};
