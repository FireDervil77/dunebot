#!/usr/bin/env node
/**
 * Faehrt die nebenwirkungsfreien Gegenproben der Abnahme (Stufe 8) gegen die
 * **laufende** Anlage.
 *
 * Der Unterschied zu `check-streaming-eingang.js` ist der ganze Punkt: Dort
 * werden reine Funktionen durchgespielt, hier klopft es am echten Endpunkt an.
 * Eine Signaturpruefung, die als Funktion stimmt, aber im Router nicht
 * aufgerufen wird, faellt nur hier auf.
 *
 * **Nebenwirkungsfrei heisst hier woertlich:** Kein Fall erzeugt eine
 * Discord-Nachricht, keiner aendert einen Zustand. Die Faelle 11, 12, 13, 14,
 * 15, 16, 17 und 20 fehlen deshalb - sie brauchen entweder echte Nachrichten
 * oder einen Handgriff in Discord und stehen im Abnahmeprotokoll als
 * "Betreiber".
 *
 *   node scripts/check-streaming-abnahme.js
 *
 * Exitcode 1, wenn ein Fall scheitert.
 */
'use strict';

const crypto = require('crypto');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../apps/dashboard/.env'), quiet: true });
const mysql = require('mysql2/promise');

const ADRESSE = (process.env.DASHBOARD_BASE_URL || 'http://127.0.0.1:3000').replace(/\/+$/, '');

let faelle = 0;
let gescheitert = 0;

/**
 * @param {string} was Beschreibung
 * @param {boolean} gut Ergebnis
 * @param {string} [zusatz] Messwert
 */
function pruefe(was, gut, zusatz = '') {
    faelle++;
    if (!gut) gescheitert++;
    console.log(`  ${gut ? '✓' : '✗'} ${was}${zusatz ? `  — ${zusatz}` : ''}`);
}

/**
 * Eine Zustellung bauen und schicken.
 *
 * @param {Object} opt Angaben
 * @returns {Promise<{status: number, ms: number, msgId: string}>} Ergebnis
 */
async function zustellen(opt) {
    const roh = Buffer.from(JSON.stringify(opt.koerper), 'utf8');
    const msgId = opt.msgId || `abnahme-${crypto.randomUUID()}`;
    const zeit = opt.zeit || new Date().toISOString();

    const signatur = opt.signatur !== undefined
        ? opt.signatur
        : 'sha256=' + crypto.createHmac('sha256', opt.geheimnis)
            .update(Buffer.concat([Buffer.from(msgId), Buffer.from(zeit), roh])).digest('hex');

    const beginn = Date.now();
    const antwort = await fetch(`${ADRESSE}${opt.pfad || '/api/streaming/webhook'}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Twitch-Eventsub-Message-Id': msgId,
            'Twitch-Eventsub-Message-Timestamp': zeit,
            'Twitch-Eventsub-Message-Signature': signatur,
            'Twitch-Eventsub-Message-Type': 'notification',
            'Twitch-Eventsub-Subscription-Type': opt.ereignis || 'channel.update',
            'Twitch-Eventsub-Subscription-Version': '1'
        },
        body: roh
    });

    return { status: antwort.status, ms: Date.now() - beginn, msgId };
}

(async () => {
    const c = await mysql.createConnection({
        host: process.env.MYSQL_HOST, port: process.env.MYSQL_PORT || 3306,
        user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD,
        database: process.env.MYSQL_DATABASE
    });
    const q = async (sql, w) => { const [r] = await c.query(sql, w); return r; };

    // Einen Streamer mit Abo und bekanntem Zustand nehmen. Bewusst einen, der
    // NICHT live ist: Dann erzeugt `channel.update` keine Auftraege.
    const s = (await q(`
        SELECT s.*, z.titel, z.kategorie, z.ist_live
          FROM streaming_streamers s
          LEFT JOIN streaming_state z ON z.streamer_id = s.id
         WHERE EXISTS (SELECT 1 FROM streaming_subscriptions a
                        WHERE a.streamer_id = s.id AND a.ereignis = 'channel.update')
           AND (z.ist_live = 0 OR z.ist_live IS NULL)
         LIMIT 1`))[0];

    if (!s) { console.log('\n  Kein geeigneter Streamer (offline, mit channel.update-Abo) gefunden.\n'); process.exit(1); }

    const abo = (await q(
        "SELECT * FROM streaming_subscriptions WHERE streamer_id = ? AND ereignis = 'channel.update' LIMIT 1",
        [s.id]))[0];

    console.log(`\nAbnahme gegen ${ADRESSE}  (Streamer: ${s.login}, offline)`);

    /**
     * **Wichtig: derselbe Titel wie jetzt.** Ein `channel.update` schreibt
     * Titel und Kategorie in den Zustand. Mit den vorhandenen Werten ist das
     * ein Nullschritt - die Probe darf keine echten Angaben ueberschreiben.
     */
    const koerper = {
        subscription: {
            id: abo.anbieter_abo_id, type: 'channel.update', version: '1', status: 'enabled',
            condition: { broadcaster_user_id: String(s.kanal_id) }
        },
        event: {
            broadcaster_user_id: String(s.kanal_id),
            broadcaster_user_login: s.login,
            broadcaster_user_name: s.anzeigename,
            title: s.titel || '',
            category_name: s.kategorie || ''
        }
    };

    const vorher = (await q('SELECT COUNT(*) n FROM streaming_events'))[0].n;

    // ---------------------------------------------------------------- 8
    console.log('\nFall 8 — Signatur verstellt');
    const a8 = await zustellen({ koerper, geheimnis: abo.geheimnis, signatur: 'sha256=' + 'f'.repeat(64) });
    pruefe('wird abgelehnt', a8.status >= 400 && a8.status < 500, `HTTP ${a8.status}`);
    const nach8 = (await q('SELECT COUNT(*) n FROM streaming_events'))[0].n;
    pruefe('nichts im Posteingang', nach8 === vorher, `${vorher} -> ${nach8}`);

    // ---------------------------------------------------------------- 10
    console.log('\nFall 10 — Zeitstempel 20 Minuten alt');
    const alt = new Date(Date.now() - 20 * 60000).toISOString();
    const a10 = await zustellen({ koerper, geheimnis: abo.geheimnis, zeit: alt });
    pruefe('wird abgelehnt', a10.status >= 400 && a10.status < 500, `HTTP ${a10.status}`);
    const nach10 = (await q('SELECT COUNT(*) n FROM streaming_events'))[0].n;
    pruefe('nichts im Posteingang', nach10 === vorher, `${vorher} -> ${nach10}`);

    // ---------------------------------------------------------------- 19
    console.log('\nFall 19 — fremder Plugin-Eingang');
    const a19 = await zustellen({ koerper, geheimnis: abo.geheimnis, pfad: '/api/gameserver/webhook' });
    pruefe('/api/gameserver/webhook antwortet 404', a19.status === 404, `HTTP ${a19.status}`);

    // ---------------------------------------------------------------- 9
    console.log('\nFall 9 — dieselbe Zustellung zweimal');
    const msgId = `abnahme-dublette-${crypto.randomUUID()}`;
    const e1 = await zustellen({ koerper, geheimnis: abo.geheimnis, msgId });
    const e2 = await zustellen({ koerper, geheimnis: abo.geheimnis, msgId });
    pruefe('beide werden angenommen', e1.status < 300 && e2.status < 300, `HTTP ${e1.status} / ${e2.status}`);

    await new Promise(r => setTimeout(r, 1500));   // dem Takt Zeit lassen
    const zeilen = await q('SELECT zustand FROM streaming_events WHERE anbieter_msg_id = ?', [msgId]);
    pruefe('genau eine Zeile im Posteingang', zeilen.length === 1, `${zeilen.length} Zeile(n)`);
    // **Die Wiederholung darf das Original nicht aus der Warteschlange nehmen.**
    // Genau das tat der Eingang bis zum 2026-08-25: Er setzte `dublette`, wenn
    // die Zeile noch auf `neu` stand - und `neu` ist die Warteschlange, aus der
    // sich der Takt bedient. Eine Wiederholung vor der Verarbeitung liess die
    // Ankuendigung damit lautlos ausfallen. Gefunden genau hier.
    pruefe('das Original wurde verarbeitet, nicht verworfen',
        zeilen.length === 1 && zeilen[0].zustand !== 'dublette',
        zeilen[0] ? `zustand = ${zeilen[0].zustand}` : '—');

    const auftraege = await q(
        "SELECT COUNT(*) n FROM streaming_outbox WHERE angelegt_am >= DATE_SUB(NOW(), INTERVAL 2 MINUTE)");
    pruefe('kein Auftrag entstanden (Streamer ist offline)', auftraege[0].n === 0, `${auftraege[0].n} Auftrag/Auftraege`);

    // ---------------------------------------------------------------- 18
    console.log('\nFall 18 — dreissig Zustellungen in schneller Folge');
    // Bewusst mit falscher Signatur: Es geht um die MENGENGRENZE, nicht um die
    // Verarbeitung. Der `generalLimiter` (60/min je IP) steht projektweit vor
    // jeder Route; kaeme er auch hier zum Zug, antwortete er mit 429 - und
    // Twitch wertet das als Fehlschlag und widerruft irgendwann die Abos
    // ALLER Guilds. Genau deshalb haengt der Eingang vor den
    // Sicherheits-Middlewares.
    const zeiten = [];
    let neunundzwanzig = 0;
    for (let i = 0; i < 30; i++) {
        const a = await zustellen({ koerper, geheimnis: abo.geheimnis, signatur: 'sha256=' + 'e'.repeat(64) });
        zeiten.push(a.ms);
        if (a.status === 429) neunundzwanzig++;
    }
    pruefe('kein einziges 429', neunundzwanzig === 0, `${neunundzwanzig} von 30`);
    zeiten.sort((x, y) => x - y);
    const mittel = Math.round(zeiten.reduce((a, b) => a + b, 0) / zeiten.length);
    console.log(`      Antwortzeit abgelehnter Zustellungen: Mittel ${mittel} ms, ` +
        `Median ${zeiten[15]} ms, groesster Wert ${zeiten[29]} ms`);
    console.log('      (Das ist NICHT die Messung aus Abschnitt C — die verlangt echte,');
    console.log('       angenommene Zustellungen. Abgelehnte sind schneller.)');

    const nachAllem = (await q('SELECT COUNT(*) n FROM streaming_events'))[0].n;
    console.log(`\nPosteingang: ${vorher} vor der Abnahme, ${nachAllem} danach ` +
        `(+${nachAllem - vorher} — genau die eine Dublettenprobe)`);

    await c.end();
    console.log(gescheitert === 0
        ? `\nErgebnis: ${faelle} Faelle, 0 Abweichungen.\n`
        : `\nErgebnis: ${faelle} Faelle, ${gescheitert} Abweichung(en).\n`);
    process.exit(gescheitert === 0 ? 0 : 1);
})().catch(e => { console.log('\nAbnahme abgebrochen:', e.message, '\n'); process.exit(1); });
