const {
    ActionRowBuilder,
    AttachmentBuilder,
    ButtonBuilder,
    ButtonStyle,
    ComponentType,
    MessageFlags,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
} = require("discord.js");
const { EmbedUtils } = require("dunebot-sdk/utils");
const { ServiceManager } = require("dunebot-core");

/**
 * `/meinedaten` — Was speichert der Bot über mich, und weg damit (G-04c, K380).
 *
 * Für Mitglieder ohne Dashboard-Zugang (F-G1 A, 2026-11-13). Die Aufgaben
 * sind geteilt wie bei `/plugin status` (discord-funktionen-abbilden): Das
 * Dashboard zählt, exportiert und löscht über `Datenauskunft`, der Bot fragt,
 * holt die Bestätigung ein und meldet je Plugin zurück, auch was scheiterte
 * und was bis zum Ende einer Frist bleibt.
 *
 * Nur als Slash-Befehl: Das Bestätigungsfenster (Name eintippen) gibt es nur
 * an Interaktionen. Ist Slash in einer Guild abgeschaltet, bleibt die Seite
 * „Meine Daten“ im Dashboard; der Knopf hier führt auch dorthin.
 *
 * Für alle Mitglieder, ohne Rechte: Jeder fragt nur nach sich selbst, die ID
 * kommt aus der Interaktion, nicht aus einer Eingabe.
 *
 * @type {import('dunebot-sdk').CommandType}
 */
module.exports = {
    name: "meinedaten",
    description: "core:MEINEDATEN.DESCRIPTION",
    command: {
        enabled: false,
    },
    slashCommand: {
        enabled: true,
        ephemeral: true,
        // Leer, aber da: `/help meinedaten` (getSlashUsage) liest options.find.
        options: [],
    },

    async interactionRun({ interaction }) {
        await meineDaten(interaction);
    },
};

/** Zählen über alle Tabellen dauert Sekunden, Löschen mit Rolle zurücknehmen etwas länger. */
const DASHBOARD_FRIST_MS = 60 * 1000;
/** So lange bleiben die Knöpfe bedienbar (die Antwort ist 15 Minuten änderbar). */
const KNOEPFE_MS = 10 * 60 * 1000;
/** Bestätigungsfenster. */
const FENSTER_MS = 2 * 60 * 1000;
/** Höchste Dateigröße, die Discord einem Bot ohne Boost abnimmt. */
const DATEI_HOECHSTENS = 8 * 1024 * 1024;

const KNOPF = { EXPORT: "meinedaten-export", HIER: "meinedaten-hier", UEBERALL: "meinedaten-ueberall" };

function frage(event, payload) {
    const ipcClient = ServiceManager.get("ipcClient");
    return ipcClient
        ? ipcClient.sendToDashboard(event, payload, DASHBOARD_FRIST_MS)
        : Promise.resolve({ success: false, error: "keine Verbindung zum Dashboard" });
}

/** Seite „Meine Daten“, wenn die Adresse bekannt ist. */
function seitenAdresse() {
    const basis = String(process.env.DASHBOARD_BASE_URL || "").replace(/\/+$/, "");
    return basis ? `${basis}/meinedaten` : null;
}

/** Eingetippter Name gleich dem verlangten? Groß- und Kleinschreibung egal. */
function nameStimmt(eingabe, soll) {
    return String(eingabe ?? "").trim().toLowerCase() === String(soll ?? "").trim().toLowerCase();
}

/**
 * Zeilen für die Auskunft eines Bereichs (diese Guild oder übergreifend).
 * @param {{plugins: Object[]}} teil aus `MeineDaten.zusammenzaehlen`
 * @param {Function} t Übersetzer
 * @returns {string[]}
 */
function auskunftZeilen(teil, t) {
    const zeilen = [];
    for (const p of teil.plugins) {
        const teile = [];
        if (p.loeschen) teile.push(t("ZAHL_LOESCHEN", { n: p.loeschen }));
        if (p.mitgeloescht) teile.push(t("ZAHL_MIT", { n: p.mitgeloescht }));
        if (p.anonymisieren) teile.push(t("ZAHL_ANONYM", { n: p.anonymisieren }));
        if (teile.length) zeilen.push(`**${p.plugin}**: ${teile.join(" · ")}`);
        for (const b of p.bleibt) zeilen.push(`⏳ **${p.plugin}**: ${t("ZAHL_FRIST", { n: b.zeilen, grund: b.grund })}`);
        for (const b of p.ausgenommen) zeilen.push(`ℹ️ **${p.plugin}**: ${t("ZAHL_BLEIBT", { n: b.zeilen, grund: b.grund })}`);
    }
    return zeilen;
}

/** Etwas zu löschen oder zu anonymisieren? */
function hatWeg(teil) {
    return teil.summe.loeschen + teil.summe.anonymisieren + teil.summe.mitgeloescht > 0;
}

/**
 * Rückmeldung nach dem Löschen, je Plugin.
 * @param {Object} r aus `MeineDaten.rueckmeldung`
 * @param {Function} t Übersetzer
 * @returns {import('discord.js').EmbedBuilder}
 */
function ergebnisEmbed(r, t) {
    const zeilen = [];
    for (const p of r.plugins) {
        if (!p.ok) {
            zeilen.push(`❌ **${p.plugin}**: ${t("ERG_FEHLER", { grund: p.fehler || "?" })}`);
            continue;
        }
        const teile = [];
        if (p.geloescht) teile.push(t("ERG_GELOESCHT", { n: p.geloescht }));
        if (p.mitgeloescht) teile.push(t("ERG_MIT", { n: p.mitgeloescht }));
        if (p.anonymisiert) teile.push(t("ERG_ANONYM", { n: p.anonymisiert }));
        if (teile.length) zeilen.push(`✅ **${p.plugin}**: ${teile.join(" · ")}`);
        for (const b of p.bleibt) zeilen.push(`⏳ **${p.plugin}**: ${t("ZAHL_FRIST", { n: b.zeilen, grund: b.grund })}`);
        if (p.nurUeberall) zeilen.push(`ℹ️ **${p.plugin}**: ${t("ERG_NUR_UEBERALL", { n: p.nurUeberall })}`);
    }
    if (!zeilen.length) zeilen.push(t("ERG_NICHTS"));
    if (r.ueberall) zeilen.push("", t("ERG_ABGEMELDET"));
    const art = r.ok ? "success" : "error";
    return EmbedUtils[art]({
        title: t(r.ok ? "ERG_TITEL_OK" : "ERG_TITEL_TEILWEISE"),
        description: zeilen.join("\n").slice(0, 4000),
    });
}

/**
 * Ablauf: Auskunft zeigen, dann Knöpfe für Export, hier löschen, überall
 * löschen. Löschen fragt in einem Fenster nach dem Namen.
 *
 * @param {import('discord.js').ChatInputCommandInteraction} interaction bereits verschoben (ephemeral)
 */
async function meineDaten(interaction) {
    const { guild, user } = interaction;
    const t = (schluessel, werte) => guild.getT(`core:MEINEDATEN.${schluessel}`, werte);
    const Logger = ServiceManager.get("Logger");

    const antwort = await frage("core:MEINEDATEN_AUSKUNFT", { userId: user.id, guildId: guild.id });
    if (!antwort?.success || !antwort.data) {
        return interaction.editReply({ content: t("KEIN_DASHBOARD", { grund: antwort?.error || "keine Antwort" }) });
    }
    const { hier, andereGuilds, uebergreifend } = antwort.data;

    const zeilen = auskunftZeilen(hier, t);
    const beschreibung = [zeilen.length ? zeilen.join("\n") : t("HIER_NICHTS"), ""];
    const uebergreifendZeilen = auskunftZeilen(uebergreifend, t);
    if (andereGuilds) beschreibung.push(t("ANDERE_GUILDS", { n: andereGuilds }));
    if (uebergreifendZeilen.length) beschreibung.push(`**${t("UEBERGREIFEND")}**`, ...uebergreifendZeilen);
    beschreibung.push("", t("HINWEIS_WEGE"));

    const knoepfe = [];
    if (hier.plugins.length) {
        knoepfe.push(new ButtonBuilder().setCustomId(KNOPF.EXPORT).setStyle(ButtonStyle.Secondary).setLabel(t("BTN_EXPORT")));
    }
    if (hatWeg(hier)) {
        knoepfe.push(new ButtonBuilder().setCustomId(KNOPF.HIER).setStyle(ButtonStyle.Danger).setLabel(t("BTN_HIER")));
    }
    if (hatWeg(hier) || andereGuilds || hatWeg(uebergreifend)) {
        knoepfe.push(new ButtonBuilder().setCustomId(KNOPF.UEBERALL).setStyle(ButtonStyle.Danger).setLabel(t("BTN_UEBERALL")));
    }
    const adresse = seitenAdresse();
    if (adresse) knoepfe.push(new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(adresse).setLabel(t("BTN_SEITE")));

    const nachricht = await interaction.editReply({
        embeds: [EmbedUtils.embed({ title: t("TITEL", { guild: guild.name }), description: beschreibung.join("\n").slice(0, 4000) })],
        components: knoepfe.length ? [new ActionRowBuilder().addComponents(knoepfe)] : [],
    });
    if (!knoepfe.some(k => k.data.custom_id)) return;

    const ende = Date.now() + KNOEPFE_MS;
    for (;;) {
        // Ein Zeitablauf wirft; er heißt „niemand klickt mehr“.
        const klick = await nachricht.awaitMessageComponent({
            componentType: ComponentType.Button,
            filter: (i) => i.user.id === user.id,
            time: Math.max(1000, ende - Date.now()),
        }).catch(() => null);
        if (!klick) {
            await interaction.editReply({ components: [] })
                .catch((e) => Logger.debug(`[meinedaten] Knöpfe nicht entfernt: ${e.message}`));
            return;
        }

        if (klick.customId === KNOPF.EXPORT) {
            await exportieren(klick, guild, t);
            continue;
        }

        const ueberall = klick.customId === KNOPF.UEBERALL;
        const soll = ueberall ? user.username : guild.name;
        const fensterId = `meinedaten-fenster-${klick.id}`;
        await klick.showModal(new ModalBuilder({
            customId: fensterId,
            title: t(ueberall ? "FENSTER_TITEL_UEBERALL" : "FENSTER_TITEL_HIER").slice(0, 45),
            components: [
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId("name")
                        .setLabel(t(ueberall ? "FENSTER_LABEL_UEBERALL" : "FENSTER_LABEL_HIER").slice(0, 45))
                        .setPlaceholder(String(soll).slice(0, 100))
                        .setStyle(TextInputStyle.Short)
                        .setRequired(true),
                ),
            ],
        }));
        // Ein Zeitablauf wirft; er heißt „nicht bestätigt“, die Knöpfe bleiben.
        const bestaetigung = await klick
            .awaitModalSubmit({ time: FENSTER_MS, filter: (m) => m.customId === fensterId && m.user.id === user.id })
            .catch(() => null);
        if (!bestaetigung) continue;
        if (!nameStimmt(bestaetigung.fields.getTextInputValue("name"), soll)) {
            await bestaetigung.reply({ content: t("FENSTER_FALSCH", { soll }), flags: MessageFlags.Ephemeral });
            continue;
        }

        await bestaetigung.update({
            embeds: [EmbedUtils.embed({ description: t(ueberall ? "LOESCHE_UEBERALL" : "LOESCHE_HIER") })],
            components: [],
        });
        const erg = await frage("core:MEINEDATEN_LOESCHEN", { userId: user.id, guildId: ueberall ? null : guild.id });
        if (!erg?.data?.plugins) {
            await interaction.editReply({
                embeds: [EmbedUtils.error({ description: t("KEIN_DASHBOARD", { grund: erg?.error || "keine Antwort" }) })],
            });
            return;
        }
        await interaction.editReply({ embeds: [ergebnisEmbed(erg.data, t)] });
        return;
    }
}

/**
 * Export dieser Guild als JSON-Datei, nur für den, der fragt.
 * @param {import('discord.js').ButtonInteraction} klick
 * @param {import('discord.js').Guild} guild
 * @param {Function} t Übersetzer
 */
async function exportieren(klick, guild, t) {
    await klick.deferReply({ flags: MessageFlags.Ephemeral });
    const antwort = await frage("core:MEINEDATEN_EXPORT", { userId: klick.user.id, guildId: guild.id });
    if (!antwort?.success || !antwort.data) {
        return klick.editReply({ content: t("KEIN_DASHBOARD", { grund: antwort?.error || "keine Antwort" }) });
    }
    const inhalt = Buffer.from(JSON.stringify(antwort.data, null, 2), "utf8");
    if (inhalt.length > DATEI_HOECHSTENS) {
        return klick.editReply({ content: t("EXPORT_ZU_GROSS", { adresse: seitenAdresse() || "/meinedaten" }) });
    }
    return klick.editReply({
        content: t("EXPORT_FERTIG"),
        files: [new AttachmentBuilder(inhalt, { name: `meine-daten-${guild.id}.json` })],
    });
}
