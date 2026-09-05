'use strict';

/**
 * Streaming - Seitenrouten
 *
 *   /            -> Weiterleitung auf /streamer
 *   /streamer    Beobachtete Kanaele
 *   /ziele       Wohin die Ankuendigung geht
 *   /vorlagen    Der Text darueber
 *   /zustand     Was laeuft, was klemmt
 *   /betrieb     Abos, Kontingent, Zugangsdaten (nur Betreiber)
 *
 * **Rechte:** Lesen verlangt `STREAMING.VIEW`, Schreiben jeweils das engere
 * Recht - und zwar **in der Route**. Dass die Ansicht einen Knopf ausblendet,
 * ist Hoeflichkeit, keine Sperre; `scripts/check-streaming-rechte.js` prueft
 * deshalb jede schreibende Route einzeln.
 *
 * Ob jemand aendern darf, entscheidet in den Ansichten der vorhandene
 * Theme-Helfer `hasPermission('KEY')` (siehe `ThemeRenderer`) - kein eigener
 * Nachbau im Router.
 *
 * @module streaming/dashboard/routes/guild
 */

const express = require('express');
const router = express.Router();
const { ServiceManager } = require('dunebot-core');
const { requirePermission } = require('../../../../apps/dashboard/middlewares/permissions.middleware');
const { CheckAdmin } = require('../../../../apps/dashboard/middlewares/admin.middleware');
const {
    makeTranslator, renderView, renderFehler,
    getZielkanaele, getSprachkanaele, getRollen, getMitglieder, vorWieLange
} = require('./_shared');
const modelle = require('../../shared/models');
const abos = require('../kern/abos');
const melder = require('../kern/melder');
const {
    PLATZHALTER, PLATZHALTER_CHAT, pruefeVorlage, pruefeChatVorlage,
    VORGABE_LIVE, VORGABE_RUECKSCHAU, VORGABE_CHAT, CHAT_MAX
} = require('../../shared/vorlagen');

/**
 * Was eine abgelehnte Chat-Vorlage dem Benutzer sagt.
 *
 * **Der Text steht hier und nicht in der Ansicht**, weil die Ablehnung hier
 * entsteht. `pruefeChatVorlage` gibt eine Kennung zurueck, kein Deutsch - so
 * kann das Pruefskript dieselbe Regel ohne Ansicht durchspielen.
 */
const CHAT_FEHLER = {
    zu_lang:     `Der Text ist zu lang — Twitch nimmt höchstens ${CHAT_MAX} Zeichen.`,
    platzhalter: 'Darin steht ein Platzhalter, den es nicht gibt. Er würde wörtlich im Chat stehen.',
    nur_discord: '{rolle} und {dauer} gibt es nur in der Discord-Ankündigung — '
               + 'eine Discord-Erwähnung im Twitch-Chat wäre nur eine Zeichenkette.'
};
const { antworte, antworteFehler } = require('dunebot-sdk').FormAntwort;

/**
 * Auswaehlbare Zeitzonen.
 *
 * Bewusst eine kurze Liste statt eines Freitextfelds: Ein vertippter
 * Zonenname faellt sonst nirgends auf - `Intl` wirft, wir weichen auf die
 * Serverzeit aus, und die Ruhezeit gilt still zur falschen Stunde.
 */
const ZEITZONEN = [
    'Europe/Berlin', 'Europe/Vienna', 'Europe/Zurich', 'Europe/London',
    'Europe/Lisbon', 'Europe/Helsinki', 'Europe/Moscow', 'UTC',
    'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
    'America/Sao_Paulo', 'Asia/Tokyo', 'Asia/Seoul', 'Asia/Singapore',
    'Australia/Sydney', 'Pacific/Auckland'
];

/**
 * Eine Uhrzeit aus dem Formular pruefen.
 *
 * Leer heisst "keine Ruhezeit", nicht "Mitternacht". Ein `<input type="time">`
 * liefert "HH:MM"; alles andere wird abgelehnt, statt als 00:00 zu gelten.
 *
 * @param {*} wert Eingabe
 * @returns {string|null} "HH:MM:00" oder null
 */
function uhrzeit(wert) {
    const t = String(wert || '').trim();
    if (!t) return null;
    const m = t.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
    return m ? `${m[1]}:${m[2]}:00` : null;
}

// =====================================================
// Einstieg — die Uebersicht (P3)
// =====================================================
//
// **Bis zum 2026-09-03 stand hier eine Weiterleitung auf `/streamer`.** Das
// Plugin hatte damit als einziges neben `discord` keinen Einstiegspunkt: Wer
// "Streaming" anklickte, landete in einer Liste eingetragener Kanaele und
// musste sich den Rest selbst zusammensuchen. Sieben andere Plugins haben
// eine Uebersicht als ersten Punkt.
//
// **Die Seite holt sich dieselben Zahlen wie `/zustand`** — `zustandsBild()`
// steht da, samt der gerechneten Ampel und der Problemliste. Es waere die
// zweite Stelle geworden, an der dieselbe Frage anders beantwortet wird.
//
// ⚠ **Ohne Strom, mit Absicht.** `/zustand` haelt sich per SSE offen; diese
// Seite ist eine Momentaufnahme beim Aufruf. Beides zu koennen hiesse, den
// Strom zweimal zu bedienen. Wenn die Uebersicht den Zustand spaeter ganz
// aufnimmt, wandert er mit — dann an genau einer Stelle.
router.get('/', requirePermission('STREAMING.VIEW'), async (req, res) => {
    const guildId = res.locals.guildId;
    const tr = makeTranslator(req, res);

    try {
        const [bild, ziele] = await Promise.all([
            zustandsBild(guildId, tr),
            modelle.zieleDerGuild(guildId)
        ]);

        // **Die Zusage wird nur dort geprueft, wo sie zaehlt.** Ein Kanal, der
        // hier bloss verfolgt wird, hat mit dem Schreiben nichts zu tun — und
        // eine Warnung ueber fremde Zusagen in einer fremden Guild waere
        // genau der Griff nach fremden Chat-Einstellungen, den TEIL C
        // ausschliesst.
        let chatWarnung = null;
        try {
            const heimguild = require('../kern/heimguild');
            if (await heimguild.istHeim(guildId)) {
                const abonnenten = require('../kern/abonnenten');
                const meinkanal = require('../kern/meinkanal');
                const kanaele = await heimguild.kanaeleDerGuild(guildId);

                for (const k of kanaele) {
                    if (!k.chat_ansage_an) continue;
                    const inhaber = await abonnenten.kanalInhaber(k);
                    const darf = await meinkanal.darfSchreiben(inhaber);
                    if (!darf) {
                        chatWarnung = {
                            kanal: k.anzeigename || k.login,
                            zusage: meinkanal.SCHREIB_ZUSAGE
                        };
                        break;
                    }
                }
            }
        } catch (error) {
            // **Kein Abbruch der Seite.** Die Uebersicht ist der Einstieg; sie
            // muss auch dann etwas zeigen, wenn eine einzelne Auskunft nicht
            // zu bekommen ist. Gemeldet wird es trotzdem.
            ServiceManager.get('Logger').warn(
                `[Streaming] Schreibzusage fuer ${guildId} nicht pruefbar: ${error.message}`);
        }

        await renderView(res, 'guild/streaming-uebersicht', {
            tr, guildId,
            zustand: bild.zustand,
            streamer: bild.streamer,
            ampel: bild.ampel,
            ampelText: bild.ampelText,
            probleme: bild.probleme,
            zieleAnzahl: (ziele || []).length,
            chatWarnung,
            vorWieLange
        });
    } catch (error) {
        return renderFehler(res, error, 'Die Uebersicht konnte nicht geladen werden');
    }
});

// =====================================================
// Die Seiten, die es noch nicht gibt (P3, Entwuerfe)
// =====================================================
//
// **Warum sie ueberhaupt erreichbar sind.** Der Schnitt aus dem Panel-Entwurf
// steht nur, wenn man ihn sieht: "Mein Chatbot" mit einem einzigen Punkt ist
// keine Gliederung, sondern eine Ankuendigung. Erst mit Befehlen, Schutz,
// Mitmachen und Statistik daneben laesst sich beurteilen, ob der Zuschnitt
// taugt.
//
// **Sie tragen kein einziges Bedienelement.** Kein Schalter, kein Feld, kein
// Speichern. Ein Formular, das nicht speichert, ist eine Attrappe — und die
// sieht fertig aus, versagt beim ersten Einsatz lautlos, und niemand weiss
// hinterher, ob es je funktioniert hat.
//
// **Nur in der Heim-Guild**, wie der Chatbot-Zweig selbst: Ein Entwurf fuer
// fremde Chat-Einstellungen in einer fremden Guild waere derselbe Griff, den
// TEIL C ausschliesst — nur ohne Wirkung, was ihn nicht besser macht.
//
// **Das Recht steht hier als Literal, nicht in `entwuerfe.js`.** Der erste Bau
// las es aus der Datentabelle — `requirePermission(daten.recht)` —, und
// `scripts/check-streaming-rechte.js` hat das sofort als "ohne Rechtepruefung"
// gemeldet. Zu Recht: Ein Recht, das aus Daten kommt, ist nicht mehr am Router
// ablesbar. Schriebe dort jemand `STREAMING.VIEW`, staende die Chatbot-Seite
// jeder Guild offen, ohne dass es hier auffiele.
//
// Alle fuenf Entwurfsseiten gehoeren dem Kanalinhaber, also tragen alle
// dasselbe Recht.
require('../entwuerfe').namen()
    // **Gebaute Seiten haben eigene Routen — der Entwurf wird uebersprungen.**
    // Die Liste steht nicht hier, sondern am Eintrag selbst (`gebaut`): Ein
    // Name mehr in einem `!==`-Vergleich waere die zweite Stelle, an der
    // dasselbe entschieden wird, und die zweite vergisst man.
    .filter(name => !require('../entwuerfe').seite(name).gebaut)
    .forEach((name) => {
    const daten = require('../entwuerfe').seite(name);

    router.get(`/${name}`, requirePermission('STREAMING.CHAT.MANAGE'), async (req, res) => {
        const guildId = res.locals.guildId;
        const tr = makeTranslator(req, res);

        try {
            if (daten.nurHeim && !await require('../kern/heimguild').istHeim(guildId)) {
                return res.redirect(`/guild/${guildId}/plugins/streaming`);
            }

            // `PLUGIN:name` zeigt auf ein anderes Plugin derselben Guild. Der
            // Verweis wird hier aufgeloest und nicht in der Ansicht: Die
            // Guild-Kennung gehoert nicht in eine Datentabelle, die keine
            // Anfrage kennt.
            const seite = {
                ...daten,
                verweise: (daten.verweise || []).map(v => ({
                    text: v.text,
                    url: v.url.startsWith('PLUGIN:')
                        ? `/guild/${guildId}/plugins/${v.url.slice(7)}`
                        : v.url
                }))
            };

            await renderView(res, 'guild/streaming-entwurf', { tr, guildId, seite });
        } catch (error) {
            return renderFehler(res, error, 'Die Seite konnte nicht geladen werden');
        }
    });
});

// =====================================================
// Beobachtete Kanaele
// =====================================================
router.get('/streamer', requirePermission('STREAMING.VIEW'), async (req, res) => {
    const guildId = res.locals.guildId;
    const tr = makeTranslator(req, res);

    try {
        const [streamer, anzahl] = await Promise.all([
            modelle.streamerDerGuild(guildId),
            modelle.anzahlStreamer(guildId)
        ]);

        const grenze = Number(require('../../config.json').STREAMER_JE_GUILD || 25);
        const [zielkanaele, rollen] = await Promise.all([getZielkanaele(guildId), getRollen(guildId)]);

        await renderView(res, 'guild/streaming-streamer', {
            tr, guildId, streamer, anzahl, grenze, vorWieLange,
            zielkanaele, rollen,
            meldung: req.query.ok || null,
            fehler: req.query.fehler || null
        });
    } catch (error) {
        return renderFehler(res, error, 'Die Streamer-Liste konnte nicht geladen werden');
    }
});

// =====================================================
// Kanal eintragen
// =====================================================
router.post('/streamer', requirePermission('STREAMING.STREAMERS.MANAGE'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const guildId = res.locals.guildId;
    const zurueck = `/guild/${guildId}/plugins/streaming/streamer`;

    try {
        const eingabe = String(req.body.kanal || '').trim();
        const channelId = String(req.body.channel_id || '').trim();
        const rolleId = String(req.body.rolle_id || '').trim() || null;
        const veroeffentlichen = req.body.veroeffentlichen ? 1 : 0;

        if (!eingabe)   return res.redirect(`${zurueck}?fehler=kanal_fehlt`);
        if (!channelId) return res.redirect(`${zurueck}?fehler=ziel_fehlt`);

        // Mengengrenze: zaehlt EIGENE beobachtete Kanaele, nicht Abos. Ein
        // Kanal, den zehn andere Guilds schon beobachten, kostet nichts extra.
        const grenze = Number(require('../../config.json').STREAMER_JE_GUILD || 25);
        if (await modelle.anzahlStreamer(guildId) >= grenze) {
            return res.redirect(`${zurueck}?fehler=grenze`);
        }

        // Auf der Plattform nachsehen. Ein eingetippter Name ist eine
        // Behauptung — hier wird sie geprueft, mehr nicht: Niemand meldet sich
        // an, der Streamer erfaehrt nichts davon.
        const kanal = await abos.ADAPTER.twitch.aufloesen(eingabe);
        if (!kanal) return res.redirect(`${zurueck}?fehler=unbekannt`);

        const streamer = await abos.streamerSichern('twitch', kanal);
        const schonBeobachtet = await abos.nutzerZaehlen(streamer.id) > 0;

        const ergebnisse = await abos.abosSichern(streamer.id, 'twitch', kanal.kanal_id);
        const gescheitert = ergebnisse.filter(e => e.ok === false);

        // Ziel dieser Guild anlegen (oder wiederbeleben)
        await ServiceManager.get('dbService').query(
            `INSERT INTO streaming_targets (guild_id, streamer_id, channel_id, rolle_id, veroeffentlichen, angelegt_von)
             VALUES (?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE rolle_id = VALUES(rolle_id),
                                     veroeffentlichen = VALUES(veroeffentlichen), aktiv = 1`,
            [guildId, streamer.id, channelId, rolleId, veroeffentlichen,
             req.session?.user?.info?.id || null]);

        if (gescheitert.length) {
            Logger.warn(`[Streaming] ${kanal.login} eingetragen, aber ${gescheitert.length} Abo(s) scheiterten`);
            return res.redirect(`${zurueck}?fehler=abo`);
        }

        Logger.success(`[Streaming] ${kanal.login} fuer Guild ${guildId} eingetragen`);
        return res.redirect(`${zurueck}?ok=${schonBeobachtet ? 'geteilt' : 'neu'}`);
    } catch (error) {
        Logger.error('[Streaming] Eintragen fehlgeschlagen:', error);
        return res.redirect(`${zurueck}?fehler=technisch`);
    }
});

// =====================================================
// Kanal entfernen
// =====================================================
router.post('/streamer/:id/entfernen', requirePermission('STREAMING.STREAMERS.MANAGE'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const guildId = res.locals.guildId;
    const zurueck = `/guild/${guildId}/plugins/streaming/streamer`;

    try {
        const streamerId = Number(req.params.id);
        if (!Number.isInteger(streamerId)) return res.redirect(`${zurueck}?fehler=technisch`);

        // Nur die Ziele DIESER Guild. Der Streamer bleibt - er gehoert
        // anderen Guilds mit.
        await ServiceManager.get('dbService').query(
            'DELETE FROM streaming_targets WHERE guild_id = ? AND streamer_id = ?', [guildId, streamerId]);

        // Beobachtet ihn danach niemand mehr, muss das Abo weg: sonst laeuft
        // das gemeinsame Kontingent langsam voll.
        const ergebnis = await abos.abosAufraeumen(streamerId);

        Logger.info(`[Streaming] Streamer ${streamerId} aus Guild ${guildId} entfernt` +
            (ergebnis.behalten ? ' (Abo bleibt, andere Guilds beobachten weiter)' : ''));
        return res.redirect(`${zurueck}?ok=entfernt`);
    } catch (error) {
        Logger.error('[Streaming] Entfernen fehlgeschlagen:', error);
        return res.redirect(`${zurueck}?fehler=technisch`);
    }
});

// =====================================================
// Ziele
// =====================================================
/**
 * **Was jede Seite braucht — und was sie deshalb nicht laedt.**
 *
 * Bis zum 2026-08-29 stand alles auf einer Seite, also wurde alles geladen.
 * Mit dem Schnitt nach Aufgaben faellt das auseinander, und das ist mehr als
 * Ordnung: `getMitglieder` geht ueber IPC an `members.fetch()` - einen der drei
 * Aufrufe im Haus, die ohne eigene Frist laufen. Ihn auf jeder der drei Seiten
 * zu machen, hiesse das Risiko zu verdreifachen, ohne es zu brauchen.
 *
 * @type {Object<string, {mitglieder: boolean, sprachkanaele: boolean, zusagen: boolean}>}
 */
const SEITEN_BEDARF = {
    ankuendigung: { mitglieder: false, sprachkanaele: false, zusagen: false, vorlagen: true  },
    meldungen:    { mitglieder: false, sprachkanaele: false, zusagen: true,  vorlagen: false },
    rollen:       { mitglieder: true,  sprachkanaele: true,  zusagen: true,  vorlagen: false },

    // **Die Kanalseite braucht alles** (P4) — sie zeigt die vier Bereiche
    // eines Kanals nebeneinander statt auf drei Seiten verteilt.
    //
    // Dass sie mehr laedt als jede Einzelseite, ist kein Rueckschritt: Sie
    // laedt es fuer **einen** Kanal. Die Einzelseiten laden weniger, aber fuer
    // alle — und genau daran wuchsen sie multiplikativ. Vier Ziele ergaben auf
    // `/ankuendigung` 23 Karten untereinander.
    kanal:        { mitglieder: true,  sprachkanaele: true,  zusagen: true,  vorlagen: true  }
};

/**
 * Eine der drei Ziel-Seiten aufbauen.
 *
 * Sie teilen sich die Ansicht und die Karten; `seite` entscheidet, welche
 * Karten erscheinen. Drei eigene Ansichten waeren drei Kopien desselben
 * Geruests gewesen - genau das, was bei den sieben Seitenkoepfen schon einmal
 * auseinandergelaufen ist.
 *
 * @param {string} seite 'ankuendigung', 'meldungen' oder 'rollen'
 * @param {Object} req Anfrage
 * @param {Object} res Antwort
 * @returns {Promise<void>} nichts
 */
async function zielSeite(seite, req, res) {
    // **Der Filter ist das ganze P4.** Dieselbe Datenladerei, dieselben
    // Karten — nur auf einen Kanal eingeschraenkt und in eine Ansicht mit
    // Reitern gegeben. Eine zweite Ladefunktion daneben waere die zweite
    // Stelle geworden, an der ein neues Feld vergessen wird.
    const nurStreamer = seite === 'kanal' ? Number(req.params.id) : null;
    const guildId = res.locals.guildId;
    const tr = makeTranslator(req, res);
    const bedarf = SEITEN_BEDARF[seite];

    try {
        const [ziele, zielkanaele, rollen, liveRolleId] = await Promise.all([
            modelle.zieleDerGuild(guildId),
            getZielkanaele(guildId),
            getRollen(guildId),
            modelle.liveRolle(guildId)
        ]);
        const zeitzone = await modelle.zeitzone(guildId);

        const sprachkanaele = bedarf.sprachkanaele ? await getSprachkanaele(guildId) : [];
        const mitglieder = bedarf.mitglieder ? await getMitglieder(guildId) : [];
        // Die Vorlagen stehen seit dem 2026-08-29 auf der Ankuendigungsseite -
        // der Text gehoert zu der Sache, deren Text er ist.
        const vorlagen = bedarf.vorlagen ? await modelle.vorlagenLesen(guildId) : null;

        // **Trägt die gewählte Rolle Mitglieder, die nicht von uns kommen?**
        // Dann bedeutet sie auf diesem Server noch etwas anderes - ein
        // Zugangsrecht zum Beispiel. Das gehoert gesagt, BEVOR ein Abgleich
        // sie einsammelt (Vorfall 2026-08-25, Baustelle 69).
        //
        // Nur auf der Rollen-Seite: Ohne die Mitgliederliste laesst es sich
        // nicht ausrechnen, und eine `0` waere hier keine Auskunft, sondern
        // eine Behauptung.
        let fremdeTraeger = 0;
        if (bedarf.mitglieder && liveRolleId) {
            const unsere = new Set(await modelle.vergebeneRolle(guildId, liveRolleId));
            fremdeTraeger = (mitglieder || [])
                .filter(m => (m.rollen || []).includes(String(liveRolleId)) && !unsere.has(String(m.id)))
                .length;
        }

        // **Stand der Abonnenten-Zusage je Ziel.** Ohne diese Auskunft waere
        // das Feld "Abonnenten-Rolle" ein Versprechen: Man waehlt eine Rolle,
        // speichert, und nichts passiert — weil der Kanalinhaber gar nicht
        // verknuepft ist. Diese Sorte stiller Wirkungslosigkeit ist genau das,
        // was dieses Plugin an anderen Bots kritisiert.
        if (bedarf.zusagen) {
            const abonnenten = require('../kern/abonnenten');
            for (const z of ziele) {
                try {
                    const streamer = (await ServiceManager.get('dbService').query(
                        'SELECT id, plattform, kanal_id, login FROM streaming_streamers WHERE id = ?',
                        [z.streamer_id]))[0];
                    if (!streamer) continue;

                    const inhaber = await abonnenten.kanalInhaber(streamer);
                    if (!inhaber) { z.aboZusage = false; z.melderScopes = []; continue; }

                    const zusage = await require('../../../../apps/dashboard/helpers/Verbindungsspeicher')
                        .zusageLesen(inhaber, streamer.plattform);

                    z.aboInhaber = zusage?.konto_name || streamer.login;
                    z.aboZusage = String(zusage?.scopes || '').includes('channel:read:subscriptions')
                        ? true : 'ohne-zusage';

                    // Dieselbe Auskunft fuer die Melder (12c). Sie brauchen je
                    // nach Art einen anderen Scope — `bits:read`,
                    // `moderator:read:followers`, oder gar keinen (Raid).
                    z.melderScopes = String(zusage?.scopes || '').split(' ').filter(Boolean);
                } catch (err) {
                    // **Nicht pruefbar ist nicht dasselbe wie nicht erteilt.**
                    // Frueher stand hier `z.aboZusage = false`, und die Seite
                    // behauptete dann "der Kanal ist nicht verknuepft" — eine
                    // falsche Auskunft, die wie eine richtige aussieht. Jetzt
                    // sagt sie, dass sie es nicht weiss.
                    ServiceManager.get('Logger').warn(
                        `[Streaming] Zusagenstand fuer Ziel ${z.id} nicht lesbar: ${err.message}`);
                    z.aboZusage = 'unbekannt';
                    z.melderScopes = null;
                }
            }
        }

        // Auf den einen Kanal einschraenken — nach dem Laden, weil die
        // Zusagen- und Traegerrechnung oben die ganze Liste braucht.
        let sichtbar = ziele;
        let kanal = null;
        if (nurStreamer !== null) {
            sichtbar = (ziele || []).filter(z => Number(z.streamer_id) === nurStreamer);
            if (!sichtbar.length) {
                // Kein Ziel heisst: Dieser Kanal wird in dieser Guild nicht
                // verfolgt. Ein leeres Geruest waere eine Seite, die etwas
                // ueber einen fremden Kanal zu wissen vorgibt.
                return res.redirect(`/guild/${guildId}/plugins/streaming/streamer`);
            }
            kanal = {
                id: nurStreamer,
                login: sichtbar[0].login,
                anzeigename: sichtbar[0].anzeigename,
                ist_live: sichtbar[0].ist_live,
                letzte_meldung_am: sichtbar[0].letzte_meldung_am
            };
        }

        await renderView(res, seite === 'kanal' ? 'guild/streaming-kanal' : 'guild/streaming-ziele', {
            tr, guildId, seite, kanal, vorWieLange,
            ziele: sichtbar, zielkanaele, sprachkanaele, rollen, mitglieder, liveRolleId,
            fremdeTraeger, zeitzone, zonen: ZEITZONEN,
            vorlagen, platzhalter: PLATZHALTER,
            vorgabeLive: VORGABE_LIVE, vorgabeRueckschau: VORGABE_RUECKSCHAU,
            // Die Melderarten kommen aus dem Kern, nicht aus der Ansicht:
            // Sonst stuende die Liste an zwei Stellen und waeche beim
            // naechsten Ereignis nur an einer mit.
            melderArten: melder.ARTEN,
            melderBeschreibung: (art) => melder.beschreibungFuer(
                require('../plattformen/twitch'), art),
            meldung: req.query.ok || null,
            fehler: req.query.fehler || null
        });
    } catch (error) {
        return renderFehler(res, error, 'Die Seite konnte nicht geladen werden');
    }
}

// =====================================================
// Meine Befehle (Stufe 15)
// =====================================================
//
// **Nur in der Heim-Guild.** Ein Kanal hat genau eine; dort richtet sein
// Inhaber die Befehle ein. Ohne diese Schranke koennte jede Guild, die den
// Kanal beobachtet, in seinen Chat schreiben lassen.
async function befehlsSeite(req, res, meldung, fehler) {
    const guildId = res.locals.guildId;
    const tr = makeTranslator(req, res);

    const heimguild = require('../kern/heimguild');
    if (!await heimguild.istHeim(guildId)) {
        return res.redirect(`/guild/${guildId}/plugins/streaming`);
    }

    const [zeilen, kanaele, bausteine] = await Promise.all([
        befehlsModul().alleFuerGuild(guildId),
        heimguild.kanaeleDerGuild(guildId),
        require('../kern/bausteine').alleFuerGuild(guildId)
    ]);

    await renderView(res, 'guild/streaming-befehle', {
        tr, guildId, kanaele, bausteine,
        eigene: zeilen.filter(z => z.art !== 'fertig'),
        fertigZeilen: zeilen.filter(z => z.art === 'fertig'),
        FERTIG: befehlsModul().FERTIG,
        PRAEFIX: befehlsModul().PRAEFIX,
        PLATZHALTER: befehlsModul().PLATZHALTER,
        vorWieLange,
        meldung: meldung || req.query.ok || null,
        fehler: fehler || req.query.fehler || null
    });
}

/** @returns {Object} Befehlsmodul */
function befehlsModul() {
    return require('../kern/befehle');
}

router.get('/befehle', requirePermission('STREAMING.CHAT.MANAGE'), async (req, res) => {
    try {
        return await befehlsSeite(req, res);
    } catch (error) {
        return renderFehler(res, error, 'Die Befehle konnten nicht geladen werden');
    }
});

/** Der erste Kanal der Heim-Guild — heute gibt es genau einen. */
async function heimKanalId(guildId) {
    const kanaele = await require('../kern/heimguild').kanaeleDerGuild(guildId);
    return kanaele.length ? kanaele[0].id : null;
}

router.post('/befehle', requirePermission('STREAMING.CHAT.MANAGE'), async (req, res) => {
    const guildId = res.locals.guildId;
    const zurueck = `/guild/${guildId}/plugins/streaming/befehle`;
    try {
        const ergebnis = await befehlsModul().anlegen(
            guildId, await heimKanalId(guildId), req.body, res.locals.user?.id);
        return res.redirect(`${zurueck}?${ergebnis.ok ? 'ok=neu' : 'fehler=' + ergebnis.grund}`);
    } catch (error) {
        ServiceManager.get('Logger').error('[Streaming] Befehl anlegen', error);
        return res.redirect(`${zurueck}?fehler=technisch`);
    }
});

router.post('/befehle/fertig', requirePermission('STREAMING.CHAT.MANAGE'), async (req, res) => {
    const guildId = res.locals.guildId;
    const zurueck = `/guild/${guildId}/plugins/streaming/befehle`;
    try {
        const roh = req.body.fertig;
        const gewaehlt = Array.isArray(roh) ? roh : (roh ? [roh] : []);
        await befehlsModul().fertigSetzen(guildId, await heimKanalId(guildId), gewaehlt);
        return res.redirect(`${zurueck}?ok=gespeichert`);
    } catch (error) {
        ServiceManager.get('Logger').error('[Streaming] Fertige Befehle setzen', error);
        return res.redirect(`${zurueck}?fehler=technisch`);
    }
});

router.post('/befehle/:id', requirePermission('STREAMING.CHAT.MANAGE'), async (req, res) => {
    const guildId = res.locals.guildId;
    const zurueck = `/guild/${guildId}/plugins/streaming/befehle`;
    try {
        const getroffen = await befehlsModul().aendern(req.params.id, guildId, {
            antwort: req.body.antwort,
            zaehler_name: req.body.zaehler_name,
            wer: req.body.wer,
            abkuehlung_s: req.body.abkuehlung_s,
            aktiv: req.body.aktiv ? 1 : 0
        });
        return res.redirect(`${zurueck}?${getroffen ? 'ok=gespeichert' : 'fehler=weg'}`);
    } catch (error) {
        ServiceManager.get('Logger').error('[Streaming] Befehl aendern', error);
        return res.redirect(`${zurueck}?fehler=technisch`);
    }
});

router.post('/befehle/:id/entfernen', requirePermission('STREAMING.CHAT.MANAGE'), async (req, res) => {
    const guildId = res.locals.guildId;
    const zurueck = `/guild/${guildId}/plugins/streaming/befehle`;
    try {
        const getroffen = await befehlsModul().entfernen(req.params.id, guildId);
        return res.redirect(`${zurueck}?${getroffen ? 'ok=entfernt' : 'fehler=weg'}`);
    } catch (error) {
        ServiceManager.get('Logger').error('[Streaming] Befehl entfernen', error);
        return res.redirect(`${zurueck}?fehler=technisch`);
    }
});

// =====================================================
// Eigene Textbausteine — `{discord}` einmal setzen
// =====================================================
//
// **Sie stehen auf der Befehlsseite, nicht auf einer eigenen.** Sie gelten
// zwar auch fuer Ansagen, aber ein Menuepunkt fuer eine Handvoll Name-Wert-
// Paare waere mehr Gliederung als Inhalt — und sie gehoeren dorthin, wo man
// den Text schreibt, in dem sie vorkommen.

/** @returns {Object} Bausteinmodul */
function bausteinModul() {
    return require('../kern/bausteine');
}

router.post('/bausteine', requirePermission('STREAMING.CHAT.MANAGE'), async (req, res) => {
    const guildId = res.locals.guildId;
    const zurueck = `/guild/${guildId}/plugins/streaming/befehle`;
    try {
        const ergebnis = await bausteinModul().anlegen(
            guildId, await heimKanalId(guildId), req.body, res.locals.user?.id);
        // **Eigenes Praefix.** Beide Formulare landen auf derselben Seite, und
        // `doppelt` heisst beim Befehl „das Wort gibt es schon", beim Baustein
        // „den Namen gibt es schon". Ein gemeinsamer Schluessel zeigte den
        // falschen Satz.
        return res.redirect(`${zurueck}?${ergebnis.ok ? 'ok=baustein' : 'fehler=b_' + ergebnis.grund}`);
    } catch (error) {
        ServiceManager.get('Logger').error('[Streaming] Baustein anlegen', error);
        return res.redirect(`${zurueck}?fehler=technisch`);
    }
});

router.post('/bausteine/:id', requirePermission('STREAMING.CHAT.MANAGE'), async (req, res) => {
    const guildId = res.locals.guildId;
    const zurueck = `/guild/${guildId}/plugins/streaming/befehle`;
    try {
        const ergebnis = await bausteinModul().aendern(req.params.id, guildId, req.body);
        return res.redirect(`${zurueck}?${ergebnis.ok ? 'ok=gespeichert' : 'fehler=b_' + (ergebnis.grund || 'weg')}`);
    } catch (error) {
        ServiceManager.get('Logger').error('[Streaming] Baustein aendern', error);
        return res.redirect(`${zurueck}?fehler=technisch`);
    }
});

router.post('/bausteine/:id/entfernen', requirePermission('STREAMING.CHAT.MANAGE'), async (req, res) => {
    const guildId = res.locals.guildId;
    const zurueck = `/guild/${guildId}/plugins/streaming/befehle`;
    try {
        const getroffen = await bausteinModul().entfernen(req.params.id, guildId);
        return res.redirect(`${zurueck}?${getroffen ? 'ok=entfernt' : 'fehler=weg'}`);
    } catch (error) {
        ServiceManager.get('Logger').error('[Streaming] Baustein entfernen', error);
        return res.redirect(`${zurueck}?fehler=technisch`);
    }
});

// =====================================================
// Meine Ansagen (P6) — was der Bot von sich aus sagt
// =====================================================

/** @returns {Object} Ansagenmodul */
function ansagenModul() {
    return require('../kern/ansagen');
}

router.get('/ansagen', requirePermission('STREAMING.CHAT.MANAGE'), async (req, res) => {
    const guildId = res.locals.guildId;
    const tr = makeTranslator(req, res);
    try {
        // Dieselbe Tuer wie bei den Befehlen: Ansagen gehen in den eigenen
        // Chat, und den gibt es nur in der Heim-Guild.
        if (!await require('../kern/heimguild').istHeim(guildId)) {
            return res.redirect(`/guild/${guildId}/plugins/streaming`);
        }

        const [zeilen, kanaele, bausteine] = await Promise.all([
            ansagenModul().alleFuerGuild(guildId),
            require('../kern/heimguild').kanaeleDerGuild(guildId),
            require('../kern/bausteine').alleFuerGuild(guildId)
        ]);

        await renderView(res, 'guild/streaming-ansagen', {
            tr, guildId, kanaele, ansagen: zeilen, bausteine,
            GRENZEN: {
                intervallMin: ansagenModul().INTERVALL_MIN,
                intervallMax: ansagenModul().INTERVALL_MAX,
                zeilenMax:    ansagenModul().ZEILEN_MAX
            },
            PLATZHALTER: require('../../shared/vorlagen').PLATZHALTER_CHAT,
            vorWieLange,
            meldung: req.query.ok || null,
            fehler: req.query.fehler || null
        });
    } catch (error) {
        return renderFehler(res, error, 'Die Ansagen konnten nicht geladen werden');
    }
});

router.post('/ansagen', requirePermission('STREAMING.CHAT.MANAGE'), async (req, res) => {
    const guildId = res.locals.guildId;
    const zurueck = `/guild/${guildId}/plugins/streaming/ansagen`;
    try {
        const ergebnis = await ansagenModul().anlegen(
            guildId, await heimKanalId(guildId), req.body, res.locals.user?.id);
        return res.redirect(`${zurueck}?${ergebnis.ok ? 'ok=neu' : 'fehler=' + ergebnis.grund}`);
    } catch (error) {
        ServiceManager.get('Logger').error('[Streaming] Ansage anlegen', error);
        return res.redirect(`${zurueck}?fehler=technisch`);
    }
});

router.post('/ansagen/:id', requirePermission('STREAMING.CHAT.MANAGE'), async (req, res) => {
    const guildId = res.locals.guildId;
    const zurueck = `/guild/${guildId}/plugins/streaming/ansagen`;
    try {
        const ergebnis = await ansagenModul().aendern(req.params.id, guildId, {
            text:           req.body.text,
            intervall_min:  req.body.intervall_min,
            mindest_zeilen: req.body.mindest_zeilen,
            aktiv:          req.body.aktiv ? 1 : 0
        });
        return res.redirect(`${zurueck}?${ergebnis.ok ? 'ok=gespeichert' : 'fehler=' + (ergebnis.grund || 'weg')}`);
    } catch (error) {
        ServiceManager.get('Logger').error('[Streaming] Ansage aendern', error);
        return res.redirect(`${zurueck}?fehler=technisch`);
    }
});

router.post('/ansagen/:id/entfernen', requirePermission('STREAMING.CHAT.MANAGE'), async (req, res) => {
    const guildId = res.locals.guildId;
    const zurueck = `/guild/${guildId}/plugins/streaming/ansagen`;
    try {
        const getroffen = await ansagenModul().entfernen(req.params.id, guildId);
        return res.redirect(`${zurueck}?${getroffen ? 'ok=entfernt' : 'fehler=weg'}`);
    } catch (error) {
        ServiceManager.get('Logger').error('[Streaming] Ansage entfernen', error);
        return res.redirect(`${zurueck}?fehler=technisch`);
    }
});

// =====================================================
// Ereignisse — die Vorgabe dieser Guild
// =====================================================
//
// **Warum das keine Zielseite mehr ist** (2026-09-04). `/meldungen` rief
// `zielSeite('meldungen')` und zeigte damit dieselbe Tabelle wie
// `/ankuendigung` und `/rollen` — nur mit getauschter Spalte. Drei Seiten, ein
// Inhalt.
//
// Der Entwurf schneidet es anders: Die Guild sagt einmal, was sie hoeren will;
// ein einzelner Kanal darf abweichen, und DAS steht auf seiner Seite (P4). Was
// hier bleibt, ist die Vorgabe — eine Karte, ein Speichern-Knopf.
router.get('/meldungen', requirePermission('STREAMING.VIEW'), async (req, res) => {
    const guildId = res.locals.guildId;
    const tr = makeTranslator(req, res);
    try {
        const [arten, bitsAb, ziele] = await Promise.all([
            modelle.melderVorgabe(guildId),
            modelle.bitsSchwelle(guildId),
            modelle.zieleDerGuild(guildId)
        ]);

        // Wie viele Kanaele weichen ab? Das beantwortet die Frage, die man vor
        // einer Vorgabe hat: "gilt das ueberhaupt fuer jemanden?"
        const eigene = ziele.filter(z => z.melder_arten !== null && z.melder_arten !== undefined).length;

        await renderView(res, 'guild/streaming-ereignisse', {
            tr, guildId, arten, bitsAb,
            ARTEN: melder.ARTEN,
            anzahlZiele: ziele.length,
            mitEigenen: eigene,
            meldung: req.query.ok || null,
            fehler: req.query.fehler || null
        });
    } catch (error) {
        return renderFehler(res, error, 'Die Ereignis-Vorgabe konnte nicht geladen werden');
    }
});

router.post('/meldungen', requirePermission('STREAMING.TARGETS.MANAGE'), async (req, res) => {
    const guildId = res.locals.guildId;
    const zurueck = `/guild/${guildId}/plugins/streaming/meldungen`;
    try {
        // Ein einzelner Schalter kommt als Zeichenkette, mehrere als Feld.
        const roh = req.body.arten;
        const gewaehlt = (Array.isArray(roh) ? roh : (roh ? [roh] : []))
            .filter(a => Object.prototype.hasOwnProperty.call(melder.ARTEN, a));

        await modelle.melderVorgabeSetzen(guildId, gewaehlt);
        await modelle.bitsSchwelleSetzen(guildId, req.body.bits_ab);
        return res.redirect(`${zurueck}?ok=gespeichert`);
    } catch (error) {
        ServiceManager.get('Logger').error('[Streaming] Ereignis-Vorgabe speichern', error);
        return res.redirect(`${zurueck}?fehler=technisch`);
    }
});

// =====================================================
// Automatische Rollen — die Vorgaben dieser Guild
// =====================================================
//
// Wie `/meldungen` keine Zielseite mehr: Der Entwurf zeigt hier zwei Karten,
// Live-Rolle und Abo-Rolle, und keine Kanaltabelle. Der einzelne Kanal weicht
// auf seiner Seite ab (P4).
router.get('/rollen', requirePermission('STREAMING.VIEW'), async (req, res) => {
    const guildId = res.locals.guildId;
    const tr = makeTranslator(req, res);
    try {
        const [rollen, mitglieder, liveRolleId, aboRolleId, ziele] = await Promise.all([
            getRollen(guildId),
            getMitglieder(guildId),
            modelle.liveRolle(guildId),
            modelle.aboRolle(guildId),
            modelle.zieleDerGuild(guildId)
        ]);

        // **Fremde Traeger der Live-Rolle.** Ohne die Mitgliederliste laesst es
        // sich nicht ausrechnen, und eine `0` waere keine Auskunft, sondern eine
        // Behauptung (Vorfall 2026-08-25, Baustelle 69).
        let fremdeTraeger = 0;
        if (liveRolleId) {
            const unsere = new Set(await modelle.vergebeneRolle(guildId, liveRolleId));
            fremdeTraeger = (mitglieder || [])
                .filter(m => (m.rollen || []).includes(String(liveRolleId)) && !unsere.has(String(m.id)))
                .length;
        }

        const name = (id) => (rollen || []).find(r => String(r.id) === String(id))?.name || null;

        await renderView(res, 'guild/streaming-rollen', {
            tr, guildId, rollen, liveRolleId, aboRolleId,
            liveRolleName: name(liveRolleId),
            aboRolleName: name(aboRolleId),
            fremdeTraeger,
            anzahlZiele: (ziele || []).length,
            mitEigenerAboRolle: (ziele || []).filter(z => z.abo_rolle_id).length,
            meldung: req.query.ok || null,
            fehler: req.query.fehler || null
        });
    } catch (error) {
        return renderFehler(res, error, 'Die Rollen-Vorgaben konnten nicht geladen werden');
    }
});

router.post('/rollen', requirePermission('STREAMING.SETTINGS.EDIT'), async (req, res) => {
    const guildId = res.locals.guildId;
    const zurueck = `/guild/${guildId}/plugins/streaming/rollen`;
    try {
        const gueltig = (w) => /^\d{5,32}$/.test(String(w || '').trim()) ? String(w).trim() : '';
        await modelle.liveRolleSetzen(guildId, gueltig(req.body.live_rolle_id));
        await modelle.aboRolleSetzen(guildId, gueltig(req.body.abo_rolle_id));
        return res.redirect(`${zurueck}?ok=gespeichert`);
    } catch (error) {
        ServiceManager.get('Logger').error('[Streaming] Rollen-Vorgaben speichern', error);
        return res.redirect(`${zurueck}?fehler=technisch`);
    }
});

Object.keys(SEITEN_BEDARF)
    // `kanal` hat eine eigene Adresse mit Kennung — sie steht weiter unten
    // bei den anderen `/streamer/...`-Routen.
    // `meldungen` ist seit dem 2026-09-04 keine Zielseite mehr, sondern die
    // Vorgabe der Guild — eigene Route weiter oben.
    .filter(seite => seite !== 'kanal' && seite !== 'meldungen' && seite !== 'rollen')
    .forEach((seite) => {
        router.get(`/${seite}`, requirePermission('STREAMING.VIEW'), (req, res) => zielSeite(seite, req, res));
    });

// **Ein Kanal, eine Seite** (P4). Die Antwort auf zwei Befunde: Derselbe Kanal
// stand als Karte unter Ankuendigung, nochmal unter Meldungen, nochmal unter
// Rollen — und jede dieser Seiten wuchs mit der Zahl ALLER Ziele mal der Zahl
// ihrer Einstellungen.
router.get('/streamer/:id', requirePermission('STREAMING.VIEW'), (req, res) => {
    if (!Number.isInteger(Number(req.params.id))) {
        return res.redirect(`/guild/${res.locals.guildId}/plugins/streaming/streamer`);
    }
    return zielSeite('kanal', req, res);
});

// **`/ziele` bleibt erreichbar.** Die Adresse steht in Lesezeichen, in der
// Streamer-Seite und in jeder Rueckmeldung, die vor heute verschickt wurde.
// Ein 404 dort waere kein sauberer Schnitt, sondern ein toter Verweis.
router.get('/ziele', requirePermission('STREAMING.VIEW'), (req, res) => {
    res.redirect(`/guild/${res.locals.guildId}/plugins/streaming/ankuendigung`);
});

// **Reihenfolge zaehlt.** Diese Route muss VOR `/ziele/:id` stehen: Express
// nimmt die erste Route, die passt, und `:id` passt auch auf "live-rolle".
// Andersherum landete jedes Speichern der Live-Rolle in der Ziel-Route, wo
// `Number("live-rolle")` NaN ergibt - und die Seite meldete einen technischen
// Fehler, ohne dass irgendwo stuende, warum.
// Die Live-Rolle der Guild
//
// Eigenes Recht (SETTINGS.EDIT statt TARGETS.MANAGE): Das ist eine Vorgabe der
// Guild, kein einzelnes Ziel. Wer Ziele pflegen darf, soll nicht nebenbei eine
// Rolle vergeben duerfen, die der ganze Server sieht.
router.post('/ziele/live-rolle', requirePermission('STREAMING.SETTINGS.EDIT'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const guildId = res.locals.guildId;
    const zurueck = `/guild/${guildId}/plugins/streaming/rollen`;

    try {
        const rolleId = String(req.body.live_rolle_id || '').trim();
        if (rolleId && !/^\d{5,32}$/.test(rolleId)) {
            return res.redirect(`${zurueck}?fehler=rolle`);
        }

        const vorher = await modelle.liveRolle(guildId);
        await modelle.liveRolleSetzen(guildId, rolleId);

        // **Wird die Rolle gewechselt oder abgeschaltet, bleibt die alte an
        // allen haengen, die gerade live sind.** Sie abzuraeumen ist kein
        // Zusatz, sondern gehoert zum Umstellen dazu - sonst traegt jemand
        // wochenlang eine Rolle, die es im Plugin nicht mehr gibt.
        if (vorher && vorher !== rolleId) {
            const anzahl = await altRolleAbraeumen(guildId, vorher);
            Logger.info(`[Streaming] Live-Rolle gewechselt, ${anzahl} Auftrag/Auftraege zum Entziehen der alten Rolle`);
            return res.redirect(`${zurueck}?ok=${rolleId ? 'rolle_gewechselt' : 'rolle_aus'}`);
        }

        Logger.info(`[Streaming] Live-Rolle der Guild ${guildId} ${rolleId ? 'gesetzt' : 'abgeschaltet'}`);
        return res.redirect(`${zurueck}?ok=gespeichert`);
    } catch (error) {
        Logger.error('[Streaming] Live-Rolle speichern fehlgeschlagen:', error);
        return res.redirect(`${zurueck}?fehler=technisch`);
    }
});

// Die Zeitzone der Guild
//
// **Sie stand bis zum 2026-08-29 im selben Formular wie die Live-Rolle**, mit
// der Begruendung: "zwei Knoepfe nebeneinander waeren nur Gelegenheit, einen
// davon zu vergessen." Die galt, solange beides auf EINER Seite stand.
//
// Mit dem Schnitt nach Aufgaben stehen sie auf verschiedenen: Die Live-Rolle
// gehoert zu "Rollen", die Zeitzone zur "Ankuendigung" - sie regelt die
// Ruhezeiten und sonst nichts. Ein gemeinsames Formular ueber zwei Seiten gibt
// es nicht; die alte Begruendung ist damit nicht widerlegt, sondern
// gegenstandslos.
router.post('/ziele/zeitzone', requirePermission('STREAMING.SETTINGS.EDIT'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const guildId = res.locals.guildId;
    const zurueck = `/guild/${guildId}/plugins/streaming/ankuendigung`;

    try {
        const zone = String(req.body.zeitzone || '').trim();
        // **Keine Freitext-Zone.** `Intl` wirft bei einem Tippfehler, wir
        // weichen auf die Serverzeit aus, und die Ruhezeit gilt still zur
        // falschen Stunde.
        if (zone && !ZEITZONEN.includes(zone)) return res.redirect(`${zurueck}?fehler=zone`);
        if (zone) await modelle.zeitzoneSetzen(guildId, zone);

        Logger.info(`[Streaming] Zeitzone der Guild ${guildId} auf ${zone || '(unveraendert)'} gesetzt`);
        return res.redirect(`${zurueck}?ok=gespeichert`);
    } catch (error) {
        Logger.error('[Streaming] Zeitzone speichern fehlgeschlagen:', error);
        return res.redirect(`${zurueck}?fehler=technisch`);
    }
});

/**
 * Eine abgeloeste Live-Rolle bei allen einsammeln, die sie tragen koennten.
 *
 * Gemeint sind die Ziele dieser Guild mit zugeordnetem Mitglied - mehr wissen
 * wir nicht. Wer die Rolle von Hand bekommen hat, behaelt sie: Das Plugin
 * raeumt nur weg, was es selbst vergeben haben koennte.
 *
 * @param {string} guildId Discord-Guild-ID
 * @param {string} rolleId Die alte Rolle
 * @returns {Promise<number>} Anzahl Auftraege
 */
async function altRolleAbraeumen(guildId, rolleId) {
    const db = ServiceManager.get('dbService');

    // **Nur, wem WIR sie gegeben haben.** Vorher stand hier "alle Mitglieder,
    // die einem Ziel zugeordnet sind" — und das nahm die Rolle auch denen weg,
    // die sie aus einem ganz anderen Grund tragen. Ist die eingetragene Rolle
    // zugleich ein Zugangsrecht, ist das ein Zugangsverlust (2026-08-25).
    const vergeben = await db.query(
        'SELECT mitglied_id FROM streaming_role_grants WHERE guild_id = ? AND rolle_id = ?',
        [guildId, rolleId]);

    let anzahl = 0;

    for (const v of vergeben) {
        await db.query(`
            INSERT INTO streaming_outbox (guild_id, aktion, nutzlast)
            VALUES (?, 'rolle_nehmen', ?)
        `, [guildId, JSON.stringify({ mitglied_id: v.mitglied_id, rolle_id: rolleId })]);
        anzahl++;
    }

    return anzahl;
}

// Ein Ziel aendern
/**
 * **Die Felder einer Funktionskarte aus dem Formular lesen.**
 *
 * Je Karte eine Funktion. Sie gibt entweder die Spaltenwerte zurueck oder eine
 * Fehlermarke - dann wird nichts geschrieben.
 *
 * **Warum je Karte und nicht einmal fuer alles.** Bis zum 2026-08-29 las eine
 * einzige Route saemtliche neunzehn Felder und schrieb alle siebzehn Spalten.
 * Solange EIN Formular alles mitschickte, ging das gut. Sobald die Seite in
 * Karten zerfaellt, schickt jede nur ihre eigenen Felder - und dieselbe Route
 * haette die uebrigen zwoelf still auf NULL gesetzt. Die Trennung hier und die
 * Spaltenliste in `KARTEN_SPALTEN` sind zwei Haelften derselben Zusage.
 *
 * @type {Object<string, function(Object): (Object|{fehler: string})>}
 */
const KARTEN_FELDER = {
    schalter: (b) => ({ aktiv: b.aktiv ? 1 : 0 }),

    ankuendigung: (b) => {
        const channelId = String(b.channel_id || '').trim();
        if (!channelId) return { fehler: 'ziel_fehlt' };
        const bild = String(b.eigenes_bild || '').trim();
        if (bild && !/^https:\/\//i.test(bild)) return { fehler: 'bild' };
        return {
            channel_id:       channelId,
            rolle_id:         String(b.rolle_id || '').trim() || null,
            eigenes_bild:     bild || null,
            veroeffentlichen: b.veroeffentlichen ? 1 : 0
        };
    },

    meldungen: (b) => ({
        // Der Kanal darf leer bleiben - dann gehen die Meldungen in den
        // Ankuendigungskanal (Entscheidung des Betreibers am 2026-08-27).
        melder_channel_id: String(b.melder_channel_id || '').trim() || null,
        // Die Arten laufen durch `artenSchreiben`: Was dort nicht als
        // gueltiger Name steht, faellt weg, statt in die Spalte zu geraten.
        melder_arten:      melder.artenSchreiben(
                               Array.isArray(b.melder_arten) ? b.melder_arten
                               : (b.melder_arten ? [b.melder_arten] : []))
    }),

    filter: (b) => ({
        filter_spiel:     String(b.filter_spiel || '').trim() || null,
        filter_titel:     String(b.filter_titel || '').trim() || null,
        filter_spiel_aus: String(b.filter_spiel_aus || '').trim() || null,
        filter_titel_aus: String(b.filter_titel_aus || '').trim() || null,
        ruhe_von:         uhrzeit(b.ruhe_von),
        ruhe_bis:         uhrzeit(b.ruhe_bis)
    }),

    aufraeumen: (b) => {
        // 'bearbeiten' ist die Vorgabe. Ein unbekannter Wert kaeme aus einem
        // veraenderten Formular - dann gilt die Vorgabe, nicht der Wunsch.
        const erlaubt = ['bearbeiten', 'loeschen', 'stehenlassen'];
        return { aufraeumen: erlaubt.includes(b.aufraeumen) ? b.aufraeumen : 'bearbeiten' };
    },

    rollen: (b) => ({
        // Nur Ziffern: Eine Discord-Kennung ist eine Zahl. Ein eingetippter
        // Name kaeme sonst als Kennung durch und die Vergabe liefe ins Leere.
        abo_rolle_id:  /^\d{5,32}$/.test(String(b.abo_rolle_id || '').trim())
                          ? String(b.abo_rolle_id).trim() : null,
        mitglied_id:   /^\d{5,32}$/.test(String(b.mitglied_id || '').trim())
                          ? String(b.mitglied_id).trim() : null,
        onair_channel: String(b.onair_channel || '').trim() || null
    })
};

/**
 * **Karten, nach deren Aenderung die Twitch-Abos nachziehen muessen.**
 *
 * Nicht alle. `aktiv` steht in vierzehn Abfragen als Bedingung, die
 * Melder-Arten bestellen eigene Ereignisse, und die Abonnenten-Rolle braucht
 * `channel.subscribe` und Verwandte. Ein Filter oder eine Ruhezeit aendert
 * dagegen nichts an dem, was wir bei Twitch bestellt haben - dort waere der
 * Nachzug nur Wartezeit ohne Wirkung.
 *
 * @type {Set<string>}
 */
const KARTEN_MIT_ABONACHZUG = new Set(['schalter', 'meldungen', 'rollen']);

/**
 * **Auf welcher Seite steht welche Karte.**
 *
 * Nach dem Speichern soll man dort stehen, wo man war. Ein festes `/ziele`
 * warf einen von der Meldungen-Seite auf die Ankuendigung - und beim naechsten
 * Haekchen wieder, bis man aufgibt.
 *
 * `filter` und `aufraeumen` gehoeren zur Ankuendigung: Beide entscheiden ueber
 * genau sie - das eine, ob sie erscheint, das andere, was danach mit ihr
 * geschieht.
 *
 * @type {Object<string, string>}
 */
const KARTEN_SEITE = {
    schalter:     'ankuendigung',
    ankuendigung: 'ankuendigung',
    filter:       'ankuendigung',
    aufraeumen:   'ankuendigung',
    meldungen:    'meldungen',
    rollen:       'rollen'
};

/**
 * Die Twitch-Abos einer Zieländerung nachziehen.
 *
 * **Was hier passiert, gehoert in die Rueckmeldung.** Ein Speichern, das
 * nebenbei Abonnements bestellt oder abbestellt, ist mehr als "gespeichert" -
 * und wer es nicht erfaehrt, haelt die Wartezeit fuer einen Fehler.
 *
 * @param {string} guildId Discord-Guild-ID
 * @param {number} zielId Ziel-ID
 * @returns {Promise<{bestellt: number, abbestellt: number, fehler: string|null}>} Bilanz
 */
async function abosNachziehen(guildId, zielId) {
    const Logger = ServiceManager.get('Logger');
    try {
        const ziel = await modelle.zielLesen(guildId, zielId);
        if (!ziel) return { bestellt: 0, abbestellt: 0, fehler: null };

        const streamer = (await ServiceManager.get('dbService').query(
            'SELECT plattform, kanal_id FROM streaming_streamers WHERE id = ?', [ziel.streamer_id]))[0];
        if (!streamer) return { bestellt: 0, abbestellt: 0, fehler: null };

        const ergebnisse = await abos.abosSichern(ziel.streamer_id, streamer.plattform, streamer.kanal_id);
        const bestellt = (ergebnisse || []).filter(e => e && e.ok && !e.uebersprungen).length;

        // Gezielt nur die Abo- und Melder-Ereignisse: `abosAufraeumen` wuerde
        // ALLES abbestellen, sobald die letzte Guild das Ziel entfernt.
        const a = await abos.aboEreignisseAufraeumen(ziel.streamer_id);
        const b = await abos.melderEreignisseAufraeumen(ziel.streamer_id);
        return { bestellt, abbestellt: (a?.abbestellt || 0) + (b?.abbestellt || 0), fehler: null };
    } catch (err) {
        // Ein Fehlschlag hier darf das Speichern nicht zuruecknehmen. Der
        // taegliche Abgleich holt es nach - aber gesagt wird es trotzdem.
        Logger.warn(`[Streaming] Abos nach Zieländerung nicht nachgezogen: ${err.message}`);
        return { bestellt: 0, abbestellt: 0, fehler: err.message };
    }
}

/**
 * Eine Funktionskarte speichern.
 *
 * @param {string} karte Name der Karte
 * @param {Object} req Anfrage
 * @param {Object} res Antwort
 * @returns {Promise<void>} nichts
 */
async function karteSpeichern(karte, req, res) {
    const Logger = ServiceManager.get('Logger');
    const guildId = res.locals.guildId;
    const zurueck = `/guild/${guildId}/plugins/streaming/${KARTEN_SEITE[karte]}`;

    try {
        const zielId = Number(req.params.id);
        if (!Number.isInteger(zielId)) return res.redirect(`${zurueck}?fehler=technisch`);

        const felder = KARTEN_FELDER[karte](req.body);
        if (felder.fehler) return res.redirect(`${zurueck}?fehler=${felder.fehler}`);

        const geaendert = await modelle.zielTeilSpeichern(guildId, zielId, karte, felder);

        // Null geaenderte Zeilen heisst hier: das Ziel gehoert dieser Guild
        // nicht (oder gibt es nicht mehr). Das ist kein Erfolg.
        //
        // **Aber auch kein sicherer Fehler:** MySQL meldet 0, wenn sich nichts
        // GEAENDERT hat - wer zweimal dasselbe speichert, bekaeme sonst "Dieses
        // Ziel gibt es nicht mehr" zu lesen. Deshalb wird nachgesehen, statt
        // aus der Zahl zu schliessen.
        if (!geaendert) {
            const vorhanden = await modelle.zielLesen(guildId, zielId);
            if (!vorhanden) return res.redirect(`${zurueck}?fehler=weg`);
        }

        const nachzug = KARTEN_MIT_ABONACHZUG.has(karte)
            ? await abosNachziehen(guildId, zielId)
            : { bestellt: 0, abbestellt: 0, fehler: null };

        Logger.info(`[Streaming] Ziel ${zielId} in Guild ${guildId}: ${karte} geaendert`
            + (nachzug.bestellt || nachzug.abbestellt
                ? ` (${nachzug.bestellt} bestellt, ${nachzug.abbestellt} abbestellt)` : ''));

        const teile = [];
        if (nachzug.bestellt)   teile.push(`${nachzug.bestellt} Ereignis${nachzug.bestellt === 1 ? '' : 'se'} bei Twitch bestellt`);
        if (nachzug.abbestellt) teile.push(`${nachzug.abbestellt} abbestellt`);
        if (nachzug.fehler)     teile.push('die Twitch-Abos konnten nicht nachgezogen werden — der tägliche Abgleich holt es nach');

        return antworte(req, res, {
            zurueck, ok: 'gespeichert',
            // Bei einem Fehlschlag im Nachzug ist "gespeichert" wahr, aber
            // unvollstaendig. Gelb statt gruen sagt genau das.
            art: nachzug.fehler ? 'warning' : 'success',
            text: 'Gespeichert' + (teile.length ? ' — ' + teile.join(', ') : '')
        });
    } catch (error) {
        Logger.error(`[Streaming] Karte ${karte} speichern fehlgeschlagen:`, error);
        return res.redirect(`${zurueck}?fehler=technisch`);
    }
}

// **Je Karte eine eigene Adresse.** Nicht `/ziele/:id/:karte` mit einer
// Weiche: Dieses Muster faengt auch `/ziele/7/entfernen` und `/ziele/7/probe`
// ab, sobald es vor ihnen steht - und wer die Reihenfolge spaeter umstellt,
// merkt davon nichts, bis ein Entfernen-Knopf ploetzlich speichert.
Object.keys(KARTEN_FELDER).forEach((karte) => {
    router.post(`/ziele/:id/${karte}`, requirePermission('STREAMING.TARGETS.MANAGE'),
        (req, res) => karteSpeichern(karte, req, res));
});

// Ein einzelnes Ziel entfernen
router.post('/ziele/:id/entfernen', requirePermission('STREAMING.TARGETS.MANAGE'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const guildId = res.locals.guildId;
    const zurueck = `/guild/${guildId}/plugins/streaming/ziele`;

    try {
        const zielId = Number(req.params.id);
        if (!Number.isInteger(zielId)) return res.redirect(`${zurueck}?fehler=technisch`);

        const ergebnis = await modelle.zielEntfernen(guildId, zielId);
        if (!ergebnis.entfernt) return res.redirect(`${zurueck}?fehler=weg`);

        // War es das letzte Ziel dieser Guild fuer den Kanal, muss das Abo
        // geprueft werden - sonst bleibt ein Abo stehen, das niemand mehr
        // liest, und das gemeinsame Kontingent laeuft voll.
        if (ergebnis.letztes) await abos.abosAufraeumen(ergebnis.streamerId);

        Logger.info(`[Streaming] Ziel ${zielId} aus Guild ${guildId} entfernt`);
        return res.redirect(`${zurueck}?ok=entfernt`);
    } catch (error) {
        Logger.error('[Streaming] Ziel entfernen fehlgeschlagen:', error);
        return res.redirect(`${zurueck}?fehler=technisch`);
    }
});

/**
 * Eine Probeankuendigung ausloesen.
 *
 * **Warum hier und nicht als `/streaming test` im Bot**, wie das Stufenpapier
 * es vorsah: `STREAMING.TEST` liesse sich dort gar nicht pruefen. Gemessen am
 * 2026-08-25 - Bot-Befehle kennen nur **Discord**-Berechtigungen
 * (`apps/bot/handler.js:38`, `userPermissions: [...]`), und der Bot-Vorgang hat
 * ueberhaupt keinen `permissionManager` (`apps/bot/bot.js` registriert Logger,
 * dbService, client, commandManager, pluginManager, i18n, ipcClient,
 * guildManager - sonst nichts). Ein Recht, das nirgends geprueft wird, ist
 * genau das Muster, das beim ersten Einsatz lautlos versagt.
 *
 * Dazu passt die Regel, die im Befehlskopf selbst steht: Was man **einmal
 * einrichtet**, gehoert ins Dashboard. Eine Probe gehoert neben das Ziel, das
 * sie prueft.
 *
 * Der Auftrag geht durch den **normalen** Ausgang - dieselbe Vorlage,
 * derselbe Nachrichtenbau, dieselbe IPC-Strecke. Eine Probe auf einem
 * Sonderweg wuerde nichts beweisen.
 */
router.post('/ziele/:id/probe', requirePermission('STREAMING.TEST'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const guildId = res.locals.guildId;
    const zurueck = `/guild/${guildId}/plugins/streaming/ziele`;

    try {
        const zielId = Number(req.params.id);
        if (!Number.isInteger(zielId)) return res.redirect(`${zurueck}?fehler=technisch`);

        // **Das Ziel muss dieser Guild gehoeren.** Ohne diese Zeile koennte
        // jemand mit STREAMING.TEST in seiner eigenen Guild eine Ankuendigung
        // in den Kanal einer FREMDEN schicken - die Ziel-ID steht in der
        // Adresszeile. Der Router prueft das Recht, nicht die Zugehoerigkeit;
        // das muss hier passieren.
        const ziel = await modelle.zielLesen(guildId, zielId);
        if (!ziel) {
            return antworteFehler(req, res, {
                zurueck, fehler: 'weg', text: 'Dieses Ziel gibt es nicht mehr.'
            });
        }

        const art = req.body?.art === 'rueckschau' ? 'rueckschau' : 'live';
        await modelle.probeVormerken(guildId, zielId, Boolean(req.body?.mit_erwaehnung), art);

        Logger.info(`[Streaming] Probe fuer Ziel ${zielId} (Guild ${guildId}) vorgemerkt` +
            ` (${art}${req.body?.mit_erwaehnung ? ', mit Erwaehnung' : ''})`);

        // **Der erste Aufrufer von `FormAntwort`.** Ohne JavaScript laeuft
        // genau die Weiterleitung wie vorher; mit JavaScript kommt ein Toast
        // und die Seite bleibt stehen - das ist bei einer Probe der Punkt, man
        // will ja gleich die naechste schicken.
        return antworte(req, res, {
            zurueck, ok: 'probe',
            text: `Probe ist unterwegs (${art === 'rueckschau' ? 'Rückschau' : 'Ankündigung'}) — `
                + 'sie steht in wenigen Sekunden im Kanal. Sie wird nicht veröffentlicht, '
                + 'räumt sich aber auch nicht selbst weg: Sie bleibt stehen, bis du sie löschst.'
        });
    } catch (error) {
        Logger.error('[Streaming] Probe fehlgeschlagen:', error);
        return antworteFehler(req, res, {
            zurueck, fehler: 'technisch',
            text: 'Das hat technisch nicht geklappt. Der Grund steht im Protokoll.'
        });
    }
});

// =====================================================
// Vorlagen
// =====================================================
/**
 * Der Chatbot-Bereich - nur in der Heim-Guild (Stufe 14).
 *
 * **Die Route prueft das Heim selbst.** Der Menuepunkt erscheint zwar nur hier,
 * aber ein Menuepunkt ist keine Sperre: Die Adresse laesst sich tippen, und in
 * einer Guild, die nicht Heim ist, stuenden dahinter fremde Kanaele.
 *
 * `STREAMING.CHAT.MANAGE` sagt dann, WER hier drankommt. Zwei Fragen, zwei
 * Pruefungen - die eine ersetzt die andere nicht.
 */
router.get('/chatbot', requirePermission('STREAMING.CHAT.MANAGE'), async (req, res) => {
    const guildId = res.locals.guildId;
    const tr = makeTranslator(req, res);
    const heimguild = require('../kern/heimguild');

    try {
        const kanaele = await heimguild.kanaeleDerGuild(guildId);

        // **Der Anschlusszustand je Kanal**, aus derselben Quelle wie "Mein
        // Kanal": Steht unser Bot dort als Moderator? Die Antwort ist
        // dreiwertig - wer nicht fragen konnte, meldet 'unbekannt', nie 'nein'.
        const meinkanal = require('../kern/meinkanal');
        for (const k of kanaele) {
            const zeilen = await meinkanal.modZeile({ kontoId: k.kanal_id });
            k.anschluss = zeilen[0] || null;
        }

        // **Die Chat-Leitung, aus gespeicherten Messwerten statt aus einem
        // Abruf beim Seitenaufbau.** Twitch nach jedem Klick zu fragen waere
        // langsam und wuerde am Kontingent zehren; der Bericht des letzten
        // Abgleichs sagt dasselbe und sagt dazu, wann er entstand.
        const bericht = await require('../kern/chatabos').letzterBericht();
        const leitung = require('../eingang/conduit').zustand();
        const jeKanal = new Map((bericht?.kanaele || []).map(k => [String(k.kanal_id), k]));
        const gezaehlt = new Map((leitung.chat || []).map(c => [String(c.kanal_id), c]));
        for (const k of kanaele) {
            k.abo = jeKanal.get(String(k.kanal_id)) || null;
            k.empfangen = gezaehlt.get(String(k.kanal_id)) || null;
        }

        // **Die Stimme (Stufe 13c): darf der Bot hier unter dem Namen des
        // Streamers schreiben, und was kam beim letzten Mal dabei heraus?**
        //
        // Beides gehoert zusammen auf die Karte: Der Schalter allein saehe
        // aus wie eine Zusicherung. Erst der letzte Ausgang sagt, ob die
        // Ansage wirklich im Chat stand - ein `is_sent: false` kommt sonst
        // nirgends an.
        const abonnenten = require('../kern/abonnenten');
        for (const k of kanaele) {
            const inhaber = await abonnenten.kanalInhaber(k);
            k.darf_schreiben = await meinkanal.darfSchreiben(inhaber);

            const letzte = await ServiceManager.get('dbService').query(`
                SELECT zustand, fehlertext, erledigt_am, faellig_ab
                  FROM streaming_outbox
                 WHERE aktion = 'chat_ansage'
                   AND JSON_EXTRACT(nutzlast, '$.streamer_id') = ?
                 ORDER BY id DESC LIMIT 1
            `, [k.id]);
            k.letzte_ansage = letzte[0] || null;
        }

        await renderView(res, 'guild/streaming-chatbot', {
            tr, guildId, kanaele, bericht, leitung,
            platzhalter: PLATZHALTER_CHAT, vorgabeAnsage: VORGABE_CHAT, chatMax: CHAT_MAX,
            zusageName: meinkanal.SCHREIB_ZUSAGE,
            vorWieLange,
            meldung: req.query.ok || null,
            fehler: req.query.fehler || null
        });
    } catch (error) {
        return renderFehler(res, error, 'Der Chatbot-Bereich konnte nicht geladen werden');
    }
});

/**
 * Den Chat-Anschluss jetzt abgleichen.
 *
 * **Warum es diesen Knopf gibt.** Der Mod-Status vergibt der Kanalinhaber mit
 * `/mod` bei Twitch - davon erfaehrt diese Anlage nichts. Ohne den Knopf
 * dauerte es bis zum naechsten Tageslauf, bis der Bot den Chat betritt, und
 * niemand koennte den Unterschied zwischen "dauert noch" und "geht nicht"
 * sehen.
 *
 * **Die Route prueft das Heim ein zweites Mal**, wie die Anzeige darueber:
 * Der Abgleich betrifft alle Kanaele der Anlage, nicht nur die dieser Guild -
 * er darf also nur von einem Ort ausgeloest werden, der ueberhaupt einer ist.
 */
router.post('/chatbot/abgleich', requirePermission('STREAMING.CHAT.MANAGE'), async (req, res) => {
    const guildId = res.locals.guildId;
    const zurueck = `/guild/${guildId}/plugins/streaming/chatbot`;

    try {
        if (!await require('../kern/heimguild').istHeim(guildId)) {
            return antworteFehler(req, res, {
                zurueck, fehler: 'kein_heim',
                text: 'Dieser Server ist fuer keinen Kanal das Heim.'
            });
        }

        const bericht = await require('../kern/chatabos').abgleichen();

        // **Der Abbruchgrund wird durchgereicht, nicht uebersetzt.** Er sagt
        // genau, woran es lag - "hat nicht geklappt" saehe bei einem fehlenden
        // Bot-Konto genauso aus wie bei einer klemmenden Twitch-Abfrage.
        if (bericht.abgebrochen) {
            return antworteFehler(req, res, {
                zurueck, fehler: 'abgebrochen', art: 'warning',
                text: `Nichts abgeglichen: ${bericht.abgebrochen}.`
            });
        }

        const teile = [];
        if (bericht.bestellt.length)   teile.push(`${bericht.bestellt.length} angeschlossen`);
        if (bericht.abbestellt.length) teile.push(`${bericht.abbestellt.length} abgemeldet`);
        if (bericht.fehler.length)     teile.push(`${bericht.fehler.length} abgelehnt`);

        return antworte(req, res, {
            zurueck, ok: 'abgeglichen',
            art: bericht.fehler.length ? 'warning' : 'success',
            text: teile.length
                ? `Abgeglichen: ${teile.join(', ')}.`
                : `Nichts zu tun — ${bericht.gewuenscht} Kanal(-Chats) stehen bereits.`
        });
    } catch (error) {
        ServiceManager.get('Logger').error('[Streaming] Chat-Abgleich von Hand fehlgeschlagen', error);
        return antworteFehler(req, res, {
            zurueck, fehler: 'technisch',
            text: 'Das hat technisch nicht geklappt. Der Grund steht im Protokoll.'
        });
    }
});

/**
 * Die Live-Ansage eines Kanals einstellen (Stufe 13c).
 *
 * **Ein Kanal je Absendung, nicht alle auf einmal.** Die Seite zeigt je Kanal
 * eine Karte, und jede Karte hat ihr eigenes Formular - sonst schriebe ein
 * Klick den Text eines fremden Streamers mit um.
 *
 * **Der Kanal muss zu DIESER Guild gehoeren.** `heim_guild_id` steht in der
 * Bedingung des UPDATE und wird nicht vorher geprueft: Zwischen Pruefung und
 * Schreiben laege sonst ein Spalt, und die Kennung aus dem Formular ist
 * ohnehin nichts, worauf man baut.
 */
router.post('/chatbot/ansage', requirePermission('STREAMING.CHAT.MANAGE'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const guildId = res.locals.guildId;
    const zurueck = `/guild/${guildId}/plugins/streaming/chatbot`;

    try {
        const streamerId = Number(req.body.streamer_id);
        if (!Number.isInteger(streamerId) || streamerId <= 0) {
            return antworteFehler(req, res, {
                zurueck, fehler: 'kanal', text: 'Zu diesem Kanal fehlt die Kennung.'
            });
        }

        const text = String(req.body.ansage_text || '').trim();
        const an   = req.body.ansage_an === 'on' || req.body.ansage_an === '1';

        // **Der Text wird geprueft, auch wenn der Schalter aus ist.** Sonst
        // liegt eine kaputte Vorlage still im Feld und faellt genau in dem
        // Augenblick auf, in dem jemand einschaltet - also beim ersten
        // echten Stream.
        const fehler = pruefeChatVorlage(text);
        if (fehler) {
            return antworteFehler(req, res, { zurueck, fehler, text: CHAT_FEHLER[fehler] });
        }

        const ergebnis = await ServiceManager.get('dbService').query(`
            UPDATE streaming_streamers
               SET chat_ansage_an = ?, chat_ansage_text = ?
             WHERE id = ? AND heim_guild_id = ?
        `, [an ? 1 : 0, text || null, streamerId, String(guildId)]);

        if (!ergebnis?.affectedRows) {
            // Kein Vorwurf, sondern der wahrscheinliche Fall: Der Kanalinhaber
            // hat sein Heim inzwischen woandershin gelegt. Ein "gespeichert"
            // waere hier die Luege, die niemand bemerkt.
            return antworteFehler(req, res, {
                zurueck, fehler: 'kein_heim',
                text: 'Dieser Kanal wird hier nicht (mehr) verwaltet. Es wurde nichts geaendert.'
            });
        }

        Logger.info(`[Streaming] Chat-Ansage fuer Kanal ${streamerId} in ${guildId}: ${an ? 'an' : 'aus'}`);
        return antworte(req, res, {
            zurueck, ok: 'gespeichert',
            text: an ? 'Die Live-Ansage ist eingeschaltet.' : 'Die Live-Ansage ist ausgeschaltet.'
        });
    } catch (error) {
        Logger.error('[Streaming] Chat-Ansage speichern fehlgeschlagen', error);
        return antworteFehler(req, res, {
            zurueck, fehler: 'technisch',
            text: 'Das hat technisch nicht geklappt. Der Grund steht im Protokoll.'
        });
    }
});

/**
 * Die Ansage einmal probeweise in den Chat schreiben (Stufe 13c).
 *
 * **Warum es diesen Knopf gibt.** Ohne ihn liesse sich die Ansage erst beim
 * naechsten echten Stream pruefen - und wenn dann etwas klemmt, ist der
 * Augenblick vorbei. Dieselbe Ueberlegung wie bei der Probeankuendigung aus
 * Stufe 6, deren Nebenfund am 2026-08-25 mehr wert war als der Knopf selbst.
 *
 * **Er geht denselben Weg wie der Ernstfall**, ueber die Outbox und dieselbe
 * Sendefunktion. Ein zweiter, kuerzerer Weg wuerde genau das pruefen, was im
 * Ernstfall nicht laeuft.
 *
 * ⚠ **Die Probe steht wirklich im Chat**, unter dem Namen des Streamers - es
 * gibt keinen stillen Testmodus bei Twitch. Deshalb verlangt sie denselben
 * eingeschalteten Schalter wie der Ernstfall: Wer die Ansage aus hat, hat
 * auch keine Probe bestellt.
 */
router.post('/chatbot/probe', requirePermission('STREAMING.CHAT.MANAGE'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const guildId = res.locals.guildId;
    const zurueck = `/guild/${guildId}/plugins/streaming/chatbot`;

    try {
        const streamerId = Number(req.body.streamer_id);
        if (!Number.isInteger(streamerId) || streamerId <= 0) {
            return antworteFehler(req, res, {
                zurueck, fehler: 'kanal', text: 'Zu diesem Kanal fehlt die Kennung.'
            });
        }

        const zeilen = await ServiceManager.get('dbService').query(
            'SELECT chat_ansage_an FROM streaming_streamers WHERE id = ? AND heim_guild_id = ?',
            [streamerId, String(guildId)]);

        if (!zeilen.length) {
            return antworteFehler(req, res, {
                zurueck, fehler: 'kein_heim',
                text: 'Dieser Kanal wird hier nicht (mehr) verwaltet.'
            });
        }
        if (!Number(zeilen[0].chat_ansage_an)) {
            return antworteFehler(req, res, {
                zurueck, fehler: 'aus', art: 'warning',
                text: 'Die Live-Ansage ist ausgeschaltet — es wurde nichts gesendet.'
            });
        }

        await ServiceManager.get('dbService').query(`
            INSERT INTO streaming_outbox (target_id, guild_id, aktion, nutzlast)
            VALUES (NULL, ?, 'chat_ansage', ?)
        `, [String(guildId), JSON.stringify({ streamer_id: streamerId, probe: true })]);

        Logger.info(`[Streaming] Chat-Probe fuer Kanal ${streamerId} vorgemerkt`);
        return antworte(req, res, {
            zurueck, ok: 'probe',
            text: 'Die Probe ist unterwegs. Steht sie nicht im Chat, sagt die Karte gleich warum.'
        });
    } catch (error) {
        Logger.error('[Streaming] Chat-Probe fehlgeschlagen', error);
        return antworteFehler(req, res, {
            zurueck, fehler: 'technisch',
            text: 'Das hat technisch nicht geklappt. Der Grund steht im Protokoll.'
        });
    }
});

// **`/vorlagen` bleibt erreichbar.** Die Seite ist am 2026-08-29 in die
// Ankuendigung gefaltet worden - der Text gehoert zu der Sache, deren Text er
// ist. Die Adresse steht aber in Lesezeichen und in jeder Rueckmeldung, die
// vor heute verschickt wurde; ein 404 dort waere kein sauberer Schnitt.
router.get('/vorlagen', requirePermission('STREAMING.VIEW'), (req, res) => {
    res.redirect(`/guild/${res.locals.guildId}/plugins/streaming/ankuendigung`);
});

router.post('/vorlagen', requirePermission('STREAMING.TEMPLATES.EDIT'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const guildId = res.locals.guildId;
    const zurueck = `/guild/${guildId}/plugins/streaming/ankuendigung`;

    try {
        const live  = String(req.body.vorlage_live || '').trim();
        const rueck = String(req.body.vorlage_rueckschau || '').trim();

        const zuLang = pruefeVorlage(live) || pruefeVorlage(rueck);
        if (zuLang) return res.redirect(`${zurueck}?fehler=${zuLang}`);

        await modelle.vorlagenSetzen(guildId, live, rueck);
        Logger.info(`[Streaming] Standardvorlagen der Guild ${guildId} gesetzt`);
        return res.redirect(`${zurueck}?ok=gespeichert`);
    } catch (error) {
        Logger.error('[Streaming] Vorlagen speichern fehlgeschlagen:', error);
        return res.redirect(`${zurueck}?fehler=technisch`);
    }
});

// Die Abweichung eines einzelnen Ziels
router.post('/vorlagen/:id', requirePermission('STREAMING.TEMPLATES.EDIT'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const guildId = res.locals.guildId;
    const zurueck = `/guild/${guildId}/plugins/streaming/ankuendigung`;

    try {
        const zielId = Number(req.params.id);
        if (!Number.isInteger(zielId)) return res.redirect(`${zurueck}?fehler=technisch`);

        const vorlage = String(req.body.vorlage || '').trim();
        const zuLang = pruefeVorlage(vorlage);
        if (zuLang) return res.redirect(`${zurueck}?fehler=${zuLang}`);

        const geaendert = await modelle.zielVorlageSetzen(guildId, zielId, vorlage);
        if (!geaendert && !(await modelle.zielLesen(guildId, zielId))) {
            return res.redirect(`${zurueck}?fehler=weg`);
        }

        Logger.info(`[Streaming] Vorlage von Ziel ${zielId} ${vorlage ? 'gesetzt' : 'zurueckgesetzt'}`);
        return res.redirect(`${zurueck}?ok=${vorlage ? 'gespeichert' : 'zurueckgesetzt'}`);
    } catch (error) {
        Logger.error('[Streaming] Zielvorlage speichern fehlgeschlagen:', error);
        return res.redirect(`${zurueck}?fehler=technisch`);
    }
});

// =====================================================
// Zustand
// =====================================================
router.get('/zustand', requirePermission('STREAMING.VIEW'), async (req, res) => {
    const guildId = res.locals.guildId;
    const tr = makeTranslator(req, res);

    try {
        const bild = await zustandsBild(guildId, tr);

        await renderView(res, 'guild/streaming-zustand', {
            tr, guildId,
            zustand: bild.zustand,
            streamer: bild.streamer,
            ampel: bild.ampel,
            probleme: bild.probleme,
            vorWieLange
        });
    } catch (error) {
        return renderFehler(res, error, 'Der Zustand konnte nicht geladen werden');
    }
});

/**
 * Der Zustand als Zahlen - fuer die offene Seite.
 *
 * **Warum eine eigene Route und nicht die Daten im Signal?** Weil hier
 * `requirePermission` steht. Ein Signal traegt nur "es hat sich etwas
 * geaendert"; abgeholt wird ueber denselben Rechteweg wie jeder andere
 * Zugriff. Haette der Strom die Daten selbst mitgeschickt, gaebe es eine
 * zweite Stelle, an der man die Pruefung vergessen kann - und der Fehler kaeme
 * als fremde Zahlen im falschen Browser heraus, nicht als Fehlermeldung.
 */
router.get('/zustand/daten', requirePermission('STREAMING.VIEW'), async (req, res) => {
    const guildId = res.locals.guildId;
    const tr = makeTranslator(req, res);

    try {
        const bild = await zustandsBild(guildId, tr);

        return res.json({
            success: true,
            ampel: bild.ampel,
            ampelText: bild.ampelText,
            ueberwacht: bild.zustand.ueberwacht,
            live: bild.zustand.live,
            letzteMeldung: vorWieLange(bild.zustand.letzteMeldungAm) || tr('streaming:STATE.NEVER'),
            streamer: bild.streamer.map(s => ({
                id: s.id,
                zustand: (s.abo_zustand === 'widerrufen' || s.abo_zustand === 'fehler')
                    ? 'abo_kaputt'
                    : (s.ist_live ? 'live' : 'offline'),
                aboZustand: s.abo_zustand || null,
                letztGehoert: vorWieLange(s.letzte_meldung_am) || tr('streaming:STATE.NEVER')
            })),
            probleme: bild.probleme,
            stand: Date.now()
        });
    } catch (error) {
        ServiceManager.get('Logger').error('[Streaming] Zustandsdaten fehlgeschlagen:', error);
        return res.status(500).json({ success: false });
    }
});

/**
 * Der Strom: haelt die Zustandsseite offen und stupst sie an.
 *
 * Bis zum 2026-08-25 war die Seite **einmal gezeichnet und dann tot** - kein
 * Poll, kein Nachschub. Sie zeigte "offline" mit derselben Bestimmtheit, ob
 * die Angabe zwei Sekunden oder zwei Stunden alt war.
 *
 * Der `SSEManager` ist vorhanden (`apps/dashboard/helpers/SSEManager.js`) und
 * wird von `masterserver` bereits benutzt - hier wird angedockt, nicht neu
 * gebaut.
 */
router.get('/zustand/strom', requirePermission('STREAMING.VIEW'), (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const sseManager = ServiceManager.get('sseManager');
    const guildId = res.locals.guildId;

    // Ohne Dienst keine Verbindung - aber mit klarer Ansage. Ein stiller
    // Fehlschlag hiesse: die Seite haelt sich fuer aktuell und ist es nie.
    if (!sseManager) {
        return res.status(503).json({ success: false, message: 'Strom nicht verfuegbar' });
    }

    try {
        const nutzerId = res.locals.user?.id || req.session?.user?.info?.id || 'anonymous';
        sseManager.addClient(guildId, `streaming-${nutzerId}-${Date.now()}`, res, {
            metadata: { userId: nutzerId, source: 'streaming' }
        });
    } catch (error) {
        Logger.error('[Streaming] Strom-Anmeldung fehlgeschlagen:', error);
        if (!res.headersSent) res.status(500).json({ success: false });
    }
});

/**
 * Alles, was die Zustandsseite zeigt - an **einer** Stelle gerechnet.
 *
 * Seite und Strom holen hier dasselbe. Waeren es zwei Rechnungen, liefen sie
 * auseinander: Die frisch geladene Seite zeigte das eine, der Nachschub
 * daraufhin das andere, und niemand wuesste, welches stimmt.
 *
 * @param {string} guildId Guild
 * @param {Function} tr Uebersetzer
 * @returns {Promise<Object>} Zustand, Streamer, Ampel, Probleme
 */
async function zustandsBild(guildId, tr) {
    const [zustand, streamer] = await Promise.all([
        modelle.zustandDerGuild(guildId),
        modelle.streamerDerGuild(guildId)
    ]);

    const ampel = ampelFarbe(zustand);

    return {
        zustand, streamer, ampel,
        ampelText: ampel === 'rot' ? tr('streaming:STATE.BROKEN')
            : (ampel === 'gelb' ? tr('streaming:STATE.DELAYED') : tr('streaming:STATE.OK')),
        probleme: problemListe(zustand)
    };
}

/**
 * Was klemmt - als Liste aus Text und Abhilfe, nicht als HTML.
 *
 * Die Ansicht baut daraus ihre Eintraege, der Strom schickt dieselbe Form. So
 * kennt die Browserseite **kein** Markup, das hier nochmal steht - der
 * Doppelbau, den man sonst beim naechsten Umbau an einer der beiden Stellen
 * vergisst.
 *
 * @param {Object} z Zustandszahlen
 * @returns {Array<{text: string, abhilfe: string}>} Probleme
 */
function problemListe(z) {
    const liste = (z.kaputteAbos || []).map(a => ({
        text: `${a.login}: Abo ${a.zustand}` + (a.fehlertext ? ` — ${a.fehlertext}` : ''),
        abhilfe: 'Kanal einmal entfernen und neu eintragen.'
    }));

    if (z.gescheitert > 0) {
        liste.push({
            text: `${z.gescheitert} Auftrag/Aufträge aufgegeben`,
            abhilfe: 'Rechte des Bots im Zielkanal prüfen.'
        });
    }

    return liste;
}

/**
 * Die Ampel wird gerechnet, nicht gesetzt.
 *
 * Bewusst eine reine Funktion ohne Datenbank: So laesst sich jeder Fall
 * durchspielen, ohne eine Anlage zu betreiben - `scripts/check-streaming-*`
 * setzt hier an.
 *
 * @param {Object} z Zustandszahlen
 * @returns {string} 'gruen' | 'gelb' | 'rot'
 */
function ampelFarbe(z) {
    if (z.kaputteAbos?.length > 0 || z.gescheitert > 0) return 'rot';
    if (z.offeneAuftraege > 0) return 'gelb';
    return 'gruen';
}

// =====================================================
// Betrieb - nur fuer den Betreiber
// =====================================================
router.get('/betrieb', CheckAdmin, async (req, res) => {
    const tr = makeTranslator(req, res);
    const guildId = res.locals.guildId;

    try {
        const abgleich = require('../kern/abgleich');
        const aufraeumen = require('../kern/aufraeumen');

        const [daten, abgleichBericht, aufraeumBericht, alleStreamer] = await Promise.all([
            modelle.zugangsdaten('TWITCH'),
            abgleich.letzterBericht(),
            aufraeumen.letzterBericht(),
            modelle.alleStreamer()
        ]);
        const verzug = await modelle.verzugStatistik();

        await renderView(res, 'guild/streaming-betrieb', {
            tr, guildId,
            clientId: daten.clientId || '',
            secretQuelle: daten.quelle,
            abgleichBericht, aufraeumBericht, alleStreamer, verzug,
            vorWieLange,
            gespeichert: req.query.ok === '1',
            meldung: req.query.ok || null,
            fehler: req.query.fehler || null
        });
    } catch (error) {
        return renderFehler(res, error, 'Die Betriebsseite konnte nicht geladen werden');
    }
});

// Abgleich von Hand ausloesen
//
// Der Lauf laeuft ohnehin taeglich. Von Hand braucht man ihn nach einem
// Ausfall - und genau dann will man nicht bis morgen warten.
router.post('/betrieb/abgleich', CheckAdmin, async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const guildId = res.locals.guildId;
    const zurueck = `/guild/${guildId}/plugins/streaming/betrieb`;

    try {
        // `trocken` zeigt nur, was geschehen wuerde. Beim ersten Mal nach
        // einem Ausfall ist das die richtige Reihenfolge: erst sehen, dann
        // handeln.
        const trocken = Boolean(req.body.trocken);
        const bericht = await require('../kern/abgleich').lauf({ trocken });

        Logger.info(`[Streaming] Abgleich von Hand ausgeloest (${trocken ? 'Probelauf' : 'scharf'})`);
        return res.redirect(`${zurueck}?ok=${bericht.abgebrochen ? 'abgleich_abbruch' : (trocken ? 'abgleich_probe' : 'abgleich')}`);
    } catch (error) {
        Logger.error('[Streaming] Abgleich fehlgeschlagen:', error);
        return res.redirect(`${zurueck}?fehler=technisch`);
    }
});

// Einen Kanal ueberall entfernen
//
// Das ist NICHT dasselbe wie das Entfernen in einer Guild: Hier verschwindet
// der Kanal aus **allen** Guilds, die Abos werden abbestellt und die
// Nachrichten-Verweise fallen mit. Grundlage ist die Loeschpflicht aus dem
// Twitch-Developer-Agreement (FRAGEN.md, F-11).
//
// **Was hier bewusst NOCH fehlt:** eine Sperre, die ein erneutes Eintragen
// verhindert. Die gehoert in den Admin-Bereich und nicht in dieses Plugin
// (Entscheidung des Betreibers am 2026-08-24, ab Stufe 8). Bis dahin kann eine
// Guild denselben Kanal morgen wieder eintragen - das sagt die Seite auch.
router.post('/betrieb/streamer/:id/ueberall-entfernen', CheckAdmin, async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const guildId = res.locals.guildId;
    const zurueck = `/guild/${guildId}/plugins/streaming/betrieb`;

    try {
        const streamerId = Number(req.params.id);
        if (!Number.isInteger(streamerId)) return res.redirect(`${zurueck}?fehler=technisch`);

        const zeilen = await ServiceManager.get('dbService').query(
            'SELECT login FROM streaming_streamers WHERE id = ?', [streamerId]);
        if (!zeilen.length) return res.redirect(`${zurueck}?fehler=weg`);

        // Reihenfolge: erst die Ziele weg, DANN aufraeumen. `abosAufraeumen`
        // zaehlt die verbliebenen Ziele - solange noch eines steht, behaelt es
        // das Abo und die Loeschung waere unvollstaendig.
        await ServiceManager.get('dbService').query(
            'DELETE FROM streaming_targets WHERE streamer_id = ?', [streamerId]);
        const ergebnis = await abos.abosAufraeumen(streamerId);

        Logger.warn(`[Streaming] "${zeilen[0].login}" ueberall entfernt (${ergebnis.abbestellt} Abo(s) abbestellt)`);
        return res.redirect(`${zurueck}?ok=ueberall`);
    } catch (error) {
        Logger.error('[Streaming] Ueberall entfernen fehlgeschlagen:', error);
        return res.redirect(`${zurueck}?fehler=technisch`);
    }
});

router.post('/betrieb/zugangsdaten', CheckAdmin, async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const guildId = res.locals.guildId;

    try {
        const clientId = String(req.body.client_id || '').trim();
        // Ein leeres Feld heisst "nicht anfassen", nicht "loeschen" - sonst
        // raeumt ein Speichern der Client-ID nebenbei das Geheimnis weg.
        const secret = String(req.body.client_secret || '').trim() || null;

        if (!clientId) {
            return res.redirect(`/guild/${guildId}/plugins/streaming/betrieb?fehler=id`);
        }

        await modelle.zugangsdatenSetzen('TWITCH', clientId, secret);
        Logger.info(`[Streaming] Twitch-Zugangsdaten gesetzt (Secret ${secret ? 'neu' : 'unveraendert'})`);

        return res.redirect(`/guild/${guildId}/plugins/streaming/betrieb?ok=1`);
    } catch (error) {
        return renderFehler(res, error, 'Die Zugangsdaten konnten nicht gespeichert werden');
    }
});

module.exports = router;
