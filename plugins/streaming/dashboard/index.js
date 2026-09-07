'use strict';

/**
 * Streaming - Dashboard-Plugin
 *
 * Angelegt am 2026-08-23 nach dem Muster, das bei Musik entstanden ist. Die
 * dort gesammelten Fallen sind hier von Anfang an vermieden:
 *
 *   - Rechteschluessel in Punktschreibweise, deckungsgleich mit permissions.json
 *   - `removeNavigation` vor `registerNavigation`, weil letzteres nie loescht
 *   - kein Verlass auf `onUpdate` - der Haken hat projektweit keinen Aufrufer
 *   - Lesen mit VIEW, Schreiben mit den engeren Rechten, in JEDER Route
 *   - jede Tabelle hat eine Ansicht, sonst waere sie tot
 *
 * Der Bauplan steht in docs/streamer-plugin/ - Wiedereinstieg ueber STAND.md.
 *
 * @author FireBot Team
 */

const { DashboardPlugin, VersionHelper, WebhookRegistry, VerbindungsRegistry } = require('dunebot-sdk');
const { ServiceManager } = require('dunebot-core');
const meinkanal = require('./kern/meinkanal');

class StreamingDashboardPlugin extends DashboardPlugin {
    constructor(app) {
        super({
            name: 'streaming',
            displayName: 'Streaming',
            description: 'Meldet im Discord, wenn ein beobachteter Kanal live geht',
            version: VersionHelper.getVersionFromContext(__dirname),
            author: 'FireBot Team',
            icon: 'fa-solid fa-satellite-dish',
            baseDir: __dirname,
            publicAssets: true
        });

        this.app = app;
        this.guildRouter = require('express').Router({ mergeParams: true });
    }

    /**
     * Plugin aktivieren.
     *
     * @param {Object} app Express-App
     * @param {Object} dbService Datenbank-Dienst
     * @returns {Promise<boolean>} true bei Erfolg
     */
    async onEnable(app, dbService) {
        const Logger = ServiceManager.get('Logger');
        Logger.info('Aktiviere [Streaming] Dashboard-Plugin...');

        this._setupRoutes();
        this._playerAnhaengen(app);
        this._eingangAnmelden();
        await this._zugangsdatenPruefen();
        this._takteStarten();

        // **Auch hier, nicht nur im Bot.** Der Bot braucht die Quelle fuer die
        // Ziehung; das Dashboard braucht sie, um auf der Verlosungsseite die
        // Lose aus dem Chat mitzuzaehlen. Ohne das zeigte eine Verlosung, an
        // der nur im Stream mitgemacht wird, dauerhaft "0 Teilnehmer" - und
        // der Betreiber haelt sie fuer kaputt, waehrend sie laeuft.
        require('../shared/lose').anmelden();

        Logger.success('[Streaming] Dashboard-Plugin aktiviert');
        return true;
    }

    /**
     * Den Eingang anmelden.
     *
     * Der Kern haengt einen Mount `/api/:name/webhook` ein und reicht an den
     * hier eingetragenen Handler durch - mit dem **unveraenderten** Koerper als
     * `req.rawBody`, weil die Signaturpruefung genau darauf rechnet.
     *
     * Bewusst eine Handlung und kein Feld auf der Plugin-Klasse: Ein Feld, das
     * geprueft und nirgends gemountet wird, ist genau die Falle, in der
     * `adminRouter` steckt.
     *
     * @private
     */
    _eingangAnmelden() {
        const Logger = ServiceManager.get('Logger');
        try {
            WebhookRegistry.register('streaming', require('./routes/webhook.router'));
            Logger.info('[Streaming] Eingang angemeldet: /api/streaming/webhook');

            // **Die Kontoverknuepfung.** Sie ist die Voraussetzung dafuer,
            // dass die Live-Rolle etwas BELEGTES ueber eine Person aussagt
            // statt einer Behauptung der Serverleitung zu folgen (F-16,
            // entschieden am 2026-08-26). Der Kern kennt Twitch nicht — er
            // bekommt hier zwei Funktionen und sonst nichts.
            const twitch = require('./plattformen/twitch');
            VerbindungsRegistry.register('twitch', {
                label: 'Twitch',
                symbol: 'fa-brands fa-twitch',
                farbe: '#9146FF',
                hinweis: 'Belegt, dass dir der Kanal gehört. Wir fragen dabei keine Berechtigungen ab.',
                autorisierUrl: twitch.verknuepfungsUrl,
                identitaet: twitch.verknuepfteIdentitaet,

                // **Noch keine `zusagen` — und das ist Absicht.** Eine Zusage
                // anzubieten, die keine Funktion einloest, waere genau das
                // leere Versprechen, gegen das diese Registry gebaut wurde.
                // Die erste kommt mit Stufe 12b (Abonnenten-Rollen).
                //
                // Die drei Funktionen stehen trotzdem schon hier: Sobald die
                // erste Zusage entsteht, muss die stuendliche Pflichtpruefung
                // sie erreichen koennen. Sie danach nachzureichen hiesse, das
                // Netz erst nach dem Sprung zu spannen.
                tauschen: twitch.tauschen,
                erneuern: twitch.erneuern,
                pruefen:  twitch.pruefen,

                // **Die erste Zusage (Stufe 12b).** Genau ein Scope, und er
                // wird nur vom Kanalinhaber gebraucht: Twitch gibt die
                // Abonnentenliste eines Kanals nur ihm selbst.
                //
                // Der Name steht im Link, die Scopes nie — sonst koennte ein
                // untergeschobener Link jede Berechtigung erfragen.
                zusagen: {
                    abonnenten: {
                        label: 'Abonnenten lesen',
                        hinweis: 'Nötig, damit deine Twitch-Abonnenten auf Discord automatisch eine Rolle bekommen. '
                               + 'Wir lesen nur, wer abonniert hat — nicht deinen Chat und nichts sonst.',
                        scopes: ['channel:read:subscriptions']
                    },

                    // **Getrennt, nicht gebündelt (Stufe 12c).** Wer nur
                    // Follower melden will, soll nicht seine Bits-Einnahmen
                    // freigeben müssen. Twitch führt beide einzeln, also
                    // fragen wir beide einzeln — eine Sammelzusage wäre für
                    // uns bequemer und für ihn schlechter.
                    //
                    // Raids stehen absichtlich nicht hier: Sie brauchen keine
                    // Zusage. Eine anzubieten, die nichts freischaltet, wäre
                    // das leere Versprechen, gegen das diese Registry gebaut
                    // wurde.
                    bits: {
                        label: 'Bits lesen',
                        hinweis: 'Nötig, damit Bits in deinem Kanal auf Discord gemeldet werden können. '
                               + 'Wir lesen nur, wie viele Bits geschickt wurden und von wem.',
                        scopes: ['bits:read']
                    },
                    follower: {
                        label: 'Follower lesen',
                        hinweis: 'Nötig, damit neue Follower auf Discord gemeldet werden können. '
                               + 'Wir lesen nur, wer dir folgt.',
                        scopes: ['moderator:read:followers']
                    },

                    // **Die erste Zusage, die etwas SCHREIBT** (Stufe 13c).
                    // Alle anderen lesen; diese laesst eine Zeile unter dem
                    // Namen des Streamers im Chat erscheinen. Das ist eine
                    // andere Art von Erlaubnis, und der Hinweis sagt es im
                    // ersten Satz - nicht in einer Fussnote (17.5, Punkt 1).
                    //
                    // **Warum `user:write:chat` allein genuegt:** Es sendet
                    // sein eigenes Konto in seinen eigenen Kanal. `user:bot`
                    // und `channel:bot` verlangt Twitch nur, wenn ein
                    // App-Token sendet - und das tut hier keins. Ein Scope
                    // mehr "zur Sicherheit" waere eine Berechtigung, die
                    // nichts freischaltet und trotzdem im Dialog steht.
                    //
                    // Die Vereinigung mit den schon erteilten Scopes macht
                    // der Kern (`erbeteneScopes` im Verbindungs-Router).
                    // Wuerde hier nur dieser eine erbeten, kaeme ein
                    // Schluessel zurueck, der NUR schreiben kann - und die
                    // Abonnenten-Rolle waere still tot.
                    chatschreiben: {
                        label: 'Chatbot darf unter meinem Namen schreiben',
                        hinweis: 'Der Chatbot schreibt dann in deinem Twitch-Chat — unter deinem Namen, '
                               + 'nicht unter einem Botnamen. Für die Live-Ansage beim Streamstart. '
                               + 'Du kannst sie jederzeit abschalten oder diese Erlaubnis zurücknehmen.',
                        scopes: ['user:write:chat']
                    },

                    // **Zwei Zusagen fuer P9, und beide einzeln.** Wer nur
                    // clippen lassen will, soll keine Umfragen freigeben
                    // muessen - dieselbe Regel wie bei Bits und Followern.
                    // Eine Sammelzusage waere fuer uns bequemer und fuer ihn
                    // schlechter.
                    clip: {
                        label: 'Clips schneiden',
                        hinweis: 'Nötig, damit !clip in deinem Chat einen Clip aus den letzten Sekunden '
                               + 'schneidet. Der Clip entsteht auf Twitch und gehört dir; wir behalten '
                               + 'davon nichts — nur die Adresse geht einmal in den Chat.',
                        scopes: ['clips:edit']
                    },

                    // **`channel:manage:polls` allein, nicht zusaetzlich
                    // `channel:read:polls`.** Twitch laesst das Lesen mit der
                    // Verwaltungszusage zu; die zweite waere eine Zeile mehr
                    // im Dialog, die nichts freischaltet.
                    //
                    // ⚠ Twitch erlaubt Umfragen nur Affiliates und Partnern.
                    // Das steht im Hinweis, weil die Absage sonst wie ein
                    // Fehler von uns aussieht.
                    umfragen: {
                        label: 'Umfragen starten und ansehen',
                        hinweis: 'Nötig, damit du Twitch-Umfragen aus dem Panel starten, ihren Stand sehen '
                               + 'und sie beenden kannst. Twitch erlaubt Umfragen nur Affiliates und '
                               + 'Partnern — ohne diesen Status weist Twitch sie ab, nicht wir.',
                        scopes: ['channel:manage:polls']
                    },

                    // **Die einzige Zusage, die nicht einem Menschen gehört**
                    // (Stufe 13a). Hier stimmt unser eigenes Bot-Konto zu, und
                    // zwar genau einmal — Twitch: *„only needed to be
                    // performed once and kept alive through refreshing the
                    // access token."*
                    //
                    // `nurAnlage` hält sie aus jedem Benutzerprofil heraus.
                    // Dort wäre sie ein Knopf, der das eigene Twitch-Konto
                    // zum Chatbot machen würde — und `uniq_benutzer_plattform`
                    // wiese ihn ohnehin ab.
                    //
                    // **Was hier NICHT steht:** `channel:bot`. Das erteilt der
                    // Streamer für seinen Kanal, nicht der Bot für sich — und
                    // `/mod` ist die Alternative dazu (Twitch: *„either
                    // channel:bot scope from broadcaster or moderator
                    // status"*).
                    chatbot: {
                        label: 'Chat lesen und schreiben (Bot-Konto)',
                        hinweis: 'Einmalige Zustimmung des Bot-Kontos. Ohne sie kann der Bot in '
                               + 'keinem Twitch-Chat mitlesen oder etwas sagen.',
                        // **`user:read:moderated_channels` ist der vierte, und
                        // er ist der Grund, warum die Profilseite ueberhaupt
                        // etwas Wahres sagen kann** (Stufe 13a, 2026-08-28).
                        // Damit fragt unser Bot-Konto einmal "welche Kanaele
                        // moderiere ich" und beantwortet damit fuer JEDEN
                        // Streamer die Frage "ist der Bot in meinem Chat".
                        //
                        // Die Gegenrichtung (`moderation:read` am Token des
                        // Streamers) taete dasselbe, aber jeder einzelne
                        // Streamer muesste dafuer einen Scope erteilen - fuer
                        // eine reine Anzeige. Das waere zu viel verlangt.
                        //
                        // Er steht hier VOR der ersten Zustimmung. Wird er
                        // spaeter nachgereicht, muss der Betreiber ein
                        // weiteres Mal zulassen: Twitch gibt einen Schluessel
                        // genau ueber das, wonach der Dialog gefragt hat.
                        scopes: ['user:bot', 'user:read:chat', 'user:write:chat',
                                 'user:read:moderated_channels'],
                        nurAnlage: true
                    }
                },

                // **Der Abschnitt "Mein Kanal" im Profil** (Stufe 13a,
                // 2026-08-28). Er haengt am Nachweis, nicht an einer Guild:
                // Chat-Einstellungen gehoeren dem Kanalinhaber (F-18), und
                // laegen sie hinter einem Guild-Recht, entschiede die
                // Serverleitung darueber, ob jemand den Bot in SEINEM Chat
                // regeln darf. Der Vertrag steht im Kopf der Registry, der
                // Inhalt in `kern/meinkanal.js`.
                einstellungen: {
                    titel: 'Mein Kanal',
                    hinweis: 'Gilt fuer deinen Twitch-Kanal - unabhaengig davon, '
                           + 'auf welchem Discord-Server du gerade bist.',
                    lesen: meinkanal.zeilen,

                    // **Die Heim-Guild** (Stufe 14). Sie steht hier und nicht
                    // im Guild-Menue, weil sie dem Kanalinhaber gehoert:
                    // Laege sie hinter einem Guild-Recht, koennte sich jede
                    // Serverleitung selbst zum Heim eines fremden Kanals
                    // erklaeren - und im Chat dieses Kanals reden.
                    wahl: meinkanal.wahl
                }
            });
            Logger.info('[Streaming] Kontoverknuepfung angemeldet: twitch');
        } catch (error) {
            // Ohne Eingang kommt nie eine Meldung an. Das darf nicht still
            // bleiben - aber es darf auch nicht das Dashboard mitreissen.
            Logger.error('[Streaming] Eingang konnte NICHT angemeldet werden:', error);
        }
    }

    /**
     * Kern-Takt und Ausgang starten.
     *
     * Beide laufen im Dashboard-Vorgang: Dort kommt der Webhook an, dort steht
     * die Datenbankverbindung. Der Bot bekommt nur fertige Auftraege.
     *
     * Der Eingang selbst arbeitet nichts ab - er schreibt weg und antwortet.
     * Ohne diese Takte bleibt der Posteingang also voll und es passiert nichts.
     *
     * Der Strom ist kein Takt, sondern eine Anmeldung: Er haengt den
     * hausinternen Signalweg an den `SSEManager`, damit offene Zustandsseiten
     * mitbekommen, dass sich etwas geaendert hat. Faellt er aus, bleibt alles
     * andere heil - die Seite ist dann nur wieder so alt wie vor dem
     * 2026-08-25.
     *
     * @private
     */
    _takteStarten() {
        const Logger = ServiceManager.get('Logger');
        try {
            require('./kern/takt').starten();
            require('./ausgabe/drossel').starten();
            require('./ausgabe/strom').starten();
        } catch (error) {
            Logger.error('[Streaming] Takte konnten nicht gestartet werden:', error);
        }

        // **Der zweite Eingang (Stufe 13a).** Kein Takt, sondern eine
        // Dauerverbindung — deshalb getrennt und mit eigenem Fangnetz: Ein
        // Conduit, den Twitch gerade ablehnt, darf weder die Takte oben
        // verhindern noch das Dashboard mitnehmen. Die Ankuendigungen laufen
        // ueber den Webhook und sind davon unberuehrt.
        //
        // `starten()` ist asynchron und wird bewusst NICHT abgewartet: Es holt
        // einen App-Token und legt ggf. einen Conduit an. Der Start des
        // Plugins darauf warten zu lassen hiesse, das Dashboard von Twitchs
        // Erreichbarkeit abhaengig zu machen.
        require('./eingang/conduit').starten()
            .then(ok => {
                if (!ok) Logger.warn('[Streaming] Chat-Eingang nicht verfuegbar — der Rest laeuft weiter');
            })
            .catch(error => Logger.error('[Streaming] Chat-Eingang gescheitert', error));
    }

    /**
     * Beim Start einmal deutlich sagen, ob die Plattform-Zugangsdaten da sind.
     *
     * Ohne sie laesst sich kein Abonnement anlegen - und das faellt sonst
     * erst auf, wenn jemand einen Kanal eintraegt und eine unverstaendliche
     * Fehlermeldung bekommt. Stilles Nichtstun ist der schlimmste
     * Fehlerzustand.
     *
     * @private
     */
    async _zugangsdatenPruefen() {
        const Logger = ServiceManager.get('Logger');
        try {
            const { zugangsdaten } = require('../shared/models');
            const daten = await zugangsdaten('TWITCH');

            if (daten.quelle === 'dashboard' || daten.quelle === 'env') {
                Logger.info(`[Streaming] Twitch-Zugangsdaten gefunden (Quelle: ${daten.quelle})`);
            } else if (daten.quelle === 'defekt') {
                Logger.error('[Streaming] Twitch-Secret liegt vor, laesst sich aber nicht entschluesseln - bitte im Betrieb neu setzen');
            } else {
                Logger.warn('[Streaming] Keine Twitch-Zugangsdaten hinterlegt - es koennen keine Abos angelegt werden. Einzutragen unter Streaming > Betrieb.');
            }
        } catch (error) {
            Logger.warn(`[Streaming] Zugangsdaten nicht pruefbar: ${error.message}`);
        }
    }

    /**
     * Router einhaengen.
     *
     * @private
     */
    /**
     * Den Player als Browserquelle anhaengen.
     *
     * **Ausserhalb des Guild-Bereichs und ausserhalb der Anmeldung**, weil OBS
     * keine Sitzung mitbringt. Der Schluessel in der Adresse ist der Ausweis;
     * warum das reicht und warum alles GET ist, steht in `player.router.js`.
     *
     * **Der Waechter ist kein Zierrat.** `onEnable` laeuft bei jedem Start,
     * und ein zweites `app.use` auf denselben Pfad haengt einen zweiten Router
     * daneben - beide antworten, der erste gewinnt, und welcher das ist, haengt
     * an der Reihenfolge. Genau die Doppelung, die heute schon zweimal Zeit
     * gekostet hat (5c92980, cf8c824).
     *
     * @param {Object} app Express-App
     * @private
     */
    _playerAnhaengen(app) {
        const Logger = ServiceManager.get('Logger');

        if (this._playerHaengt) return;
        if (!app || typeof app.use !== 'function') {
            // Melden statt ausweichen: Ohne die Route gibt es keinen Ton, und
            // der Streamer saehe nur eine Adresse, die 404 liefert.
            Logger.error('[Streaming] Player nicht angehaengt - keine Express-App bekommen.');
            return;
        }

        app.use('/stream/player', require('./routes/player.router'));
        this._playerHaengt = true;
        Logger.info('[Streaming] Player angehaengt: /stream/player/<schluessel>');
    }

    _setupRoutes() {
        const Logger = ServiceManager.get('Logger');

        // **Vor dem Seiten-Router.** Der faengt mit '/' alles, was danach
        // kommt - eine spaeter eingehaengte Unterseite bekaeme nie eine
        // Anfrage zu sehen.
        this.guildRouter.use('/musik', require('./routes/musik.router'));

        // Seiten-Router zuletzt: er faengt mit '/' auch die Startseite
        this.guildRouter.use('/', require('./routes/guild.router'));

        Logger.info('[Streaming] Routen registriert (2 Router)');
    }

    /**
     * @returns {Promise<boolean>} true bei Erfolg
     */
    async onDisable() {
        try {
            require('../shared/lose').abmelden();
            require('./kern/takt').anhalten();
            require('./ausgabe/drossel').anhalten();
            require('./ausgabe/strom').anhalten();
            // **Die Leitung muss ausdruecklich zu.** Ein WebSocket haelt den
            // Vorgang am Leben und baut sich nach jedem Abriss selbst wieder
            // auf - ein abgeschaltetes Plugin haette sonst eine Verbindung,
            // die niemand mehr abfragt und die trotzdem weiterlaeuft.
            require('./eingang/conduit').beenden();
        } catch { /* beim Abschalten ist ein stehengebliebener Takt das kleinere Uebel */ }

        WebhookRegistry.unregister('streaming');
        // Der Anbieter verschwindet, die Verknuepfungen bleiben. Ein
        // abgeschaltetes Plugin ist kein Widerruf — der Benutzer hat seine
        // Zugehoerigkeit belegt, und das bleibt wahr. Loesen darf nur er.
        VerbindungsRegistry.unregister('twitch');
        ServiceManager.get('Logger').info('[Streaming] Dashboard-Plugin deaktiviert, Eingang und Verknuepfung abgemeldet');
        return true;
    }

    /**
     * Plugin in einer Guild aktivieren.
     *
     * @param {string} guildId Discord-Guild-ID
     */
    async onGuildEnable(guildId) {
        await this._registerNavigation(guildId);
        ServiceManager.get('Logger').info(`[Streaming] Plugin fuer Guild ${guildId} aktiviert`);
    }

    /**
     * Plugin in einer Guild deaktivieren.
     *
     * Entfernt werden die Ziele DIESER Guild - nicht die Streamer. Die sind
     * global und gehoeren anderen Guilds mit; wer sie hier loeschte, naehme
     * fremden Servern ihre Ankuendigungen weg.
     *
     * Die verwaisten Abos raeumt der taegliche Abgleich ab (Stufe 6).
     *
     * @param {string} guildId Discord-Guild-ID
     * @returns {Promise<boolean>} true bei Erfolg
     */
    async onGuildDisable(guildId) {
        const Logger = ServiceManager.get('Logger');
        const dbService = ServiceManager.get('dbService');

        try {
            await ServiceManager.get('navigationManager').removeNavigation(this.name, guildId);

            // Reihenfolge zaehlt wegen der Fremdschluessel auf den Zielen
            const abfragen = [
                `DELETE FROM streaming_messages
                  WHERE target_id IN (SELECT id FROM streaming_targets WHERE guild_id = ?)`,
                'DELETE FROM streaming_outbox  WHERE guild_id = ?',
                'DELETE FROM streaming_targets WHERE guild_id = ?'
            ];

            for (const sql of abfragen) {
                try {
                    await dbService.query(sql, [guildId]);
                } catch (e) {
                    if (e.code !== 'ER_NO_SUCH_TABLE') throw e;
                }
            }

            Logger.success(`[Streaming] Ziele der Guild ${guildId} entfernt (Streamer bleiben - sie sind global)`);
            return true;
        } catch (error) {
            Logger.error(`[Streaming] Fehler beim Deaktivieren fuer Guild ${guildId}:`, error);
            throw error;
        }
    }

    /**
     * Navigation registrieren.
     *
     * Laeuft bei jedem Start ueber `onGuildEnable`. Das vorangestellte
     * `removeNavigation` raeumt Altbestand weg - `registerNavigation`
     * ueberspringt Vorhandenes, loescht aber nie.
     *
     * @param {string} guildId Discord-Guild-ID
     * @private
     */
    /**
     * Die Navigation dieser Guild neu aufbauen.
     *
     * **Wozu.** `_registerNavigation` laeuft sonst nur beim Start. Wer im
     * Profil seine Heim-Guild waehlt, saehe den Chatbot-Punkt also erst nach
     * einem Neustart des Dashboards - eine Wahl, die scheinbar nichts tut, ist
     * genau die Attrappe, gegen die dieses Plugin geschrieben ist.
     *
     * Nach aussen gegeben, damit `kern/heimguild` es rufen kann, ohne den
     * Umweg ueber eine private Methode.
     *
     * @param {string} guildId Discord-Guild-ID
     * @returns {Promise<void>} nichts
     */
    async navigationAuffrischen(guildId) {
        await this._registerNavigation(guildId);
    }

    /**
     * Zaehler fuer die Seitenleiste (P10).
     *
     * Der Vertrag steht in `apps/dashboard/middlewares/context/base.middleware.js`:
     * `{ '<url>': <zahl> }`, und gefragt wird nur, wer die Methode hat.
     *
     * **Nur "Kanaele" bekommt eine Zahl**, und das ist keine Sparsamkeit,
     * sondern der Bestand: Nachgesehen, welche Tabellen es gibt — es gibt
     * keine fuer Befehle. Der Entwurf zeigt dort "Meine Befehle 0"; eine 0
     * aus einer Tabelle, die es nicht gibt, waere eine erfundene Auskunft.
     * Die Zahl kommt, wenn die Befehle kommen (Stufe 15).
     *
     * @param {string} guildId Discord-Guild-ID
     * @returns {Promise<Object>} Zaehler je Menue-Adresse
     */
    async navigationZaehler(guildId) {
        const { anzahlStreamer } = require('../shared/models');
        const basis = `/guild/${guildId}/plugins/streaming`;

        // **"Meine Befehle" bekommt seine Zahl seit Stufe 15.** Vorher stand
        // hier die Begruendung, es gebe keine Tabelle dafuer und eine 0 aus
        // einer Tabelle, die es nicht gibt, waere eine erfundene Auskunft. Die
        // Tabelle gibt es jetzt — und die 0 ist die Auskunft, die der Entwurf
        // zeigt: Es gibt die Sache, sie ist nur leer.
        //
        // In einer Guild, die kein Heim eines Kanals ist, stehen dort keine
        // Zeilen. Die 0 stimmt dort also auch, ohne dass es einen Sonderfall
        // braucht.
        const zeilen = await ServiceManager.get('dbService').query(
            'SELECT COUNT(*) AS anzahl FROM streaming_commands WHERE guild_id = ? AND aktiv = 1',
            [guildId]);

        return {
            [`${basis}/streamer`]: await anzahlStreamer(guildId),
            [`${basis}/befehle`]: Number(zeilen[0]?.anzahl || 0)
        };
    }

    async _registerNavigation(guildId) {
        const Logger = ServiceManager.get('Logger');
        const navigationManager = ServiceManager.get('navigationManager');

        const basis = `/guild/${guildId}/plugins/streaming`;
        const haupt = navigationManager.menuTypes.MAIN;

        // **Die drei Abschnitte** (P2, siehe `docs/streamer-plugin/16-Panel-Neuschnitt.md`).
        //
        // Sie sind keine dritte Ebene — `partials/guild/sidebar.ejs` kann
        // weiterhin genau zwei. `abschnitt` ist ein Feld am Punkt, und die
        // Seitenleiste gruppiert beim Rendern danach (P1, `d6f6a5e`).
        //
        // Der Schnitt bildet TEIL C ab: andere Reichweite, anderes Recht,
        // anderer Adressat. "Verfolgung" gilt in beliebig vielen Guilds je
        // Kanal; "Mein Chatbot" nur in der Heim-Guild; "Anlage" nur in der
        // Kontroll-Guild.
        const VERFOLGUNG = 'streaming:NAV.ABSCHNITT_TRACKING';
        const CHATBOT    = 'streaming:NAV.ABSCHNITT_CHATBOT';
        const ANLAGE     = 'streaming:NAV.ABSCHNITT_SYSTEM';

        const eintrag = (titel, url, icon, order, extra = {}) => ({
            title: `streaming:${titel}`,
            url, icon, order,
            type: haupt,
            capability: 'STREAMING.VIEW',
            visible: true,
            guildId,
            parent: basis,
            ...extra
        });

        const navItems = [
            {
                title: 'streaming:NAV.STREAMING',
                url: basis,
                icon: 'fa-solid fa-satellite-dish',
                // **Fester Platz in der Seitenleiste** (2026-09-04).
                //
                // Hier stand `order: null`. Der NavigationManager vergab dann
                // die naechste freie 1000er-Stufe — also die, die sich aus der
                // Reihenfolge der REGISTRIERUNG ergibt, nicht aus dem Plugin.
                // Wer sich zuerst eintrug, stand oben; nach einem Neustart in
                // anderer Reihenfolge stand er woanders. Und weil die Abfrage
                // alles ab 9000 ausblendet, bekamen ab dem achten Plugin ALLE
                // die 9000 — fuenf Punkte mit demselben Wert, deren Reihenfolge
                // dann der Uebersetzungsschluessel entschied.
                //
                // Die Zahlen sind der heutige Stand, eingefroren, in
                // 500er-Schritten: unter 9000 ist Platz fuer alle zehn.
                order: 8000,
                type: haupt,
                capability: 'STREAMING.VIEW',
                visible: true,
                guildId,
                parent: null
            },
            // **Nach Aufgabe benannt, nicht nach Tabelle** (2026-08-29).
            //
            // Vorher hiessen die Punkte "Streamer / Ziele / Vorlagen" - das
            // sind unsere Tabellennamen. Wer eine Follower-Meldung einschalten
            // wollte, musste wissen, dass sie in "Ziele" steckt.
            //
            // `/ziele` ist damit keine Seite mehr, sondern eine Weiterleitung
            // auf `/ankuendigung`: Die Adresse steht in Lesezeichen und in
            // jeder Rueckmeldung, die vor heute verschickt wurde.
            //
            // **"Vorlagen" ist gefaltet** (2026-08-29). Der Text steht jetzt
            // auf der Ankuendigungsseite - der Standard der Guild als Karte
            // oben, der eigene Text je Ziel als Karte beim Ziel. `/vorlagen`
            // leitet dorthin weiter, weil die Adresse in Lesezeichen steht.
            //
            // Beim ersten Anlauf hatte ich den Punkt stehenlassen, weil die
            // Vorlage der GANZEN Guild sonst unauffindbar geworden waere. Das
            // ist geloest: Sie steht als eigene Karte oben auf der Seite.
            //
            // **Umbenannt am 2026-09-03 (P2), die Adressen bleiben.**
            //
            // "Ankuendigung" und "Meldungen" war *unser* Unterschied — die
            // eine ist `stream.online`, die andere sind Chat-Ereignisse. Fuer
            // einen Menschen ist beides "der Bot sagt was in Discord". Die
            // neuen Namen sagen, WANN es passiert, nicht aus welcher Tabelle
            // es kommt.
            //
            // **Die Adressen sind bewusst NICHT mitgewandert.** `/meldungen`
            // heisst weiter `/meldungen` und traegt die Aufschrift
            // "Ereignisse". Ein Adresswechsel braucht Weiterleitungen fuer
            // Lesezeichen und fuer jede Rueckmeldung, die vor heute
            // verschickt wurde — das ist ein eigener Schritt, kein Anhaengsel
            // an eine Umbenennung.
            // **Die Uebersicht als eigener Punkt** (2026-09-03, P2-Nachtrag).
            //
            // Sie zeigt auf dieselbe Adresse wie der Menuepunkt darueber. Bis
            // heute erzeugte die Seitenleiste dafuer selbst einen Eintrag —
            // unter dem Namen des MENUES. Im aufgeklappten Menue stand deshalb
            // "Streaming / Streaming", wo der Entwurf "Übersicht" zeigt.
            //
            // Der Punkt traegt bewusst KEINEN `abschnitt`: Er gehoert zu keiner
            // der drei Gruppen, sondern steht ueber ihnen — genauso wie im
            // Entwurf. `sidebar.ejs` laesst seinen eigenen Eintrag jetzt weg,
            // sobald ein Kind dieselbe Adresse traegt.
            eintrag('NAV.OVERVIEW', basis, 'fa-solid fa-gauge-high', 5),
            eintrag('NAV.CHANNELS', `${basis}/streamer`,     'fa-solid fa-video', 10, { abschnitt: VERFOLGUNG }),
            eintrag('NAV.ANNOUNCE', `${basis}/ankuendigung`, 'fa-solid fa-bullhorn', 20, { abschnitt: VERFOLGUNG }),
            eintrag('NAV.ALERTS',   `${basis}/meldungen`,    'fa-solid fa-bell', 30, { abschnitt: VERFOLGUNG }),
            eintrag('NAV.ROLES',    `${basis}/rollen`,       'fa-solid fa-user-tag', 40, { abschnitt: VERFOLGUNG }),
            //
            // **"Zustand" bleibt vorerst unter Verfolgung.** Der Entwurf laesst
            // ihn verschwinden — er WIRD die Uebersicht (P3). Bis die Seite
            // steht, waere ein entfernter Punkt eine Funktion, die niemand
            // mehr findet. Inhaltlich sitzt er hier richtig: Was er zeigt,
            // sind Abos und Auftraege der Verfolgung.
            eintrag('NAV.STATE',    `${basis}/zustand`,      'fa-solid fa-heart-pulse', 50, { abschnitt: VERFOLGUNG }),

            // **Kein Eintrag mehr unter den Kern-Einstellungen** (2026-09-03).
            //
            // Der Punkt dort ist fuer Plugins gedacht, die eigene
            // Einstellungen mitbringen — ein zentraler Ort fuer "ich will
            // etwas konfigurieren". Nachgesehen, wohin die anderen zeigen:
            //
            //     automod, moderation, music, greeting, ticket
            //         -> `${basis}/settings`   eine echte Einstellungsseite
            //     streaming (bis heute)
            //         -> `${basis}`            die Uebersicht
            //
            // Streaming hat keine Einstellungsseite; seine Vorgaben stehen
            // dort, wo sie wirken (Standardtext auf der Ankuendigung, die
            // Live-Rolle bei den Rollen). Der Eintrag fuehrte also nicht zu
            // Einstellungen, sondern ein zweites Mal auf den Einstieg — und
            // stand damit als Dublette in einer ohnehin langen Seitenleiste.
            //
            // Kommt einmal eine echte Einstellungsseite dazu, gehoert er
            // zurueck — dann aber mit `${basis}/settings` als Ziel.
        ];

        // **Der Chatbot-Zweig - nur in der Heim-Guild** (Stufe 14).
        //
        // Er erscheint dort, wo ein Kanalinhaber seinen Chatbot verwalten
        // laesst, und sonst nirgends. Das ist keine Bequemlichkeit, sondern
        // der Schnitt selbst: Ein Menuepunkt "Chatbot" in jeder Guild, die
        // irgendeinen Kanal verfolgt, waere die Einladung, an fremden
        // Chat-Einstellungen zu drehen (TEIL C).
        //
        // `STREAMING.CHAT.MANAGE` entscheidet dann, WER hier drankommt - das
        // bleibt Sache der Serverleitung, wie ueberall.
        try {
            if (await require('./kern/heimguild').istHeim(guildId)) {
                // **Order 60, nicht mehr 45.** Vorher stand der Chatbot
                // zwischen "Rollen" (40) und "Zustand" (50) — mit Abschnitten
                // haette das die Verfolgungsgruppe auseinandergerissen. Die
                // Seitenleiste faengt das ab (sie gruppiert, statt zu
                // vergleichen), aber die Punkte staenden dann in einer
                // Reihenfolge, die niemand gewollt hat.
                navItems.push(eintrag('NAV.CHATBOT', `${basis}/chatbot`, 'fa-solid fa-comments', 60, {
                    capability: 'STREAMING.CHAT.MANAGE',
                    abschnitt: CHATBOT
                }));

                // **Die Entwurfsseiten stehen im Menue, obwohl sie nichts
                // koennen** — und das ist der Punkt: Ein Abschnitt "Mein
                // Chatbot" mit einem einzigen Eintrag ist keine Gliederung,
                // sondern eine Ankuendigung. Erst nebeneinander laesst sich
                // beurteilen, ob der Zuschnitt taugt.
                //
                // Sie tragen kein Bedienelement und sagen im Kopf, dass sie
                // Entwurf sind. Wer sie oeffnet, weiss in zehn Sekunden, woran
                // er ist — anders als bei einer Seite voller Schalter, die
                // nichts bewirken.
                [
                    ['NAV.COMMANDS',  'befehle',    'fa-solid fa-terminal', 61],
                    ['NAV.ANNOUNCES', 'ansagen',    'fa-solid fa-clock', 62],
                    ['NAV.GUARD',     'schutz',     'fa-solid fa-shield', 63],
                    ['NAV.JOIN_IN',   'mitmachen',  'fa-solid fa-hand-sparkles', 64],
                    ['NAV.STATS',     'statistik',  'fa-solid fa-chart-line', 65],
                    // Musikwunsch (2026-09-07). Steht im Chatbot-Abschnitt,
                    // weil er an der Heim-Guild haengt wie die Befehle - und
                    // weil die Seite die OBS-Adresse traegt, ohne die der
                    // Player unerreichbar ist.
                    ['NAV.MUSIC',     'musik',      'fa-solid fa-music', 66]
                ].forEach(([titel, pfad, icon, order]) => {
                    navItems.push(eintrag(titel, `${basis}/${pfad}`, icon, order, {
                        capability: 'STREAMING.CHAT.MANAGE',
                        abschnitt: CHATBOT
                    }));
                });
            }
        } catch (error) {
            // **Kein Menuepunkt ist besser als ein falscher.** Wer die Frage
            // nicht beantworten kann, soll nicht raten - ein Chatbot-Eintrag
            // in einer fremden Guild waere schlimmer als ein fehlender in der
            // eigenen. Gemeldet wird es trotzdem.
            Logger.warn(`[Streaming] Heim-Guild-Frage fuer ${guildId} nicht beantwortbar: ${error.message}`);
        }

        // Betriebsseite: nur in der Kontroll-Guild, und dort nur fuer den
        // Serverbesitzer.
        //
        // `requiresOwner` allein reicht dafuer NICHT - nachgesehen in
        // `NavigationManager.js:545-556`: Es prueft `is_owner`, und das kommt
        // aus `PermissionManager.js:162` als `guild.owner_id === userId`. Das
        // ist der **Guild**-Besitzer, nicht der Betreiber der Anlage. Ohne die
        // Einschraenkung auf CONTROL_GUILD_ID saehe jeder Serverbesitzer einen
        // Menuepunkt "Betrieb" - und dahinter stehen die Zugangsdaten der
        // ganzen Anlage. Die Route selbst haengt zusaetzlich an CheckAdmin
        // (SYSTEM.ACCESS); ein sichtbarer Punkt, der 403 liefert, waere
        // trotzdem eine falsche Einladung.
        if (String(guildId) === String(process.env.CONTROL_GUILD_ID || '')) {
            navItems.push(
                eintrag('NAV.OPERATIONS', `${basis}/betrieb`, 'fa-solid fa-sliders', 70, {
                    capability: null,
                    requiresOwner: true,
                    abschnitt: ANLAGE
                })
            );
        }

        try {
            await navigationManager.removeNavigation(this.name, guildId);
            await navigationManager.registerNavigation(this.name, guildId, navItems);
            Logger.debug(`[Streaming] Navigation registriert (${navItems.length} Eintraege)`);
        } catch (error) {
            Logger.error('[Streaming] Fehler beim Registrieren der Navigation:', error);
        }
    }
}

module.exports = StreamingDashboardPlugin;
