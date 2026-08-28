'use strict';

/**
 * Konten, die **der Anlage** gehoeren — nicht einem Benutzer (Stufe 13a).
 *
 * ## Warum unter `/admin` und nicht im Profil
 *
 * Hausregel *„Pflichten in den Kern"*: Was fuer den ganzen Betrieb gilt,
 * gehoert in den Kern und unter `/admin` — nie in ein Plugin und nie an das
 * Profil eines Menschen.
 *
 * Der Chatbot braucht ein eigenes Twitch-Konto, das unserer Anwendung einmal
 * zustimmt. Twitch dazu woertlich: *„only needed to be performed once and kept
 * alive through refreshing the access token."*
 *
 * **Es waere falsch, das ueber ein Benutzerprofil zu machen**, und zwar aus
 * drei getrennten Gruenden:
 *
 *   1. Der Nachweis in `user_connections` sagt *„diesem Discord-Benutzer
 *      gehoert dieses Konto"*. Fuer ein Dienstkonto ist das schlicht nicht
 *      wahr.
 *   2. `uniq_benutzer_plattform (user_id, plattform)` laesst es gar nicht zu —
 *      der Betreiber hat dort sein eigenes Twitch-Konto liegen.
 *   3. `user_connection_grants` haengt per `ON DELETE CASCADE` an dieser
 *      Verknuepfung. Loest der Mensch sie — sein gutes Recht —, waere der
 *      Chatbot in **allen** Kanaelen tot.
 *
 * ## Was diese Seite NICHT tut
 *
 * Sie macht den Bot nirgends zum Moderator. Das kann nur der Kanalinhaber, in
 * seinem Chat, mit `/mod`. Twitch verlangt fuer Lesen und Schreiben *„either
 * `channel:bot` scope from broadcaster **or moderator status**"* — beides
 * liegt beim Streamer, nicht bei uns. Die Seite sagt das, statt es zu
 * verschweigen.
 *
 * @module dashboard/routes/admin/anlagenkonten
 */

const express = require('express');
const router = express.Router();

const { ServiceManager } = require('dunebot-core');
const { VerbindungsRegistry } = require('dunebot-sdk');
const Verbindungsspeicher = require('../../helpers/Verbindungsspeicher');

/** Zwecke, die diese Seite verwaltet. Heute genau einer. */
const ZWECKE = [
    {
        zweck: 'chatbot',
        titel: 'Chat-Bot-Konto',
        erklaerung: 'Das Twitch-Konto, unter dem der Bot in fremden Chats mitliest und schreibt. '
                  + 'Es stimmt genau einmal zu; danach hält der Kern den Schlüssel am Leben.'
    }
];

/**
 * Der Stand je Plattform und Zweck.
 *
 * @returns {Promise<Array<Object>>} Zeilen fuer die Ansicht
 */
async function stand() {
    const zeilen = [];

    for (const anbieter of VerbindungsRegistry.list()) {
        for (const z of ZWECKE) {
            // Nur anbieten, was der Anbieter auch kennt. Ein Zweck ohne
            // passende Zusage waere ein Knopf, der nichts tun kann — genau der
            // Fehler vom 2026-08-26.
            const scopes = VerbindungsRegistry.scopesVon(anbieter.name, z.zweck);
            if (!scopes || !scopes.length) continue;

            let zusage = null;
            try {
                zusage = await Verbindungsspeicher.betreiberZusageLesen(anbieter.name, z.zweck);
            } catch (err) {
                ServiceManager.get('Logger').warn(
                    `[Anlagenkonten] ${anbieter.name}/${z.zweck} nicht lesbar: ${err.message}`);
            }

            const erteilt = zusage ? String(zusage.scopes || '').split(' ').filter(Boolean) : [];

            // **Hat hier das falsche Konto zugestimmt?**
            //
            // Gemessen am 2026-08-28: Der Betreiber klickte "Bot-Konto
            // zulassen", war im Browser aber noch als er selbst bei Twitch
            // angemeldet — und Twitch nahm die Zustimmung von DIESEM Konto.
            // Der Eintrag sah danach tadellos aus: Scopes vollstaendig, kein
            // Fehler, gruener Haken. Nur haette der Bot unter dem Namen des
            // Betreibers geschrieben.
            //
            // Erkennbar ist es daran, dass dasselbe Konto in
            // `user_connections` als Verknuepfung eines Menschen steht. Das
            // ist kein Beweis fuer einen Irrtum — jemand kann sein eigenes
            // Konto bewusst als Bot einsetzen —, aber es ist der einzige
            // Hinweis, den wir haben, und er ist stark genug fuer eine
            // deutliche Warnung.
            let auchBenutzerkonto = null;
            if (zusage?.konto_id) {
                try {
                    const zeilen = await ServiceManager.get('dbService').query(
                        'SELECT user_id FROM user_connections WHERE plattform = ? AND konto_id = ? LIMIT 1',
                        [anbieter.name, String(zusage.konto_id)]);
                    auchBenutzerkonto = zeilen[0] ? String(zeilen[0].user_id) : null;
                } catch (err) {
                    ServiceManager.get('Logger').warn(
                        `[Anlagenkonten] Abgleich mit user_connections fehlgeschlagen: ${err.message}`);
                }
            }

            zeilen.push({
                plattform: anbieter.name,
                label: anbieter.label,
                symbol: anbieter.symbol,
                farbe: anbieter.farbe,
                ...z,
                noetig: scopes,
                // **Vollstaendig heisst: JEDER noetige Scope liegt vor.** Eine
                // Teilmenge ist kein "fast fertig", sondern ein Bot, der lesen
                // aber nicht reden kann — und das faellt erst im Betrieb auf.
                vollstaendig: Boolean(zusage) && scopes.every(sc => erteilt.includes(sc)),
                erteilt,
                fehlend: scopes.filter(sc => !erteilt.includes(sc)),
                kontoName: zusage ? (zusage.konto_name || zusage.konto_id) : null,
                geprueft: zusage ? zusage.geprueft_am : null,
                fehler: zusage ? zusage.fehlertext : null,
                auchBenutzerkonto
            });
        }
    }

    return zeilen;
}

router.get('/', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const themeManager = ServiceManager.get('themeManager');
    try {
        // **Ueber den themeManager, nicht `res.render`.** Der Admin-Bereich
        // legt darueber sein Geruest, setzt `activeMenu` und findet die Ansicht
        // im aktiven Theme. Ein direktes `res.render` liefert die Seite ohne
        // alles drumherum aus — sie sieht dann aus wie ein Fehler.
        return await themeManager.renderView(res, 'admin/anlagenkonten', {
            title: 'Konten der Anlage',
            activeMenu: '/admin/anlagenkonten',
            titel: 'Konten der Anlage',
            konten: await stand(),
            meldung: req.query.ok || null,
            fehler: req.query.fehler || null
        });
    } catch (error) {
        Logger.error('[Anlagenkonten] Seite nicht ladbar:', error);
        return res.status(500).render('error', {
            message: 'Die Seite konnte nicht geladen werden',
            error: { status: 500, message: error.message }
        });
    }
});

/**
 * Zurueckziehen.
 *
 * **Kein `confirm()` in der Ansicht allein.** Das hier schaltet den Chatbot in
 * jedem Kanal ab; die Folge steht deshalb auch in der Protokollzeile
 * (`betreiberWiderrufen`), nicht nur im Browser.
 */
router.post('/:plattform/:zweck/zuruecknehmen', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const plattform = String(req.params.plattform || '');
    const zweck = String(req.params.zweck || '');

    if (!VerbindungsRegistry.NAME_MUSTER.test(plattform) || !VerbindungsRegistry.NAME_MUSTER.test(zweck)) {
        return res.redirect('/admin/anlagenkonten?fehler=unbekannt');
    }

    try {
        await Verbindungsspeicher.betreiberWiderrufen(plattform, zweck);
        return res.redirect('/admin/anlagenkonten?ok=zurueckgenommen');
    } catch (error) {
        Logger.error(`[Anlagenkonten] Zuruecknehmen ${plattform}/${zweck} fehlgeschlagen:`, error);
        return res.redirect('/admin/anlagenkonten?fehler=technisch');
    }
});

module.exports = router;
module.exports.stand = stand;
module.exports.ZWECKE = ZWECKE;
