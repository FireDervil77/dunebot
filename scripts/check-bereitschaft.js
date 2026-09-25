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

    // ════════════════════════════════════════════════════════════════════════
    // Baustelle 105 (2026-09-08): Die LISTE zeigte dieselbe Frage anders an
    // ════════════════════════════════════════════════════════════════════════
    //
    // Zwei Löcher, ein Symptom. `baueServerListe` rechnete die Leiter aus der
    // Spielerzahl statt sie zu lesen, und die Serverseite holte die Spalten gar
    // nicht erst aus der Datenbank. Beides fiel niemandem auf, weil dieser
    // Wächter nur die Rechnung prüfte, nicht ihre Eingabe.
    console.log('\n▸ Die Serverliste liest dieselbe Leiter (Baustelle 105)');

    const [addonZeile] = await c.query(
        'SELECT addon_marketplace_id FROM gameservers WHERE addon_marketplace_id IS NOT NULL LIMIT 1');
    const addonId = addonZeile[0] ? addonZeile[0].addon_marketplace_id : 1;
    const nachAddon = { [addonId]: paket };
    const zeile = (mehr) => ({
        id: 1, name: 'Prüfserver', addon_marketplace_id: addonId,
        current_players: null, max_players: null, ports: null, ...mehr,
    });
    const einzige = (mehr) => Serverseite.baueServerListe([zeile(mehr)], nachAddon).liste[0];

    const listenFaelle = [
        ['Stufe query ohne Spielerzahl heisst BEREIT',
         { status: 'online', bereitschaft_stufe: 'query', current_players: null },
         (x) => x.bereit && x.bereitschaftText === 'bereit',
         'früher: „Abfrage antwortet nicht", weil die Spielerzahl fehlte'],
        ['Spielerzahl ohne Meldung heisst NICHT bereit',
         { status: 'online', bereitschaft_stufe: null, current_players: 3 },
         (x) => !x.bereit && x.stufen.every(st => !st.erfuellt),
         'früher: drei grüne Balken, nur weil eine Zahl vorlag'],
        ['Stufe process nennt die Stufe, auf die er wartet',
         { status: 'starting', bereitschaft_stufe: 'process' },
         (x) => !x.bereit && x.stufen[0].erfuellt && /wartet auf/.test(x.bereitschaftText)],
        ['Der Erklärsatz erreicht die Liste',
         { status: 'starting', bereitschaft_stufe: 'process',
           bereitschaft_grund: 'Port 2457 lauscht nach 60 s noch nicht.' },
         (x) => /2457/.test(x.bereitschaftGrund || '')],
        ['Ausgeschaltet heisst aus, nicht „Abfrage antwortet nicht"',
         { status: 'offline', bereitschaft_stufe: 'query' },
         (x) => !x.bereit && x.bereitschaftText === 'aus'],
        ['Ohne Paket wird nichts behauptet',
         { status: 'online', bereitschaft_stufe: 'query', addon_marketplace_id: -1 },
         (x) => !x.bereit && !x.stufen.length && x.bereitschaftText === 'nicht messbar'],
    ];
    for (const [was, mehr, erwartet, zusatz] of listenFaelle) {
        const x = einzige(mehr);
        pruefe(erwartet(x), was,
            (zusatz ? zusatz + ' · ' : '') + `text="${x.bereitschaftText}" `
            + `balken=[${x.stufen.map(st => st.erfuellt ? '✓' : st.wartet ? '~' : '·').join('')}]`);
    }

    // ── Das letzte Wort hat fb-init (Baustelle 160, 2026-09-25) ──────────────
    //
    // Astro Colony 203: fb-init meldete `ready` bei Stufe port, weil fb-probe
    // die Abfrage nicht sprechen konnte — das Panel wartete ewig auf „Abfrage"
    // und sperrte „Neu starten". Geprüft mit einem Paket, das die Abfrage
    // VERLANGT; sonst gäbe es nichts Ungeprüftes.
    console.log('\n▸ fb-init hat das letzte Wort (Baustelle 160)');
    const mitAbfrage = { ...paket, start: { ...paket.start,
        ready_when: { port: 'query', query: true } } };
    const grund160 = 'Stufe 3 nicht geprüft — das Protokoll spricht fb-probe nicht.';
    const b160 = (bereit) => Serverseite.baueBereitschaft(mitAbfrage,
        { status: 'online', bereitschaft_stufe: 'port', bereitschaft_grund: grund160,
          bereitschaft_bereit: bereit });
    const ja = b160(1);
    pruefe(ja.bereit && ja.ungeprueft.includes('Abfrage') && !ja.stufen.some(st => st.wartet),
        'ready bei Stufe port → bereit, Abfrage „nicht geprüft", nichts wartet',
        `bereit=${ja.bereit} ungeprueft=${ja.ungeprueft}`);
    pruefe(ja.stufen.find(st => st.schluessel === 'query').erklaerung.includes(grund160),
        'die Begründung von fb-init steht an der Stufe');
    pruefe(!b160(0).bereit, 'eine andere Meldung als ready macht nicht bereit');
    pruefe(!b160(null).bereit && b160(null).stufen.some(st => st.wartet),
        'alter Daemon ohne Meldungsart: die Leiter gilt wie bisher');
    const liste160 = Serverseite.baueServerListe([zeile({ status: 'online', bereitschaft_stufe: 'port',
        bereitschaft_bereit: 1, bereitschaft_grund: grund160 })], { [addonId]: mitAbfrage }).liste[0];
    pruefe(liste160.bereit && /nicht geprüft/.test(liste160.bereitschaftText),
        'die Liste sagt „nicht geprüft" dazu', `text="${liste160.bereitschaftText}"`);
    const { pillenZustand } = require('../plugins/gameserver/dashboard/assets/js/gameserver-live.js');
    const pille = pillenZustand({ status: 'online', bereit: true, messbar: true,
        text: liste160.bereitschaftText, grund: grund160 });
    pruefe(/nicht geprüft/.test(pille.text) && pille.titel === grund160,
        'die Pille sagt es sichtbar, der Tooltip nennt den Grund', `text="${pille.text}"`);

    // ── Die Meldung des VORIGEN Laufs zählt nicht ────────────────────────────
    console.log('\n▸ Eine Meldung von vor dem letzten Start zählt nicht');
    const vorher = new Date(Date.now() - 3600e3);
    const nachher = new Date(Date.now() - 60e3);
    const alt = Serverseite.baueBereitschaft(paket, {
        status: 'online', bereitschaft_stufe: 'query',
        bereitschaft_am: vorher, last_started_at: nachher,
    });
    pruefe(!alt.gemessen && !alt.bereit && alt.veraltet,
        'gemeldet vor dem Start → veraltet, keine grünen Balken',
        `gemessen=${alt.gemessen} bereit=${alt.bereit} veraltet=${alt.veraltet}`);

    const frisch = Serverseite.baueBereitschaft(paket, {
        status: 'online', bereitschaft_stufe: 'query',
        bereitschaft_am: nachher, last_started_at: vorher,
    });
    pruefe(frisch.gemessen && frisch.bereit && !frisch.veraltet,
        'gemeldet nach dem Start → gilt');

    const ohneZeiten = Serverseite.baueBereitschaft(paket,
        { status: 'online', bereitschaft_stufe: 'query' });
    pruefe(ohneZeiten.gemessen && ohneZeiten.bereit,
        'ohne beide Zeitangaben wird kein Fehlalarm erzeugt');

    // ── Und die Abfragen holen die Spalten überhaupt ─────────────────────────
    //
    // Der eigentliche Fund vom 2026-09-08: Die Serverseite rief die richtige
    // Funktion auf und bekam trotzdem nichts zu sehen, weil ihre SQL-Abfrage
    // die drei Spalten nicht auswählte. Eine Rechnung zu prüfen, ohne ihre
    // Eingabe zu prüfen, ist ein grüner Wächter über einem leeren Feld.
    console.log('\n▸ Die Routen holen die Spalten aus der Datenbank');
    const fs = require('fs');
    const quelle = fs.readFileSync(
        require('path').join(__dirname, '../plugins/gameserver/dashboard/routes/servers.js'), 'utf8');
    // Kommentare zuerst weg — sonst zählt eine Begründung als Beleg.
    const ohneKommentare = quelle
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n').map(z => z.replace(/(^|\s)\/\/.*$/, '').replace(/(^|\s)--\s.*$/, '')).join('\n');

    const bloecke = [
        ['Übersicht  (router.get(\'/\'))', "router.get('/',", "router.get('/create'"],
        ['Serverseite (router.get(\'/:serverId\'))', "router.get('/:serverId',", "router.get('/:serverId/"],
    ];
    for (const [name, von, bis] of bloecke) {
        const a = ohneKommentare.indexOf(von);
        const b = a >= 0 ? ohneKommentare.indexOf(bis, a) : -1;
        const block = a >= 0 ? ohneKommentare.slice(a, b > a ? b : undefined) : '';
        pruefe(a >= 0 && /bereitschaft_stufe/.test(block) && /bereitschaft_bereit/.test(block),
            name + ' wählt bereitschaft_stufe und bereitschaft_bereit aus',
            a < 0 ? 'Block nicht gefunden — Anker anpassen' : '');
    }

    await c.end();
    console.log(fehler === 0 ? '\n✅ Bereitschaft kommt an und behauptet nichts Ungemessenes\n'
                             : `\n❌ ${fehler} Abweichung(en)\n`);
    process.exit(fehler === 0 ? 0 : 1);
})().catch((e) => { console.error('FEHLER:', e.message); process.exit(1); });
