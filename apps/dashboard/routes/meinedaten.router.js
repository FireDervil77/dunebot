/**
 * Seite „Meine Daten“ (G-04c, K380, F-G1 A).
 * Routen: /meinedaten, /meinedaten/export, /meinedaten/loeschen
 *
 * **Warum auf oberster Ebene und nicht im Profil:** Das Profil liegt unter
 * `/guild/:guildId/profile`, und dorthin kommt nur, wer Zugang zum Dashboard
 * einer Guild hat. Den vergibt der Besitzer. Leveling, Logging und Clan
 * speichern aber über **jedes** Mitglied. Hier reicht die Discord-Anmeldung.
 * Auf diese Adresse können AGB und Datenschutz verweisen.
 *
 * Gezählt, exportiert und gelöscht wird über `Datenauskunft`, geformt über
 * `MeineDaten`, also genau wie beim Befehl `/mydata` im Bot.
 *
 * Jeder sieht und löscht nur sich selbst: Die ID kommt aus der Sitzung, nie
 * aus der Anfrage.
 *
 * @author FireDervil
 */

const express = require('express');
const router = express.Router();
const { ServiceManager } = require('dunebot-core');
const { csrfProtection } = require('../middlewares/security/csrf-protection.middleware');
const Datenauskunft = require('../helpers/Datenauskunft');
const MeineDaten = require('../helpers/MeineDaten');

const SCHNEEFLOCKE = /^\d{17,20}$/;

/** Eingetippter Name gleich dem verlangten? Groß- und Kleinschreibung egal, wie im Bot. */
function nameStimmt(eingabe, soll) {
    return String(eingabe ?? '').trim().toLowerCase() === String(soll ?? '').trim().toLowerCase();
}

// GET /meinedaten → Übersicht je Guild
router.get('/', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const themeManager = ServiceManager.get('themeManager');
    const userId = req.session.user.info.id;

    let daten = null;
    let fehler = null;
    try {
        daten = await MeineDaten.uebersicht(userId);
    } catch (err) {
        Logger.error(`[MeineDaten] Übersicht für ${userId} gescheitert:`, err);
        fehler = err.message;
    }

    await themeManager.renderView(res, 'auth/meine-daten', {
        title: 'Meine Daten',
        daten,
        fehler,
        benutzername: req.session.user.info.username || '',
    });
});

// GET /meinedaten/export?guild=<id> → JSON; ohne Guild alles
router.get('/export', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const userId = req.session.user.info.id;
    const guildId = req.query.guild ? String(req.query.guild) : null;
    if (guildId !== null && !SCHNEEFLOCKE.test(guildId)) {
        return res.status(400).json({ success: false, message: 'Guild-ID ungültig' });
    }
    try {
        const aus = await Datenauskunft.auskunft(userId, { guildId, mitZeilen: true });
        aus.guildNamen = await MeineDaten.guildNamen(guildId ? [guildId] : aus.guilds);
        res.setHeader('Content-Disposition', `attachment; filename="meine-daten-${guildId || 'alle'}.json"`);
        res.type('application/json').send(JSON.stringify(aus, null, 2));
    } catch (err) {
        Logger.error(`[MeineDaten] Export für ${userId} gescheitert:`, err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// POST /meinedaten/loeschen { guildId: '<id>' | 'alle', bestaetigung }
router.post('/loeschen', csrfProtection, async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const userId = req.session.user.info.id;
    const ziel = String(req.body?.guildId ?? '');
    const ueberall = ziel === 'alle';
    if (!ueberall && !SCHNEEFLOCKE.test(ziel)) {
        return res.status(400).json({ success: false, message: 'Guild-ID ungültig' });
    }

    // Was eingetippt werden muss, steht auf dem Server fest, nicht im Browser.
    let soll;
    if (ueberall) {
        soll = req.session.user.info.username || userId;
    } else {
        const namen = await MeineDaten.guildNamen([ziel]);
        soll = namen[ziel] || ziel;
    }
    if (!nameStimmt(req.body?.bestaetigung, soll)) {
        return res.status(400).json({ success: false, message: `Der Name stimmt nicht, es wurde nichts gelöscht. Erwartet: ${soll}` });
    }

    let ergebnis;
    try {
        ergebnis = await Datenauskunft.mitgliedLoeschen(userId, { guildId: ueberall ? null : ziel, anlass: 'Seite Meine Daten' });
    } catch (err) {
        Logger.error(`[MeineDaten] Löschen für ${userId} gescheitert:`, err);
        return res.status(500).json({ success: false, message: err.message });
    }
    const rueck = MeineDaten.rueckmeldung(ergebnis);

    // „Überall“ löscht auch die Sitzungen in der Datenbank. Die eigene muss
    // hier zusätzlich zerstört werden: express-session schriebe sie sonst am
    // Ende dieser Anfrage zurück.
    if (ueberall) {
        await new Promise((fertig) => req.session.destroy((err) => {
            if (err) Logger.warn(`[MeineDaten] Sitzung von ${userId} nicht zerstört: ${err.message}`);
            fertig();
        }));
        res.clearCookie(process.env.SESSION_COOKIE || 'connect.sid');
    }
    return res.status(rueck.ok ? 200 : 207).json({ success: rueck.ok, data: rueck, abgemeldet: ueberall });
});

module.exports = router;
