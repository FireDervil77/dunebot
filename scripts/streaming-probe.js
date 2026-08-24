#!/usr/bin/env node
/**
 * Schickt eine echte, korrekt signierte Zustellung an den eigenen Eingang.
 *
 * Damit laesst sich die ganze Kette pruefen, ohne live zu gehen:
 *
 *     Eingang -> Signatur -> Posteingang -> Takt -> Entscheidung
 *             -> Auffaecherung -> Ausgang -> Bot -> Discord
 *
 * Das Einzige, was NICHT geprueft wird, ist der Weg von Twitch zu uns — und
 * der ist bereits bewiesen: Die Abos stehen auf "bestaetigt", also hat Twitch
 * uns erreicht und wir haben richtig geantwortet.
 *
 * Die Signatur wird mit dem echten Geheimnis des Abos gebildet. Eine Probe mit
 * falscher Signatur wuerde abgelehnt — genau wie ein Angriff.
 *
 *   node scripts/streaming-probe.js <kanalname> [online|offline|update] [--ja] [--frisch]
 *
 * Ohne `--ja` wird nur gezeigt, was geschehen wuerde. **Mit `--ja` entsteht
 * eine echte Nachricht im Discord.**
 *
 * `--frisch` setzt vorher den Zustand des Streamers zurueck (nicht live, keine
 * letzte Meldung). Ohne das greift beim zweiten Versuch die Abklingzeit - im
 * Betrieb genau richtig, beim Proben hinderlich.
 *
 * `--kette` spielt den ganzen Ablauf durch: live gehen, Titel wechseln,
 * beenden. Das ist noetig, weil der Anreicherungslauf alle 30 Sekunden bei der
 * Plattform nachfragt - und dort ist der Kanal natuerlich NICHT live. Er setzt
 * den Zustand dann zurueck (richtig so, das ist die Selbstheilung gegen
 * verlorene offline-Meldungen), womit ein einzeln geschicktes `update` oder
 * `offline` ins Leere laeuft. Die Kette haelt den Zustand zwischen den
 * Schritten aufrecht.
 */
'use strict';

const crypto = require('crypto');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../apps/dashboard/.env') });
const mysql = require('mysql2/promise');

const [, , kanalArg, artArg = 'online', ...rest] = process.argv;
const ernst = rest.includes('--ja') || artArg === '--ja';
const frisch = rest.includes('--frisch') || artArg === '--frisch';
const kette = rest.includes('--kette') || artArg === '--kette';
const art = ['online', 'offline', 'update'].includes(artArg) ? artArg : 'online';

const EREIGNIS = { online: 'stream.online', offline: 'stream.offline', update: 'channel.update' }[art];
const ADRESSE = (process.env.DASHBOARD_BASE_URL || 'http://127.0.0.1:3000').replace(/\/+$/, '');

if (!kanalArg) {
    console.log('\n  node scripts/streaming-probe.js <kanalname> [online|offline|update] [--ja]\n');
    process.exit(1);
}

/**
 * Eine einzelne Zustellung schicken.
 *
 * @param {Object} c Datenbankverbindung
 * @param {Object} s Streamer-Zeile
 * @param {string} ereignis Ereignisname
 * @param {string} sendungId Kennung der Sendung
 * @returns {Promise<{status: number, msgId: string, ms: number}>} Ergebnis
 */
async function schicken(c, s, ereignis, sendungId) {
    const [abo] = await c.query(
        'SELECT * FROM streaming_subscriptions WHERE streamer_id = ? AND ereignis = ? LIMIT 1',
        [s.id, ereignis]);
    if (!abo.length) throw new Error(`Kein Abo "${ereignis}"`);

    const koerper = {
        subscription: {
            id: abo[0].anbieter_abo_id, type: ereignis, version: '1', status: 'enabled',
            condition: { broadcaster_user_id: String(s.kanal_id) }
        },
        event: ereignis === 'channel.update'
            ? {
                broadcaster_user_id: String(s.kanal_id), broadcaster_user_login: s.login,
                broadcaster_user_name: s.anzeigename, title: `Titel gewechselt um ${new Date().toLocaleTimeString('de-DE')}`,
                category_name: 'Software and Game Development'
            }
            : {
                id: sendungId, broadcaster_user_id: String(s.kanal_id),
                broadcaster_user_login: s.login, broadcaster_user_name: s.anzeigename,
                type: 'live', started_at: new Date(Date.now() - 45 * 60000).toISOString()
            }
    };

    const roh = Buffer.from(JSON.stringify(koerper), 'utf8');
    const msgId = `probe-${crypto.randomUUID()}`;
    const zeit = new Date().toISOString();
    const signatur = 'sha256=' + crypto.createHmac('sha256', abo[0].geheimnis)
        .update(Buffer.concat([Buffer.from(msgId), Buffer.from(zeit), roh])).digest('hex');

    const beginn = Date.now();
    const antwort = await fetch(`${ADRESSE}/api/streaming/webhook`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Twitch-Eventsub-Message-Id': msgId,
            'Twitch-Eventsub-Message-Timestamp': zeit,
            'Twitch-Eventsub-Message-Signature': signatur,
            'Twitch-Eventsub-Message-Type': 'notification',
            'Twitch-Eventsub-Subscription-Type': ereignis,
            'Twitch-Eventsub-Subscription-Version': '1'
        },
        body: roh
    });

    return { status: antwort.status, msgId, ms: Date.now() - beginn };
}

/**
 * Den ganzen Ablauf durchspielen.
 *
 * @param {Object} c Datenbankverbindung
 * @param {Object} s Streamer-Zeile
 * @returns {Promise<void>}
 */
async function ketteFahren(c, s) {
    const sendungId = `probe-${Date.now()}`;

    /** Zeigt, was in der Datenbank steht. */
    const stand = async (was) => {
        const [n] = await c.query(`
            SELECT m.message_id, m.zustand FROM streaming_messages m
              JOIN streaming_targets t ON t.id = m.target_id
             WHERE t.streamer_id = ? ORDER BY m.id DESC LIMIT 1`, [s.id]);
        const [z] = await c.query('SELECT ist_live, titel FROM streaming_state WHERE streamer_id = ?', [s.id]);
        console.log(`     ${was}: Nachricht ${n[0]?.zustand || '—'}${n[0]?.message_id ? ` (${n[0].message_id})` : ''}` +
            ` · live=${z[0]?.ist_live ?? '—'} · Titel "${z[0]?.titel || '—'}"`);
    };

    console.log('\n  1) live gehen');
    await c.query("UPDATE streaming_state SET ist_live = 0, sendung_id = NULL, zuletzt_gemeldet_am = NULL, beendet_am = NULL WHERE streamer_id = ?", [s.id]);
    let r = await schicken(c, s, 'stream.online', sendungId);
    console.log(`     Antwort ${r.status} nach ${r.ms} ms`);
    await new Promise(x => setTimeout(x, 9000));
    await stand('danach');

    console.log('\n  2) Titel wechseln (darf KEINE neue Nachricht erzeugen)');
    // Die Anreicherung koennte inzwischen zurueckgesetzt haben - der Kanal ist
    // bei Twitch ja wirklich nicht live. Fuer die Probe halten wir ihn live.
    await c.query('UPDATE streaming_state SET ist_live = 1, angereichert_am = NOW() WHERE streamer_id = ?', [s.id]);
    r = await schicken(c, s, 'channel.update', sendungId);
    console.log(`     Antwort ${r.status} nach ${r.ms} ms`);
    await new Promise(x => setTimeout(x, 9000));
    await stand('danach');

    console.log('\n  3) beenden (Nachricht wird zur Rueckschau)');
    await c.query('UPDATE streaming_state SET ist_live = 1 WHERE streamer_id = ?', [s.id]);
    r = await schicken(c, s, 'stream.offline', sendungId);
    console.log(`     Antwort ${r.status} nach ${r.ms} ms`);
    console.log('     (Karenz: 2 Minuten, dann wird aufgeraeumt)');
    await new Promise(x => setTimeout(x, 9000));
    await stand('danach');

    const [auftraege] = await c.query(`
        SELECT aktion, zustand, faellig_ab, fehlertext FROM streaming_outbox
         WHERE target_id IN (SELECT id FROM streaming_targets WHERE streamer_id = ?)
         ORDER BY id DESC LIMIT 4`, [s.id]);
    console.log('\n  Auftraege:');
    auftraege.forEach(a => console.log(`     ${a.aktion} = ${a.zustand}` +
        (a.zustand === 'offen' ? `  (faellig ${new Date(a.faellig_ab).toLocaleTimeString('de-DE')})` : '') +
        (a.fehlertext ? `  — ${a.fehlertext}` : '')));
    console.log('');
}

(async () => {
    let c;
    try {
        c = await mysql.createConnection({
            host: process.env.MYSQL_HOST, port: process.env.MYSQL_PORT || 3306,
            user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD,
            database: process.env.MYSQL_DATABASE
        });

        const [streamer] = await c.query(
            'SELECT * FROM streaming_streamers WHERE login = ? LIMIT 1', [String(kanalArg).toLowerCase()]);
        if (!streamer.length) {
            console.log(`\n  Kanal "${kanalArg}" ist nicht eingetragen.\n`);
            process.exit(1);
        }
        const s = streamer[0];

        const [abo] = await c.query(
            'SELECT * FROM streaming_subscriptions WHERE streamer_id = ? AND ereignis = ? LIMIT 1',
            [s.id, EREIGNIS]);
        if (!abo.length) {
            console.log(`\n  Kein Abo "${EREIGNIS}" fuer ${s.login}.\n`);
            process.exit(1);
        }

        const [ziele] = await c.query(
            'SELECT t.*, COUNT(*) OVER () AS anzahl FROM streaming_targets t WHERE t.streamer_id = ? AND t.aktiv = 1', [s.id]);

        console.log(`\n  Kanal:     ${s.anzeigename || s.login}  (ID ${s.kanal_id})`);
        console.log(`  Ereignis:  ${EREIGNIS}`);
        console.log(`  Abo:       ${abo[0].zustand}`);
        console.log(`  Ziele:     ${ziele.length}`);
        console.log(`  Adresse:   ${ADRESSE}/api/streaming/webhook`);
        if (frisch) console.log('  Zustand:   wird vorher zurueckgesetzt (--frisch)');

        if (!ernst) {
            console.log('\n  Das war die Vorschau. Mit --ja wird es wirklich geschickt —');
            console.log('  und dann entsteht eine ECHTE Nachricht in deinem Discord.\n');
            process.exit(0);
        }

        if (kette) {
            await ketteFahren(c, s);
            process.exit(0);
        }

        if (frisch) {
            await c.query(
                "UPDATE streaming_state SET ist_live = 0, sendung_id = NULL, zuletzt_gemeldet_am = NULL, beendet_am = NULL WHERE streamer_id = ?",
                [s.id]);
        }

        // Nutzlast wie Twitch sie schickt. Die Sendungskennung traegt die
        // Uhrzeit, damit sich die Probe wiederholen laesst, ohne als Dublette
        // zu gelten.
        const sendungId = `probe-${Date.now()}`;
        const koerper = {
            subscription: {
                id: abo[0].anbieter_abo_id, type: EREIGNIS, version: '1', status: 'enabled',
                condition: { broadcaster_user_id: String(s.kanal_id) }
            },
            event: art === 'update'
                ? {
                    broadcaster_user_id: String(s.kanal_id), broadcaster_user_login: s.login,
                    broadcaster_user_name: s.anzeigename, title: 'Titel aus der Probe',
                    category_name: 'Software and Game Development'
                }
                : {
                    id: sendungId, broadcaster_user_id: String(s.kanal_id),
                    broadcaster_user_login: s.login, broadcaster_user_name: s.anzeigename,
                    type: 'live', started_at: new Date().toISOString()
                }
        };

        const roh = Buffer.from(JSON.stringify(koerper), 'utf8');
        const msgId = `probe-${crypto.randomUUID()}`;
        const zeit = new Date().toISOString();
        const signatur = 'sha256=' + crypto.createHmac('sha256', abo[0].geheimnis)
            .update(Buffer.concat([Buffer.from(msgId), Buffer.from(zeit), roh])).digest('hex');

        const beginn = Date.now();
        const antwort = await fetch(`${ADRESSE}/api/streaming/webhook`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Twitch-Eventsub-Message-Id': msgId,
                'Twitch-Eventsub-Message-Timestamp': zeit,
                'Twitch-Eventsub-Message-Signature': signatur,
                'Twitch-Eventsub-Message-Type': 'notification',
                'Twitch-Eventsub-Subscription-Type': EREIGNIS,
                'Twitch-Eventsub-Subscription-Version': '1'
            },
            body: roh
        });

        console.log(`\n  Antwort:   ${antwort.status} nach ${Date.now() - beginn} ms`);
        if (antwort.status !== 204) {
            console.log('  Erwartet waren 204. Der Grund steht im Dashboard-Log.\n');
            process.exit(1);
        }

        // Der Takt laeuft alle 5 s, die Drossel alle 500 ms.
        console.log('  Warte auf Verarbeitung …');
        await new Promise(r => setTimeout(r, 8000));

        const [ereignisse] = await c.query(
            'SELECT zustand, fehlertext FROM streaming_events WHERE anbieter_msg_id = ?', [msgId]);
        console.log(`\n  Posteingang: ${ereignisse[0]?.zustand || 'nicht gefunden'}` +
            (ereignisse[0]?.fehlertext ? `  — ${ereignisse[0].fehlertext}` : ''));

        const [auftraege] = await c.query(`
            SELECT aktion, zustand, fehlertext FROM streaming_outbox
             WHERE target_id IN (SELECT id FROM streaming_targets WHERE streamer_id = ?)
             ORDER BY id DESC LIMIT 5`, [s.id]);
        console.log('  Auftraege:  ' + (auftraege.length
            ? auftraege.map(a => `${a.aktion}=${a.zustand}${a.fehlertext ? ` (${a.fehlertext})` : ''}`).join(', ')
            : 'keine'));

        const [nachrichten] = await c.query(`
            SELECT message_id, zustand FROM streaming_messages
             WHERE target_id IN (SELECT id FROM streaming_targets WHERE streamer_id = ?)
             ORDER BY id DESC LIMIT 3`, [s.id]);
        console.log('  Nachrichten: ' + (nachrichten.length
            ? nachrichten.map(n => `${n.zustand}${n.message_id ? ` (${n.message_id})` : ''}`).join(', ')
            : 'keine'));

        console.log('');
    } catch (err) {
        console.log('\n  FEHLER:', err.message, '\n');
        process.exitCode = 1;
    } finally {
        if (c) await c.end().catch(() => {});
        process.exit(process.exitCode || 0);
    }
})();
