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
 *   node scripts/streaming-probe.js <kanalname> [online|offline|update|abo|abo-ende] [--ja] [--frisch]
 *
 * Ohne `--ja` wird nur gezeigt, was geschehen wuerde. **Mit `--ja` entsteht
 * eine echte Nachricht im Discord** — bei `abo`/`abo-ende` stattdessen eine
 * echte Rollenaenderung.
 *
 * `abo` und `abo-ende` schicken `channel.subscribe` bzw.
 * `channel.subscription.end`. Wer abonniert, steht in `--abonnent=<Konto-ID>`;
 * ohne Angabe ist es der Kanalinhaber. Der Grund fuer diese Vorgabe: Eine Rolle
 * kann nur bei einem Twitch-Konto entstehen, das einem Discord-Mitglied
 * zugeordnet ist — ein erfundenes Konto laesst die Kette vorher enden, und dann
 * beweist die Probe nichts.
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
const ARTEN = ['online', 'offline', 'update', 'abo', 'abo-ende'];
const art = ARTEN.includes(artArg) ? artArg : 'online';

const EREIGNIS = {
    online: 'stream.online', offline: 'stream.offline', update: 'channel.update',
    abo: 'channel.subscribe', 'abo-ende': 'channel.subscription.end'
}[art];

/**
 * Wer abonniert (nur bei `abo`/`abo-ende`).
 *
 * **Vorgabe ist der Kanalinhaber selbst.** Nicht, weil das realistisch waere —
 * Twitch zaehlt ihn gar nicht als Abonnenten — sondern weil die Rolle nur bei
 * einem Konto entstehen kann, das in `user_connections` einem Discord-Mitglied
 * zugeordnet ist. Ein erfundenes Konto laesst die Kette schon eine Station
 * vorher enden, und dann beweist die Probe nichts.
 */
const abonnentArg = (rest.find(x => x.startsWith('--abonnent=')) || '').split('=')[1] || null;
const ABO_ART = art === 'abo' || art === 'abo-ende';
const ADRESSE = (process.env.DASHBOARD_BASE_URL || 'http://127.0.0.1:3000').replace(/\/+$/, '');

if (!kanalArg) {
    console.log(`\n  node scripts/streaming-probe.js <kanalname> [${ARTEN.join('|')}] [--ja]`);
    console.log('  bei abo/abo-ende zusaetzlich: [--abonnent=<Twitch-Konto-ID>]\n');
    process.exit(1);
}

/**
 * Die Nutzlast, wie Twitch sie schickt.
 *
 * **Eine Stelle, nicht zwei.** Sie stand vorher doppelt da — im Einzelversand
 * und in der Kette — und wer ein Ereignis dazunimmt, pflegt sonst genau eine
 * der beiden.
 *
 * @param {Object} s Streamer-Zeile
 * @param {string} ereignis Ereignisname
 * @param {string} sendungId Kennung der Sendung
 * @param {Object} opt { startVorMin, titel }
 * @returns {Object} `event`-Teil der Zustellung
 */
function nutzlastBauen(s, ereignis, sendungId, { startVorMin = 0, titel = 'Titel aus der Probe' } = {}) {
    const kanal = {
        broadcaster_user_id: String(s.kanal_id),
        broadcaster_user_login: s.login,
        broadcaster_user_name: s.anzeigename
    };

    if (ereignis === 'channel.update') {
        return { ...kanal, title: titel, category_name: 'Software and Game Development' };
    }

    if (ereignis === 'channel.subscribe' || ereignis === 'channel.subscription.end') {
        const kontoId = abonnentArg || String(s.kanal_id);
        const eigen = kontoId === String(s.kanal_id);
        return {
            ...kanal,
            user_id: kontoId,
            user_login: eigen ? s.login : `probe-${kontoId}`,
            user_name: eigen ? (s.anzeigename || s.login) : `Probe ${kontoId}`,
            tier: '1000',
            is_gift: false
        };
    }

    return {
        ...kanal, id: sendungId, type: 'live',
        started_at: new Date(Date.now() - startVorMin * 60000).toISOString()
    };
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
        event: nutzlastBauen(s, ereignis, sendungId, {
            startVorMin: 45,
            titel: `Titel gewechselt um ${new Date().toLocaleTimeString('de-DE')}`
        })
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

        // Bei einem Abo entscheiden zwei Dinge VOR dem Absenden, ob ueberhaupt
        // etwas entstehen kann. Beide versagen lautlos - deshalb stehen sie
        // hier, bevor man auf --ja drueckt.
        if (ABO_ART) {
            const kontoId = abonnentArg || String(s.kanal_id);
            const [verkn] = await c.query(
                'SELECT user_id FROM user_connections WHERE plattform = ? AND konto_id = ? LIMIT 1',
                [s.plattform, kontoId]);
            const [mitRolle] = await c.query(
                `SELECT id, guild_id, abo_rolle_id FROM streaming_targets
                  WHERE streamer_id = ? AND aktiv = 1 AND abo_rolle_id IS NOT NULL`, [s.id]);

            console.log(`  Abonnent:  ${kontoId}${abonnentArg ? '' : '  (der Kanalinhaber selbst — Vorgabe)'}`);
            console.log(`  Mitglied:  ${verkn[0]?.user_id || 'KEINES — ohne Verknuepfung kann keine Rolle entstehen'}`);
            console.log('  Abo-Rolle: ' + (mitRolle.length
                ? mitRolle.map(z => `${z.abo_rolle_id} (Ziel ${z.id})`).join(', ')
                : 'KEINE — kein aktives Ziel hat eine Abonnenten-Rolle'));

            if (!verkn.length || !mitRolle.length) {
                console.log('\n  ⚠ So endet die Kette vor der Rolle. Das ist kein Fehler im Code,');
                console.log('    aber die Probe wuerde nichts beweisen.');
            }
        }

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
            event: nutzlastBauen(s, EREIGNIS, sendungId)
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
            SELECT aktion, zustand, faellig_ab, fehlertext FROM streaming_outbox
             WHERE target_id IN (SELECT id FROM streaming_targets WHERE streamer_id = ?)
             ORDER BY id DESC LIMIT 5`, [s.id]);
        console.log('  Auftraege:  ' + (auftraege.length
            ? auftraege.map(a => `${a.aktion}=${a.zustand}${a.fehlertext ? ` (${a.fehlertext})` : ''}`).join(', ')
            : 'keine'));

        // **Der wichtigste Satz dieser Ausgabe.** Ein Auftrag auf "offen" mit
        // einer Faelligkeit in der Zukunft sieht aus wie ein Fehlschlag und ist
        // keiner - er wartet die Karenz ab. Ohne diese Zeile schaut man nach
        // zehn Sekunden ins Discord, sieht die unveraenderte Ankuendigung und
        // haelt das Aufraeumen fuer kaputt. Genau das ist am 2026-08-25 zweimal
        // passiert, bevor diese Zeile hier stand.
        const offen = auftraege.filter(a => a.zustand === 'offen' && new Date(a.faellig_ab) > new Date());
        if (offen.length) {
            console.log('');
            for (const a of offen) {
                const sekunden = Math.max(0, Math.round((new Date(a.faellig_ab) - Date.now()) / 1000));
                console.log(`  ⏳ "${a.aktion}" ist vorgemerkt, aber noch NICHT faellig:`);
                console.log(`     faellig um ${new Date(a.faellig_ab).toLocaleTimeString('de-DE')}, also in ${sekunden} s.`);
            }
            console.log('     Bis dahin bleibt die Nachricht im Discord unveraendert stehen —');
            console.log('     das ist die Karenz und richtig so: Kommt der Streamer innerhalb');
            console.log('     dieser Zeit zurueck, waere das Aufraeumen ein Fehler gewesen.');
            console.log('     Also warten und DANN nachsehen.');
        }

        // Bei einem Abo ist die Nachricht nicht das Ergebnis — die Rolle ist es.
        // Und die Buchfuehrung entscheidet, ob wir sie je wieder abziehen
        // duerfen ("nur zurueck, was wir gaben").
        if (ABO_ART) {
            const kontoId = abonnentArg || String(s.kanal_id);

            const [abonnent] = await c.query(
                `SELECT konto_name, stufe, geschenkt FROM streaming_subscribers
                  WHERE streamer_id = ? AND konto_id = ?`, [s.id, kontoId]);
            console.log('  Abonnent:    ' + (abonnent.length
                ? `vermerkt — Stufe ${abonnent[0].stufe || '—'}${abonnent[0].geschenkt ? ', geschenkt' : ''}`
                : 'steht NICHT in streaming_subscribers'));

            const [gaben] = await c.query(`
                SELECT g.guild_id, g.rolle_id, g.mitglied_id
                  FROM streaming_role_grants g
                 WHERE g.mitglied_id = (SELECT user_id FROM user_connections
                                         WHERE plattform = ? AND konto_id = ? LIMIT 1)`,
                [s.plattform, kontoId]);
            console.log('  Buchfuehrung: ' + (gaben.length
                ? gaben.map(g => `Rolle ${g.rolle_id} an ${g.mitglied_id}`).join(', ')
                : 'kein Eintrag in streaming_role_grants'));

            console.log('\n  Der Beweis steht in Discord, nicht hier: Traegt das Mitglied die Rolle?');
            if (art === 'abo') {
                console.log('  ⚠ Sie flackert. Der taegliche Abonnenten-Lauf holt die echte Liste bei');
                console.log('    Twitch — wer dort nicht steht, verliert sie wieder. Bei einer Probe');
                console.log('    mit dem Kanalinhaber ist das sicher: Twitch fuehrt ihn nicht als Abonnenten.');
            }
        }

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
