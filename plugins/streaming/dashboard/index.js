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
        this._eingangAnmelden();
        await this._zugangsdatenPruefen();
        this._takteStarten();

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
    _setupRoutes() {
        const Logger = ServiceManager.get('Logger');

        // Seiten-Router zuletzt: er faengt mit '/' auch die Startseite
        this.guildRouter.use('/', require('./routes/guild.router'));

        Logger.info('[Streaming] Routen registriert (1 Router)');
    }

    /**
     * @returns {Promise<boolean>} true bei Erfolg
     */
    async onDisable() {
        try {
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

    async _registerNavigation(guildId) {
        const Logger = ServiceManager.get('Logger');
        const navigationManager = ServiceManager.get('navigationManager');

        const basis = `/guild/${guildId}/plugins/streaming`;
        const haupt = navigationManager.menuTypes.MAIN;

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
                order: null,
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
            // **"Vorlagen" bleibt vorerst ein eigener Punkt.** Der Entwurf sah
            // vor, ihn in die Ankuendigung zu falten - dort haengt der Text ja
            // hin. Nur liegt auf der Seite auch die Vorlage der GANZEN Guild,
            // und die waere danach nur noch ueber einen Ziel-Verweis
            // erreichbar. Etwas unauffindbar zu machen ist keine Ordnung.
            // Er rueckt deshalb neben die Ankuendigung, bis das Falten
            // wirklich gebaut ist.
            eintrag('NAV.CHANNELS', `${basis}/streamer`,     'fa-solid fa-video', 10),
            eintrag('NAV.ANNOUNCE', `${basis}/ankuendigung`, 'fa-solid fa-bullhorn', 20),
            eintrag('NAV.TEMPLATES', `${basis}/vorlagen`,    'fa-solid fa-comment-dots', 25),
            eintrag('NAV.ALERTS',   `${basis}/meldungen`,    'fa-solid fa-bell', 30),
            eintrag('NAV.ROLES',    `${basis}/rollen`,       'fa-solid fa-user-tag', 40),
            eintrag('NAV.STATE',    `${basis}/zustand`,      'fa-solid fa-heart-pulse', 50),

            // Einstiegspunkt unter den Kern-Einstellungen
            {
                title: 'streaming:NAV.STREAMING',
                url: basis,
                icon: 'fa-solid fa-satellite-dish',
                order: null,
                type: haupt,
                capability: 'STREAMING.VIEW',
                visible: true,
                guildId,
                parent: `/guild/${guildId}/settings`
            }
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
                navItems.push(eintrag('NAV.CHATBOT', `${basis}/chatbot`, 'fa-solid fa-comments', 45, {
                    capability: 'STREAMING.CHAT.MANAGE'
                }));
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
                eintrag('NAV.OPERATIONS', `${basis}/betrieb`, 'fa-solid fa-sliders', 60, {
                    capability: null,
                    requiresOwner: true
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
