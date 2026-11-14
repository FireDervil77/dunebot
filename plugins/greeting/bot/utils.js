const { Vorlage } = require("dunebot-sdk");

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
 */

const ANLAESSE = Object.freeze({
    welcome: "greeting:willkommen",
    dm_welcome: "greeting:direktnachricht",
    farewell: "greeting:abschied",
    boost: "greeting:boost",
});

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
 * `member.inviterData` setzt heute niemand (Fund bei G-13, behoben mit G-16).
 * Bis dahin stehen die Werte auf „NA“ bzw. 0, wie vor G-08.
 *
 * @param {import('discord.js').GuildMember} member
 * @param {Object} vorlage
 * @param {Object} inviterData
 */
async function eigeneWerte(member, vorlage, inviterData = {}) {
    const text = Object.keys(Vorlage.FELDER).map((f) => vorlage?.[f] || "").join(" ");
    const extra = {};
    if (text.includes("{inviter:")) {
        const inviterId = inviterData.member_id || "NA";
        let name = inviterId;
        let tag = inviterId;
        if (inviterId !== "VANITY" && inviterId !== "NA") {
            try {
                const inviter = await member.client.users.fetch(inviterId);
                name = inviter.username;
                tag = inviter.tag;
            } catch (ex) {
                member.client.logger.error(`Parsing inviterId: ${inviterId}`, ex);
                name = "NA";
                tag = "NA";
            }
        } else if (member.user.bot) {
            name = "OAuth";
            tag = "OAuth";
        }
        extra["inviter:name"] = name;
        extra["inviter:tag"] = tag;
    }
    if (text.includes("{invites}")) {
        const d = inviterData.invite_data || {};
        extra.invites = d.tracked + d.added - d.fake - d.left || 0;
    }
    return extra;
}

/**
 * Nachricht eines Anlasses für dieses Mitglied.
 *
 * @param {import('discord.js').GuildMember} member
 * @param {string} anlass einer aus ANLAESSE
 * @param {Object} [optionen]
 * @param {Object} [optionen.inviterData]
 * @param {string} [optionen.textStatt] anderer Nachrichtentext (Einladung mit eigenem Text)
 * @param {{name: string, attachment: *}[]} [optionen.anhaenge] z. B. das Willkommensbild
 * @returns {Promise<Object>} Nachricht für `send()`
 */
async function baueNachricht(member, anlass, optionen = {}) {
    let vorlage = (await Vorlage.lade(member.guild.id, anlass)) || Vorlage.leer();
    if (optionen.textStatt) vorlage = { ...vorlage, text: optionen.textStatt };
    const extra = await eigeneWerte(member, vorlage, optionen.inviterData);
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

module.exports = {
    ANLAESSE,
    baueNachricht,
};
