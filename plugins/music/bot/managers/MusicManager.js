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
const { MusicSettings, MusicSession } = require('../../shared/models');

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
     * Abspieler beenden.
     *
     * @param {string} guildId Discord-Guild-ID
     * @param {boolean} [vergessen=false] Auch den gesicherten Stand verwerfen
     */
    beenden(guildId, vergessen = false) {
        const abspieler = this.abspieler.get(guildId);

        // Der gesicherte Stand haengt nicht am Abspieler - er kann auch dann
        // wegzuwerfen sein, wenn hier gerade keiner mehr laeuft
        if (vergessen) {
            MusicSession.loeschen(guildId).catch(err => {
                ServiceManager.get('Logger').warn(`[Musik] Stand nicht verworfen: ${err.message}`);
            });
        }

        if (!abspieler) return false;

        abspieler.aufraeumen();
        this.abspieler.delete(guildId);
        return true;
    }

    /**
     * Gesicherte Warteschlangen nach einem Neustart wieder aufnehmen.
     *
     * Zwei Bedingungen, damit daraus keine Ueberraschung wird:
     *
     * - **Nur wenn jemand da ist.** Ein Bot, der um vier Uhr morgens von
     *   allein in einen leeren Kanal zurueckkehrt und Musik spielt, ist ein
     *   Fehler, kein Dienst. Ausnahme ist der Dauerbetrieb - der ist
     *   ausdruecklich dafuer gedacht.
     * - **Nur frische Staende.** Was aelter als `HOECHSTALTER_STUNDEN` ist,
     *   wird verworfen. Sonst holt ein Neustart nach drei Wochen eine
     *   Warteschlange zurueck, an die sich niemand mehr erinnert.
     *
     * Der laufende Titel beginnt von vorn. Mitten im Stueck einzusteigen
     * waere machbar, aber der gesicherte Sekundenstand ist nach einem
     * Absturz ohnehin nur ungefaehr.
     *
     * @returns {Promise<number>} Wie viele Sitzungen wieder aufgenommen wurden
     */
    async wiederherstellen() {
        const Logger = ServiceManager.get('Logger');

        let staende;
        try {
            staende = await MusicSession.alle();
        } catch (err) {
            // Fehlt die Tabelle noch, ist das kein Grund, den Bot aufzuhalten
            Logger.warn(`[Musik] Gesicherte Warteschlangen nicht lesbar: ${err.message}`);
            return 0;
        }

        if (staende.length === 0) return 0;

        let aufgenommen = 0;

        for (const stand of staende) {
            try {
                const alter = (Date.now() - new Date(stand.gesichertUm || Date.now()).getTime()) / 3600000;
                if (alter > MusicManager.HOECHSTALTER_STUNDEN) {
                    await MusicSession.loeschen(stand.guildId);
                    continue;
                }

                const kanal = this.client.channels.cache.get(stand.sprachKanalId);
                if (!kanal || !kanal.members) {
                    await MusicSession.loeschen(stand.guildId);
                    continue;
                }

                const menschen = kanal.members.filter(m => !m.user.bot).size;
                if (menschen === 0 && !stand.dauerbetrieb) continue;

                // Nichts zu spielen - dann lohnt auch das Beitreten nicht
                if (!stand.aktuell && stand.warteschlange.length === 0) {
                    await MusicSession.loeschen(stand.guildId);
                    continue;
                }

                const abspieler = this.holen(stand.guildId);
                abspieler.standUebernehmen(stand);

                // Der unterbrochene Titel kommt wieder nach vorn
                if (stand.aktuell) abspieler.warteschlange.unshift(stand.aktuell);

                await abspieler.beitreten(kanal, stand.textKanalId);
                await abspieler.starten();

                aufgenommen++;
                Logger.info(
                    `[Musik] Guild ${stand.guildId}: Warteschlange mit ` +
                    `${abspieler.warteschlange.length + 1} Titeln wieder aufgenommen`
                );
            } catch (err) {
                Logger.warn(`[Musik] Guild ${stand.guildId}: Wiederaufnahme fehlgeschlagen: ${err.message}`);
            }
        }

        return aufgenommen;
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
     * Die Kanalbelegung hat sich geaendert - jemand kam oder ging.
     *
     * Der Bot geht **nur**, wenn niemand mehr da ist, und auch dann erst nach
     * der eingestellten Frist. Eine leere Warteschlange ist kein Grund: er
     * soll im Kanal warten, bis jemand etwas moechte.
     *
     * Kommt in der Frist wieder jemand herein, wird der Rueckzug abgeblasen.
     *
     * @param {string} guildId Discord-Guild-ID
     * @param {Object} kanal Betroffener Sprachkanal
     * @param {boolean} [jemandKam=false] Ob jemand hereinkam statt zu gehen
     */
    async pruefeVerwaisung(guildId, kanal, jemandKam = false) {
        const abspieler = this.abspieler.get(guildId);
        if (!abspieler || !kanal || abspieler.sprachKanalId !== kanal.id) return;

        abspieler.kanalbelegungGeaendert(jemandKam);
    }

    /** Alles beenden - beim Abschalten des Plugins. */
    zerstoeren() {
        for (const guildId of Array.from(this.abspieler.keys())) {
            this.beenden(guildId);
        }
    }
}

/**
 * Wie alt ein gesicherter Stand hoechstens sein darf, um wieder
 * aufgenommen zu werden. Danach erinnert sich ohnehin niemand mehr daran,
 * was in der Liste stand.
 */
MusicManager.HOECHSTALTER_STUNDEN = 12;

module.exports = MusicManager;
