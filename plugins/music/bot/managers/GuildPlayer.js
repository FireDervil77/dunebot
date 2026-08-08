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

const prism = require('prism-media');
const { ServiceManager } = require('dunebot-core');
const { MusicSettings, MusicHistory } = require('../../shared/models');
const { aufloesenZumAbspielen, aehnlichenFinden } = require('../quellen');
const { tonstromVonSeite, tonstromVonAdresse } = require('../quellen/strom');
const klangfilter = require('../klangfilter');
const steuerung = require('../steuerung');
const { dauerText } = require('../format');

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

        /** Die stehende "Jetzt laeuft"-Nachricht mit der Mediensteuerung. */
        this._ansageNachricht = null;

        this.spieler = createAudioPlayer({
            behaviors: {
                // Ohne Zuhoerer weiterlaufen zu lassen kostet nur Bandbreite
                noSubscriber: NoSubscriberBehavior.Pause,

                // Der Vorgabewert ist 5, also gibt @discordjs/voice schon nach
                // 100 ms ohne Nachschub auf und erklaert den Titel fuer
                // beendet. Fuer Ton aus dem Netz ist das viel zu streng: ein
                // kurzer Schluckauf der Leitung beendete so das ganze Stueck.
                // 250 Rahmen sind fuenf Sekunden Nachsicht - lang genug fuer
                // eine Delle, kurz genug, dass eine wirklich tote Quelle nicht
                // ewig blockiert.
                maxMissedFrames: 250
            }
        });

        this._hakenSetzen();
    }

    /**
     * Ob eine Sprachverbindung steht.
     *
     * Muss ein Zugriff sein, kein Feld: `zustand()` gab `verbunden` zurueck,
     * der Abspieler selbst hatte es aber nie. `abspieler.verbunden` war
     * damit immer `undefined` - und weil `utils.pruefen` genau darauf prueft,
     * brachen **zwoelf der sechzehn Unterbefehle** sofort mit "Es laeuft
     * gerade nichts" ab, ohne je etwas zu tun. Auch die Pruefung auf den
     * falschen Sprachkanal lief deshalb ins Leere.
     *
     * @returns {boolean}
     */
    get verbunden() {
        return Boolean(this.verbindung);
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
            Logger.error(`[Musik] Abspielfehler in Guild ${this.guildId}:`, err);
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
            // Der Bot bleibt im Kanal und wartet auf den naechsten Wunsch.
            // Gegangen wird nur, wenn niemand mehr da ist - das entscheidet
            // `_verwaisungPruefen`, angestossen vom Sprachereignis.
            Logger.debug(`[Musik] Guild ${this.guildId}: Warteschlange leer, warte im Kanal`);
            this.ansageAuffrischen();
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
            // Direkte Tonspur und Internetradio zeigen schon auf die Bytes
            // selbst. Alles andere ist eine Seitenadresse - da laedt yt-dlp,
            // weil ein schlichter Abruf von Google gedrosselt wird.
            const eingang = t.source === 'direct'
                ? tonstromVonAdresse(t.url)
                : tonstromVonSeite(t.url, this.qualitaet);

            const quelle = this._tonquelle(eingang, klangfilter.ffmpegArgumente(this.filter));

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

            this._ansagen();
            return true;

        } catch (err) {
            Logger.error(`[Musik] "${t.title}" (${t.source}, ${t.url}) liess sich nicht abspielen:`, err);
            // Nicht steckenbleiben - der naechste ist dran
            return await this._weiter();
        }
    }

    /**
     * Einen Datenstrom durch ffmpeg in einen abspielbaren Tonstrom verwandeln.
     *
     * Es geht immer durch ffmpeg, auch ohne Klangfilter: die Lautstaerke-
     * regelung von @discordjs/voice arbeitet auf rohem PCM, also muesste
     * ohnehin entpackt werden. Ein zweiter Weg daran vorbei braechte nichts
     * ausser einer zweiten Stelle, an der etwas kaputtgehen kann.
     *
     * ffmpeg bekommt die Bytes ueber die Standardeingabe, niemals eine
     * Adresse - warum, steht ausfuehrlich in `quellen/strom.js`. Kurz: das
     * mitgelieferte statische ffmpeg stuerzt bei jeder Namensaufloesung ab.
     *
     * ffmpeg gibt rohes s16le aus, deshalb `StreamType.Raw`.
     *
     * @param {Object} eingang Datenstrom mit den Tonbytes
     * @param {Array<string>} argumente ffmpeg-Ausgabeargumente
     * @returns {Object} Tonquelle
     * @private
     */
    _tonquelle(eingang, argumente) {
        const wandler = new prism.FFmpeg({ args: argumente });
        const strom = eingang.pipe(wandler);

        // Bricht der Ton ab, muessen auch ffmpeg und die Leitung zu - sonst
        // bleiben Vorgaenge und offene Verbindungen liegen.
        strom.on('close', () => {
            try { wandler.destroy(); } catch { /* schon zu */ }
            try { eingang.destroy(); } catch { /* schon zu */ }
        });

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
     * Im Textkanal ansagen, was jetzt laeuft - mit Mediensteuerung.
     *
     * Die vorige Ansage verliert dabei ihre Knoepfe. Sonst haengen im Kanal
     * lauter alte Steuerungen herum, und ein Druck auf die von vorgestern
     * wuerde den heutigen Titel ueberspringen.
     *
     * @private
     */
    _ansagen() {
        if (!this.textKanalId) return;

        MusicSettings.getSettings(this.guildId).then(einstellungen => {
            if (!einstellungen.announce_now_playing) return;

            const kanalId = einstellungen.announce_channel || this.textKanalId;
            const kanal = this.client.channels.cache.get(kanalId);
            if (!kanal || !kanal.isTextBased()) return;

            // Der alten Ansage die Knoepfe nehmen
            const alte = this._ansageNachricht;
            this._ansageNachricht = null;
            if (alte) {
                alte.edit({ components: [] }).catch(() => { /* schon geloescht */ });
            }

            kanal.send(steuerung.nachricht(this.zustand()))
                .then(gesendet => { this._ansageNachricht = gesendet; })
                .catch(() => { /* Kein Schreibrecht - dann eben ohne Ansage */ });
        }).catch(() => { /* Einstellungen nicht lesbar - Ansage entfaellt */ });
    }

    /**
     * Die stehende Ansage auf den neuesten Stand bringen.
     *
     * Fuer Aenderungen, die keinen neuen Titel bedeuten - angehalten,
     * Lautstaerke, Wiederholung. Schlaegt still fehl, wenn die Nachricht
     * inzwischen weg ist.
     */
    ansageAuffrischen() {
        if (!this._ansageNachricht) return;
        this._ansageNachricht
            .edit(steuerung.nachricht(this.zustand()))
            .catch(() => { this._ansageNachricht = null; });
    }

    /** Anhalten. */
    pausieren() {
        if (!this.aktuell || this.pausiert) return false;
        this.spieler.pause();
        this.pausiert = true;
        this.gelaufenVorPause += Date.now() - (this.gestartetUm || Date.now());
        this.gestartetUm = null;
        this.ansageAuffrischen();
        return true;
    }

    /** Weiterlaufen lassen. */
    fortsetzen() {
        if (!this.aktuell || !this.pausiert) return false;
        this.spieler.unpause();
        this.pausiert = false;
        this.gestartetUm = Date.now();
        this.ansageAuffrischen();
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

    /**
     * Alles anhalten und die Warteschlange leeren.
     *
     * Der Bot bleibt danach im Kanal - "Stopp" heisst anhalten, nicht
     * weggehen. Zum Weggehen gibt es `/music disconnect`.
     */
    stoppen() {
        this.warteschlange = [];
        this.wiederholung = WIEDERHOLUNG.AUS;
        this.aktuell = null;
        this._wirdBeendet = true;
        this.spieler.stop(true);
        this._wirdBeendet = false;
        this.ansageAuffrischen();
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
        this.ansageAuffrischen();
        return neu;
    }

    /** Warteschlange mischen. */
    mischen() {
        for (let i = this.warteschlange.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [this.warteschlange[i], this.warteschlange[j]] = [this.warteschlange[j], this.warteschlange[i]];
        }
        this.ansageAuffrischen();
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
        this.ansageAuffrischen();
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
        this.ansageAuffrischen();
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
        } else {
            // Ohne Dauerbetrieb gilt wieder: ohne Menschen kein Bot
            this._verwaisungPruefen();
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
            verbunden: this.verbunden,
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
     * Wie viele Menschen im Sprachkanal sind.
     *
     * @returns {number} Anzahl ohne Bots; 0 auch, wenn der Kanal weg ist
     * @private
     */
    _menschenImKanal() {
        if (!this.sprachKanalId) return 0;
        const kanal = this.client.channels.cache.get(this.sprachKanalId);
        if (!kanal || !kanal.members) return 0;
        return kanal.members.filter(m => !m.user.bot).size;
    }

    /**
     * Den Rueckzug einleiten, wenn niemand mehr im Kanal ist.
     *
     * **Eine leere Warteschlange ist ausdruecklich kein Grund zu gehen.** Der
     * Bot soll im Kanal stehen bleiben und darauf warten, dass jemand etwas
     * moechte - genau dafuer ist er da.
     *
     * Vorher hing `leave_when_empty` an der leeren Warteschlange, obwohl die
     * Beschriftung "Kanal verlassen, wenn niemand mehr da ist" lautet. Der Bot
     * verschwand deshalb Sekunden nach dem letzten Titel, auch wenn der halbe
     * Server noch im Kanal sass.
     *
     * Die Frist wird zurueckgenommen, sobald wieder jemand hereinkommt.
     *
     * @private
     */
    _verwaisungPruefen() {
        this._leerlaufAbbrechen();

        // Im Dauerbetrieb bleibt der Bot im Kanal, egal wie leer es wird
        if (this.dauerbetrieb) return;
        if (!this.verbindung) return;
        // Noch jemand da - dann gibt es nichts zu tun
        if (this._menschenImKanal() > 0) return;

        MusicSettings.getSettings(this.guildId).then(einstellungen => {
            if (!einstellungen.leave_when_empty) return;
            const sekunden = einstellungen.leave_after_seconds || 120;

            this._verlassenZeitgeber = setTimeout(() => {
                // In der Zwischenzeit koennte jemand zurueckgekommen sein
                if (this._menschenImKanal() > 0) return;

                ServiceManager.get('Logger').info(
                    `[Musik] Guild ${this.guildId}: seit ${sekunden}s niemand mehr im Kanal, verlasse ihn`
                );
                this.aufraeumen();
            }, sekunden * 1000);
        }).catch(() => { /* Ohne Einstellungen bleiben wir eben stehen */ });
    }

    /**
     * Von aussen anstossbar - das Sprachereignis meldet Kommen und Gehen.
     *
     * @param {boolean} [jemandKam=false] Ob gerade jemand hereinkam
     */
    kanalbelegungGeaendert(jemandKam = false) {
        if (jemandKam) {
            // Wieder jemand da: der Rueckzug ist abgeblasen
            this._leerlaufAbbrechen();
            return;
        }
        this._verwaisungPruefen();
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

        // Die Knoepfe der stehenden Ansage steuerten sonst ins Leere
        const ansage = this._ansageNachricht;
        this._ansageNachricht = null;
        if (ansage) ansage.edit({ components: [] }).catch(() => { /* schon weg */ });

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
     * Liegt inzwischen in `format.js`; hier bleibt der Zugang stehen, weil
     * `utils.js` und die Unterbefehle ihn ueber den Abspieler aufrufen.
     *
     * @param {number|null} sek Sekunden
     * @returns {string} Lesbare Dauer
     */
    static dauerText(sek) {
        return dauerText(sek);
    }
}

GuildPlayer.WIEDERHOLUNG = WIEDERHOLUNG;

module.exports = GuildPlayer;
