#!/usr/bin/env node
/**
 * Prueft den Eingang des Streaming-Plugins ohne Anlage und ohne Twitch.
 *
 * Signaturpruefung, Altersgrenze, Einordnung und Uebersetzung sind reine
 * Funktionen — die lassen sich vollstaendig durchspielen, und genau das
 * gehoert getan, BEVOR ein echtes Ereignis kommt. Ein Eingang, der nur den
 * guten Fall kennt, ist nicht geprueft: Die Faelle, die zaehlen, sind die
 * abgelehnten.
 *
 *   node scripts/check-streaming-eingang.js
 *
 * Exitcode 1, wenn ein Fall scheitert.
 */
'use strict';

const crypto = require('crypto');
const twitch = require('../plugins/streaming/dashboard/plattformen/twitch');

let geprueft = 0;
let gescheitert = 0;

/**
 * @param {string} was Beschreibung
 * @param {*} ist Ergebnis
 * @param {*} soll Erwartung
 */
function pruefe(was, ist, soll) {
    geprueft++;
    const gut = JSON.stringify(ist) === JSON.stringify(soll);
    if (!gut) gescheitert++;
    console.log(`  ${gut ? '✓' : '✗'} ${was}${gut ? '' : `  (ist: ${JSON.stringify(ist)}, soll: ${JSON.stringify(soll)})`}`);
}

const GEHEIMNIS = 'a'.repeat(64);

/**
 * Baut eine Zustellung, wie Twitch sie schickt.
 *
 * @param {Object} [opt] Abweichungen
 * @returns {Object} { headers, roherKoerper, koerper }
 */
function zustellung(opt = {}) {
    const koerper = opt.koerper || {
        subscription: { id: 'abo-1', type: 'stream.online', status: 'enabled',
                        condition: { broadcaster_user_id: '12345' } },
        event: { id: 'sendung-1', broadcaster_user_id: '12345',
                 broadcaster_user_login: 'ninja', started_at: '2026-08-23T18:00:00Z' }
    };
    const roherKoerper = Buffer.from(opt.rohtext ?? JSON.stringify(koerper), 'utf8');
    const id = opt.id ?? 'msg-1';
    const zeit = opt.zeit ?? new Date().toISOString();
    const geheimnis = opt.geheimnis ?? GEHEIMNIS;

    const signatur = opt.signatur ?? ('sha256=' + crypto.createHmac('sha256', geheimnis)
        .update(Buffer.concat([Buffer.from(id), Buffer.from(zeit), roherKoerper])).digest('hex'));

    return {
        headers: {
            'twitch-eventsub-message-id': id,
            'twitch-eventsub-message-timestamp': zeit,
            'twitch-eventsub-message-signature': signatur,
            'twitch-eventsub-message-type': opt.typ ?? 'notification',
            'twitch-eventsub-subscription-type': koerper?.subscription?.type
        },
        roherKoerper,
        koerper
    };
}

console.log('\nSignatur — der gute Fall');
{
    const z = zustellung();
    pruefe('gueltige Signatur wird angenommen',
        twitch.signaturPruefen(z.headers, z.roherKoerper, GEHEIMNIS), true);
}

console.log('\nSignatur — die Faelle, die zaehlen');
{
    const z = zustellung();
    pruefe('falsches Geheimnis',
        twitch.signaturPruefen(z.headers, z.roherKoerper, 'b'.repeat(64)), false);

    pruefe('veraenderter Koerper (ein Zeichen)',
        twitch.signaturPruefen(z.headers, Buffer.concat([z.roherKoerper, Buffer.from(' ')]), GEHEIMNIS), false);

    const fremd = zustellung({ id: 'msg-2' });
    pruefe('Signatur einer anderen Nachricht',
        twitch.signaturPruefen({ ...z.headers, 'twitch-eventsub-message-signature':
            fremd.headers['twitch-eventsub-message-signature'] }, z.roherKoerper, GEHEIMNIS), false);

    pruefe('Signatur fehlt',
        twitch.signaturPruefen({ ...z.headers, 'twitch-eventsub-message-signature': undefined },
            z.roherKoerper, GEHEIMNIS), false);

    pruefe('Geheimnis fehlt',
        twitch.signaturPruefen(z.headers, z.roherKoerper, null), false);

    // Muss ablehnen, nicht abstuerzen: timingSafeEqual wirft bei ungleicher Laenge.
    pruefe('zu kurze Signatur stuerzt nicht ab',
        twitch.signaturPruefen({ ...z.headers, 'twitch-eventsub-message-signature': 'sha256=ab' },
            z.roherKoerper, GEHEIMNIS), false);
}

console.log('\nAlter');
{
    pruefe('frisch', twitch.zuAlt(zustellung().headers), false);
    pruefe('20 Minuten alt',
        twitch.zuAlt(zustellung({ zeit: new Date(Date.now() - 20 * 60000).toISOString() }).headers), true);
    pruefe('20 Minuten in der Zukunft',
        twitch.zuAlt(zustellung({ zeit: new Date(Date.now() + 20 * 60000).toISOString() }).headers), true);
    pruefe('kein Zeitstempel', twitch.zuAlt({}), true);
}

console.log('\nEinordnung');
{
    pruefe('notification', twitch.einordnen({ 'twitch-eventsub-message-type': 'notification' }), 'ereignis');
    pruefe('verification', twitch.einordnen({ 'twitch-eventsub-message-type': 'webhook_callback_verification' }), 'bestaetigung');
    pruefe('revocation', twitch.einordnen({ 'twitch-eventsub-message-type': 'revocation' }), 'widerruf');
    pruefe('leer', twitch.einordnen({}), 'unbekannt');
}

console.log('\nUebersetzung ins Hausvokabular');
{
    const online = zustellung();
    pruefe('stream.online -> ging_live',
        twitch.uebersetzen(online.headers, online.koerper),
        { plattform: 'twitch', kanal_id: '12345', login: 'ninja', art: 'ging_live',
          sendung_id: 'sendung-1', begonnen_am: '2026-08-23T18:00:00Z' });

    const update = zustellung({ koerper: {
        subscription: { id: 'abo-2', type: 'channel.update', condition: { broadcaster_user_id: '12345' } },
        event: { broadcaster_user_id: '12345', broadcaster_user_login: 'ninja',
                 title: 'Neuer Titel', category_name: 'Just Chatting' } } });
    pruefe('channel.update -> geaendert',
        twitch.uebersetzen(update.headers, update.koerper),
        { plattform: 'twitch', kanal_id: '12345', login: 'ninja', art: 'geaendert',
          titel: 'Neuer Titel', kategorie: 'Just Chatting' });

    const fremd = zustellung({ koerper: {
        subscription: { id: 'x', type: 'channel.follow', condition: { broadcaster_user_id: '12345' } },
        event: { broadcaster_user_id: '12345' } } });
    pruefe('unbekannter Typ -> null', twitch.uebersetzen(fremd.headers, fremd.koerper), null);

    pruefe('ohne Kanal -> null', twitch.uebersetzen({}, { event: {} }), null);
}

console.log(gescheitert === 0
    ? `\nErgebnis: ${geprueft} Faelle, 0 Abweichungen.\n`
    : `\nErgebnis: ${geprueft} Faelle, ${gescheitert} Abweichung(en).\n`);

process.exit(gescheitert === 0 ? 0 : 1);
