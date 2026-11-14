const { MiscUtils } = require("dunebot-sdk/utils");
const { ServiceManager } = require("dunebot-core");
const { Vorlage } = require("dunebot-sdk");
const { baueNachricht, ANLAESSE } = require("./utils");

/**
 * Greeting - was `/welcome` und `/farewell` gemeinsam tun (G-08, 2026-11-14).
 *
 * Bis 2026-11-14 standen dieselben neun Funktionen zweimal in den beiden
 * Befehlsdateien und schrieben das Embed als JSON in `greeting_settings`.
 * Jetzt ändern sie einzelne Felder der Vorlage (`Vorlage.aendere`). Was der
 * Befehl setzt, sieht man im Dashboard unter Nachrichten.
 *
 * Liegt bewusst nicht unter `commands/`: Dort wäre jede Datei ein Befehl.
 */

/** Die zwei Befehle und was zu ihnen gehört. */
const ARTEN = Object.freeze({
    welcome: { schluessel: "WELCOME", anlass: ANLAESSE.welcome, an: "welcome_enabled", kanal: "welcome_channel" },
    farewell: { schluessel: "FAREWELL", anlass: ANLAESSE.farewell, an: "farewell_enabled", kanal: "farewell_channel" },
});

function art(name) {
    const a = ARTEN[name];
    if (!a) throw new Error(`greeting: unbekannte Art ${name}`);
    return a;
}

async function einstellungen(guildId) {
    const rows = await ServiceManager.get("dbService").query("SELECT * FROM greeting_settings WHERE guild_id = ?", [guildId]);
    return rows?.[0] || {};
}

/** Vorschau in den eingestellten Kanal senden. */
async function vorschau(name, member, guild) {
    const a = art(name);
    const settings = await einstellungen(guild.id);
    if (!settings[a.an]) return guild.getT(`greeting:${a.schluessel}.${a.schluessel}_DISABLED`);
    const ziel = guild.channels.cache.get(settings[a.kanal]);
    if (!ziel) return guild.getT(`greeting:${a.schluessel}.CHANNEL_NOT_CONFIG`);
    await ziel.send(await baueNachricht(member, a.anlass));
    return guild.getT(`greeting:${a.schluessel}.PREVIEW_SENT`, { channel: ziel.toString() });
}

async function setzeStatus(name, status, guild) {
    const a = art(name);
    const an = String(status).toUpperCase() === "ON";
    await ServiceManager.get("dbService").query(
        `INSERT INTO greeting_settings (guild_id, ${a.an}) VALUES (?, ?) ON DUPLICATE KEY UPDATE ${a.an} = ?`,
        [guild.id, an, an]
    );
    return guild.getT(`greeting:${a.schluessel}.${an ? "ENABLED" : "DISABLED"}`);
}

async function setzeKanal(name, channel, guild) {
    const a = art(name);
    if (!channel) return guild.getT(`greeting:${a.schluessel}.CHANNEL_NOT_CONFIG`);
    if (!guild.members.me.permissionsIn(channel).has(["SendMessages", "EmbedLinks"])) {
        return guild.getT(`greeting:${a.schluessel}.CHANNEL_NO_PERMS`, { channel: channel.toString() });
    }
    await ServiceManager.get("dbService").query(
        `INSERT INTO greeting_settings (guild_id, ${a.kanal}) VALUES (?, ?) ON DUPLICATE KEY UPDATE ${a.kanal} = ?`,
        [guild.id, channel.id, channel.id]
    );
    return guild.getT(`greeting:${a.schluessel}.CHANNEL_SET`, { channel: channel.toString() });
}

/**
 * Felder der Vorlage ändern. `teil` in den Namen der Vorlage
 * (`beschreibung`, `farbe`, `vorschaubild`, `fusszeile`, `bild`).
 * @returns {Promise<string|null>} Fehlertext oder null
 */
async function aendereFelder(a, teil, guild) {
    if (teil.farbe !== undefined) {
        const f = String(teil.farbe || "").trim();
        const mitRaute = f.startsWith("#") ? f : `#${f}`;
        if (!MiscUtils.isHex(mitRaute)) return guild.getT(`greeting:${a.schluessel}.INVALID_COLOR`);
        teil = { ...teil, farbe: mitRaute };
    }
    try {
        await Vorlage.aendere(guild.id, a.anlass, teil);
    } catch (err) {
        if (err instanceof Vorlage.Eingabefehler) {
            if (err.schluessel === "ADRESSE") return guild.getT(`greeting:${a.schluessel}.INVALID_IMAGE`);
            return guild.getT(`greeting:${a.schluessel}.INVALID_CONTENT`);
        }
        throw err;
    }
    return null;
}

/** Ein oder mehrere Felder setzen (Präfix-Befehle `desc`, `color` usw.). */
async function setzeFelder(name, teil, guild) {
    const a = art(name);
    return (await aendereFelder(a, teil, guild)) || guild.getT(`greeting:${a.schluessel}.CONFIG_UPDATED`);
}

/** `/welcome message` bzw. `/farewell message`: Kanal und Felder zugleich, schaltet ein. */
async function setzeNachricht(name, interaction) {
    const a = art(name);
    const { guild } = interaction;
    const channel = guild.channels.cache.get(interaction.options.getChannel("channel").id);
    if (!guild.members.me.permissionsIn(channel).has(["SendMessages", "EmbedLinks"])) {
        return guild.getT(`greeting:${a.schluessel}.CHANNEL_NO_PERMS`, { channel: channel.toString() });
    }
    const teil = {
        beschreibung: interaction.options.getString("description"),
        vorschaubild: interaction.options.getString("status") === "ON" ? "{member:avatar}" : "",
    };
    const farbe = interaction.options.getString("hex-code");
    const fusszeile = interaction.options.getString("footer");
    const bild = interaction.options.getString("url");
    if (farbe) teil.farbe = farbe;
    if (fusszeile) teil.fusszeile = fusszeile;
    if (bild) teil.bild = bild;

    const fehler = await aendereFelder(a, teil, guild);
    if (fehler) return fehler;

    await ServiceManager.get("dbService").query(
        `INSERT INTO greeting_settings (guild_id, ${a.an}, ${a.kanal}) VALUES (?, TRUE, ?)
         ON DUPLICATE KEY UPDATE ${a.an} = TRUE, ${a.kanal} = ?`,
        [guild.id, channel.id, channel.id]
    );
    return guild.getT(`greeting:${a.schluessel}.CONFIG_SAVED`, { channel: channel.toString() });
}

module.exports = { ARTEN, vorschau, setzeStatus, setzeKanal, setzeFelder, setzeNachricht };
