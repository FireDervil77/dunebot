/**
 * Kontoverknuepfungen: Discord-Benutzer <-> Konto einer Plattform.
 * Routen: /verbindungen/:plattform/{start,rueckruf,loesen}
 *
 * **Warum auf oberster Ebene und nicht unter der Guild:** Die Rueckrufadresse
 * muss beim Anbieter (Twitch, Kick, Google) fest hinterlegt werden. Eine
 * Adresse mit `:guildId` darin waere je Guild eine andere - man muesste
 * jede einzeln eintragen. Deshalb steht der Weg hier, und wohin es danach
 * zurueckgeht, merkt sich der `state`.
 *
 * **Die Seite dagegen liegt im Profil** (`/guild/:guildId/profile/verbindungen`),
 * denn dorthin gehoert sie: Es ist eine Angelegenheit des Benutzers, nicht
 * der Serverleitung.
 *
 * **Hier wird kein Zugangsschluessel abgelegt.** Der Rueckruf stellt fest, WER
 * jemand auf der Plattform ist; gespeichert wird nur dieser Nachweis
 * (`user_connections`). Am 2026-08-26 wurde genau das Gegenteil aus
 * `users.tokens` entfernt (Baustelle 74) - es hier neu einzufuehren waere
 * absurd.
 *
 * @author FireDervil
 */

const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { ServiceManager } = require('dunebot-core');
const { VerbindungsRegistry } = require('dunebot-sdk');
const { CheckAuth } = require('../middlewares/auth.middleware');

/**
 * Wie lange ein begonnener Vorgang gilt. Grosszuegig, weil das Anmelden bei
 * der Plattform dazwischenliegt — aber endlich.
 */
const HOECHSTALTER_MS = 15 * 60 * 1000;

/** Basisadresse, unter der uns der Anbieter zurueckruft. */
function basis() {
    return String(process.env.DASHBOARD_BASE_URL || '').replace(/\/+$/, '');
}

/**
 * Die Rueckrufadresse einer Plattform - **genau so** muss sie beim Anbieter
 * eingetragen sein, Zeichen fuer Zeichen.
 *
 * @param {string} plattform Kuerzel
 * @returns {string} Adresse
 */
function rueckrufUrl(plattform) {
    return `${basis()}/verbindungen/${plattform}/rueckruf`;
}

/**
 * Wohin es nach dem Verknuepfen zurueckgeht.
 *
 * **Nur eigene Pfade.** Ein Ziel aus der Adresszeile ungeprueft zu uebernehmen
 * waere eine offene Weiterleitung: Ein Link, der bei uns beginnt und woanders
 * endet, ist genau das, womit Phishing arbeitet.
 *
 * @param {string} wert Vorschlag aus der Anfrage
 * @returns {string|null} sicherer Pfad oder null
 */
function sicheresZiel(wert) {
    const z = String(wert || '');
    if (!z.startsWith('/') || z.startsWith('//')) return null;
    return z;
}

// =====================================================
// Hinschicken
// =====================================================
router.get('/:plattform/start', CheckAuth, async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');

    const name = String(req.params.plattform || '');
    const anbieter = VerbindungsRegistry.NAME_MUSTER.test(name)
        ? VerbindungsRegistry.get(name) : null;

    const zurueck = sicheresZiel(req.query.zurueck) || '/guild';
    if (!anbieter) return res.redirect(`${zurueck}?fehler=unbekannt`);

    // **Ohne Basisadresse waere die Rueckrufadresse relativ** ("/verbindungen/
    // …/rueckruf"). Der Anbieter lehnt sie ab, und zwar mit einer Meldung auf
    // SEINER Seite — bei uns sieht es aus, als sei nichts passiert. Lieber
    // hier laut scheitern als dort stumm.
    if (!basis()) {
        Logger.error('[Verbindungen] DASHBOARD_BASE_URL ist nicht gesetzt — ' +
            'ohne sie kann keine Rueckrufadresse gebildet werden');
        return res.redirect(`${zurueck}?fehler=basis`);
    }

    try {
        // Derselbe Mechanismus wie bei der Discord-Anmeldung: ein einmaliger
        // Zufallswert, der Hin- und Rueckweg verbindet. Ohne ihn koennte ein
        // Fremder einen Rueckruf unterschieben.
        const state = crypto.randomBytes(16).toString('hex');
        await dbService.saveState(state, zurueck);

        const ziel = await anbieter.autorisierUrl({
            state, rueckrufUrl: rueckrufUrl(name)
        });
        if (!ziel) return res.redirect(`${zurueck}?fehler=anbieter`);

        return res.redirect(ziel);
    } catch (error) {
        Logger.error(`[Verbindungen] Start fuer ${name} fehlgeschlagen:`, error);
        return res.redirect(`${zurueck}?fehler=technisch`);
    }
});

// =====================================================
// Zurueckkommen
// =====================================================
router.get('/:plattform/rueckruf', CheckAuth, async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');

    const name = String(req.params.plattform || '');
    const anbieter = VerbindungsRegistry.NAME_MUSTER.test(name)
        ? VerbindungsRegistry.get(name) : null;
    if (!anbieter) return res.redirect('/guild?fehler=unbekannt');

    const userId = req.session?.user?.info?.id;
    let zurueck = '/guild';

    try {
        // 1. State pruefen und **verbrauchen**. Ein State, der zweimal gilt,
        //    ist keiner.
        const gespeichert = req.query.state ? await dbService.getState(String(req.query.state)) : null;
        if (!gespeichert) {
            Logger.warn(`[Verbindungen] ${name}: Rueckruf ohne gueltigen State`);
            return res.redirect('/guild?fehler=state');
        }

        // **Ein State ohne Verfallsdatum gilt ewig.** `getState` prueft das
        // Alter nicht — es gibt den Zeitpunkt nur zurueck. Ein Rueckruf, der
        // Tage spaeter eintrifft, gehoert nicht mehr zu diesem Vorgang.
        const alterMs = gespeichert.created_at
            ? Date.now() - new Date(gespeichert.created_at).getTime() : 0;
        if (alterMs > HOECHSTALTER_MS) {
            await dbService.deleteState(String(req.query.state));
            Logger.warn(`[Verbindungen] ${name}: State war ${Math.round(alterMs / 60000)} Minuten alt`);
            return res.redirect('/guild?fehler=state');
        }

        zurueck = sicheresZiel(gespeichert.redirect_url) || '/guild';
        // Verbrauchen, bevor irgendetwas anderes passiert: Ein State, der
        // zweimal gilt, ist keiner.
        await dbService.deleteState(String(req.query.state));

        // 2. Abbruch beim Anbieter ist kein Fehler, sondern eine Entscheidung.
        if (req.query.error) {
            Logger.info(`[Verbindungen] ${name}: vom Benutzer abgebrochen (${req.query.error})`);
            return res.redirect(`${zurueck}?fehler=abgebrochen`);
        }
        if (!req.query.code) return res.redirect(`${zurueck}?fehler=code`);

        // 3. Identitaet feststellen - das macht das Plugin, nicht der Kern.
        const wer = await anbieter.identitaet({
            code: String(req.query.code), rueckrufUrl: rueckrufUrl(name)
        });
        if (!wer || !wer.kontoId) {
            Logger.warn(`[Verbindungen] ${name}: keine Identitaet erhalten`);
            return res.redirect(`${zurueck}?fehler=anbieter`);
        }

        // 4. Wegschreiben. Die zweite Eindeutigkeit der Tabelle
        //    (plattform, konto_id) ist der eigentliche Sinn der Uebung: Ein
        //    Konto gehoert hoechstens einem Benutzer. Wer es beansprucht,
        //    obwohl es schon jemandem gehoert, bekommt eine klare Absage -
        //    kein stilles Ueberschreiben.
        try {
            await dbService.query(`
                INSERT INTO user_connections (user_id, plattform, konto_id, konto_name, geprueft_am)
                VALUES (?, ?, ?, ?, NOW())
                ON DUPLICATE KEY UPDATE
                    konto_id = VALUES(konto_id),
                    konto_name = VALUES(konto_name),
                    geprueft_am = NOW()
            `, [userId, name, String(wer.kontoId), wer.kontoName || null]);
        } catch (err) {
            if (err && err.code === 'ER_DUP_ENTRY') {
                Logger.warn(`[Verbindungen] ${name}: Konto ${wer.kontoId} gehoert bereits einem anderen Benutzer`);
                return res.redirect(`${zurueck}?fehler=vergeben`);
            }
            throw err;
        }

        Logger.success(`[Verbindungen] ${name}: ${wer.kontoName || wer.kontoId} mit ${userId} verknuepft`);
        return res.redirect(`${zurueck}?ok=verbunden`);
    } catch (error) {
        Logger.error(`[Verbindungen] Rueckruf ${name} fehlgeschlagen:`, error);
        return res.redirect(`${zurueck}?fehler=technisch`);
    }
});

// =====================================================
// Loesen
// =====================================================
router.post('/:plattform/loesen', CheckAuth, async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');

    const name = String(req.params.plattform || '');
    const zurueck = sicheresZiel(req.body?.zurueck) || '/guild';
    const userId = req.session?.user?.info?.id;

    if (!VerbindungsRegistry.NAME_MUSTER.test(name)) {
        return res.redirect(`${zurueck}?fehler=unbekannt`);
    }

    try {
        // **Auch dann loesbar, wenn das Plugin abgeschaltet ist.** Deshalb
        // steht hier keine Registry-Abfrage: Wer seine Verknuepfung loswerden
        // will, darf nicht davon abhaengen, ob gerade jemand danach fragt.
        await dbService.query(
            'DELETE FROM user_connections WHERE user_id = ? AND plattform = ?',
            [userId, name]);

        Logger.info(`[Verbindungen] ${name} von ${userId} geloest`);
        return res.redirect(`${zurueck}?ok=geloest`);
    } catch (error) {
        Logger.error(`[Verbindungen] Loesen ${name} fehlgeschlagen:`, error);
        return res.redirect(`${zurueck}?fehler=technisch`);
    }
});

module.exports = router;

// Die Profilseite braucht die Rueckrufadresse, um sie anzuzeigen - sie muss
// beim Anbieter Zeichen fuer Zeichen so eingetragen sein.
module.exports.rueckrufUrl = rueckrufUrl;

// Nach aussen gegeben, damit `scripts/check-verbindungen.js` die offene
// Weiterleitung wirklich PRUEFEN kann statt sie im Quelltext zu suchen. Eine
// Sicherheitszusage, die nur als Regex geprueft wird, ist keine.
module.exports.sicheresZiel = sicheresZiel;
