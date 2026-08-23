#!/usr/bin/env node
/**
 * Sammelt, was beim Bauen eines Pakets heute noch fehlt.
 *
 * ── Warum es das braucht ────────────────────────────────────────────────────
 *
 * Der Betreiber am 2026-08-23: Eggs sollen ganz verschwinden, „damit wir wirklich
 * so später Pakete bauen können wie sie müssen und da auch nichts vergessen".
 *
 * Genau das ist die Gefahr beim Entfernen: Ein Egg-Feld, das heute noch gelesen
 * wird, trägt womöglich Wissen, für das es im Paketformat keinen Platz gibt.
 * Wer es löscht, merkt das erst, wenn ein Spiel nicht mehr startet — und dann
 * fehlt die Quelle, aus der man es zurückholen könnte.
 *
 * Dieses Werkzeug misst drei Dinge und rät bei keinem:
 *
 *   1. Welche Felder stehen in den Eggs, und welche davon liest der Übersetzer?
 *      Was er nicht liest, hat im Paket keinen Platz — oder niemand hat gemerkt,
 *      dass es einen bräuchte.
 *   2. Was hat der Übersetzer selbst als ungelöst vermerkt (`status.open`)?
 *   3. Welche Brücken stehen noch (`packages/fbpkg/uebergang/*.json`)? Jede davon
 *      ist eine Sache, die das Paket noch nicht allein ausdrücken kann.
 *
 *   node scripts/sammle-paketluecken.js            # Bericht
 *   node scripts/sammle-paketluecken.js --json     # zusätzlich in bestand/ ablegen
 */
'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '../apps/dashboard/.env') });
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

/**
 * Was der Übersetzer aus einem Egg liest.
 *
 * NICHT geraten: abgelesen aus `scripts/uebersetze-pakete.js` (alle `gd.*`- und
 * `egg.*`-Zugriffe). Ändert sich der Übersetzer, gehört diese Liste nachgezogen
 * — sonst meldet das Werkzeug Lücken, die keine sind.
 */
const GELESEN = new Set([
    // Rohe Eggs tragen diese oben, unser `game_data` schachtelt sie unter `meta`.
    // Beide Formen gehoeren hierher, sonst meldet das Werkzeug die halbe
    // Kopfzeile jedes Eggs als Luecke.
    'name', 'author', 'description', 'meta.name', 'meta.author',
    'meta.description', 'meta.version', 'exported_at', '_comment',
    'meta', 'startup', 'startup.command', 'startup.done', 'startup.stop',
    'variables', 'ports', 'config', 'scripts', 'scripts.installation',
    'query', 'query.port_var', 'query.gamedig_type',
    'platform', 'image', 'file_denylist',
]);

/** Wo das gelesene Feld im Paket landet — für den Bericht. */
const ZIEL = {
    'meta': 'identity', 'startup': 'start', 'startup.command': 'start.args',
    'startup.done': 'start.ready_when', 'startup.stop': 'management.stop',
    'variables': 'settings', 'ports': 'ports', 'config': 'files',
    'scripts': 'install', 'scripts.installation': 'install.steps',
    'query': 'ports (Zweck query)', 'query.port_var': 'ports[].assign',
    'query.gamedig_type': 'ports[].protocol', 'platform': 'requirements',
    'image': 'image', 'file_denylist': 'files.deny',
    'name': 'identity.name', 'author': 'identity.origin',
    'description': 'identity.description',
    'exported_at': '— (Zeitstempel des Exports, ohne Entsprechung)',
    '_comment': '— (Hinweis fuer Menschen)',
};

/**
 * Ist dieser Schlüssel ein FELDNAME oder ein DATENWERT?
 *
 * `docker_images` ist eine Zuordnung Etikett → Image; die Schlüssel darin sind
 * `ghcr.io/parkervcp/yolks:debian` oder `Java 17`. Beim ersten Lauf über 272
 * Eggs füllten genau die den halben Bericht — 30 Zeilen „Feld" für Dinge, die
 * gar keine Felder sind.
 *
 * Ein Feldname enthält keinen Punkt, keinen Schrägstrich, keinen Doppelpunkt und
 * kein Leerzeichen. Das ist eine Faustregel und keine Wahrheit, aber sie trennt
 * hier sauber — und wo sie danebenliegt, taucht das Feld eben auf der obersten
 * Ebene trotzdem auf.
 */
function istFeldname(k) {
    return !/[./: ]/.test(k);
}

/**
 * Felder, deren SCHLUESSEL Daten sind statt Feldnamen.
 *
 * `docker_images` ordnet Etikett → Image zu: mal `ghcr.io/parkervcp/yolks:debian`,
 * mal schlicht `Debian` oder `Proton`. Die Faustregel oben faengt die erste Form,
 * nicht die zweite — und dann steht `docker_images.Proton` im Bericht, als waere
 * es ein Feld.
 *
 * Hier hilft nur Wissen, nicht Mustererkennung: Wir kennen dieses eine Feld.
 */
const WERTSCHLUESSEL = new Set(['docker_images']);

function pfade(objekt, prefix = '', tiefe = 0) {
    const aus = [];
    if (!objekt || typeof objekt !== 'object' || Array.isArray(objekt)) return aus;
    for (const [k, v] of Object.entries(objekt)) {
        // Unterhalb der obersten Ebene zaehlen nur Feldnamen. Ein Bildname als
        // Schluessel ist ein WERT und gehoert nicht in eine Feldliste.
        if (tiefe > 0 && !istFeldname(k)) continue;
        const p = prefix ? `${prefix}.${k}` : k;
        aus.push(p);
        // Zwei Ebenen genügen: Tiefer wird es je Spiel verschieden, und dann
        // meldet das Werkzeug Rauschen statt Lücken.
        if (tiefe < 1 && !WERTSCHLUESSEL.has(k)) aus.push(...pfade(v, p, tiefe + 1));
    }
    return aus;
}

(async () => {
    const alsJSON = process.argv.includes('--json');
    const c = await mysql.createConnection({
        host: process.env.MYSQL_HOST, port: process.env.MYSQL_PORT,
        user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD,
        database: process.env.MYSQL_DATABASE,
    });

    // ── 1. Egg-Felder, die der Uebersetzer nicht uebernimmt ─────────────────
    //
    // Standardquelle sind die eingespielten Spiele. Der Betreiber am
    // 2026-08-23: "ich wuerde das nicht an allen 23 messen, sondern an allen
    // eggs" — zu Recht. 23 eingespielte Eggs sind eine Stichprobe, und ein
    // Format an einer Stichprobe zu entwerfen heisst, die Ueberraschungen auf
    // spaeter zu verschieben.
    //
    // Mit --eggs <ordner> liest das Werkzeug stattdessen rohe Egg-Dateien aus
    // einem Verzeichnis. Damit laesst sich gegen eine beliebig grosse Sammlung
    // messen, sobald eine vorliegt.
    const eggOrdnerFlag = process.argv.indexOf('--eggs');
    const eggOrdner = eggOrdnerFlag >= 0 ? process.argv[eggOrdnerFlag + 1] : null;

    let spiele;
    if (eggOrdner) {
        if (!fs.existsSync(eggOrdner)) {
            console.error(`Ordner nicht gefunden: ${eggOrdner}`);
            process.exit(1);
        }
        const dateien = [];
        const gehe = (d) => {
            for (const e of fs.readdirSync(d, { withFileTypes: true })) {
                const voll = path.join(d, e.name);
                if (e.isDirectory()) gehe(voll);
                else if (e.name.endsWith('.json')) dateien.push(voll);
            }
        };
        gehe(eggOrdner);
        spiele = dateien.map(f => {
            try {
                return { slug: path.basename(f, '.json'), name: path.basename(f), game_data: fs.readFileSync(f, 'utf8') };
            } catch { return null; }
        }).filter(Boolean);
        console.log(`\nQuelle: ${dateien.length} Egg-Dateien aus ${eggOrdner}`);
    } else {
        [spiele] = await c.query('SELECT id, slug, name, game_data FROM addon_marketplace ORDER BY name');
        console.log(`\nQuelle: ${spiele.length} eingespielte Spiele aus addon_marketplace`);
        console.log('        (mit --eggs <ordner> gegen eine groessere Sammlung messen)');
    }
    const ungelesen = new Map();   // Pfad → [slugs]
    const gelesenZaehler = new Map();

    for (const s of spiele) {
        let gd;
        try {
            gd = typeof s.game_data === 'string' ? JSON.parse(s.game_data) : s.game_data;
        } catch { continue; }
        if (!gd) continue;
        for (const p of pfade(gd)) {
            const wurzel = p.split('.')[0];
            if (GELESEN.has(p) || GELESEN.has(wurzel)) {
                gelesenZaehler.set(wurzel, (gelesenZaehler.get(wurzel) || 0) + 1);
                continue;
            }
            if (!ungelesen.has(p)) ungelesen.set(p, []);
            ungelesen.get(p).push(s.slug);
        }
    }

    console.log(`\n═══ Paketlücken, gemessen am ${new Date().toISOString().slice(0, 10)} ═══`);
    console.log(`\n▸ 1. Egg-Felder, die der ÜBERSETZER nicht ins Paket übernimmt`
        + `  (${spiele.length} Spiele untersucht)\n`);
    // Wer liest das Feld SONST? Das ist der Unterschied zwischen „darf weg"
    // und „hängt eine Funktion dran".
    //
    // Beim ersten Lauf am 2026-08-23 hätte die Überschrift „ohne Leser" fast
    // dazu geführt, `templates` zu streichen — dabei liest StartPayload.js es
    // und die Addon-Detailseite zeigt es an. Ein Werkzeug, das zum Löschen
    // verleitet, ist schlimmer als keines.
    const sucheLeser = (feld) => {
        const wurzel = feld.split('.')[0];
        try {
            const treffer = require('child_process')
                .execSync(
                    `grep -rIl --exclude-dir=node_modules --exclude-dir=.git ` +
                    `-e '\\.${wurzel}\\b' -e "\\['${wurzel}'\\]" ` +
                    `plugins apps scripts packages 2>/dev/null || true`,
                    { cwd: path.join(__dirname, '..'), encoding: 'utf8' })
                .split('\n').filter(Boolean)
                .filter(f => !f.includes('sammle-paketluecken'));
            return treffer;
        } catch { return []; }
    };

    const leserJe = {};
    if (!ungelesen.size) {
        console.log('   Keine. Jedes Feld, das in einem Egg steht, übernimmt der Übersetzer.');
    } else {
        const sortiert = [...ungelesen.entries()].sort((a, b) => b[1].length - a[1].length);
        const gesehen = new Set();
        for (const [pfad, slugs] of sortiert) {
            const wurzel = pfad.split('.')[0];
            let hinweis = '';
            if (!gesehen.has(wurzel)) {
                gesehen.add(wurzel);
                const leser = sucheLeser(wurzel);
                leserJe[wurzel] = leser;
                hinweis = leser.length
                    ? `   ← liest sonst wer: ${leser.length} Datei(en)`
                    : '   ← liest sonst NIEMAND';
            }
            console.log(`   ${String(slugs.length).padStart(3)}× ${pfad}${hinweis}`);
            if (hinweis && leserJe[wurzel] && leserJe[wurzel].length && leserJe[wurzel].length <= 4) {
                for (const f of leserJe[wurzel]) console.log(`        ${f}`);
            }
            if (slugs.length <= 3) console.log(`        ${slugs.join(', ')}`);
        }
        console.log('\n   Jede Zeile ist eine Entscheidung: gehört das ins Paketformat,');
        console.log('   oder darf es mit den Eggs verschwinden?');
        console.log('   „liest sonst wer" sagt, ob der Rest des Systems daran hängt.');
    }

    // ── 2. Was der Übersetzer selbst offen liess ────────────────────────────
    const [versionen] = await c.query(`
        SELECT pk.slug, pv.fbpkg FROM packages pk
          JOIN package_versions pv ON pv.package_id = pk.id`);
    console.log(`\n▸ 2. Vom Übersetzer als ungelöst vermerkt (status.open)\n`);
    let offenGesamt = 0;
    const offenJe = {};
    for (const v of versionen) {
        const pkg = typeof v.fbpkg === 'string' ? JSON.parse(v.fbpkg) : v.fbpkg;
        const offen = pkg?.status?.open || [];
        offenJe[v.slug] = offen;
        offenGesamt += offen.length;
        console.log(`   ${v.slug}: ${offen.length} Punkt(e)`);
        for (const o of offen) console.log(`      – ${o}`);
    }
    if (!versionen.length) console.log('   (kein Paket eingeliefert)');

    // ── 3. Brücken, die noch stehen ─────────────────────────────────────────
    const ordner = path.join(__dirname, '../packages/fbpkg/uebergang');
    console.log(`\n▸ 3. Übergangsbrücken — was das Paket noch nicht allein ausdrückt\n`);
    const bruecken = {};
    if (fs.existsSync(ordner)) {
        for (const datei of fs.readdirSync(ordner).filter(f => f.endsWith('.json'))) {
            const b = JSON.parse(fs.readFileSync(path.join(ordner, datei), 'utf8'));
            const felder = Object.keys(b).filter(k =>
                !['format', 'slug', 'gilt_bis', 'warum', 'geprueft_am', 'geprueft_gegen'].includes(k));
            bruecken[b.slug || datei] = felder;
            console.log(`   ${b.slug || datei}: ${felder.join(', ') || '(nichts mehr)'}`);
            if (b.gilt_bis) console.log(`      gilt bis: ${b.gilt_bis}`);
        }
    }
    if (!Object.keys(bruecken).length) console.log('   Keine — jedes Paket steht für sich.');

    // ── 4. Wer haengt noch an den Bruecken? ─────────────────────────────────
    //
    // Eine Bruecke darf erst weg, wenn niemand mehr darauf steht. Das ist keine
    // Vermutung, das ist abzaehlbar: Traegt ein Server noch Portschluessel im
    // Egg-Stil (`game_plus_1`), braucht `portzwecke` ihn weiterhin.
    console.log('\n▸ 4. Server, die noch an Egg-Daten haengen\n');
    const [server] = await c.query('SELECT id, name, ports FROM gameservers');
    const haengend = [];
    for (const srv of server) {
        let ports;
        try { ports = typeof srv.ports === 'string' ? JSON.parse(srv.ports) : srv.ports; }
        catch { continue; }
        const eggSchluessel = Object.keys(ports || {}).filter(k => /_plus_\d+$/.test(k));
        if (eggSchluessel.length) haengend.push({ id: srv.id, name: srv.name, schluessel: eggSchluessel });
    }
    if (!server.length) {
        console.log('   Kein Gameserver vorhanden — die Brücken tragen niemanden mehr.');
    } else if (!haengend.length) {
        console.log(`   Keiner von ${server.length}. Die Portbrücke (portzwecke) ist entbehrlich.`);
    } else {
        for (const h of haengend) {
            console.log(`   #${h.id} ${h.name}: ${h.schluessel.join(', ')}`);
        }
        console.log(`\n   ${haengend.length} von ${server.length} Servern. Solange auch nur einer`);
        console.log('   dabei ist, bleibt `portzwecke` in der Übergangsdatei nötig.');
    }

    console.log('\n═══ Zusammenfassung ═══');
    console.log(`   vom Übersetzer ignoriert: ${ungelesen.size} Feldpfade`);
    console.log(`   offene Punkte in Paketen: ${offenGesamt}`);
    console.log(`   Brücken               : ${Object.keys(bruecken).length}`);
    console.log(`   Server an Egg-Daten   : ${haengend.length}`);
    console.log('\n   Solange eine dieser drei Zahlen nicht 0 ist, darf der');
    console.log('   entsprechende Egg-Leseweg nicht entfernt werden.\n');

    if (alsJSON) {
        const ziel = path.join(__dirname, '../docs/spielpakete/bestand',
            `paketluecken-${new Date().toISOString().slice(0, 10)}.json`);
        fs.writeFileSync(ziel, JSON.stringify({
            gemessen_am: new Date().toISOString(),
            spiele: spiele.length,
            egg_felder_ohne_uebersetzer: Object.fromEntries(ungelesen),
            wer_liest_sie_sonst: leserJe,
            egg_felder_mit_leser: Object.fromEntries(
                [...gelesenZaehler].map(([k, n]) => [k, { treffer: n, ziel: ZIEL[k] || '?' }])),
            offene_punkte: offenJe,
            bruecken,
            server_an_egg_daten: haengend,
        }, null, 2));
        console.log(`   → abgelegt: ${path.relative(process.cwd(), ziel)}\n`);
    }

    await c.end();
    process.exit(0);
})().catch((e) => { console.error('FEHLER:', e.message); process.exit(1); });
