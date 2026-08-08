/**
 * Musik - die Knoepfe unter der laufenden Nachricht
 *
 * Die Knoepfe rufen dieselben Methoden des `GuildPlayer` auf wie die
 * Schraegstrich-Befehle und das Dashboard. Es gibt also weiterhin nur eine
 * Stelle, an der wirklich gesteuert wird - hier wird nur uebersetzt, was
 * ein Druck bedeutet.
 *
 * Nach jedem Druck wird die Nachricht neu aufgebaut, damit Knopf und
 * Zustand zusammenpassen: sonst steht auf dem Knopf "Pause", waehrend es
 * laengst angehalten ist.
 *
 * @module music/bot/events/interactionCreate
 */

const { MessageFlags } = require('discord.js');
const { ServiceManager } = require('dunebot-core');
const { VORSATZ, WIEDERHOLUNG } = require('../steuerung');
const { titelZeile } = require('../utils');

/** Um wie viel die Lautstaerkeknoepfe verstellen. */
const SCHRITT = 10;

/**
 * @param {import('discord.js').BaseInteraction} interaction
 */
module.exports = async (interaction) => {
    if (!interaction.isButton()) return;
    if (!interaction.customId.startsWith(VORSATZ)) return;

    const Logger = ServiceManager.get('Logger');
    const vorgang = interaction.customId.slice(VORSATZ.length);
    const manager = interaction.client.musicManager;

    /** Kurze Ruecksprache, die nur der Druckende sieht. */
    const nurFuerDich = (text) =>
        interaction.reply({ content: text, flags: MessageFlags.Ephemeral }).catch(() => {});

    if (!manager) return nurFuerDich('Das Musik-System laeuft gerade nicht.');

    const abspieler = manager.vorhanden(interaction.guildId);
    if (!abspieler || !abspieler.verbindung) {
        return nurFuerDich('Es laeuft gerade nichts mehr. Diese Knoepfe sind veraltet.');
    }

    const mitglied = interaction.member;

    // Wer nicht dabei ist, steuert nicht mit
    const eigenerKanal = mitglied?.voice?.channel;
    if (!eigenerKanal) return nurFuerDich('Du musst dafuer im Sprachkanal sein.');
    if (eigenerKanal.id !== abspieler.sprachKanalId) {
        return nurFuerDich('Du bist in einem anderen Sprachkanal als ich.');
    }

    // Die Warteschlange anzusehen darf jeder, alles andere braucht das Recht
    if (vorgang !== 'queue' && !(await manager.darfSteuern(mitglied))) {
        return nurFuerDich('Dafuer brauchst du die DJ-Rolle.');
    }

    try {
        // Den Druck sofort bestaetigen - Discord gibt dafuer drei Sekunden.
        // Das Neuzeichnen macht `ansageAuffrischen()` im Abspieler, damit es
        // nur einen Weg dafuer gibt: Knopf, Befehl und Dashboard aendern
        // denselben Zustand und muessen dieselbe Nachricht nachziehen.
        if (vorgang !== 'queue' && vorgang !== 'leave') {
            await interaction.deferUpdate().catch(() => { /* schon beantwortet */ });
        }

        switch (vorgang) {
            case 'pause':
                if (abspieler.pausiert) abspieler.fortsetzen();
                else abspieler.pausieren();
                break;

            case 'skip':
                // Ueberspringen laesst den naechsten Titel anlaufen; der
                // schickt seine eigene Ansage und nimmt dieser hier die Knoepfe
                abspieler.ueberspringen(1);
                break;

            case 'stop':
                abspieler.stoppen();
                break;

            case 'loop': {
                const jetzt = WIEDERHOLUNG[abspieler.wiederholung] || WIEDERHOLUNG.aus;
                abspieler.wiederholungSetzen(jetzt.naechster);
                break;
            }

            case 'shuffle':
                abspieler.mischen();
                break;

            case 'vol_down':
                abspieler.lautstaerkeSetzen(abspieler.lautstaerke - SCHRITT);
                break;

            case 'vol_up':
                abspieler.lautstaerkeSetzen(abspieler.lautstaerke + SCHRITT);
                break;

            case 'queue': {
                const z = abspieler.zustand();
                if (z.warteschlange.length === 0) {
                    return nurFuerDich('Die Warteschlange ist leer.');
                }
                const liste = z.warteschlange
                    .slice(0, 15)
                    .map((t, i) => titelZeile(t, i + 1))
                    .join('\n');
                const rest = z.warteschlange.length > 15
                    ? `\n\n… und ${z.warteschlange.length - 15} weitere`
                    : '';
                return nurFuerDich(`**Warteschlange**\n${liste}${rest}`);
            }

            case 'leave':
                manager.beenden(interaction.guildId);
                return interaction.update({
                    embeds: [{ color: 0x6C757D, description: 'Ich habe den Sprachkanal verlassen.' }],
                    components: []
                }).catch(() => {});

            default:
                return nurFuerDich('Diesen Knopf kenne ich nicht.');
        }
    } catch (err) {
        Logger.error(`[Musik] Knopf "${vorgang}" fehlgeschlagen:`, err);
        if (!interaction.replied && !interaction.deferred) {
            await nurFuerDich('Das hat nicht geklappt.');
        }
    }
};
