#!/usr/bin/env node
/**
 * Wo steht die Abonnenten-Rolle **im laufenden System**?
 *
 * `check-streaming-abonnenten.js` prueft die Rechnungen mit Attrappen — schnell,
 * nebenwirkungsfrei und blind fuer alles, was zwischen den Teilen liegt. Dieses
 * Skript geht den umgekehrten Weg: Es fasst nichts an, aber es fragt die echte
 * Datenbank und das echte Twitch.
 *
 * **Warum das ein eigenes Werkzeug ist.** Die Kette hat sieben Glieder, und
 * sechs davon versagen lautlos: keine Verknuepfung, keine Zusage, kein
 * EventSub-Abo, keine Rolle gewaehlt, Abonnent nicht verknuepft, Auftrag
 * haengt. In jedem dieser Faelle passiert genau nichts — ohne Fehlermeldung,
 * ohne Protokollzeile. Wer das von Hand sucht, sucht lange.
 *
 * Die Ausgabe sagt bei jedem Glied, **was der Betreiber tun muss**, statt nur
 * "fehlt" zu melden.
 *
 *   node scripts/check-streaming-abo-stand.js
 *
 * Exitcode 1, wenn die Kette irgendwo reisst.
 */
'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../apps/dashboard/.env'), quiet: true });

const mysql = require('mysql2/promise');
const { ServiceManager } = require('dunebot-core');

let reisst = false;

/**
 * @param {'ok'|'warn'|'stop'} art Art der Meldung
 * @param {string} text Beschreibung
 * @param {string} [tun] Was zu tun ist
 * @returns {void}
 */
function melde(art, text, tun = '') {
    const zeichen = { ok: '✓', warn: '·', stop: '✗' }[art];
    if (art === 'stop') reisst = true;
    console.log(`  ${zeichen} ${text}`);
    if (tun) console.log(`      → ${tun}`);
}

(async () => {
    const c = await mysql.createConnection({
        host: process.env.MYSQL_HOST, port: process.env.MYSQL_PORT || 3306,
        user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD,
        database: process.env.MYSQL_DATABASE
    });
    const q = async (sql, w = []) => (await c.query(sql, w))[0];

    ServiceManager.register('Logger', {
        info: () => {}, debug: () => {}, warn: () => {}, success: () => {},
        error: (...a) => console.log('     !', ...a.map(String))
    });
    ServiceManager.register('dbService', {
        async query(sql, w) { return q(sql, w); },
        async getConfig(plugin, key, context = 'shared', guildId = null) {
            const sql = `SELECT config_value FROM configs
                          WHERE plugin_name = ? AND config_key = ? AND context = ?
                            ${guildId ? 'AND guild_id = ?' : 'AND is_global = TRUE'} LIMIT 1`;
            const z = await q(sql, guildId ? [plugin, key, context, guildId] : [plugin, key, context]);
            return z[0] ? z[0].config_value : null;
        }
    });

    const speicher   = require('../apps/dashboard/helpers/Verbindungsspeicher');
    const abonnenten = require('../plugins/streaming/dashboard/kern/abonnenten');
    const twitch     = require('../plugins/streaming/dashboard/plattformen/twitch');

    // ---------------------------------------------------------------
    console.log('\n1. Ist der Umzug durch?');
    // ---------------------------------------------------------------

    const spalten = (await q('SHOW COLUMNS FROM streaming_targets')).map(z => z.Field);
    if (spalten.includes('abo_rolle_id')) melde('ok', 'streaming_targets.abo_rolle_id existiert');
    else melde('stop', 'streaming_targets.abo_rolle_id fehlt', 'node migrate.js run');

    const tab = await q("SHOW TABLES LIKE 'streaming_subscribers'");
    if (tab.length) melde('ok', 'streaming_subscribers existiert');
    else melde('stop', 'streaming_subscribers fehlt', 'node migrate.js run');

    if (reisst) { await c.end(); process.exit(1); }

    // ---------------------------------------------------------------
    console.log('\n2. Will ueberhaupt jemand eine Abonnenten-Rolle?');
    // ---------------------------------------------------------------

    const ziele = await q(`
        SELECT t.id, t.guild_id, t.abo_rolle_id, t.aktiv, s.id AS streamer_id, s.login, s.plattform, s.kanal_id
          FROM streaming_targets t
          JOIN streaming_streamers s ON s.id = t.streamer_id
         WHERE t.abo_rolle_id IS NOT NULL AND t.abo_rolle_id <> ''
    `);

    if (!ziele.length) {
        melde('warn', 'kein Ziel hat eine Abonnenten-Rolle gewaehlt',
            'Dashboard → Guild → Streaming → Ziele → "Abonnenten-Rolle" waehlen');
        console.log('\n  Nichts weiter zu pruefen — die Kette hat noch keinen Anfang.\n');
        await c.end();
        process.exit(0);
    }

    for (const z of ziele) {
        melde(z.aktiv ? 'ok' : 'warn',
            `Guild ${z.guild_id}: Rolle ${z.abo_rolle_id} fuer ${z.login}` + (z.aktiv ? '' : ' (Ziel ist ABGESCHALTET)'),
            z.aktiv ? '' : 'Das Ziel aktivieren, sonst zaehlt es nirgends mit');
    }

    // Je Kanal einmal weiterpruefen, nicht je Ziel.
    const kanaele = [...new Map(ziele.filter(z => z.aktiv).map(z => [z.streamer_id, z])).values()];

    for (const k of kanaele) {
        console.log(`\n--- Kanal ${k.login} (${k.kanal_id}) ---`);

        // ---------------------------------------------------------------
        console.log('\n3. Hat der Kanalinhaber sich verknuepft?');
        // ---------------------------------------------------------------

        const inhaber = await abonnenten.kanalInhaber(k);
        if (!inhaber) {
            melde('stop', 'niemand hat diesen Kanal verknuepft',
                `Der Inhaber von "${k.login}" muss sich im Dashboard anmelden und unter ` +
                'Profil → Verbundene Konten sein Twitch-Konto verbinden. Niemand kann das fuer ihn tun.');
            continue;
        }
        melde('ok', `verknuepft mit Discord-Benutzer ${inhaber}`);

        // ---------------------------------------------------------------
        console.log('\n4. Hat er das Lesen der Abonnenten erlaubt?');
        // ---------------------------------------------------------------

        const zusage = await speicher.zusageLesen(inhaber, k.plattform);
        const scopes = String(zusage?.scopes || '').split(' ').filter(Boolean);

        if (!scopes.includes('channel:read:subscriptions')) {
            melde('stop', 'die Zusage "Abonnenten lesen" fehlt',
                'Profil → Verbundene Konten → bei Twitch "Abonnenten lesen" erteilen');
            continue;
        }
        melde('ok', `Zusage vorhanden (${scopes.join(' ')})`);
        if (zusage.fehlertext) {
            melde('stop', `die Zusage ist als ungueltig vermerkt: ${zusage.fehlertext}`,
                'Erneut erteilen — vermutlich Passwort geaendert oder App getrennt');
            continue;
        }
        melde('ok', `zuletzt geprueft: ${zusage.geprueft_am || 'noch nie'}`);

        // ---------------------------------------------------------------
        console.log('\n5. Stehen die EventSub-Abos?');
        // ---------------------------------------------------------------

        // Beschreibungen herein, Namen heraus — in der Tabelle steht `typ`.
        const noetig = twitch.typenVon(twitch.EREIGNISSE_ABO);
        const haben = await q(
            'SELECT ereignis, zustand FROM streaming_subscriptions WHERE streamer_id = ?', [k.streamer_id]);
        const stand = new Map(haben.map(h => [h.ereignis, h.zustand]));

        for (const e of noetig) {
            const z = stand.get(e);
            if (z === 'bestaetigt') melde('ok', `${e}: bestaetigt`);
            else if (z) melde('warn', `${e}: ${z}`, 'Der taegliche Abgleich holt das nach');
            else melde('stop', `${e}: kein Abo`,
                'Ziel einmal speichern — das legt die fehlenden Abos an');
        }

        // ---------------------------------------------------------------
        console.log('\n6. Was sagt Twitch?');
        // ---------------------------------------------------------------

        const ergebnis = await speicher.mitZugang({ userId: inhaber, plattform: k.plattform },
            async (zugang) => await twitch.abonnentenLesen(k.kanal_id, zugang));

        if (!ergebnis) { melde('stop', 'kein Zugang — Zusage nicht lesbar'); continue; }
        if (ergebnis.abgelehnt) {
            melde('stop', 'Twitch lehnt den Zugang ab (401)',
                'Die Zusage neu erteilen');
            continue;
        }
        if (!ergebnis.ok) {
            melde('warn', 'Abonnentenliste gerade nicht lesbar — nichts wird geaendert',
                'Kein Handlungsbedarf, spaeter erneut pruefen');
            continue;
        }
        melde('ok', `${ergebnis.abonnenten.length} Abonnent(en) bei Twitch`);

        // ---------------------------------------------------------------
        console.log('\n7. Wer davon kann eine Rolle bekommen?');
        // ---------------------------------------------------------------

        let verknuepft = 0;
        for (const a of ergebnis.abonnenten) {
            const m = await abonnenten.mitgliedFuer(k.plattform, a.kontoId);
            if (m) verknuepft++;
        }

        if (!ergebnis.abonnenten.length) {
            melde('warn', 'noch niemand abonniert — nichts zu vergeben');
        } else if (!verknuepft) {
            melde('warn', `0 von ${ergebnis.abonnenten.length} haben ihr Discord-Konto verknuepft`,
                'Das ist kein Fehler: Wer sich verknuepft, bekommt die Rolle beim naechsten Abgleich');
        } else {
            melde('ok', `${verknuepft} von ${ergebnis.abonnenten.length} sind verknuepft`);
        }

        // ---------------------------------------------------------------
        console.log('\n8. Was ist tatsaechlich vergeben?');
        // ---------------------------------------------------------------

        for (const z of ziele.filter(x => x.streamer_id === k.streamer_id && x.aktiv)) {
            const vergeben = await q(
                'SELECT COUNT(*) AS n FROM streaming_role_grants WHERE guild_id = ? AND rolle_id = ?',
                [z.guild_id, z.abo_rolle_id]);
            melde('ok', `Guild ${z.guild_id}: ${vergeben[0].n} Vergabe(n) in unserer Buchfuehrung`);
        }

        // **`JSON_UNQUOTE` ist hier kein Zierrat.** `JSON_EXTRACT` liefert
        // `"abo"` MIT Anfuehrungszeichen. Dass der direkte Vergleich auf
        // diesem MariaDB 10.6 trotzdem trifft, ist eine Freundlichkeit der
        // Fassung, keine Zusage — und ein Vergleich, der still nie trifft,
        // meldete hier auf ewig "0 offene Auftraege". Nachgemessen am
        // 2026-08-26: beide Formen liefern 1, genommen wird die eindeutige.
        let offen;
        try {
            offen = (await q(`
                SELECT COUNT(*) AS n FROM streaming_outbox
                 WHERE zustand = 'offen' AND aktion LIKE 'rolle_%'
                   AND JSON_UNQUOTE(JSON_EXTRACT(nutzlast, '$.grund')) = 'abo'
            `))[0].n;
        } catch (err) {
            // Nicht schweigend eine Zahl erfinden: Eine kaputte Abfrage sieht
            // sonst aus wie "nichts offen".
            melde('warn', `offene Auftraege nicht zaehlbar: ${err.message}`);
            offen = null;
        }
        if (offen !== null) melde('ok', `${offen} offene(r) Abo-Rollenauftrag/-auftraege im Ausgang`);
    }

    console.log(reisst
        ? '\nDie Kette reisst — siehe die Pfeile oben.\n'
        : '\nDie Kette ist durchgehend.\n');

    await c.end();
    process.exit(reisst ? 1 : 0);
})().catch((err) => {
    console.error('\nFEHLER:', err);
    process.exit(1);
});
