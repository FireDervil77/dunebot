const { MiscUtils, Logger, EmbedUtils } = require("dunebot-sdk/utils");
const { parsePlaceholders } = require("dunebot-core");
const { pruefeSpam, ohneEinladungen, istBefehlsnachricht, merkeEigeneLoeschung, shouldModerate } = require("../utils");
const { AutoModSettings, AutoModStrikes, AutoModLogs, AutoModEscalation, AutoModExemptions, AutoModRegexRules, AutoModCompoundRules } = require("../../shared/models");
const { getGuildKeywordLists } = require("../keywordLoader");
const { findeTreffer } = require("../../shared/stichwortTreffer");

// Moderation Integration - Optional dependency
let addModAction;
try {
    const ModUtils = require("../../../moderation/bot/utils");
    addModAction = ModUtils.addModAction;
} catch (ex) {
    Logger.warn("[AutoMod] Moderation plugin not found, using fallback actions");
    // Der Ersatz muss dieselbe Unterschrift haben wie das Original - sonst
    // faellt die Dauer hier wieder auf den Boden, sobald das Moderations-Plugin
    // einmal fehlt.
    addModAction = async (issuer, target, reason, action, durationMs) => {
        switch (action) {
            case "TIMEOUT":
                await target.timeout(Number(durationMs) > 0 ? Number(durationMs) : 24 * 60 * 60 * 1000, reason);
                break;
            case "KICK":
                await target.kick(reason);
                break;
            case "BAN":
                await target.ban({ reason });
                break;
        }
    };
}

/**
 * This function saves stats for a new message
 * @param {import("discord.js").Message} message
 */
module.exports = async (message) => {
    if (message.system || message.webhookId) return;
    if (message.author.bot && message.author.id === message.guild.members.me.id) return;

    const settings = await AutoModSettings.getSettings(message.guild.id);

    // Welche Kanal-IDs zaehlen fuer Whitelist und Ausnahmen?
    //
    // In einem Thread ist `message.channelId` die ID des **Threads**, nicht die
    // des Kanals darunter. Wer einen Kanal ausgenommen hat, meint aber dessen
    // Threads mit - und Threads stehen in keiner Auswahlliste, sie kommen und
    // gehen. Deshalb zaehlt bei Threads der Elternkanal zusaetzlich.
    //
    // Nur bei Threads. Bei einem gewoehnlichen Kanal ist `parentId` die
    // Kategorie, und eine ganze Kategorie auszunehmen, weil jemand einen Kanal
    // darin ausgenommen hat, waere etwas voellig anderes.
    const kanalIds = [message.channelId];
    if (message.channel?.isThread?.() && message.channel.parentId) {
        kanalIds.push(message.channel.parentId);
    }

    if (kanalIds.some(id => settings.whitelisted_channels.includes(id))) return;

    // Exemption-Check: Channels und Rollen
    try {
        const [kanalAusnahmen, memberExempt] = await Promise.all([
            Promise.all(kanalIds.map(id => AutoModExemptions.isExempt(message.guild.id, 'channel', id))),
            AutoModExemptions.isMemberExempt(message.guild.id, message.member.roles.cache.map(r => r.id))
        ]);
        if (kanalAusnahmen.some(Boolean) || memberExempt) return;
    } catch {
        // Bei DB-Fehler weitermachen mit normalen Checks
    }

    if (!settings.debug_mode && !shouldModerate(message)) return;

    // Praefix-Befehle nicht moderieren. Der alte Schutz dafuer (`message.isCommand`)
    // war wirkungslos - siehe `istBefehlsnachricht` in ../utils.
    if (await istBefehlsnachricht(message)) return;

    const { channel, member, guild, content, author, mentions } = message;
    const logChannel = settings.log_channel
        ? channel.guild.channels.cache.get(settings.log_channel)
        : null;

    let shouldDelete = false;
    let strikesTotal = 0;

    const fields = [];

    // ════════════════════════════════════════════════════════════════════════
    // Erwaehnungsgrenzen
    //
    // Die `> 0`-Pruefung fehlte hier, obwohl `max_lines` weiter unten sie hat
    // und das Dashboard ausdruecklich "0 heisst aus" verspricht. Beide Spalten
    // stehen per Vorgabe auf 0 - eine frisch aktivierte Guild gab damit fuer
    // **jede** Nachricht mit einer einzigen Erwaehnung einen Strike, ohne dass
    // irgendein Schalter an war. Nach zehn davon: Timeout.
    // ════════════════════════════════════════════════════════════════════════

    // Max mentions
    if (settings.max_mentions > 0 && mentions.members.size > settings.max_mentions) {
        fields.push({
            name: guild.getT("automod:HANDLER.FIELD_MENTIONS"),
            value: `${mentions.members.size}/${settings.max_mentions}`,
            inline: true,
        });
        strikesTotal += 1;
    }

    // Maxrole mentions
    if (settings.max_role_mentions > 0 && mentions.roles.size > settings.max_role_mentions) {
        fields.push({
            name: guild.getT("automod:HANDLER.FIELD_ROLE_MENTIONS"),
            value: `${mentions.roles.size}/${settings.max_role_mentions}`,
            inline: true,
        });
        strikesTotal += 1;
    }

    if (settings.anti_massmention) {
        // check everyone mention
        if (mentions.everyone) {
            fields.push({
                name: guild.getT("automod:HANDLER.FIELD_EVERYONE"),
                value: "✓",
                inline: true,
            });
            strikesTotal += 1;
        }

        // check user/role mentions
        if (mentions.users.size + mentions.roles.size > settings.anti_massmention_threshold) {
            fields.push({
                name: guild.getT("automod:HANDLER.FIELD_ROLE_USER_MENTIONS"),
                value: `${mentions.users.size + mentions.roles.size}/${settings.anti_massmention_threshold}`,
                inline: true,
            });
            // strikesTotal += mentions.users.size + mentions.roles.size - settings.anti_massmention_threshold;
            strikesTotal += 1;
        }
    }

    // Max Lines
    if (settings.max_lines > 0) {
        const count = content.split("\n").length;
        if (count > settings.max_lines) {
            fields.push({
                name: guild.getT("automod:HANDLER.FIELD_MAX_LINES"),
                value: `${count}/${settings.max_lines}`,
                inline: true,
            });
            shouldDelete = true;
            // strikesTotal += Math.ceil((count - settings.max_lines) / settings.max_lines);
            strikesTotal += 1;
        }
    }

    // Anti Attachments
    if (settings.anti_attachments) {
        if (message.attachments.size > 0) {
            fields.push({
                name: guild.getT("automod:HANDLER.FIELD_ATTACH"),
                value: "✓",
                inline: true,
            });
            shouldDelete = true;
            strikesTotal += 1;
        }
    }

    // ════════════════════════════════════════════════════════════════════════
    // Einladungen und Links - zwei Filter, zwei Zustaendigkeiten
    //
    // Vorher verschluckte der Linkfilter jede Einladung: `https://discord.gg/x`
    // ist nun einmal auch ein Link. Weil der Einladungsfilter zusaetzlich an
    // `!anti_links` haengte, war er dabei abgeschaltet - die Einladung wurde als
    // "Links gefunden" protokolliert, und wer nur Einladungen sperren wollte,
    // musste den Linkfilter ausschalten.
    //
    // Jetzt gilt: **Eine Einladung ist eine Einladung.** Sie gehoert dem
    // Einladungsfilter, der Linkfilter fasst sie nicht an. Fuer die Linkpruefung
    // wird der Text ohne seine Einladungen betrachtet - eine Nachricht mit
    // Einladung *und* gewoehnlichem Link loest damit beides aus, je nachdem,
    // welche Schalter an sind.
    // ════════════════════════════════════════════════════════════════════════
    const hatEinladung = MiscUtils.containsDiscordInvite(content);

    if (settings.anti_invites && hatEinladung) {
        fields.push({
            name: guild.getT("automod:HANDLER.FIELD_INVITES"),
            value: "✓",
            inline: true,
        });
        shouldDelete = true;
        strikesTotal += 1;
    }

    if (settings.anti_links && MiscUtils.containsLink(ohneEinladungen(content))) {
        fields.push({
            name: guild.getT("automod:HANDLER.FIELD_LINKS"),
            value: "✓",
            inline: true,
        });
        shouldDelete = true;
        strikesTotal += 1;
    }

    // ════════════════════════════════════════════════════════════════════════
    // Anti-Spam
    //
    // Bewusst **nicht** mehr an `!settings.anti_links` gekoppelt: Wer Links
    // sperrt, wollte damit nie den Spam-Schutz mit abschalten. Und geprueft
    // wird jetzt eine Rate statt eines Links - Einzelheiten in ../utils.
    // ════════════════════════════════════════════════════════════════════════
    if (settings.anti_spam) {
        const spam = pruefeSpam(message, settings);
        if (spam.getroffen) {
            fields.push({
                name: guild.getT("automod:HANDLER.FIELD_ANTISPAM"),
                value: spam.grund === 'RATE'
                    ? guild.getT("automod:HANDLER.SPAM_RATE", {
                        count: spam.anzahl,
                        limit: spam.grenze,
                        seconds: Number(settings.anti_spam_seconds) || 5,
                    })
                    : guild.getT("automod:HANDLER.SPAM_DUPLICATE", {
                        count: spam.anzahl,
                        limit: spam.grenze,
                    }),
                inline: true,
            });
            shouldDelete = true;
            strikesTotal += 1;
        }
    }

    // ── Stichwortlisten ──────────────────────────────────────────────────
    //
    // Ein Bestand je Guild, seit dem 2026-08-09. Die mitgelieferten Listen sind
    // nur noch Vorlage fuer das erste Befuellen - was hier geprueft wird, gehoert
    // der Guild und ist ueber das Dashboard bearbeitbar.
    //
    // Der Vergleich lief vorher ueber `lowerContent.includes(kw)` - eine reine
    // Teilzeichenkette, die bei kurzen Eintraegen mitten in harmlosen Woertern
    // anschlug. Jetzt entscheidet die Trefferart je Eintrag, Vorgabe ist
    // "ganzes Wort" (siehe shared/stichwortTreffer.js).
    const stichwortListen = await getGuildKeywordLists(guild.id);

    for (const liste of stichwortListen) {
        const treffer = findeTreffer(content, liste.keywords);
        if (!treffer) continue;

        fields.push({
            name: guild.getT("automod:HANDLER.FIELD_KEYWORD", { list: liste.name }),
            value: `||${treffer}||`,
            inline: true,
        });
        shouldDelete = true;
        strikesTotal += 1;
        break;
    }

    // Regex-Regeln Check
    try {
        const matchedRule = await AutoModRegexRules.testMessage(guild.id, content);
        if (matchedRule) {
            fields.push({
                name: guild.getT("automod:HANDLER.FIELD_REGEX", { rule: matchedRule.name }),
                value: "✓",
                inline: true,
            });

            if (matchedRule.action === 'DELETE' || matchedRule.action === 'STRIKE') {
                shouldDelete = true;
            }
            if (matchedRule.action === 'STRIKE' || matchedRule.action === 'WARN') {
                strikesTotal += 1;
            }
        }
    } catch (err) {
        Logger.error('[AutoMod] Regex-Check Fehler:', err);
    }

    // Compound Rules Check
    try {
        const matchedCompound = await AutoModCompoundRules.checkMessage(message);
        if (matchedCompound) {
            fields.push({
                name: guild.getT("automod:HANDLER.FIELD_COMPOUND", { rule: matchedCompound.name }),
                value: "✓",
                inline: true,
            });

            if (['DELETE', 'STRIKE', 'TIMEOUT', 'KICK', 'BAN'].includes(matchedCompound.action)) {
                shouldDelete = true;
            }
            if (['STRIKE', 'WARN'].includes(matchedCompound.action)) {
                strikesTotal += 1;
            }
            // Direkte Aktionen (TIMEOUT/KICK/BAN) werden nach dem Strike-System ausgeführt
            if (['TIMEOUT', 'KICK', 'BAN'].includes(matchedCompound.action)) {
                const duration = matchedCompound.action === 'TIMEOUT' && matchedCompound.duration
                    ? matchedCompound.duration * 60 * 1000
                    : undefined;
                try {
                    await addModAction(
                        guild.members.me,
                        member,
                        guild.getT("automod:HANDLER.AUTO_ACTION_REASON") + ` [${matchedCompound.name}]`,
                        matchedCompound.action,
                        duration,
                    );
                } catch {}
            }
        }
    } catch (err) {
        Logger.error('[AutoMod] Compound-Rules-Check Fehler:', err);
    }

    // delete message if deletable
    //
    // Hier stand `channel.send(text, 5)` - die 5 sollte offenbar "nach fuenf
    // Sekunden wieder weg" heissen, ist in discord.js aber kein zweiter
    // Parameter und wurde verworfen. Der Hinweis blieb dadurch fuer immer
    // stehen und muellte den Kanal zu, den er gerade aufgeraeumt hatte.
    if (shouldDelete && message.deletable) {
        // Vor dem Loeschen vormerken, nicht danach: `messageDelete` kann
        // schneller sein als die Antwort auf `delete()`. Ohne die Vormerkung
        // meldet der Ghost-Ping-Waechter jede eigene Loeschung als Ghost-Ping.
        merkeEigeneLoeschung(message.id);

        message
            .delete()
            .then(() => channel.send(guild.getT("automod:HANDLER.AUTO_DELETED")))
            .then((hinweis) => {
                if (!hinweis) return;
                setTimeout(() => hinweis.delete().catch(() => {}), 5000);
            })
            .catch(() => {});
    }

    if (strikesTotal > 0) {
        // add strikes to member
        let dbStrikes = await AutoModStrikes.getStrikes(guild.id, author.id);
        dbStrikes += strikesTotal;

        // log to db
        const reason = fields.map((field) => field.name + ": " + field.value).join("\n");
        AutoModLogs.addLog(guild.id, author.id, content, reason, strikesTotal).catch(() => {});

        // send automod log
        if (logChannel) {
            const logEmbed = EmbedUtils.embed()
                .setAuthor({ name: guild.getT("automod:HANDLER.AUTO_LOG_TITLE") })
                .setThumbnail(author.displayAvatarURL())

                .addFields(fields)
                .setDescription(
                    `**${guild.getT("automod:HANDLER.AUTO_LOG_CHANNEL")}:** ${channel.toString()}\n**${guild.getT(
                        "automod:HANDLER.AUTO_LOG_CONTENT",
                    )}:**\n${content}`,
                )
                .setFooter({
                    text: `By ${author.username} | ${author.id}`,
                    iconURL: author.avatarURL(),
                });

            // Die Spalte heisst log_embed_color. `settings.embed_colors.log`
            // stammt aus einer Vorlage mit verschachtelter Einstellung - hier
            // gab es das Feld nie, der Zugriff warf jedes Mal.
            if (settings.log_embed_color) {
                logEmbed.setColor(settings.log_embed_color);
            }

            logChannel.send({ embeds: [logEmbed] });
        }

        // DM strike details
        const dmDesc = settings.dm_message
            ? parsePlaceholders(settings.dm_message, {
                member,
                guild,
                extra: {
                    strikes: String(strikesTotal),
                    total_strikes: String(dbStrikes),
                    max_strikes: String(settings.max_strikes)
                }
            })
            : guild.getT("automod:HANDLER.AUTO_DM_DESC", {
                guild: guild.name,
                strikes: strikesTotal,
                total: dbStrikes,
                max: settings.max_strikes,
            });

        // Der Strike-Stand gehoert als eigenes Feld in die Nachricht, nicht nur
        // in den Standardtext.
        //
        // Sobald jemand einen eigenen `dm_message`-Text setzt, ersetzt der den
        // Standardtext **vollstaendig** - und mit ihm die einzige Stelle, an der
        // "x von y Strikes" stand. In der Nachricht blieben dann nur noch die
        // Verstossfelder uebrig, und deren "3/3" (drei gleiche Nachrichten von
        // drei erlaubten) sah aus wie ein Strike-Zaehler. Als Feld steht der
        // Stand jetzt unabhaengig vom Text immer da.
        const strikeFelder = fields.concat([{
            name: guild.getT("automod:HANDLER.DM_FIELD_STRIKES"),
            value: `${dbStrikes}/${settings.max_strikes}`,
            inline: true,
        }]);

        const strikeEmbed = EmbedUtils.embed()
            .setThumbnail(guild.iconURL())
            .setAuthor({ name: guild.getT("automod:HANDLER.AUTO_DM_TITLE") })
            .addFields(strikeFelder)
            .setDescription(dmDesc);

        if (settings.dm_embed_color) {
            strikeEmbed.setColor(settings.dm_embed_color);
        }

        author.send({ embeds: [strikeEmbed] }).catch(() => {});

        // check if max strikes are received - Escalation System
        const escalationLevel = await AutoModEscalation.getActionForStrikes(guild.id, dbStrikes);

        if (escalationLevel) {
            // Eskalationsstufe gefunden -> Aktion ausführen
            dbStrikes = 0;

            const actionToExecute = escalationLevel.action;
            const duration = escalationLevel.duration;

            if (actionToExecute === 'TIMEOUT' && duration) {
                await addModAction(
                    guild.members.me,
                    member,
                    guild.getT("automod:HANDLER.AUTO_ACTION_REASON"),
                    actionToExecute,
                    duration * 60 * 1000,
                ).catch(() => {});
            } else {
                await addModAction(
                    guild.members.me,
                    member,
                    guild.getT("automod:HANDLER.AUTO_ACTION_REASON"),
                    actionToExecute,
                ).catch(() => {});
            }
        } else if (dbStrikes >= settings.max_strikes) {
            // Fallback: Kein Escalation Config -> altes System
            dbStrikes = 0;

            // Die Dauer gilt nur fuer TIMEOUT; bei KICK und BAN ist sie
            // bedeutungslos und wird von `addModAction` ignoriert. Ohne
            // Einstellung greift dort weiterhin die Vorgabe von 24 Stunden.
            const dauerMs = Number(settings.action_duration) > 0
                ? Number(settings.action_duration) * 60 * 1000
                : undefined;

            await addModAction(
                guild.members.me,
                member,
                guild.getT("automod:HANDLER.AUTO_ACTION_REASON"),
                settings.action,
                dauerMs,
            ).catch(() => {});
        }

        await AutoModStrikes.updateStrikes(guild.id, author.id, dbStrikes);
    }
};
