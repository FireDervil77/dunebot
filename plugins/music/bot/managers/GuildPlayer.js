/**
 * Musik - Abspieler einer Guild
 *
 * Haelt Warteschlange, Sprachverbindung und Tonstrom fuer genau einen Server.
 * Der `MusicManager` legt je Guild einen davon an.
 *
 * Die Warteschlange lebt nur hier im Arbeitsspeicher - sie haengt an der
 * Sprachverbindung und ist mit ihr zu Ende. In die Datenbank geht nur, was
 * einen Neustart ueberdauern soll: der Verlauf.
 *
 * @module music/bot/managers/GuildPlayer
 */

const {
    joinVoiceChannel,
    createAudioPlayer,
    createAudioResource,
    AudioPlayerStatus,
    VoiceConnectionStatus,
    NoSubscriberBehavior,
    StreamType,
    entersState
} = require('@discordjs/voice');

const play = require('play-dl');
const prism = require('prism-media');
const { ServiceManager } = require('dunebot-core');
const { MusicSettings, MusicHistory } = require('../../shared/models');
const { aufloesenZumAbspielen, aehnlichenFinden } = require('../quellen');
const klangfilter = require('../klangfilter');

// prism-media startet ffmpeg selbst. Ohne diesen Hinweis sucht es im
// System-PATH - dort liegt keins, wir bringen es als Paket mit.
if (!process.env.FFMPEG_PATH) {
    try {
        process.env.FFMPEG_PATH = require('ffmpeg-static');
    } catch { /* dann muss ein System-ffmpeg herhalten */ }
}

/** Wiederholmodus. */
const WIEDERHOLUNG = { AUS: 'aus', TITEL: 'titel', LISTE: 'liste' };

class GuildPlayer {
    /**
     * @param {Object} client Discord-Client
     * @param {string} guildId Discord-Guild-ID
     */
    constructor(client, guildId) {
        this.client = client;
        this.guildId = guildId;

        /** @type {Array<Object>} Wartende Titel */
        this.warteschlange = [];
        /** @type {Object|null} Was gerade laeuft */
        this.aktuell = null;

        this.verbindung = null;
        this.sprachKanalId = null;
        this.textKanalId = null;

        this.lautstaerke = 50;
        this.wiederholung = WIEDERHOLUNG.AUS;
        this.pausiert = false;
        this.gestartetUm = null;
        /** Millisekunden, die vor der letzten Pause schon gelaufen waren. */
        this.gelaufenVorPause = 0;

        /** Klangfilter; greift erst beim naechsten Titel. */
        this.filter = 'aus';
        /** Tonqualitaet: 0 niedrig, 1 mittel, 2 hoch. */
        this.qualitaet = 2;
        /** Dauerbetrieb: im Kanal bleiben, auch wenn nichts laeuft. */
        this.dauerbetrieb = false;
        /** Weiterspielen, wenn die Warteschlange leer laeuft. */
        this.autoplay = false;

        /** Wer fuer das Ueberspringen des laufenden Titels gestimmt hat. */
        this.stimmen = new Set();

        this._verlassenZeitgeber = null;
        this._wirdBeendet = false;

        this.spieler = createAudioPlayer({
            behaviors: {
                // Ohne Zuhoerer weiterlaufen zu lassen kostet nur Bandbreite
                noSubscriber: NoSubscriberBehavior.Pause
            }
        });

        this._hakenSetzen();
    }

    /**
     * Auf die Zustaende des Abspielers hoeren.
     *
     * @private
     */
    _hakenSetzen() {
        const Logger = ServiceManager.get('Logger');

        this.spieler.on(AudioPlayerStatus.Idle, () => {
            // Titel zu Ende - der naechste ist dran
            if (this._wirdBeendet) return;
            this._weiter().catch(err => Logger.error('[Musik] Weiterschalten fehlgeschlagen:', err));
        });

        this.spieler.on(AudioPlayerStatus.Playing, () => {
            this.pausiert = false;
        });

        this.spieler.on('error', (err) => {
            Logger.error(`[Musik] Abspielfehler in Guild ${this.guildId}:`, err.message);
            // Ein kaputter Titel darf die Warteschlange nicht anhalten
            this._weiter().catch(e => Logger.error('[Musik] Weiterschalten nach Fehler fehlgeschlagen:', e));
        });
    }

    /**
     * Einem Sprachkanal beitreten.
     *
     * @param {Object} sprachKanal Discord-Sprachkanal
     * @param {string} [textKanalId] Wohin Ansagen gehen
     */
    async beitreten(sprachKanal, textKanalId = null) {
        const Logger = ServiceManager.get('Logger');

        if (this.verbindung && this.sprachKanalId === sprachKanal.id) {
            if (textKanalId) this.textKanalId = textKanalId;
            return;
        }

        this.verbindung = joinVoiceChannel({
            channelId: sprachKanal.id,
            guildId: this.guildId,
            adapterCreator: sprachKanal.guild.voiceAdapterCreator,
            selfDeaf: true
        });

        this.sprachKanalId = sprachKanal.id;
        if (textKanalId) this.textKanalId = textKanalId;

        this.verbindung.subscribe(this.spieler);

        // Jeden Zustandswechsel mitschreiben.
        //
        // Ohne das ist ein fehlgeschlagener Beitritt nicht zu deuten: man sieht
        // nur, dass der Bot wieder draussen ist, aber nicht, ob er bis
        // Signalling, bis Connecting oder gar nicht erst losgekommen ist.
        // Genau daran hing die Suche am 2026-08-08.
        this.verbindung.on('stateChange', (alt, neu) => {
            Logger.info(`[Musik] Guild ${this.guildId}: Sprachverbindung ${alt.status} -> ${neu.status}`);

            // Den Schliesscode des Sprach-WebSockets mitschreiben.
            //
            // Der Uebergang connecting -> signalling sagt nur, dass der Socket
            // mit irgendetwas ausser 4014 zuging - und das ist die eine Zahl,
            // an der die Ursache haengt: 4006 heisst abgelaufene Sitzung, 4011
            // Server nicht gefunden, 4016 unbekanntes Verschluesselungsverfahren,
            // 1006 ein Abbruch auf dem Weg. Die Bibliothek behaelt den Code fuer
            // sich, deshalb horchen wir an der Netzwerkschicht mit.
            const netz = neu.networking;
            if (netz && netz !== alt.networking) {
                netz.once('close', (code) => {
                    Logger.warn(`[Musik] Guild ${this.guildId}: Sprach-WebSocket geschlossen mit Code ${code}`);
                });
            }
        });

        this.verbindung.on('error', (err) => {
            Logger.error(`[Musik] Guild ${this.guildId}: Fehler der Sprachverbindung: ${err.message}`);
        });

        // Discord verschiebt Sprachverbindungen gelegentlich. Ohne diese
        // Behandlung bricht der Ton dabei einfach ab.
        this.verbindung.on(VoiceConnectionStatus.Disconnected, async () => {
            Logger.info(`[Musik] Guild ${this.guildId}: getrennt, warte auf Wiederkehr`);

            // `Promise.any` statt `Promise.race`.
            //
            // `race` entscheidet beim ersten *Ergebnis*, also auch beim ersten
            // Fehlschlag. Erreicht die Verbindung Connecting erst nach vier
            // Sekunden, waehrend die Signalling-Frist schon nach dreien
            // abgelaufen ist, haette `race` den Umzug faelschlich als Ende
            // gewertet und die Verbindung abgeraeumt. `any` wartet auf den
            // ersten *Erfolg* und gibt erst auf, wenn beide scheitern.
            try {
                await Promise.any([
                    entersState(this.verbindung, VoiceConnectionStatus.Signalling, 5000),
                    entersState(this.verbindung, VoiceConnectionStatus.Connecting, 5000)
                ]);
                return;   // Es war ein Umzug, keine Trennung
            } catch {
                // Beide Fristen abgelaufen - es war wirklich das Ende
            }

            Logger.info(`[Musik] Verbindung in Guild ${this.guildId} beendet`);
            this.aufraeumen();
        });

        try {
            await entersState(this.verbindung, VoiceConnectionStatus.Ready, 20000);
            Logger.info(`[Musik] Guild ${this.guildId}: Sprachverbindung steht`);
        } catch (err) {
            const zustand = this.verbindung?.state?.status || 'unbekannt';
            Logger.error(
                `[Musik] Sprachverbindung in Guild ${this.guildId} kam nicht zustande ` +
                `(zuletzt ${zustand}): ${err.message}`
            );
            this.aufraeumen();
            throw err;
        }

        const einstellungen = await MusicSettings.getSettings(this.guildId);
        this.lautstaerke = einstellungen.default_volume ?? 50;
        this.filter = einstellungen.audio_filter || 'aus';
        this.qualitaet = einstellungen.audio_quality ?? 2;
        this.dauerbetrieb = Boolean(einstellungen.mode_247);
        this.autoplay = Boolean(einstellungen.autoplay);
    }

    /**
     * Titel anhaengen.
     *
     * @param {Array<Object>} titel Aufgeloeste Titel
     * @param {Object} [optionen] { anfang: boolean }
     * @returns {Promise<{aufgenommen: number, abgewiesen: number}>}
     */
    async hinzufuegen(titel, optionen = {}) {
        const einstellungen = await MusicSettings.getSettings(this.guildId);
        // 0 heisst unbegrenzt
        const grenze = einstellungen.max_queue_size || Infinity;
        const maxDauer = einstellungen.max_track_seconds || 0;

        let aufgenommen = 0;
        let abgewiesen = 0;

        for (const t of titel) {
            if (this.warteschlange.length >= grenze) { abgewiesen++; continue; }
            if (maxDauer > 0 && t.durationSec && t.durationSec > maxDauer) { abgewiesen++; continue; }

            if (optionen.anfang) {
                this.warteschlange.unshift(t);
            } else {
                this.warteschlange.push(t);
            }
            aufgenommen++;
        }

        return { aufgenommen, abgewiesen };
    }

    /**
     * Wiedergabe starten, falls sie steht.
     *
     * @returns {Promise<boolean>} Ob etwas gestartet wurde
     */
    async starten() {
        if (this.aktuell) return false;
        return await this._weiter();
    }

    /**
     * Den naechsten Titel abspielen.
     *
     * @returns {Promise<boolean>} Ob etwas laeuft
     * @private
     */
    async _weiter() {
        const Logger = ServiceManager.get('Logger');

        // Einzeltitel-Wiederholung: denselben nochmal
        if (this.wiederholung === WIEDERHOLUNG.TITEL && this.aktuell) {
            return await this._abspielen(this.aktuell);
        }

        // Listenwiederholung: den gerade gelaufenen hinten anhaengen
        if (this.wiederholung === WIEDERHOLUNG.LISTE && this.aktuell) {
            this.warteschlange.push(this.aktuell);
        }

        let naechster = this.warteschlange.shift();

        // Warteschlange leer, aber Autoplay an: etwas Passendes nachlegen.
        // Grundlage ist der zuletzt gelaufene Titel.
        if (!naechster && this.autoplay && this.aktuell) {
            naechster = await aehnlichenFinden(this.aktuell, this._zuletztGespielt());
            if (naechster) {
                Logger.debug(`[Musik] Autoplay in Guild ${this.guildId}: "${naechster.title}"`);
            }
        }

        if (!naechster) {
            this.aktuell = null;
            this.gestartetUm = null;
            this.gelaufenVorPause = 0;
            this.stimmen.clear();
            this._leerlaufPruefen();
            return false;
        }

        // Spotify-Titel tragen noch keine Adresse - jetzt auf YouTube suchen
        const bereit = await aufloesenZumAbspielen(naechster);
        if (!bereit) {
            Logger.warn(`[Musik] "${naechster.title}" war nicht auffindbar, wird uebersprungen`);
            return await this._weiter();
        }

        return await this._abspielen(bereit);
    }

    /**
     * Einen Titel wirklich abspielen.
     *
     * @param {Object} t Titel mit Adresse
     * @returns {Promise<boolean>}
     * @private
     */
    async _abspielen(t) {
        const Logger = ServiceManager.get('Logger');

        try {
            const filterArgumente = klangfilter.ffmpegArgumente(this.filter);
            let quelle;

            if (t.source === 'direct') {
                // Direkte Tonspur und Internetradio gehen ohne play-dl
                quelle = filterArgumente
                    ? this._mitFilter(t.url, filterArgumente)
                    : createAudioResource(t.url, { inlineVolume: true });
            } else {
                const strom = await play.stream(t.url, { quality: this.qualitaet });

                quelle = filterArgumente
                    ? this._mitFilter(strom.stream, filterArgumente)
                    : createAudioResource(strom.stream, {
                        inputType: strom.type ?? StreamType.Arbitrary,
                        inlineVolume: true
                    });
            }

            if (quelle.volume) quelle.volume.setVolume(this.lautstaerke / 100);

            this.spieler.play(quelle);
            this.aktuell = t;
            this.gestartetUm = Date.now();
            this.gelaufenVorPause = 0;
            this.pausiert = false;
            this.stimmen.clear();
            this._leerlaufAbbrechen();

            // Merken, was lief - Autoplay soll nicht dasselbe nochmal bringen
            const gemerkt = this._zuletztGespielt();
            gemerkt.push(t.url);
            if (gemerkt.length > 30) gemerkt.shift();

            // Verlauf schreiben - fehlschlagen darf das die Wiedergabe nicht
            MusicHistory.add(this.guildId, { ...t, voiceChannelId: this.sprachKanalId })
                .catch(err => Logger.warn(`[Musik] Verlauf nicht geschrieben: ${err.message}`));

            this._ansagen(t);
            return true;

        } catch (err) {
            Logger.error(`[Musik] "${t.title}" liess sich nicht abspielen:`, err.message);
            // Nicht steckenbleiben - der naechste ist dran
            return await this._weiter();
        }
    }

    /**
     * Einen Tonstrom durch ffmpeg schicken, um einen Klangfilter anzuwenden.
     *
     * ffmpeg gibt rohes s16le aus, deshalb `StreamType.Raw`.
     *
     * @param {string|Object} eingabe Adresse oder Datenstrom
     * @param {Array<string>} argumente ffmpeg-Argumente
     * @returns {Object} Tonquelle
     * @private
     */
    _mitFilter(eingabe, argumente) {
        const istAdresse = typeof eingabe === 'string';
        const wandler = new prism.FFmpeg({
            args: istAdresse ? ['-i', eingabe, ...argumente] : argumente
        });

        const strom = istAdresse ? wandler : eingabe.pipe(wandler);

        // Bricht der Ton ab, muss auch ffmpeg beendet werden - sonst bleiben
        // Vorgaenge liegen.
        strom.on('close', () => { try { wandler.destroy(); } catch { /* schon zu */ } });

        return createAudioResource(strom, { inputType: StreamType.Raw, inlineVolume: true });
    }

    /**
     * Die zuletzt gespielten Adressen - damit Autoplay sich nicht im Kreis dreht.
     *
     * @returns {Array<string>} Adressen
     * @private
     */
    _zuletztGespielt() {
        if (!this._verlauf) this._verlauf = [];
        return this._verlauf;
    }

    /**
     * Im Textkanal ansagen, was jetzt laeuft.
     *
     * @param {Object} t Titel
     * @private
     */
    _ansagen(t) {
        if (!this.textKanalId) return;

        MusicSettings.getSettings(this.guildId).then(einstellungen => {
            if (!einstellungen.announce_now_playing) return;

            const kanalId = einstellungen.announce_channel || this.textKanalId;
            const kanal = this.client.channels.cache.get(kanalId);
            if (!kanal || !kanal.isTextBased()) return;

            kanal.send({
                embeds: [{
                    color: 0x1db954,
                    author: { name: 'Jetzt laeuft' },
                    title: t.title.substring(0, 256),
                    url: t.herkunftUrl || t.url,
                    thumbnail: t.thumbnail ? { url: t.thumbnail } : undefined,
                    fields: [
                        { name: 'Quelle', value: t.source, inline: true },
                        { name: 'Dauer', value: GuildPlayer.dauerText(t.durationSec), inline: true },
                        ...(t.requestedBy ? [{ name: 'Gewuenscht von', value: `<@${t.requestedBy}>`, inline: true }] : [])
                    ]
                }]
            }).catch(() => { /* Kein Schreibrecht - dann eben ohne Ansage */ });
        }).catch(() => { /* Einstellungen nicht lesbar - Ansage entfaellt */ });
    }

    /** Anhalten. */
    pausieren() {
        if (!this.aktuell || this.pausiert) return false;
        this.spieler.pause();
        this.pausiert = true;
        this.gelaufenVorPause += Date.now() - (this.gestartetUm || Date.now());
        this.gestartetUm = null;
        return true;
    }

    /** Weiterlaufen lassen. */
    fortsetzen() {
        if (!this.aktuell || !this.pausiert) return false;
        this.spieler.unpause();
        this.pausiert = false;
        this.gestartetUm = Date.now();
        return true;
    }

    /**
     * Titel ueberspringen.
     *
     * @param {number} anzahl Wie viele
     */
    ueberspringen(anzahl = 1) {
        if (anzahl > 1) {
            this.warteschlange.splice(0, Math.min(anzahl - 1, this.warteschlange.length));
        }
        // Beim Ueberspringen darf die Einzelwiederholung nicht greifen
        const gemerkt = this.wiederholung;
        if (this.wiederholung === WIEDERHOLUNG.TITEL) this.wiederholung = WIEDERHOLUNG.AUS;

        this.spieler.stop(true);
        this.wiederholung = gemerkt;
        return true;
    }

    /** Alles anhalten und die Warteschlange leeren. */
    stoppen() {
        this.warteschlange = [];
        this.wiederholung = WIEDERHOLUNG.AUS;
        this.aktuell = null;
        this._wirdBeendet = true;
        this.spieler.stop(true);
        this._wirdBeendet = false;
        this._leerlaufPruefen();
        return true;
    }

    /**
     * Lautstaerke setzen.
     *
     * @param {number} wert 0 bis 200
     */
    lautstaerkeSetzen(wert) {
        const neu = Math.max(0, Math.min(200, Math.round(Number(wert) || 0)));
        this.lautstaerke = neu;

        const quelle = this.spieler.state?.resource;
        if (quelle?.volume) quelle.volume.setVolume(neu / 100);
        return neu;
    }

    /** Warteschlange mischen. */
    mischen() {
        for (let i = this.warteschlange.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [this.warteschlange[i], this.warteschlange[j]] = [this.warteschlange[j], this.warteschlange[i]];
        }
        return this.warteschlange.length;
    }

    /**
     * Einen Titel aus der Warteschlange nehmen.
     *
     * @param {number} position Nullbasiert
     * @returns {Object|null} Der entfernte Titel
     */
    entfernen(position) {
        if (position < 0 || position >= this.warteschlange.length) return null;
        return this.warteschlange.splice(position, 1)[0];
    }

    /**
     * Einen Titel verschieben.
     *
     * @param {number} von Nullbasiert
     * @param {number} nach Nullbasiert
     */
    verschieben(von, nach) {
        if (von < 0 || von >= this.warteschlange.length) return false;
        const ziel = Math.max(0, Math.min(this.warteschlange.length - 1, nach));
        const [t] = this.warteschlange.splice(von, 1);
        this.warteschlange.splice(ziel, 0, t);
        return true;
    }

    /** Wiederholmodus setzen. */
    wiederholungSetzen(modus) {
        if (!Object.values(WIEDERHOLUNG).includes(modus)) return false;
        this.wiederholung = modus;
        return true;
    }

    /**
     * Klangfilter setzen.
     *
     * Greift erst beim naechsten Titel - der laufende Ton kommt aus einem
     * bereits gestarteten ffmpeg, dessen Argumente feststehen.
     *
     * @param {string} name Filtername
     * @returns {boolean} Ob der Name bekannt war
     */
    filterSetzen(name) {
        if (!klangfilter.bekannt(name)) return false;
        this.filter = String(name).toLowerCase();
        return true;
    }

    /**
     * Dauerbetrieb ein- oder ausschalten.
     *
     * @param {boolean} an Zustand
     */
    dauerbetriebSetzen(an) {
        this.dauerbetrieb = Boolean(an);
        if (this.dauerbetrieb) {
            this._leerlaufAbbrechen();
        } else if (!this.aktuell && this.warteschlange.length === 0) {
            this._leerlaufPruefen();
        }
        return this.dauerbetrieb;
    }

    /**
     * Autoplay ein- oder ausschalten.
     *
     * @param {boolean} an Zustand
     */
    autoplaySetzen(an) {
        this.autoplay = Boolean(an);
        return this.autoplay;
    }

    /**
     * Eine Stimme fuers Ueberspringen abgeben.
     *
     * @param {string} mitgliedId Wer stimmt
     * @param {number} zuhoerer Wie viele Menschen im Kanal sind
     * @param {number} prozent Ab welchem Anteil uebersprungen wird
     * @returns {{gezaehlt: number, noetig: number, erreicht: boolean, schonGestimmt: boolean}}
     */
    abstimmen(mitgliedId, zuhoerer, prozent = 50) {
        const schonGestimmt = this.stimmen.has(mitgliedId);
        this.stimmen.add(mitgliedId);

        // Mindestens eine Stimme, sonst rundet 50 % von 1 auf 0
        const noetig = Math.max(1, Math.ceil((zuhoerer * prozent) / 100));
        const gezaehlt = this.stimmen.size;

        return { gezaehlt, noetig, erreicht: gezaehlt >= noetig, schonGestimmt };
    }

    /**
     * Wie weit der laufende Titel ist, in Sekunden.
     *
     * @returns {number}
     */
    positionSek() {
        if (!this.aktuell) return 0;
        const laufend = this.gestartetUm ? Date.now() - this.gestartetUm : 0;
        return Math.round((this.gelaufenVorPause + laufend) / 1000);
    }

    /**
     * Zustand fuer Dashboard und Befehle.
     *
     * @returns {Object} Zustand
     */
    zustand() {
        return {
            guildId: this.guildId,
            verbunden: Boolean(this.verbindung),
            sprachKanalId: this.sprachKanalId,
            textKanalId: this.textKanalId,
            aktuell: this.aktuell
                ? { ...this.aktuell, positionSek: this.positionSek() }
                : null,
            pausiert: this.pausiert,
            lautstaerke: this.lautstaerke,
            wiederholung: this.wiederholung,
            filter: this.filter,
            qualitaet: this.qualitaet,
            dauerbetrieb: this.dauerbetrieb,
            autoplay: this.autoplay,
            stimmen: this.stimmen.size,
            warteschlange: this.warteschlange.map((t, i) => ({ ...t, position: i })),
            warteschlangeLaenge: this.warteschlange.length,
            restspielzeitSek: this.warteschlange.reduce((s, t) => s + (t.durationSec || 0), 0)
        };
    }

    /**
     * Nach dem letzten Titel nicht ewig im Kanal stehen bleiben.
     *
     * @private
     */
    _leerlaufPruefen() {
        this._leerlaufAbbrechen();

        // Im Dauerbetrieb bleibt der Bot im Kanal, egal wie leer es wird
        if (this.dauerbetrieb) return;

        MusicSettings.getSettings(this.guildId).then(einstellungen => {
            if (!einstellungen.leave_when_empty) return;
            const sekunden = einstellungen.leave_after_seconds || 120;

            this._verlassenZeitgeber = setTimeout(() => {
                if (!this.aktuell && this.warteschlange.length === 0) {
                    ServiceManager.get('Logger').info(`[Musik] Guild ${this.guildId}: nichts mehr zu tun, verlasse den Kanal`);
                    this.aufraeumen();
                }
            }, sekunden * 1000);
        }).catch(() => { /* Ohne Einstellungen bleiben wir eben stehen */ });
    }

    /** @private */
    _leerlaufAbbrechen() {
        if (this._verlassenZeitgeber) {
            clearTimeout(this._verlassenZeitgeber);
            this._verlassenZeitgeber = null;
        }
    }

    /** Verbindung trennen und alles zuruecksetzen. */
    aufraeumen() {
        this._leerlaufAbbrechen();
        this._wirdBeendet = true;

        try { this.spieler.stop(true); } catch { /* schon gestoppt */ }
        try { this.verbindung?.destroy(); } catch { /* schon getrennt */ }

        this._wirdBeendet = false;
        this.verbindung = null;
        this.sprachKanalId = null;
        this.aktuell = null;
        this.warteschlange = [];
        this.pausiert = false;
        this.gestartetUm = null;
        this.gelaufenVorPause = 0;
    }

    /**
     * Sekunden als mm:ss oder h:mm:ss.
     *
     * @param {number|null} sek Sekunden
     * @returns {string} Lesbare Dauer
     */
    static dauerText(sek) {
        if (!sek || sek <= 0) return 'live';

        const stunden = Math.floor(sek / 3600);
        const minuten = Math.floor((sek % 3600) / 60);
        const rest = sek % 60;

        return stunden > 0
            ? `${stunden}:${String(minuten).padStart(2, '0')}:${String(rest).padStart(2, '0')}`
            : `${minuten}:${String(rest).padStart(2, '0')}`;
    }
}

GuildPlayer.WIEDERHOLUNG = WIEDERHOLUNG;

module.exports = GuildPlayer;
