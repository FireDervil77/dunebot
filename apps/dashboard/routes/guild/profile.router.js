/**
 * Profil des angemeldeten Benutzers.
 * Routen: /guild/:guildId/profile
 *
 * **Warum diese Datei neu ist, obwohl es den Bereich zu geben schien:** Der
 * Profilbereich lag seit jeher in drei Teilen herum, die nie verbunden wurden
 * (Baustelle 73, gefunden 2026-08-26):
 *
 *   - ein Menuepunkt `partials/guild/topbar.ejs:203` auf `/guild/<id>/profile`
 *     — ohne jede Route dahinter, also 404 bei jedem Klick
 *   - eine Ansicht `views/guild/profile/tokens.ejs`, gerendert von
 *     `/auth/tokens`, worauf im ganzen Theme nichts verwies
 *   - die Uebersetzungen `MEMBER_SINCE`, `DAYS`, `LAST_LOGIN` in **beiden**
 *     Sprachdateien, verwendet an null Stellen
 *
 * Drei vorhandene Teile ergeben keinen funktionierenden Bereich. Beim Lesen
 * des Codes sah jeder einzelne so aus, als sei die Sache erledigt.
 *
 * **Kein Recht ausser Anmeldung.** `CheckAuth` und `CheckGuildAccess` haengen
 * am Einhaengepunkt; ein `requirePermission` waere hier falsch: Das eigene
 * Profil gehoert niemandem sonst. Die Guild-Einstellungen nebenan verlangen
 * `CORE.SETTINGS.VIEW` — genau der Unterschied, den der Betreiber bemaengelt
 * hat: Der Menuepunkt "Einstellungen" steht im persoenlichen Menue, fuehrt
 * aber in den Serverbereich.
 *
 * **Nichts wird hier erfunden.** Jedes Feld der Seite hat eine nachgesehene
 * Quelle — Sitzung, `users`-Zeile oder `res.locals.userPermissions`. Ein
 * Platzhalter fuer spaeter (etwa verbundene Konten, siehe F-16) steht
 * ausdruecklich **nicht** drin: Genau so entstand der Zustand, den diese Datei
 * repariert.
 *
 * @author FireDervil
 */

const express = require('express');
const router = express.Router({ mergeParams: true });
const { ServiceManager } = require('dunebot-core');
const { VerbindungsRegistry } = require('dunebot-sdk');
const { rueckrufUrl } = require('../verbindungen.router');

/**
 * Die eigene Zeile aus `users`.
 *
 * Sie kann fehlen: Der Eintrag entsteht erst beim Anmelde-Rueckruf. Wer eine
 * alte Sitzung hat und dessen Zeile geloescht wurde, bekommt `null` — die
 * Seite zeigt dann weniger, statt zu scheitern.
 *
 * @param {string} userId Discord-ID
 * @returns {Promise<Object|null>} Zeile oder null
 */
async function eigeneZeile(userId) {
    const dbService = ServiceManager.get('dbService');
    const zeilen = await dbService.query(
        'SELECT locale, logged_in, tokens, created_at, updated_at FROM users WHERE _id = ? LIMIT 1',
        [userId]);
    return zeilen[0] || null;
}

/**
 * Ablauf des Discord-Anmeldetokens, ohne den Token selbst.
 *
 * **Der Token wird bewusst nicht angezeigt** — auch nicht abgeschnitten. Die
 * alte Ansicht zeigte die ersten zehn Zeichen; das nuetzt niemandem und steht
 * dafuer im Bildschirmfoto jeder Hilfeanfrage. Was der Benutzer wissen will,
 * ist "bin ich noch angemeldet und wie lange" — und das ist der Ablauf.
 *
 * @param {Object|null} zeile Zeile aus `users`
 * @returns {{typ: string, ablauf: Date|null, abgelaufen: boolean}|null} Angaben
 */
function anmeldung(zeile) {
    if (!zeile || !zeile.tokens) return null;
    try {
        const t = typeof zeile.tokens === 'string' ? JSON.parse(zeile.tokens) : zeile.tokens;
        const ablauf = t.expires_at ? new Date(Number(t.expires_at)) : null;
        return {
            typ: t.token_type || 'Bearer',
            ablauf,
            abgelaufen: Boolean(ablauf && ablauf.getTime() < Date.now())
        };
    } catch {
        // Kaputtes JSON ist kein Grund, die Seite zu verweigern. Melden statt
        // ausweichen: Der Block faellt weg, der Rest steht.
        return null;
    }
}

// GET /profile
router.get('/', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const themeManager = ServiceManager.get('themeManager');
    const guildId = res.locals.guildId;
    const userId = req.session?.user?.info?.id || null;

    let zeile = null;
    try {
        if (userId) zeile = await eigeneZeile(userId);
    } catch (error) {
        // Die Seite zeigt dann "unbekannt" statt einer Fehlerseite. Das Profil
        // ohne Anmeldedatum ist immer noch ein Profil.
        Logger.error('[Profil] Benutzerzeile konnte nicht geladen werden:', error);
    }

    const rechte = res.locals.userPermissions || { permissions: {}, groups: [], is_owner: false };

    await themeManager.renderView(res, 'guild/profile', {
        title: 'Profil',
        activeMenu: `/guild/${guildId}/profile`,
        guildId,
        zeile,
        anmeldung: anmeldung(zeile),
        gruppen: Array.isArray(rechte.groups) ? rechte.groups : [],
        // **`wildcard` getrennt melden.** Fuer den Serverbesitzer schreibt
        // `getUserPermissions` den gesamten Rechtekatalog in die Antwort
        // (PermissionManager.js:445) — eine Zahl wie "312 Rechte" waere zwar
        // wahr, wuerde aber etwas anderes behaupten als "darf alles".
        alleRechte: Boolean(rechte.permissions && rechte.permissions.wildcard),
        anzahlRechte: Object.keys(rechte.permissions || {})
            .filter(k => k !== 'wildcard').length,
        istBesitzer: Boolean(rechte.is_owner),
        hatSystemzugang: Boolean(res.locals.user?.hasSystemAccess)
    });
});

/**
 * Verbundene Konten dieses Benutzers, zusammengefuehrt mit den Anbietern,
 * die gerade eingetragen sind.
 *
 * **Nur eingetragene Anbieter erscheinen.** Eine Zeile "Kick (demnaechst)"
 * waere ein leeres Versprechen — genau die Bauart, die diese Seite ueberhaupt
 * erst noetig gemacht hat (Baustelle 73). Ist ein Plugin abgeschaltet, faellt
 * sein Anbieter weg; die Verknuepfung selbst bleibt in der Tabelle stehen und
 * kommt zurueck, sobald das Plugin wieder laeuft.
 *
 * @param {string} userId Discord-ID
 * @returns {Promise<Array<Object>>} je Anbieter eine Zeile
 */
async function konten(userId) {
    const dbService = ServiceManager.get('dbService');
    let vorhanden = [];
    try {
        vorhanden = await dbService.query(
            'SELECT plattform, konto_id, konto_name, angelegt_am FROM user_connections WHERE user_id = ?',
            [userId]) || [];
    } catch (error) {
        // Die Tabelle entsteht erst mit der Migration. Fehlt sie, ist die
        // Seite trotzdem brauchbar — sie zeigt dann keine Verknuepfungen.
        ServiceManager.get('Logger').warn('[Profil] user_connections nicht lesbar:', error.message);
    }

    // Erteilte Berechtigungen dazu. Getrennt gelesen, weil die Tabelle
    // juenger ist als die Seite — fehlt sie, bleibt die Seite brauchbar.
    let zusagen = [];
    try {
        zusagen = await dbService.query(`
            SELECT v.plattform, g.scopes, g.geprueft_am, g.fehlertext
              FROM user_connection_grants g
              JOIN user_connections v ON v.id = g.verbindung_id
             WHERE v.user_id = ?
        `, [userId]) || [];
    } catch (error) {
        ServiceManager.get('Logger').warn('[Profil] user_connection_grants nicht lesbar:', error.message);
    }

    return Promise.all(VerbindungsRegistry.list().map(async a => {
        const da = vorhanden.find(v => v.plattform === a.name) || null;
        const z = zusagen.find(x => x.plattform === a.name) || null;
        const erteilt = z ? String(z.scopes || '').split(' ').filter(Boolean) : [];
        return {
            name: a.name, label: a.label, symbol: a.symbol,
            farbe: a.farbe, hinweis: a.hinweis,
            verbunden: Boolean(da),
            kontoName: da ? (da.konto_name || da.konto_id) : null,
            seit: da ? da.angelegt_am : null,
            // **Auskunft, nicht Deko.** Wer uns etwas erlaubt hat, muss sehen
            // koennen was — und es einzeln zuruecknehmen koennen, ohne die
            // Verknuepfung aufzugeben.
            scopes: erteilt,
            zusageFehler: z ? z.fehlertext : null,

            // **Und was er noch erlauben KANN.** Ohne diese Liste ist die
            // Verknuepfung eine Sackgasse: Der Anbieter meldet Zusagen an,
            // niemand kann sie erteilen. Genau so gefunden am 2026-08-26,
            // beim ersten Blick des Betreibers auf die fertige Seite.
            // **`nurAnlage` fliegt raus** (Stufe 13a). Die Chatbot-Zusage
            // gehoert dem Bot-Konto der Anlage, nicht einem Menschen. Hier
            // waere sie ein Knopf, der das eigene Twitch-Konto zum Chatbot
            // machen wuerde — und `uniq_benutzer_plattform` wiese ihn ohnehin
            // ab. Ein Knopf, der nur scheitern kann, gehoert nicht auf die
            // Seite.
            zusagen: Object.values(a.zusagen || {}).filter(x => !x.nurAnlage).map(x => ({
                name: x.name,
                label: x.label,
                hinweis: x.hinweis,
                // Erteilt ist sie, wenn JEDER ihrer Scopes vorliegt. Eine
                // halb erteilte Zusage ist nicht erteilt — sonst behauptet
                // die Seite eine Faehigkeit, die beim ersten Aufruf scheitert.
                erteilt: x.scopes.every(sc => erteilt.includes(sc))
            })),

            // **Der eigene Abschnitt des Anbieters** (Stufe 13a). Nur fuer
            // wirklich verknuepfte Konten: Ohne Nachweis gibt es niemanden,
            // ueber den zu berichten waere - und ein Netzaufruf fuer eine
            // Zeile, die ohnehin leer bliebe, waere Verschwendung bei jedem
            // Seitenaufruf.
            //
            // `einstellungenLesen` faellt nie durch; was klemmt, kommt als
            // 'unbekannt' mit Grund zurueck. Deshalb steht hier kein
            // try/catch: Es waere eines um etwas, das nicht wirft - und
            // genau so entstehen die `.catch(() => {})`, die dieses Projekt
            // als Befund fuehrt.
            einstellungen: da
                ? {
                    titel: a.einstellungen?.titel || null,
                    hinweis: a.einstellungen?.hinweis || null,
                    zeilen: await VerbindungsRegistry.einstellungenLesen(
                        a.name,
                        { userId, kontoId: da.konto_id, kontoName: da.konto_name },
                        ServiceManager.get('Logger')),
                    // **Die eine benannte Auswahl** (Stufe 14). Wie die Zeilen
                    // faellt sie nie durch; was klemmt, kommt als `grund`
                    // zurueck und erscheint als Satz statt als Auswahlfeld.
                    wahl: await VerbindungsRegistry.einstellungenWahlLesen(
                        a.name,
                        { userId, kontoId: da.konto_id, kontoName: da.konto_name },
                        ServiceManager.get('Logger'))
                }
                : null
        };
    }));
}

// GET /profile/verbindungen
router.get('/verbindungen', async (req, res) => {
    const themeManager = ServiceManager.get('themeManager');
    const guildId = res.locals.guildId;
    const userId = req.session?.user?.info?.id || null;

    await themeManager.renderView(res, 'guild/profile-verbindungen', {
        title: 'Verbundene Konten',
        activeMenu: `/guild/${guildId}/profile/verbindungen`,
        guildId,
        anbieter: userId ? await konten(userId) : [],
        // Nur der Betreiber sieht, wo die Rueckrufadresse einzutragen ist —
        // fuer alle anderen ist sie Rauschen.
        rueckrufe: res.locals.user?.hasSystemAccess || res.locals.user?.isOwner
            ? VerbindungsRegistry.list().map(a => ({ label: a.label, url: rueckrufUrl(a.name) }))
            : [],
        meldung: req.query.ok || null,
        fehler: req.query.fehler || null,
        grund: req.query.grund || null
    });
});

/**
 * Die benannte Auswahl eines Anbieters setzen (Stufe 14).
 *
 * **Hier steht keine Rechtepruefung, und das ist Absicht.** Die Tuer dieser
 * Seite ist der Nachweis: `CheckAuth` sagt, wer angemeldet ist, und das Plugin
 * prueft, ob dieser Mensch ueber genau dieses Konto verfuegen darf. Ein
 * Guild-Recht hier waere sogar falsch - dann entschiede die Serverleitung
 * darueber, ob jemand seinen eigenen Kanal einstellen darf (F-18).
 *
 * **Der Anbieter kommt aus der Adresse, das Konto aus der Datenbank.** Nicht
 * aus dem Formular: Sonst schriebe der Absender selbst hinein, fuer welches
 * Konto er zu sprechen glaubt.
 */
router.post('/verbindungen/:anbieter/wahl', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const guildId = res.locals.guildId;
    const userId = req.session?.user?.info?.id || null;
    const zurueck = `/guild/${guildId}/profile/verbindungen`;

    const anbieterName = String(req.params.anbieter || '');
    if (!VerbindungsRegistry.NAME_MUSTER.test(anbieterName)) {
        return res.redirect(`${zurueck}?fehler=unbekannt`);
    }

    try {
        if (!userId) return res.redirect(`${zurueck}?fehler=abgemeldet`);

        // **Das Konto kommt aus `user_connections`, nicht aus `konten()`.**
        // Nachgesehen am 2026-08-29: Die Ansichtsform von `konten()` traegt
        // `kontoName`, aber **kein** `kontoId` - sie ist fuer die Darstellung
        // gebaut. Ein `eigene.kontoId` waere still `undefined` gewesen, und das
        // Plugin haette geantwortet "Diesen Kanal gibt es hier nicht": eine
        // falsche Auskunft, die wie eine richtige aussieht.
        const verbindung = (await ServiceManager.get('dbService').query(
            'SELECT konto_id, konto_name FROM user_connections WHERE user_id = ? AND plattform = ? LIMIT 1',
            [userId, anbieterName]))[0];
        if (!verbindung) return res.redirect(`${zurueck}?fehler=nicht_verbunden`);

        const ergebnis = await VerbindungsRegistry.einstellungenWahlSetzen(
            anbieterName,
            { userId, kontoId: verbindung.konto_id, kontoName: verbindung.konto_name },
            req.body?.wert);

        if (!ergebnis.ok) {
            Logger.warn(`[Profil] Auswahl bei "${anbieterName}" abgelehnt: ${ergebnis.grund}`);
            // **Der Grund wird durchgereicht, nicht verschluckt.** "Nur der
            // Inhaber dieses Kanals kann das setzen" ist eine Auskunft, mit
            // der jemand etwas anfangen kann; "hat nicht geklappt" nicht.
            return res.redirect(`${zurueck}?fehler=abgelehnt&grund=${encodeURIComponent(ergebnis.grund || '')}`);
        }

        return res.redirect(`${zurueck}?ok=gewaehlt`);
    } catch (error) {
        Logger.error(`[Profil] Auswahl bei "${anbieterName}" fehlgeschlagen:`, error);
        return res.redirect(`${zurueck}?fehler=technisch`);
    }
});

module.exports = router;

// Nach aussen gegeben, damit `scripts/check-verbindungs-zusagen.js` den Weg
// von der Anmeldung bis zum Knopf wirklich durchgehen kann. Am 2026-08-26
// fiel genau hier etwas aus: Die Zusage war angemeldet, der Speicher stand,
// die Route lief — und im Profil gab es nichts zu klicken. Aufgefallen ist es
// nicht einem Pruefskript, sondern dem Betreiber beim ersten Blick.
module.exports.konten = konten;
