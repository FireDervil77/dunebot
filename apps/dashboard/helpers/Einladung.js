'use strict';

const crypto = require('crypto');
const { ServiceManager } = require('dunebot-core');

/**
 * Der Einladungslink — und der Weg zurueck.
 *
 * Bis zum 2026-09-16 stand derselbe Link dreimal im Code (auth.controller an
 * zwei Stellen, auth.middleware an einer) und hatte **keine Rücksprungadresse**:
 * Wer den Bot eingeladen hatte, blieb bei Discord stehen. Das Dashboard erfuhr
 * vom Beitritt nur, weil der alte Tab nebenher abfragte.
 *
 * Hier steht der Link jetzt einmal. Neu daran sind drei Parameter:
 *
 *   response_type=code   Discord schickt den Browser nach der Einladung zurueck
 *   redirect_uri         dieselbe Adresse wie bei der Anmeldung — sie ist im
 *                        Entwicklerportal bereits eingetragen, dort ist nichts
 *                        zu tun
 *   state                „einladung:<Zufallswert>", der Wert liegt in der
 *                        Sitzung
 *
 * **Der `state` ist die Sicherung.** Ohne ihn koennte jemand einen Rücksprung
 * mit fremder `guild_id` unterschieben und damit unsere Willkommensseite fuer
 * einen Server oeffnen, mit dem er nichts zu tun hat. Der Wert steht nur in
 * der Sitzung desselben Browsers und gilt einmal.
 *
 * Den Code aus dem Rücksprung loesen wir **nicht** ein. Er gehoert zu den
 * Bot-Scopes und traegt keine Benutzerdaten; gebraucht wird allein die
 * `guild_id`, die Discord danebenstellt.
 *
 * Geprueft von `scripts/check-willkommen.js`.
 */

/**
 * Die Rechte, die der Bot beim Einladen anfragt. Unveraendert uebernommen aus
 * den drei alten Fundstellen — wer sie aendert, aendert sie hier fuer alle.
 */
const RECHTE = '1374891929078';

/** Die Scopes des Einladungslinks (nicht die der Anmeldung). */
const SCOPE = 'bot applications.commands';

/** Erkennungszeichen im `state`. */
const MARKIERUNG = 'einladung';

/** Wie lange ein begonnener Einladungsvorgang gilt. */
const FRIST_MS = 30 * 60 * 1000;

/**
 * Einen Dienst holen, ohne daran zu scheitern.
 *
 * `ServiceManager.get()` **wirft**, wenn der Name nicht registriert ist. Im
 * laufenden Dashboard ist der Logger immer da — aber ein Wurf aus dem Bau eines
 * Einladungslinks risse die ganze Serverauswahl mit. Fuer eine Protokollzeile
 * ist das ein zu hoher Einsatz.
 *
 * @param {string} name
 * @returns {*|null}
 */
function dienst(name) {
    try {
        return ServiceManager.get(name);
    } catch {
        return null;
    }
}

/**
 * Baut den Einladungslink und merkt sich den Vorgang in der Sitzung.
 *
 * Ohne `DISCORD_REDIRECT_URI` gibt es den Link wie frueher, also ohne
 * Rücksprung — und eine Zeile im Log. Lieber eine Einladung ohne
 * Willkommensseite als gar keine Einladung.
 *
 * @param {Object} req - Express Request (braucht `req.session`)
 * @param {string} guildId
 * @returns {string} Der vollstaendige Einladungslink
 */
function baueEinladungsUrl(req, guildId) {
    const Logger = dienst('Logger');

    const parameter = new URLSearchParams({
        client_id: process.env.CLIENT_ID || '',
        scope: SCOPE,
        permissions: RECHTE,
        guild_id: String(guildId || ''),
    });

    const ruecksprung = process.env.DISCORD_REDIRECT_URI;

    if (!ruecksprung) {
        Logger?.warn(
            '[Einladung] DISCORD_REDIRECT_URI ist nicht gesetzt — der Einladungslink ' +
            'fuehrt nicht zur Willkommensseite zurueck.'
        );
    } else if (!req?.session) {
        Logger?.warn(
            '[Einladung] Keine Sitzung vorhanden — Einladungslink ohne Rücksprung, ' +
            'weil sich der Vorgang sonst nicht wiedererkennen laesst.'
        );
    } else {
        // **Ein Kennzeichen je Sitzung, nicht je Link.** Die Serverauswahl baut
        // diesen Link in einer Schleife ueber alle Guilds ohne Bot. Ein neues
        // Kennzeichen je Runde ueberschriebe das der vorigen — nur der letzte
        // Link der Seite waere gueltig gewesen, alle anderen haetten beim
        // Ruecksprung `kennzeichen_falsch` ergeben.
        //
        // Aus welcher Guild der Vorgang losging, merken wir uns bewusst NICHT:
        // Bei einem gemeinsamen Kennzeichen waere der Wert bloss der der
        // letzten Schleifenrunde. Welche Guild es wurde, sagt allein Discord.
        const vorhanden = req.session.einladung;
        const frisch = vorhanden?.kennzeichen && (Date.now() - (vorhanden.zeit || 0) < FRIST_MS);
        const kennzeichen = frisch ? vorhanden.kennzeichen : crypto.randomBytes(16).toString('hex');

        req.session.einladung = { kennzeichen, zeit: Date.now() };

        parameter.set('response_type', 'code');
        parameter.set('redirect_uri', ruecksprung);
        parameter.set('state', `${MARKIERUNG}:${kennzeichen}`);
    }

    return `https://discord.com/api/oauth2/authorize?${parameter.toString()}`;
}

/**
 * Prueft, ob der aufgerufene Callback der Rücksprung aus einer Einladung ist.
 *
 * @param {Object} req - Express Request
 * @returns {{istEinladung: boolean, gueltig: boolean, guildId: string|null, grund: string}|null}
 *          `null`, wenn es sich um einen gewoehnlichen Anmelde-Callback handelt
 */
function ruecksprungPruefen(req) {
    const state = String(req?.query?.state || '');
    if (!state.startsWith(`${MARKIERUNG}:`)) return null;

    const antwort = (gueltig, grund, guildId = null) => {
        if (req?.session?.einladung) delete req.session.einladung;
        return { istEinladung: true, gueltig, guildId, grund };
    };

    const kennzeichen = state.slice(MARKIERUNG.length + 1);
    const vorgang = req?.session?.einladung;

    if (!vorgang?.kennzeichen) return antwort(false, 'kein_vorgang');
    if (!gleich(vorgang.kennzeichen, kennzeichen)) return antwort(false, 'kennzeichen_falsch');
    if (Date.now() - (vorgang.zeit || 0) > FRIST_MS) return antwort(false, 'abgelaufen');

    // Welche Guild es wurde, sagt **allein Discord**. Der Einladende darf im
    // Dialog einen anderen Server gewaehlt haben als den, aus dem er losgegangen
    // ist; und das Kennzeichen gilt fuer alle Links der Serverauswahl zugleich,
    // taugt also nicht als Herkunftsangabe. Ohne `guild_id` gibt es keine Seite.
    const guildId = String(req?.query?.guild_id || '');
    if (!/^\d{17,20}$/.test(guildId)) return antwort(false, 'ohne_guild');

    if (req?.query?.error) return antwort(false, `abgebrochen:${req.query.error}`, guildId);

    return antwort(true, 'ok', guildId);
}

/**
 * Vergleicht zwei Zeichenketten in fester Zeit.
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function gleich(a, b) {
    const linkes = Buffer.from(String(a));
    const rechtes = Buffer.from(String(b));
    if (linkes.length !== rechtes.length) return false;
    return crypto.timingSafeEqual(linkes, rechtes);
}

/**
 * Wartet, bis der Bot die neue Guild eingetragen hat.
 *
 * **Das ist ein echtes Wettrennen, kein Schoenheitsfehler.** Discord schickt
 * den Browser zurueck, waehrend der Bot sein `guildCreate` noch abarbeitet.
 * Wer zu frueh auf `/guild/<id>/willkommen` landet, laeuft in `CheckGuildAccess`
 * — und das schickt eine unbekannte Guild-ID zurueck zur Einladung. Der
 * Einladende wuerde also den Einladungsdialog ein zweites Mal sehen.
 *
 * Deshalb hier kurz warten statt hoffen. Kommt die Zeile nicht, gibt es `false`
 * und der Aufrufer schickt zur Serverauswahl — nicht noch einmal zu Discord.
 *
 * @param {string} guildId
 * @param {number} [maxMs=8000]
 * @param {number} [taktMs=400]
 * @returns {Promise<boolean>}
 */
async function warteAufGuild(guildId, maxMs = 8000, taktMs = 400) {
    const Logger = dienst('Logger');
    const dbService = dienst('dbService');
    const bis = Date.now() + maxMs;

    if (!dbService) {
        Logger?.error('[Einladung] Kein dbService — kann nicht auf die Guild warten.');
        return false;
    }

    while (Date.now() < bis) {
        try {
            const [zeile] = await dbService.query(
                "SELECT _id FROM guilds WHERE _id = ? AND left_at IS NULL",
                [guildId]
            );
            if (zeile) return true;
        } catch (err) {
            Logger?.error('[Einladung] Warten auf die Guild fehlgeschlagen:', err);
            return false;
        }
        await new Promise((fertig) => setTimeout(fertig, taktMs));
    }

    Logger?.warn(
        `[Einladung] Guild ${guildId} war nach ${maxMs} ms nicht in der Datenbank — ` +
        `lief der Bot beim Einladen?`
    );
    return false;
}

module.exports = { baueEinladungsUrl, ruecksprungPruefen, warteAufGuild, RECHTE, MARKIERUNG, FRIST_MS };
