#!/usr/bin/env node
/**
 * Prüft, dass die gemeldete Bereitschaft wirklich ankommt und ehrlich anzeigt.
 *
 * Baustelle 58 / 62f: Der Daemon meldete die Stufe seit dem 2026-08-20, das
 * Dashboard hatte keinen Empfänger. Die Karte sagte „nicht gemessen", obwohl die
 * Messung vorlag — und das ist die gefährlichere Richtung: Ein Betreiber, der
 * drei Haken sieht, glaubt, ein Spieler kommt rein.
 *
 *   node scripts/check-bereitschaft.js
 */
'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '../apps/dashboard/.env') });
const mysql = require('mysql2/promise');

let fehler = 0;
const pruefe = (ok, was, zusatz = '') => {
    console.log(`  ${ok ? '✅' : '❌'} ${was}${zusatz ? '\n       ' + zusatz : ''}`);
    if (!ok) fehler++;
};

(async () => {
    const c = await mysql.createConnection({
        host: process.env.MYSQL_HOST, port: process.env.MYSQL_PORT,
        user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD,
        database: process.env.MYSQL_DATABASE,
    });
    const { baueSeite } = require('../plugins/gameserver/dashboard/helpers/Serverseite');
    const Serverseite = require('../plugins/gameserver/dashboard/helpers/Serverseite');

    const [pv] = await c.query('SELECT fbpkg FROM package_versions LIMIT 1');
    const paket = typeof pv[0].fbpkg === 'string' ? JSON.parse(pv[0].fbpkg) : pv[0].fbpkg;
    const bauen = Serverseite.baueBereitschaft || null;

    console.log(`\n▸ Paket ${paket.identity.slug} · ready_when: `
        + JSON.stringify(paket.start && paket.start.ready_when));

    if (!bauen) {
        console.log('  (baueBereitschaft ist nicht exportiert — über baueSeite geprüft)');
    }

    const faelle = [
        ['nichts gemeldet, Server läuft',
         { status: 'online', bereitschaft_stufe: null, bereitschaft_grund: null },
         (b) => !b.gemessen && !b.bereit && b.stufen.every(s => !s.erreicht)],
        ['Stufe process',
         { status: 'starting', bereitschaft_stufe: 'process', bereitschaft_grund: 'Prozess läuft.' },
         (b) => b.gemessen && !b.bereit && b.stufen[0].erreicht && !b.stufen[1].erreicht],
        ['Stufe port',
         { status: 'starting', bereitschaft_stufe: 'port', bereitschaft_grund: 'Port lauscht.' },
         (b) => b.gemessen && b.stufen[0].erreicht && b.stufen[1].erreicht && !b.stufen[2].erreicht],
        ['Stufe query → bereit',
         { status: 'online', bereitschaft_stufe: 'query', bereitschaft_grund: 'Abfrage antwortet.' },
         (b) => b.gemessen && b.bereit && b.stufen.every(s => s.erreicht)],
        ['Server aus, alte Stufe steht noch in der Zeile',
         { status: 'offline', bereitschaft_stufe: 'query', bereitschaft_grund: 'Abfrage antwortet.' },
         (b) => !b.gemessen && !b.bereit && b.veraltet && b.stufen.every(s => !s.erreicht)],
    ];

    console.log('');
    for (const [was, server, erwartet] of faelle) {
        const b = Serverseite.baueBereitschaft(paket, server);
        pruefe(erwartet(b), was,
            `gemessen=${b.gemessen} bereit=${b.bereit} veraltet=${b.veraltet} `
            + `erreicht=[${b.stufen.map(s => s.erreicht ? '✓' : '·').join('')}]`);
    }

    console.log('\n▸ Der Erklärsatz geht nicht verloren');
    const mitGrund = Serverseite.baueBereitschaft(paket,
        { status: 'starting', bereitschaft_stufe: 'process',
          bereitschaft_grund: 'Port 2457 lauscht nach 60 s noch nicht, der Prozess läuft aber.' });
    pruefe(/2457/.test(mitGrund.grund || ''), 'Er steht in der Karte', mitGrund.grund);

    const ausGrund = Serverseite.baueBereitschaft(paket,
        { status: 'offline', bereitschaft_stufe: 'query', bereitschaft_grund: 'Abfrage antwortet.' });
    pruefe(ausGrund.grund === null,
        'Bei ausgeschaltetem Server wird kein alter Satz als aktuell ausgegeben');

    await c.end();
    console.log(fehler === 0 ? '\n✅ Bereitschaft kommt an und behauptet nichts Ungemessenes\n'
                             : `\n❌ ${fehler} Abweichung(en)\n`);
    process.exit(fehler === 0 ? 0 : 1);
})().catch((e) => { console.error('FEHLER:', e.message); process.exit(1); });
