/**
 * Musik - Verwaltung aller Abspieler
 *
 * Haelt je Guild hoechstens einen `GuildPlayer` und ist die einzige Stelle,
 * ueber die Befehle und Dashboard darauf zugreifen.
 *
 * @module music/bot/managers/MusicManager
 */

const { ServiceManager } = require('dunebot-core');
const GuildPlayer = require('./GuildPlayer');
const { MusicSettings } = require('../../shared/models');

class MusicManager {
    /**
     * @param {Object} client Discord-Client
     */
    constructor(client) {
        this.client = client;
        /** @type {Map<string, GuildPlayer>} */
        this.abspieler = new Map();
    }

    /**
     * Den Abspieler einer Guild holen, bei Bedarf anlegen.
     *
     * @param {string} guildId Discord-Guild-ID
     * @returns {GuildPlayer}
     */
    holen(guildId) {
        let abspieler = this.abspieler.get(guildId);
        if (!abspieler) {
            abspieler = new GuildPlayer(this.client, guildId);
            this.abspieler.set(guildId, abspieler);
        }
        return abspieler;
    }

    /**
     * Den Abspieler einer Guild, aber ohne anzulegen.
     *
     * @param {string} guildId Discord-Guild-ID
     * @returns {GuildPlayer|undefined}
     */
    vorhanden(guildId) {
        return this.abspieler.get(guildId);
    }

    /**
     * Abspieler beenden und vergessen.
     *
     * @param {string} guildId Discord-Guild-ID
     */
    beenden(guildId) {
        const abspieler = this.abspieler.get(guildId);
        if (!abspieler) return false;

        abspieler.aufraeumen();
        this.abspieler.delete(guildId);
        return true;
    }

    /**
     * Darf jemand die Wiedergabe steuern?
     *
     * Ist eine DJ-Rolle gesetzt, braucht es sie - ausser man ist allein mit
     * dem Bot im Kanal oder traegt Verwaltungsrechte des Servers.
     *
     * @param {Object} mitglied Discord-GuildMember
     * @returns {Promise<boolean>}
     */
    async darfSteuern(mitglied) {
        if (!mitglied) return false;

        const einstellungen = await MusicSettings.getSettings(mitglied.guild.id);
        if (!einstellungen.dj_role_id) return true;

        if (mitglied.roles.cache.has(einstellungen.dj_role_id)) return true;
        if (mitglied.permissions.has('ManageGuild')) return true;

        // Allein mit dem Bot im Kanal darf jeder steuern
        const kanal = mitglied.voice?.channel;
        if (kanal) {
            const menschen = kanal.members.filter(m => !m.user.bot).size;
            if (menschen <= 1) return true;
        }

        return false;
    }

    /**
     * Ist der Sprachkanal fuer Musik freigegeben?
     *
     * @param {string} guildId Discord-Guild-ID
     * @param {string} kanalId Sprachkanal
     * @returns {Promise<boolean>}
     */
    async kanalErlaubt(guildId, kanalId) {
        const einstellungen = await MusicSettings.getSettings(guildId);
        const erlaubte = einstellungen.allowed_voice || [];
        // Leere Liste heisst: ueberall erlaubt
        return erlaubte.length === 0 || erlaubte.map(String).includes(String(kanalId));
    }

    /**
     * Zustand einer Guild - auch wenn gar nichts laeuft.
     *
     * @param {string} guildId Discord-Guild-ID
     * @returns {Object} Zustand
     */
    zustand(guildId) {
        const abspieler = this.abspieler.get(guildId);
        if (abspieler) return abspieler.zustand();

        return {
            guildId,
            verbunden: false,
            sprachKanalId: null,
            textKanalId: null,
            aktuell: null,
            pausiert: false,
            lautstaerke: 50,
            wiederholung: 'aus',
            warteschlange: [],
            warteschlangeLaenge: 0,
            restspielzeitSek: 0
        };
    }

    /**
     * Alle laufenden Abspieler - fuer die Betriebsuebersicht.
     *
     * @returns {Array<Object>} Zustaende
     */
    alleZustaende() {
        return Array.from(this.abspieler.values()).map(a => a.zustand());
    }

    /**
     * Wenn der letzte Mensch den Kanal verlaesst, hat der Bot dort nichts
     * mehr verloren. Wird vom `voiceStateUpdate`-Ereignis aufgerufen.
     *
     * @param {string} guildId Discord-Guild-ID
     * @param {Object} kanal Sprachkanal, den jemand verlassen hat
     */
    async pruefeVerwaisung(guildId, kanal) {
        const abspieler = this.abspieler.get(guildId);
        if (!abspieler || !kanal || abspieler.sprachKanalId !== kanal.id) return;

        const einstellungen = await MusicSettings.getSettings(guildId);
        if (!einstellungen.leave_when_empty) return;

        const menschen = kanal.members.filter(m => !m.user.bot).size;
        if (menschen > 0) return;

        ServiceManager.get('Logger').info(`[Musik] Guild ${guildId}: niemand mehr im Kanal`);
        this.beenden(guildId);
    }

    /** Alles beenden - beim Abschalten des Plugins. */
    zerstoeren() {
        for (const guildId of Array.from(this.abspieler.keys())) {
            this.beenden(guildId);
        }
    }
}

module.exports = MusicManager;
