'use strict';

/**
 * Gestaltung je Guild (G-09, K382, 2026-11-14): lesen und schreiben für die
 * Seite Einstellungen → Gestaltung und den Kern-Teil „Farben dieses Plugins“.
 *
 * Wie eine Farbe wirkt, steht im SDK (`packages/dunebot-sdk/lib/Gestaltung.js`).
 * Hier steht nur, was eine Guild einträgt, und wie es geprüft wird:
 *
 *   - Palette: fünf Rollen, jede `#rrggbb` oder leer (= Vorgabe).
 *   - Logo und Banner: ein Bild aus der Medienablage **dieser** Guild. Die
 *     Seite schickt die Adresse aus der Medienwahl, gespeichert wird die
 *     `guild_media.id`. Ein Bild einer fremden Guild findet die Abfrage nicht.
 *   - Farben eines Plugins: nur die Rollen, die das Plugin unter `farben`
 *     erklärt, alle gesetzt. „Farben der Guild nutzen“ = keine Zeile.
 *
 * Wer schreiben darf, prüft der Router (`settings.router.js`): Recht und in der
 * Kontroll-Guild nur der Besitzer. Nach jedem Schreiben erfährt es der Bot
 * (`dashboard:GESTALTUNG_GEAENDERT`).
 */

const path = require('path');
const fs = require('fs');
const { ServiceManager } = require('dunebot-core');
const { Gestaltung, Nachbar } = require('dunebot-sdk');

const PLUGINS = path.join(__dirname, '..', '..', '..', 'plugins');
const { ROLLEN, KERN_VORGABE } = Gestaltung;

function db() {
    return ServiceManager.get('dbService');
}

/** Ein Ergebnis, das der Router als 400 zurückgibt. */
class Eingabefehler extends Error {}

/** Plugins auf der Platte, die `farben` erklären: Name → Erklärung. */
function pluginsMitFarben() {
    const aus = {};
    for (const p of fs.readdirSync(PLUGINS)) {
        if (!fs.existsSync(path.join(PLUGINS, p, 'package.json'))) continue;
        const e = Gestaltung.erklaerung(p);
        if (e) aus[p] = e;
    }
    return aus;
}

/** Anzeigename aus der package.json, sonst der Name. */
function anzeigename(plugin) {
    try {
        return JSON.parse(fs.readFileSync(path.join(PLUGINS, plugin, 'package.json'), 'utf8')).displayName || plugin;
    } catch {
        return plugin;
    }
}

/** Adresse eines Bildes der Medienablage, wie die Medienwahl sie einträgt. */
function medienAdresse(guildId, gespeichert) {
    return `/uploads/media/${guildId}/${gespeichert}`;
}

/**
 * Adresse aus der Medienwahl → `guild_media.id` dieser Guild. Leer → null.
 * Angenommen werden `/uploads/media/<guild>/<datei>`, auch mit der eigenen
 * Basisadresse davor.
 */
async function medienId(guildId, adresse, was) {
    const a = String(adresse ?? '').trim();
    if (!a) return null;
    const basis = String(process.env.DASHBOARD_BASE_URL || '').replace(/\/+$/, '');
    const pfad = basis && a.startsWith(basis + '/') ? a.slice(basis.length) : a;
    const praefix = `/uploads/media/${guildId}/`;
    const name = pfad.startsWith(praefix) ? decodeURIComponent(pfad.slice(praefix.length)) : '';
    if (!name || name.includes('/')) throw new Eingabefehler(`${was}: Bitte ein Bild aus der Medienablage dieses Servers wählen.`);
    const [z] = await db().query(
        "SELECT id FROM guild_media WHERE guild_id = ? AND stored_name = ? AND mime_type LIKE 'image/%'",
        [String(guildId), name]);
    if (!z) throw new Eingabefehler(`${was}: Das Bild liegt nicht in der Medienablage dieses Servers.`);
    return z.id;
}

/** Zeilen einer Guild ohne Zwischenspeicher. */
async function zeilen(guildId) {
    const rows = await db().query(`
        SELECT g.*, lm.stored_name AS logo_name, lm.filename AS logo_datei,
               bm.stored_name AS banner_name, bm.filename AS banner_datei
        FROM guild_gestaltung g
        LEFT JOIN guild_media lm ON lm.id = g.logo_media_id AND lm.guild_id = g.guild_id
        LEFT JOIN guild_media bm ON bm.id = g.banner_media_id AND bm.guild_id = g.guild_id
        WHERE g.guild_id = ?
    `, [String(guildId)]);
    return new Map((rows || []).map(z => [z.plugin, z]));
}

/**
 * Alles für die Seite Gestaltung.
 * @param {string} guildId
 */
async function seite(guildId) {
    const z = await zeilen(guildId);
    const palette = z.get('') || {};
    const farben = ROLLEN.map(r => ({
        rolle: r,
        wert: Gestaltung.hex(palette[r]),
        vorgabe: KERN_VORGABE[r],
    }));

    // „Diese Plugins weichen ab“: nur eingeschaltete Plugins mit eigener Zeile.
    const an = new Set(await db().getEnabledPlugins(guildId));
    const erklaert = pluginsMitFarben();
    const abweichend = [];
    for (const [plugin, zeile] of z) {
        if (!plugin || !an.has(plugin) || !erklaert[plugin]) continue;
        abweichend.push({
            plugin,
            name: anzeigename(plugin),
            adresse: `/guild/${guildId}/plugins/${plugin}${erklaert[plugin].seite || ''}`,
            farben: Object.keys(erklaert[plugin].rollen).map(r => ({ rolle: r, wert: Gestaltung.hex(zeile[r]) })),
        });
    }
    abweichend.sort((a, b) => a.name.localeCompare(b.name));

    return {
        farben,
        logo: palette.logo_name ? { adresse: medienAdresse(guildId, palette.logo_name), datei: palette.logo_datei } : null,
        banner: palette.banner_name ? { adresse: medienAdresse(guildId, palette.banner_name), datei: palette.banner_datei } : null,
        abweichend,
    };
}

/** Eine Farbe aus dem Formular: leer → null, sonst `#rrggbb`. */
function farbeAusEingabe(roh, rolle, leerErlaubt) {
    const s = String(roh ?? '').trim();
    if (!s) {
        if (leerErlaubt) return null;
        throw new Eingabefehler(`Farbe „${rolle}“ fehlt.`);
    }
    const h = Gestaltung.hex(s);
    if (!h) throw new Eingabefehler(`Farbe „${rolle}“: „${s}“ ist kein Farbwert wie #3498db.`);
    return h;
}

/**
 * Palette, Logo und Banner der Guild speichern. Alles leer → die Zeile geht.
 * @param {string} guildId
 * @param {{farben?: Object<string,string>, logo?: string, banner?: string}} eingabe
 */
async function speichereGuild(guildId, eingabe) {
    const werte = {};
    for (const r of ROLLEN) werte[r] = farbeAusEingabe(eingabe?.farben?.[r], r, true);
    const logo = await medienId(guildId, eingabe?.logo, 'Logo');
    const banner = await medienId(guildId, eingabe?.banner, 'Banner');

    if (ROLLEN.every(r => werte[r] === null) && logo === null && banner === null) {
        await db().query("DELETE FROM guild_gestaltung WHERE guild_id = ? AND plugin = ''", [String(guildId)]);
    } else {
        await db().query(`
            INSERT INTO guild_gestaltung (guild_id, plugin, akzent, erfolg, hinweis, warnung, gefahr, logo_media_id, banner_media_id)
            VALUES (?, '', ?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE akzent = VALUES(akzent), erfolg = VALUES(erfolg), hinweis = VALUES(hinweis),
                warnung = VALUES(warnung), gefahr = VALUES(gefahr),
                logo_media_id = VALUES(logo_media_id), banner_media_id = VALUES(banner_media_id)
        `, [String(guildId), ...ROLLEN.map(r => werte[r]), logo, banner]);
    }
    await benachrichtige(guildId);
}

/**
 * Erklärung eines Plugins für den Kern-Teil, oder Fehler.
 * Das Plugin muss in der Guild an sein: Der Teil steht nur auf seiner Seite.
 */
async function pluginPruefen(guildId, plugin) {
    const e = Gestaltung.erklaerung(plugin);
    if (!e || !Object.keys(e.rollen).length) throw new Eingabefehler(`${plugin} erklärt keine Farben.`);
    const stand = await Nachbar.pluginAn(plugin, guildId);
    if (!stand.an) throw new Eingabefehler(`${plugin} ist auf diesem Server nicht eingeschaltet.`);
    return e;
}

/**
 * Was der Kern-Teil „Farben dieses Plugins“ zeigt.
 * @param {string} guildId
 * @param {string} plugin
 */
async function pluginTeil(guildId, plugin) {
    const e = await pluginPruefen(guildId, plugin);
    const z = await zeilen(guildId);
    const eigen = z.get(plugin) || null;
    const palette = z.get('') || {};
    return {
        eigen: Boolean(eigen),
        recht: e.recht,
        rollen: Object.keys(e.rollen).map(r => ({
            rolle: r,
            // Was das Plugin mit „Farben der Guild nutzen“ zeigt.
            guild: Gestaltung.hex(palette[r]) || e.rollen[r],
            vonGuild: Boolean(Gestaltung.hex(palette[r])),
            vorgabe: e.rollen[r],
            wert: eigen ? Gestaltung.hex(eigen[r]) : null,
        })),
    };
}

/**
 * Farben eines Plugins speichern. `eigen: false` → Farben der Guild nutzen.
 * @param {string} guildId
 * @param {string} plugin
 * @param {{eigen: boolean, farben?: Object<string,string>}} eingabe
 */
async function speicherePlugin(guildId, plugin, eingabe) {
    const e = await pluginPruefen(guildId, plugin);
    if (!eingabe?.eigen) {
        await db().query('DELETE FROM guild_gestaltung WHERE guild_id = ? AND plugin = ?', [String(guildId), plugin]);
    } else {
        const werte = {};
        for (const r of ROLLEN) werte[r] = r in e.rollen ? farbeAusEingabe(eingabe?.farben?.[r], r, false) : null;
        await db().query(`
            INSERT INTO guild_gestaltung (guild_id, plugin, akzent, erfolg, hinweis, warnung, gefahr)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE akzent = VALUES(akzent), erfolg = VALUES(erfolg), hinweis = VALUES(hinweis),
                warnung = VALUES(warnung), gefahr = VALUES(gefahr)
        `, [String(guildId), plugin, ...ROLLEN.map(r => werte[r])]);
    }
    await benachrichtige(guildId);
}

/** Zwischenspeicher hier und im Bot verwerfen. */
async function benachrichtige(guildId) {
    Gestaltung.vergiss(guildId);
    try {
        await ServiceManager.get('ipcServer').broadcast('dashboard:GESTALTUNG_GEAENDERT', { guildId: String(guildId) }, true, { timeout: 3000 });
    } catch (err) {
        // Der Bot merkt sich die Farben höchstens eine Minute.
        ServiceManager.get('Logger').warn(`[Gestaltung] Bot über die neue Gestaltung von ${guildId} nicht erreicht (gilt dort spätestens in 60 s): ${err.message}`);
    }
}

module.exports = { Eingabefehler, pluginsMitFarben, seite, speichereGuild, pluginTeil, speicherePlugin };
