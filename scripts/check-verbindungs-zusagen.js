#!/usr/bin/env node
/**
 * Prueft die **Zusagen**: erteilte Berechtigungen samt Schluessel (Stufe 12a).
 *
 * Der Anlass steht in `docs/streamer-plugin/12-Anmeldung-und-Chat.md`. Kurz:
 * Fuer Abonnenten-Rollen, Chat und Moderation braucht Twitch erteilte Scopes
 * und damit erneuerbare Nutzer-Token — und verlangt, sie **stuendlich zu
 * pruefen**, mit Audits und angedrohtem Entzug des API-Schluessels.
 *
 * Es **liest nicht, es benutzt**: echte Verschluesselung, echte Tabelle, echte
 * Fremdschluessel-Regel, echter `id.twitch.tv/oauth2/validate`. Angelegte
 * Testdaten werden am Ende wieder entfernt.
 *
 *   node scripts/check-verbindungs-zusagen.js
 *
 * Exitcode 1 bei jeder Abweichung.
 */
'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../apps/dashboard/.env'), quiet: true });

const mysql = require('mysql2/promise');
const { ServiceManager } = require('dunebot-core');
const { VerbindungsRegistry } = require('dunebot-sdk');

let faelle = 0;
let abweichungen = 0;

/**
 * @param {boolean} gut Bedingung
 * @param {string} text Beschreibung
 * @param {string} [zusatz] Ergaenzung
 * @returns {void}
 */
function pruefe(gut, text, zusatz = '') {
    faelle++;
    if (!gut) abweichungen++;
    console.log(`  ${gut ? '✓' : '✗'} ${text}${zusatz ? '  — ' + zusatz : ''}`);
}

/** Ein Benutzer, den es nicht gibt — damit nichts Echtes angefasst wird. */
const PRUEFNUTZER = '999999999999999999';

(async () => {
    const c = await mysql.createConnection({
        host: process.env.MYSQL_HOST, port: process.env.MYSQL_PORT || 3306,
        user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD,
        database: process.env.MYSQL_DATABASE
    });
    const q = async (sql, w = []) => (await c.query(sql, w))[0];

    ServiceManager.register('Logger', {
        info: () => {}, debug: () => {}, warn: () => {}, success: () => {},
        error: (...a) => console.log('   !', ...a.map(String))
    });
    ServiceManager.register('dbService', {
        async query(sql, w) { return q(sql, w); },
        // Echter Zugriff auf `configs`: Die Twitch-Zugangsdaten liegen dort
        // verschluesselt, nicht in der Umgebung. Ein Stummel, der null liefert,
        // wuerde den Adapter auf die Umgebung ausweichen lassen — und dann
        // pruefte dieses Skript etwas anderes als das Dashboard tut.
        async getConfig(plugin, key, context = 'shared', guildId = null) {
            const sql = `SELECT config_value FROM configs
                          WHERE plugin_name = ? AND config_key = ? AND context = ?
                            ${guildId ? 'AND guild_id = ?' : 'AND is_global = TRUE'} LIMIT 1`;
            const zeilen = await q(sql, guildId ? [plugin, key, context, guildId] : [plugin, key, context]);
            return zeilen[0] ? zeilen[0].config_value : null;
        }
    });

    const speicher = require('../apps/dashboard/helpers/Verbindungsspeicher');
    const router   = require('../apps/dashboard/routes/verbindungen.router');
    const twitch   = require('../plugins/streaming/dashboard/plattformen/twitch');

    // ---------------------------------------------------------------
    console.log('\nDer Vertrag: wer Zusagen anbietet, muss sie pflegen koennen');
    // ---------------------------------------------------------------

    const grund = { label: 'X', autorisierUrl: async () => 'https://x', identitaet: async () => ({}) };

    pruefe(VerbindungsRegistry.register('nur-nachweis', grund) === true,
        'ein Anbieter ohne Zusagen wird eingetragen', 'so sah Twitch bis zum 2026-08-26 aus');

    for (const fehlt of ['tauschen', 'erneuern', 'pruefen']) {
        const teil = { tauschen: async () => ({}), erneuern: async () => ({}), pruefen: async () => ({}) };
        delete teil[fehlt];
        let abgewiesen = false;
        try {
            VerbindungsRegistry.register('halb', {
                ...grund, ...teil, zusagen: { lesen: { scopes: ['a:b'] } }
            });
        } catch (e) { abgewiesen = e.message.includes(fehlt); }
        pruefe(abgewiesen, `Zusagen ohne ${fehlt}() werden abgewiesen`,
            'sonst sammelt jemand Schluessel, die niemand nachhaelt');
    }

    let leerAbgewiesen = false;
    try {
        VerbindungsRegistry.register('leer', {
            ...grund, tauschen: async () => ({}), erneuern: async () => ({}), pruefen: async () => ({}),
            zusagen: { nichts: { scopes: [] } }
        });
    } catch (e) { leerAbgewiesen = true; }
    pruefe(leerAbgewiesen, 'eine Zusage ohne Scopes wird abgewiesen',
        'sie zeigte einen Dialog, der nichts bewirkt');

    // ---------------------------------------------------------------
    console.log('\nDer Name waehlt die Scopes, nie die Adresszeile');
    // ---------------------------------------------------------------

    VerbindungsRegistry.register('pruef', {
        ...grund,
        tauschen: async () => ({}), erneuern: async () => ({}), pruefen: async () => ({}),
        zusagen: { 'abo-rollen': { label: 'Abos', scopes: ['channel:read:subscriptions'] } }
    });

    pruefe(String(VerbindungsRegistry.scopesVon('pruef', 'abo-rollen')) === 'channel:read:subscriptions',
        'ein bekannter Name liefert seine Scopes');
    pruefe(VerbindungsRegistry.scopesVon('pruef', 'moderator:manage:banned_users') === null,
        'ein Scope als Name liefert NICHTS',
        'genau der Weg, auf dem sonst jeder Link jede Berechtigung erfragen koennte');
    pruefe(VerbindungsRegistry.scopesVon('pruef', 'erfunden') === null,
        'ein erfundener Name liefert nichts');

    pruefe(router.stateZerlegen('abc123.abo-rollen').zusage === 'abo-rollen',
        'der State traegt die Zusage ueber den Rueckweg');
    pruefe(router.stateZerlegen('abc123').zusage === null,
        'ohne Zusage bleibt der State ein reiner Nachweis-Vorgang');
    pruefe(router.stateZerlegen('abc123.Boese/Sache').zusage === null,
        'ein Name, der ein Muster verletzt, wird verworfen');

    // ---------------------------------------------------------------
    console.log('\nDie Tabelle und ihre Sicherheitseigenschaft');
    // ---------------------------------------------------------------

    const spalten = (await q('SHOW COLUMNS FROM user_connection_grants')).map(z => z.Field);
    pruefe(spalten.length > 0, 'user_connection_grants existiert', spalten.join(', '));

    const nachweis = (await q('SHOW COLUMNS FROM user_connections')).map(z => z.Field);
    pruefe(!nachweis.some(n => /token|zugang|erneuerung/i.test(n)),
        'der Nachweis traegt weiterhin KEINEN Schluessel',
        'die Zusage vom 2026-08-26 gilt unveraendert');

    // Aufraeumen, falls ein frueherer Lauf abbrach.
    await q('DELETE FROM user_connections WHERE user_id = ?', [PRUEFNUTZER]);

    let ohneNachweis = false;
    try {
        await q('INSERT INTO user_connection_grants (verbindung_id, scopes, zugang_ver) VALUES (?, ?, ?)',
            [2147483600, 'a:b', 'x']);
    } catch (e) { ohneNachweis = e.code === 'ER_NO_REFERENCED_ROW_2' || /foreign key/i.test(e.message); }
    pruefe(ohneNachweis, 'eine Zusage ohne Nachweis wird von der Datenbank abgelehnt');

    // ---------------------------------------------------------------
    console.log('\nSpeichern, lesen, erneuern — mit echter Verschluesselung');
    // ---------------------------------------------------------------

    await q(`INSERT INTO user_connections (user_id, plattform, konto_id, konto_name)
             VALUES (?, 'pruef', ?, 'Pruefkonto')`, [PRUEFNUTZER, 'konto-' + PRUEFNUTZER]);

    await speicher.zusageSpeichern({
        userId: PRUEFNUTZER, plattform: 'pruef',
        scopes: ['channel:read:subscriptions'],
        zugang: 'GEHEIM-ZUGANG', erneuerung: 'GEHEIM-ERNEUERUNG', laeuftAbSek: 3600
    });

    const roh = (await q(`SELECT g.* FROM user_connection_grants g
                            JOIN user_connections v ON v.id = g.verbindung_id
                           WHERE v.user_id = ?`, [PRUEFNUTZER]))[0];

    pruefe(Boolean(roh), 'die Zusage steht in der Tabelle');
    pruefe(!String(roh.zugang_ver).includes('GEHEIM'),
        'der Zugang liegt verschluesselt', 'im Klartext waere die Spalte sinnlos');
    pruefe(!String(roh.erneuerung_ver).includes('GEHEIM'), 'die Erneuerung ebenso');
    pruefe(String(roh.scopes) === 'channel:read:subscriptions', 'die Scopes liegen im Klartext',
        '"das hast du erlaubt" muss man zeigen koennen');

    // Zweite Zusage: Scopes muessen ZUSAMMENGEFUEHRT werden, nicht ersetzt.
    await speicher.zusageSpeichern({
        userId: PRUEFNUTZER, plattform: 'pruef',
        scopes: ['user:read:chat'], zugang: 'ZWEITER', erneuerung: null, laeuftAbSek: null
    });
    const nachher = await speicher.zusageLesen(PRUEFNUTZER, 'pruef');
    pruefe(String(nachher.scopes).includes('channel:read:subscriptions') &&
           String(nachher.scopes).includes('user:read:chat'),
        'eine zweite Zusage verliert die erste nicht', nachher.scopes);

    // `mitZugang`: der Aufrufer bekommt den Klartext, aber nur durch diese Tuer.
    let gesehen = null;
    await speicher.mitZugang({ userId: PRUEFNUTZER, plattform: 'pruef' },
        async (z) => { gesehen = z; return { ok: true }; });
    pruefe(gesehen === 'ZWEITER', 'mitZugang reicht den entschluesselten Zugang durch');

    pruefe(typeof speicher.zugangHolen !== 'function',
        'es gibt KEIN zugangHolen()',
        'ein bequemer Weg am Erneuern vorbei waere der naechste stille Fehler');

    // Der 401-Fall: einmal erneuern, einmal wiederholen.
    VerbindungsRegistry.register('pruef', {
        ...grund,
        zusagen: { 'abo-rollen': { label: 'Abos', scopes: ['channel:read:subscriptions'] } },
        tauschen: async () => ({}),
        erneuern: async () => ({ zugang: 'FRISCH', erneuerung: 'NEU', laeuftAbSek: 3600 }),
        pruefen: async () => ({ gueltig: true, scopes: [], kontoId: null })
    });
    await speicher.zusageSpeichern({
        userId: PRUEFNUTZER, plattform: 'pruef',
        scopes: [], zugang: 'ALT', erneuerung: 'ALTE-ERNEUERUNG', laeuftAbSek: 60
    });

    const versuche = [];
    const ergebnis = await speicher.mitZugang({ userId: PRUEFNUTZER, plattform: 'pruef' },
        async (z) => { versuche.push(z); return z === 'FRISCH' ? { ok: true } : { abgelehnt: true }; });

    pruefe(versuche.length === 2 && versuche[1] === 'FRISCH',
        'ein abgelehnter Zugang wird einmal erneuert und wiederholt', versuche.join(' → '));
    pruefe(ergebnis?.ok === true, 'und der zweite Anlauf gelingt');

    const danach = await speicher.zusageLesen(PRUEFNUTZER, 'pruef');
    pruefe(Boolean(danach) && danach.fehlertext === null,
        'der erneuerte Schluessel ist weggeschrieben');

    // ---------------------------------------------------------------
    console.log('\nDie stuendliche Pflichtpruefung');
    // ---------------------------------------------------------------

    const bilanz = await speicher.pruefen();
    pruefe(bilanz.geprueft >= 1, 'die Pruefung erreicht die Zusage', JSON.stringify(bilanz));

    VerbindungsRegistry.register('pruef', {
        ...grund,
        zusagen: { 'abo-rollen': { label: 'Abos', scopes: ['channel:read:subscriptions'] } },
        tauschen: async () => ({}), erneuern: async () => ({}),
        pruefen: async () => ({ gueltig: false, scopes: [], kontoId: null })
    });
    await speicher.pruefen();
    const ungueltig = await speicher.zusageLesen(PRUEFNUTZER, 'pruef');
    pruefe(Boolean(ungueltig), 'eine ungueltige Zusage wird NICHT geloescht',
        'ein abgelaufener Schluessel ist kein Widerruf — der Benutzer soll es erfahren');
    pruefe(Boolean(ungueltig.fehlertext), 'sondern mit Grund vermerkt', ungueltig.fehlertext);

    VerbindungsRegistry.unregister('pruef');
    const ohneAnbieter = await speicher.pruefen();
    pruefe(ohneAnbieter.uebersprungen >= 1 && ohneAnbieter.geprueft === 0,
        'ein abgeschaltetes Plugin laesst die Zusage in Ruhe',
        'nicht pruefbar ist nicht dasselbe wie ungueltig');

    // ---------------------------------------------------------------
    console.log('\nWiderruf und Loeschung');
    // ---------------------------------------------------------------

    await speicher.widerrufen(PRUEFNUTZER, 'pruef');
    pruefe(await speicher.zusageLesen(PRUEFNUTZER, 'pruef') === null, 'Widerruf entfernt die Zusage');
    const nachWiderruf = await q('SELECT id FROM user_connections WHERE user_id = ?', [PRUEFNUTZER]);
    pruefe(nachWiderruf.length === 1, 'der Nachweis bleibt dabei stehen',
        'Berechtigung entziehen heisst nicht "das Konto gehoert mir nicht mehr"');

    await speicher.zusageSpeichern({
        userId: PRUEFNUTZER, plattform: 'pruef',
        scopes: [], zugang: 'WEG-DAMIT', erneuerung: null, laeuftAbSek: null
    });
    await q('DELETE FROM user_connections WHERE user_id = ?', [PRUEFNUTZER]);
    const waisen = await q('SELECT id FROM user_connection_grants WHERE verbindung_id NOT IN (SELECT id FROM user_connections)');
    pruefe(waisen.length === 0, 'Loesen der Verknuepfung nimmt die Schluessel zwangslaeufig mit',
        'das kann kein Aufrufer vergessen — es fuehrt niemand aus');

    // ---------------------------------------------------------------
    console.log('\nTwitch, an der echten Schnittstelle');
    // ---------------------------------------------------------------

    const url = await twitch.verknuepfungsUrl({
        state: 'abc', rueckrufUrl: 'https://x/y', scopes: ['channel:read:subscriptions']
    });
    if (url) {
        pruefe(url.includes('scope=channel%3Aread%3Asubscriptions'),
            'angefragte Scopes stehen in der Adresse');
        const ohne = await twitch.verknuepfungsUrl({ state: 'abc', rueckrufUrl: 'https://x/y' });
        pruefe(/[?&]scope=(&|$)/.test(ohne),
            'ohne Zusage bleibt scope leer — vorhanden, aber leer',
            'weglassen ist etwas anderes als leer lassen');
    } else {
        pruefe(false, 'Zugangsdaten fuer Twitch vorhanden', 'ohne sie ist dieser Teil ungeprueft');
    }

    // Echter Aufruf gegen id.twitch.tv — braucht keine Zustimmung, weil ein
    // erfundener Token immer abgelehnt wird. Das prueft die Verdrahtung, den
    // Weg und die Fehlerbehandlung an der echten Schnittstelle.
    const ungueltigerToken = await twitch.pruefen({ zugang: 'offensichtlich-kein-token' });
    pruefe(ungueltigerToken.gueltig === false,
        'ein ungueltiger Token wird von Twitch als ungueltig gemeldet',
        'echter Aufruf an /oauth2/validate');

    const erneuernFehl = await twitch.erneuern({ erneuerung: 'kein-echter-schluessel' });
    pruefe(erneuernFehl === null, 'ein untaugliche Erneuerung endet sauber mit null',
        'kein Ausnahmefehler, der den Aufrufer mitreisst');

    await c.end();
    console.log(`\nErgebnis: ${faelle} Pruefungen, ${abweichungen} Abweichung(en).\n`);
    process.exit(abweichungen ? 1 : 0);
})().catch((err) => {
    console.error('\nFEHLER:', err);
    process.exit(1);
});
