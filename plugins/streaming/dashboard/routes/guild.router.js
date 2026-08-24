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
const { PLATZHALTER, pruefeVorlage, VORGABE_LIVE, VORGABE_RUECKSCHAU } = require('../../shared/vorlagen');

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
// Einstieg
// =====================================================
router.get('/', requirePermission('STREAMING.VIEW'), (req, res) => {
    res.redirect(`/guild/${res.locals.guildId}/plugins/streaming/streamer`);
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
router.get('/ziele', requirePermission('STREAMING.VIEW'), async (req, res) => {
    const guildId = res.locals.guildId;
    const tr = makeTranslator(req, res);

    try {
        const [ziele, zielkanaele, sprachkanaele, rollen, mitglieder, liveRolleId] = await Promise.all([
            modelle.zieleDerGuild(guildId),
            getZielkanaele(guildId),
            getSprachkanaele(guildId),
            getRollen(guildId),
            getMitglieder(guildId),
            modelle.liveRolle(guildId)
        ]);
        const zeitzone = await modelle.zeitzone(guildId);

        // **Trägt die gewählte Rolle Mitglieder, die nicht von uns kommen?**
        // Dann bedeutet sie auf diesem Server noch etwas anderes - ein
        // Zugangsrecht zum Beispiel. Das gehoert gesagt, BEVOR ein Abgleich
        // sie einsammelt (Vorfall 2026-08-25, Baustelle 69).
        let fremdeTraeger = 0;
        if (liveRolleId) {
            const unsere = new Set(await modelle.vergebeneRolle(guildId, liveRolleId));
            fremdeTraeger = (mitglieder || [])
                .filter(m => (m.rollen || []).includes(String(liveRolleId)) && !unsere.has(String(m.id)))
                .length;
        }

        await renderView(res, 'guild/streaming-ziele', {
            tr, guildId, ziele, zielkanaele, sprachkanaele, rollen, mitglieder, liveRolleId,
            fremdeTraeger, zeitzone, zonen: ZEITZONEN,
            meldung: req.query.ok || null,
            fehler: req.query.fehler || null
        });
    } catch (error) {
        return renderFehler(res, error, 'Die Ziele konnten nicht geladen werden');
    }
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
    const zurueck = `/guild/${guildId}/plugins/streaming/ziele`;

    try {
        const rolleId = String(req.body.live_rolle_id || '').trim();
        if (rolleId && !/^\d{5,32}$/.test(rolleId)) {
            return res.redirect(`${zurueck}?fehler=rolle`);
        }

        // Die Zeitzone haengt am selben Formular: Beides sind Vorgaben der
        // Guild, und zwei Knoepfe nebeneinander waeren nur Gelegenheit, einen
        // davon zu vergessen.
        const zone = String(req.body.zeitzone || '').trim();
        if (zone && !ZEITZONEN.includes(zone)) return res.redirect(`${zurueck}?fehler=zone`);
        if (zone) await modelle.zeitzoneSetzen(guildId, zone);

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
router.post('/ziele/:id', requirePermission('STREAMING.TARGETS.MANAGE'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const guildId = res.locals.guildId;
    const zurueck = `/guild/${guildId}/plugins/streaming/ziele`;

    try {
        const zielId = Number(req.params.id);
        if (!Number.isInteger(zielId)) return res.redirect(`${zurueck}?fehler=technisch`);

        const channelId = String(req.body.channel_id || '').trim();
        if (!channelId) return res.redirect(`${zurueck}?fehler=ziel_fehlt`);

        // 'bearbeiten' ist die Vorgabe. Ein unbekannter Wert kaeme aus einem
        // veraenderten Formular - dann gilt die Vorgabe, nicht der Wunsch.
        const erlaubteArten = ['bearbeiten', 'loeschen', 'stehenlassen'];
        const aufraeumen = erlaubteArten.includes(req.body.aufraeumen) ? req.body.aufraeumen : 'bearbeiten';

        const bild = String(req.body.eigenes_bild || '').trim();
        if (bild && !/^https:\/\//i.test(bild)) {
            return res.redirect(`${zurueck}?fehler=bild`);
        }

        const geaendert = await modelle.zielSpeichern(guildId, zielId, {
            channel_id:       channelId,
            rolle_id:         String(req.body.rolle_id || '').trim() || null,
            onair_channel:    String(req.body.onair_channel || '').trim() || null,
            filter_spiel:     String(req.body.filter_spiel || '').trim() || null,
            filter_titel:     String(req.body.filter_titel || '').trim() || null,
            filter_spiel_aus: String(req.body.filter_spiel_aus || '').trim() || null,
            filter_titel_aus: String(req.body.filter_titel_aus || '').trim() || null,
            ruhe_von:         uhrzeit(req.body.ruhe_von),
            ruhe_bis:         uhrzeit(req.body.ruhe_bis),
            aufraeumen,
            eigenes_bild:     bild || null,
            veroeffentlichen: req.body.veroeffentlichen ? 1 : 0,
            aktiv:            req.body.aktiv ? 1 : 0,
            // Nur Ziffern: Eine Discord-ID ist eine Zahl. Ein eingetippter
            // Name kaeme sonst als Mitglied durch und die Rolle ginge ins Leere.
            mitglied_id:      /^\d{5,32}$/.test(String(req.body.mitglied_id || '').trim())
                                ? String(req.body.mitglied_id).trim() : null
        });

        // Null geaenderte Zeilen heisst hier: das Ziel gehoert dieser Guild
        // nicht (oder gibt es nicht mehr). Das ist kein Erfolg.
        if (!geaendert) {
            const vorhanden = await modelle.zielLesen(guildId, zielId);
            if (!vorhanden) return res.redirect(`${zurueck}?fehler=weg`);
        }

        Logger.info(`[Streaming] Ziel ${zielId} in Guild ${guildId} geaendert`);
        return res.redirect(`${zurueck}?ok=gespeichert`);
    } catch (error) {
        Logger.error('[Streaming] Ziel speichern fehlgeschlagen:', error);
        return res.redirect(`${zurueck}?fehler=technisch`);
    }
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

// =====================================================
// Vorlagen
// =====================================================
router.get('/vorlagen', requirePermission('STREAMING.VIEW'), async (req, res) => {
    const guildId = res.locals.guildId;
    const tr = makeTranslator(req, res);

    try {
        const [ziele, vorlagen] = await Promise.all([
            modelle.zieleDerGuild(guildId),
            modelle.vorlagenLesen(guildId)
        ]);

        await renderView(res, 'guild/streaming-vorlagen', {
            tr, guildId, ziele, vorlagen,
            platzhalter: PLATZHALTER,
            vorgabeLive: VORGABE_LIVE,
            vorgabeRueckschau: VORGABE_RUECKSCHAU,
            meldung: req.query.ok || null,
            fehler: req.query.fehler || null
        });
    } catch (error) {
        return renderFehler(res, error, 'Die Vorlagen konnten nicht geladen werden');
    }
});

// Die Standardtexte der Guild
router.post('/vorlagen', requirePermission('STREAMING.TEMPLATES.EDIT'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const guildId = res.locals.guildId;
    const zurueck = `/guild/${guildId}/plugins/streaming/vorlagen`;

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
    const zurueck = `/guild/${guildId}/plugins/streaming/vorlagen`;

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
        const [zustand, streamer] = await Promise.all([
            modelle.zustandDerGuild(guildId),
            modelle.streamerDerGuild(guildId)
        ]);

        await renderView(res, 'guild/streaming-zustand', {
            tr, guildId, zustand, streamer,
            ampel: ampelFarbe(zustand),
            vorWieLange
        });
    } catch (error) {
        return renderFehler(res, error, 'Der Zustand konnte nicht geladen werden');
    }
});

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

        await renderView(res, 'guild/streaming-betrieb', {
            tr, guildId,
            clientId: daten.clientId || '',
            secretQuelle: daten.quelle,
            abgleichBericht, aufraeumBericht, alleStreamer,
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
