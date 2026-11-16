const { Vorlage, Einladungen } = require("dunebot-sdk");

/**
 * Greeting - Nachrichten aus den Vorlagen bauen (G-08, 2026-11-14).
 *
 * Bis 2026-11-14 stand hier eine Kopie von `dunebot-core/lib/PlaceholderParser`
 * (Ersetzung der Platzhalter und Aufbau des Embeds). Jetzt füllt der Kern
 * (`Vorlage.fuelle`), und hier stehen nur noch die Platzhalter, die greeting
 * selbst erklärt (`vorlagen.platzhalter` in der package.json).
 *
 * Die vier Anlässe:
 *   greeting:willkommen       im Willkommenskanal
 *   greeting:direktnachricht  als Direktnachricht beim Beitritt
 *   greeting:abschied         im Abschiedskanal
 *   greeting:boost            im Boost-Kanal
 *
 * Dazu die Verifizierung (K389, 2026-11-14), bis dahin mit eigener
 * Platzhalter-Tabelle, zweimal, und einem eigenen Embed-Format im Panel-Text:
 *   greeting:verifiziert          Bestätigung nach der Verifizierung
 *                                 (Knopf und Captcha nur für ihn, Reaktion als DM)
 *   greeting:verifizierung_panel  die Nachricht im Verifizierungskanal, an der
 *                                 die Knöpfe oder die Reaktion hängen
 */

const ANLAESSE = Object.freeze({
    welcome: "greeting:willkommen",
    dm_welcome: "greeting:direktnachricht",
    farewell: "greeting:abschied",
    boost: "greeting:boost",
});

const VERIFIZIERUNG = Object.freeze({
    erfolg: "greeting:verifiziert",
    panel: "greeting:verifizierung_panel",
});

/** `MessageFlags.Ephemeral` */
const FLUECHTIG = 1 << 6;

/** Was gesendet wird, solange eine Vorlage leer ist (wie vor G-08). */
const VORGABE = Object.freeze({
    "greeting:willkommen": (m) => `Welcome to the server, ${m.displayName} 🎉`,
    "greeting:direktnachricht": (m) => `Welcome to the server, ${m.displayName} 🎉`,
    "greeting:abschied": (m) => `${m.user.username} has left the server 👋`,
    "greeting:boost": (m) => `${m.displayName} just boosted the server! 🚀`,
});

/**
 * Werte der greeting-eigenen Platzhalter: `{inviter:name}`, `{inviter:tag}`,
 * `{invites}`. Nur wenn einer davon vorkommt, wird der Einladende geholt.
 *
 * Woher: der Beitritt aus dem Kern (G-16, `Einladungen` im SDK). Bis
 * 2026-11-16 las das hier `member.inviterData`, das niemand setzte; die Werte
 * standen immer auf „NA“ bzw. 0.
 *
 *   {inviter:name}/{inviter:tag}  Name des Einladers; „VANITY“ über die
 *                                 Vanity-URL, „OAuth“ bei einem Bot, „NA“ wenn
 *                                 unbekannt oder nicht sicher
 *   {invites}                     wie viele über Einladungen des Einladers
 *                                 kamen und noch da sind (seit G-16 gezählt)
 *
 * @param {import('discord.js').GuildMember} member
 * @param {Object} vorlage
 * @param {Object|null} beitritt aus `Einladungen.beitritt` oder `vonMitglied`
 */
async function eigeneWerte(member, vorlage, beitritt = null) {
    const text = Object.keys(Vorlage.FELDER).map((f) => vorlage?.[f] || "").join(" ");
    const extra = {};
    const sicher = beitritt?.sicherheit === Einladungen.SICHERHEIT.EINDEUTIG;
    const einlader = sicher ? beitritt.einlader : null;
    if (text.includes("{inviter:")) {
        let name = "NA";
        let tag = "NA";
        if (sicher && beitritt.art === Einladungen.ART.VANITY) {
            name = tag = "VANITY";
        } else if (sicher && beitritt.art === Einladungen.ART.OAUTH) {
            name = tag = "OAuth";
        } else if (einlader) {
            try {
                const inviter = await member.client.users.fetch(einlader);
                name = inviter.username;
                tag = inviter.tag;
            } catch (ex) {
                member.client.logger.warn(`[Greeting] Einlader ${einlader} nicht abrufbar: ${ex.message}`);
            }
        }
        extra["inviter:name"] = name;
        extra["inviter:tag"] = tag;
    }
    if (text.includes("{invites}")) {
        extra.invites = einlader ? await Einladungen.anzahl(member.guild.id, einlader) : 0;
    }
    return extra;
}

/**
 * Nachricht eines Anlasses für dieses Mitglied.
 *
 * @param {import('discord.js').GuildMember} member
 * @param {string} anlass einer aus ANLAESSE
 * @param {Object} [optionen]
 * @param {Object|null} [optionen.beitritt] Beitritt aus dem Kern (G-16)
 * @param {string} [optionen.textStatt] anderer Nachrichtentext (Einladung mit eigenem Text)
 * @param {{name: string, attachment: *}[]} [optionen.anhaenge] z. B. das Willkommensbild
 * @returns {Promise<Object>} Nachricht für `send()`
 */
async function baueNachricht(member, anlass, optionen = {}) {
    let vorlage = (await Vorlage.lade(member.guild.id, anlass)) || Vorlage.leer();
    if (optionen.textStatt) vorlage = { ...vorlage, text: optionen.textStatt };
    const extra = await eigeneWerte(member, vorlage, optionen.beitritt);
    const kontext = { member, guild: member.guild, extra };
    const mit = { guildId: member.guild.id, erwaehnen: [member.id], anhaenge: optionen.anhaenge };

    let { nachricht } = await Vorlage.fuelle(vorlage, kontext, mit);
    if (!nachricht) {
        // Leer: der feste Satz wie vor G-08, in der Form der Vorlage (bei V2
        // als Textblock, damit ein Willkommensbild in der Galerie stehen kann).
        ({ nachricht } = await Vorlage.fuelle({ ...vorlage, text: VORGABE[anlass](member) }, kontext, mit));
    }
    return nachricht;
}

/**
 * Was die Verifizierung sendet, solange keine Vorlage gespeichert ist: so wie
 * bis 2026-11-14 der feste Aufbau aussah, Texte in der Sprache der Guild.
 * @param {import('discord.js').Guild} guild
 */
function vorgabeVerifizierung(guild) {
    return {
        erfolg: {
            form: "embed",
            titel: guild.getT("greeting:VERIFICATION.ERFOLG_TITEL"),
            beschreibung: guild.getT("greeting:VERIFICATION.ERFOLG_TEXT"),
            farbe: "#57f287",
            vorschaubild: "{member:avatar}",
            fusszeile: "{guild:name}",
            zeitstempel: true,
        },
        panel: { form: "text", text: guild.getT("greeting:VERIFICATION.PANEL_TEXT") },
    };
}

/**
 * Bestätigung nach der Verifizierung (`greeting:verifiziert`).
 * @param {import('discord.js').GuildMember} member
 * @param {Object} [optionen]
 * @param {boolean} [optionen.fluechtig] nur für ihn sichtbar (Antwort auf Knopf)
 * @returns {Promise<Object>} Nachricht für `reply()` oder `send()`
 */
async function baueVerifiziert(member, optionen = {}) {
    const guild = member.guild;
    const vorlage = (await Vorlage.lade(guild.id, VERIFIZIERUNG.erfolg)) || vorgabeVerifizierung(guild).erfolg;
    let { nachricht } = await Vorlage.fuelle(vorlage, { member, guild }, { guildId: guild.id, erwaehnen: [member.id] });
    if (!nachricht) ({ nachricht } = await Vorlage.fuelle(vorgabeVerifizierung(guild).erfolg, { member, guild }, { guildId: guild.id, erwaehnen: [member.id] }));
    if (optionen.fluechtig) nachricht.flags = (nachricht.flags || 0) | FLUECHTIG;
    return nachricht;
}

/**
 * Die Nachricht im Verifizierungskanal (`greeting:verifizierung_panel`), mit
 * den Knöpfen des Aufrufers. Ohne Mitglied: nur Platzhalter der Guild.
 * @param {import('discord.js').Guild} guild
 * @param {Object[]} [komponenten] Zeilen mit Knöpfen
 * @returns {Promise<Object>} Nachricht für `send()`
 */
async function bauePanel(guild, komponenten = []) {
    const vorlage = (await Vorlage.lade(guild.id, VERIFIZIERUNG.panel)) || vorgabeVerifizierung(guild).panel;
    const mit = { guildId: guild.id, komponenten };
    let { nachricht } = await Vorlage.fuelle(vorlage, { guild }, mit);
    if (!nachricht) ({ nachricht } = await Vorlage.fuelle(vorgabeVerifizierung(guild).panel, { guild }, mit));
    return nachricht;
}

module.exports = {
    ANLAESSE,
    VERIFIZIERUNG,
    baueNachricht,
    baueVerifiziert,
    bauePanel,
};
