#!/usr/bin/env node
/**
 * Image-Stand: Hängt ein Paket am neuesten Bau seines Images? (Baustelle 177,
 * 2026-10-09.)
 *
 * ── Was hier geprüft wird ───────────────────────────────────────────────────
 *
 * Anlass war der erste Image-Bau in einem neuen Monat. `images/bauen.sh` nennt
 * ihn 2026.10; alle Pakete und alle Werkbank-Sitzungen nannten 2026.09. Das
 * Anheft-Skript fragte den Tag des Pakets und meldete „aktuell", die Werkbank
 * bot nur an, was ein Paket schon benutzte — der Bau erreichte niemanden, und
 * niemand sah es.
 *
 * Abgesprochen mit dem Betreiber (2026-10-09):
 *
 *   - Eine Sitzung nimmt IMMER den neuesten Bau ihres Images (`latest`,
 *     `latest-<variante>`) — kein Monat mehr in der Wahl.
 *   - Ein Umzug ist eine neue Paketfassung, die sich nur im Image
 *     unterscheidet. Sie entsteht in der Werkbank; ins Paket kommen Tag und
 *     Digest des Baus, auf dem der Prüfdurchlauf lief.
 *   - Die Übersicht unter /admin/addons zeigt, welche Pakete zurückliegen.
 *   - `stable` bekommt nichts von selbst: Der Freigabe-Klick bleibt.
 *
 * Geprüft wird:
 *
 *   1. Die Tag-Regeln stehen an EINER Stelle (packages/fbpkg/lib/imagetag.js).
 *   2. Das Urteil: aktuell, neuer Bau — oder unbekannt. „Unbekannt" ist eine
 *      eigene Auskunft; ohne Antwort eines Daemons heisst nichts „aktuell".
 *   3. Die Übersicht an den ECHTEN Paketen der Datenbank (nur lesend), gegen
 *      einen Daemon aus der Attrappe.
 *   4. Der Vertrag mit dem Daemon und mit bauen.sh — nachgelesen, nicht erinnert.
 *
 *   node scripts/check-imagestand.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const WURZEL = path.join(__dirname, '..');
const DAEMON = '/home/firedervil/firebot_daemon';
require('dotenv').config({ path: path.join(WURZEL, 'apps/dashboard/.env'), quiet: true });
const mysql = require('mysql2/promise');
const { ServiceManager } = require('dunebot-core');
const { ohneKommentare, ohneKommentareEjs, ohneKommentareShell } = require('./lib/quelltext');
const T = require('../packages/fbpkg/lib/imagetag');

let fehler = 0;
async function pruefe(was, tun) {
    try { await tun(); console.log(`  ✓ ${was}`); }
    catch (e) { fehler++; console.log(`  ✗ ${was}\n      ${String(e.message).split('\n').slice(0, 5).join('\n      ')}`); }
}
const lies = (...teile) => fs.readFileSync(path.join(...teile), 'utf8');

// Der Daemon der Attrappe: `antwort` ist eine Funktion der gefragten Images.
const daemon = { online: true, antwort: null, gefragt: [] };
ServiceManager.register('ipmServer', {
    isDaemonOnline: () => daemon.online,
    sendCommand: async (id, befehl, nutzlast, frist) => {
        daemon.gefragt.push({ id, befehl, nutzlast, frist });
        const a = typeof daemon.antwort === 'function' ? daemon.antwort(nutzlast) : daemon.antwort;
        if (a instanceof Error) throw a;
        return a;
    },
});
const still = () => {};
ServiceManager.register('Logger', { debug: still, info: still, warn: still, error: still, success: still });

(async () => {
    // ── 1) Die Tag-Regeln ────────────────────────────────────────────────────
    console.log('\nTag-Regeln');
    await pruefe('Kalenderfassung, neuester Bau und Ausprägung — an den Tags, die es in der Registry gibt', async () => {
        const faelle = [
            // tag,                         variante,          neuester,                 kalender, name (ref .../fb/x)
            ['2026.09',                     '',                'latest',                 true,  'x'],
            ['2026.10',                     '',                'latest',                 true,  'x'],
            ['2026.09-GE-Proton10-32',      'GE-Proton10-32',  'latest-GE-Proton10-32',  true,  'x GE-Proton10-32'],
            ['2026.10-8',                   '8',               'latest-8',               true,  'x 8'],
            ['2026.08-25',                  '25',              'latest-25',              true,  'x 25'],
            ['latest',                      '',                'latest',                 false, 'x'],
            ['latest-GE-Proton11-5',        'GE-Proton11-5',   'latest-GE-Proton11-5',   false, 'x GE-Proton11-5'],
            // Weder noch: bleibt, wie er ist, und heisst auf der Seite mit Tag.
            ['1',                           null,              '1',                      false, 'x:1'],
            ['stable',                      null,              'stable',                 false, 'x:stable'],
            ['2026.9',                      null,              '2026.9',                 false, 'x:2026.9'],
        ];
        for (const [tag, variante, neuester, kalender, name] of faelle) {
            assert.strictEqual(T.imageVariante(tag), variante, `Ausprägung von ${tag}`);
            assert.strictEqual(T.neuesterTag(tag), neuester, `neuester Bau zu ${tag}`);
            assert.strictEqual(T.istKalendertag(tag), kalender, `Kalenderfassung? ${tag}`);
            assert.strictEqual(T.imageName({ ref: 'registry.firenetworks.de/fb/x', tag }), name, `Name zu ${tag}`);
        }
        // Zweimal angewandt ändert nichts — eine Sitzung, die schon „latest" trägt, bleibt.
        for (const [tag] of faelle) assert.strictEqual(T.neuesterTag(T.neuesterTag(tag)), T.neuesterTag(tag));
        // Der Monat gehört nicht zur Wahl, die Ausprägung schon.
        assert.strictEqual(T.neuesterTag('2026.09'), T.neuesterTag('2026.10'));
        assert.notStrictEqual(T.neuesterTag('2026.10-GE-Proton10-32'), T.neuesterTag('2026.10-GE-Proton11-5'));
    });
    await pruefe('eine Stelle: Werkbank und Übersicht nehmen die Regeln aus der Bibliothek, keine eigene Kopie', async () => {
        const werkbank = ohneKommentare(lies(WURZEL, 'plugins/werkbank/dashboard/helpers/Sitzungen.js'));
        const uebersicht = ohneKommentare(lies(WURZEL, 'plugins/gameserver/dashboard/helpers/Imagestand.js'));
        for (const [name, quelle] of [['Sitzungen.js', werkbank], ['Imagestand.js', uebersicht]]) {
            assert.match(quelle, /require\('\.\.\/\.\.\/\.\.\/\.\.\/packages\/fbpkg\/lib\/imagetag'\)/, `${name} bindet die Bibliothek nicht ein`);
            assert.ok(!/function (imageVariante|neuesterTag|istKalendertag|imageName)\b/.test(quelle), `${name} hat eine eigene Fassung der Tag-Regeln`);
            assert.ok(!/\\d\{4\}\\\.\\d\{2\}/.test(quelle), `${name} erkennt eine Kalenderfassung auf eigene Faust`);
        }
    });
    await pruefe('die Sitzung fragt den neuesten Bau — auch eine, die noch einen Monat gespeichert hat', async () => {
        ServiceManager.register('dbService', { query: async (sql) => { throw new Error(`unerwartete Abfrage: ${sql.trim().slice(0, 60)}`); } });
        const S = require('../plugins/werkbank/dashboard/helpers/Sitzungen');
        const alt = { image: { ref: 'r/fb/proton', tag: '2026.09-GE-Proton10-32', digest: 'sha256:alt' } };
        assert.deepStrictEqual(S.sitzungsImage(alt), { ref: 'r/fb/proton', tag: 'latest-GE-Proton10-32' });
        assert.deepStrictEqual(S.sitzungsImage({ image: { ref: 'r/fb/steamcmd', tag: 'latest' } }), { ref: 'r/fb/steamcmd', tag: 'latest' });
        assert.strictEqual(S.imageName(alt.image), 'proton GE-Proton10-32');
    });

    // ── 2) Das Urteil ────────────────────────────────────────────────────────
    console.log('\nUrteil');
    const I = require('../plugins/gameserver/dashboard/helpers/Imagestand');
    await pruefe('gleich → aktuell, anders → neuer Bau, alles andere → unbekannt mit Grund', async () => {
        const p = { ref: 'r/fb/steamcmd', tag: '2026.09', digest: 'sha256:aa', frageTag: 'latest' };
        assert.deepStrictEqual(I.urteile(p, { digest: 'sha256:aa' }), { stand: 'aktuell', grund: null });
        assert.deepStrictEqual(I.urteile(p, { digest: 'sha256:bb', fassung: '2026.10' }), { stand: 'neuer_bau', grund: null });
        const unbekannt = [
            [{ ...p, ref: null }, { digest: 'sha256:aa' }, /kein Image/],
            [{ ...p, frageTag: null, tag: 'stable' }, { digest: 'sha256:aa' }, /keine Kalenderfassung/],
            [{ ...p, digest: null }, { digest: 'sha256:aa' }, /keinen Digest angeheftet/],
            [p, null, /nichts gesagt/],
            [p, { fehler: 'image … weder geholt noch lokal vorhanden' }, /weder geholt/],
            [p, {}, /keinen Digest/],
        ];
        for (const [paket, bau, muster] of unbekannt) {
            const u = I.urteile(paket, bau);
            assert.strictEqual(u.stand, 'unbekannt');
            assert.match(u.grund, muster);
        }
    });

    // ── 3) Die Übersicht an den echten Paketen ───────────────────────────────
    console.log('\nÜbersicht (echte Pakete, nur lesend)');
    const c = await mysql.createConnection({
        host: process.env.MYSQL_HOST, port: process.env.MYSQL_PORT,
        user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD,
        database: process.env.MYSQL_DATABASE, dateStrings: true,
    });
    // Die Attrappe reicht genau EINE Abfrage an die echte Datenbank durch — die
    // der neuesten Fassungen — und beantwortet die nach den Maschinen selbst.
    const db = {
        query: async (sql) => {
            const t = sql.trim();
            if (/^SELECT pk\.id AS paket_id, pk\.slug, pk\.name, v\.version, v\.channel, v\.published_at, v\.fbpkg\s+FROM packages pk/.test(t)) {
                const [zeilen] = await c.query(sql);
                return zeilen;
            }
            if (/^SELECT id, name, daemon_id FROM rootserver WHERE daemon_id IS NOT NULL ORDER BY id$/.test(t)) {
                return [{ id: 1, name: 'Maschine A', daemon_id: 'd1' }, { id: 2, name: 'Maschine B', daemon_id: 'd2' }];
            }
            throw new Error(`Attrappe kennt die Abfrage nicht: ${t.slice(0, 90)}`);
        },
    };
    const pakete = await I.paketImages(db);
    const gesehen = { pakete: pakete.length, images: new Set(pakete.map(p => `${p.ref}:${p.frageTag}`)).size };
    try {
        await pruefe('jedes Paket nennt Image, Tag und Digest — und die Frage geht an `latest…` derselben Ausprägung', async () => {
            assert.ok(pakete.length > 0, 'kein einziges Paket — der Wächter mässe nichts');
            for (const p of pakete) {
                assert.ok(p.ref && p.tag && p.digest, `${p.slug}: ref/tag/digest fehlen`);
                assert.ok(T.istKalendertag(p.tag), `${p.slug}: im Paket steht „${p.tag}" — keine Kalenderfassung`);
                assert.match(p.frageTag, /^latest(-|$)/, `${p.slug}: gefragt würde ${p.frageTag}`);
                assert.strictEqual(T.imageVariante(p.frageTag), T.imageVariante(p.tag), `${p.slug}: die Frage wechselt die Ausprägung`);
            }
        });
        await pruefe('der Daemon nennt dieselben Digests → alles aktuell; je Image EINE Frage', async () => {
            daemon.gefragt.length = 0;
            daemon.antwort = (n) => ({ success: true, data: { images: n.images.map(i => ({ ...i, digest: pakete.find(p => p.ref === i.ref && p.frageTag === i.tag).digest, fassung: 'x' })) } });
            const s = await I.stand(db);
            assert.strictEqual(daemon.gefragt.length, 1);
            assert.strictEqual(daemon.gefragt[0].befehl, 'image.stand');
            assert.strictEqual(daemon.gefragt[0].id, 'd1', 'gefragt wird die erste erreichbare Maschine');
            const fragen = daemon.gefragt[0].nutzlast.images.map(i => `${i.ref}:${i.tag}`);
            assert.strictEqual(new Set(fragen).size, fragen.length, 'dasselbe Image wurde zweimal gefragt');
            assert.ok(fragen.every(f => /:latest(-|$)/.test(f)), `gefragt wurde nach einem Monat: ${fragen.join(', ')}`);
            // Pakete auf demselben Image können an VERSCHIEDENEN Digests hängen —
            // dann ist höchstens eines davon aktuell. Hier: gleich dem jeweils ersten.
            assert.strictEqual(s.gefragtBei, 'Maschine A');
            assert.strictEqual(s.fehler, null);
            assert.strictEqual(s.zaehlung.unbekannt, 0);
            assert.strictEqual(s.zaehlung.aktuell + s.zaehlung.neuer_bau, pakete.length);
            assert.ok(s.zaehlung.aktuell >= gesehen.images, 'mindestens ein Paket je Image muss aktuell sein');
        });
        await pruefe('der Daemon nennt einen anderen Digest → jedes Paket „neuer Bau", mit Namen des Standes', async () => {
            daemon.antwort = (n) => ({ success: true, data: { images: n.images.map(i => ({ ...i, digest: 'sha256:' + 'e'.repeat(64), fassung: i.tag.replace(/^latest/, '2099.01') })) } });
            const s = await I.stand(db);
            assert.strictEqual(s.zaehlung.neuer_bau, pakete.length);
            for (const p of s.pakete) {
                assert.strictEqual(p.stand, 'neuer_bau');
                assert.match(p.neuester.fassung, /^2099\.01/);
                assert.strictEqual(T.imageVariante(p.neuester.fassung), T.imageVariante(p.tag), `${p.slug}: der neue Bau hat eine andere Ausprägung`);
            }
        });
        await pruefe('ohne Auskunft heisst NICHTS „aktuell": Daemon weg, zu alt, wirft, oder ein einzelnes Image fehlt', async () => {
            const lagen = [
                [() => { daemon.online = false; }, /Kein Daemon ist erreichbar/, null],
                [() => { daemon.antwort = { success: false, error: 'Gameserver nicht gefunden' }; }, /kennt die Abfrage noch nicht — sie kommt mit 1\.0\.116/, 'Maschine A'],
                [() => { daemon.antwort = new Error('Zeitüberschreitung'); }, /Zeitüberschreitung/, 'Maschine A'],
                [() => { daemon.antwort = { success: true, data: {} }; }, /keine Auskunft/, 'Maschine A'],
            ];
            for (const [stelle, muster, bei] of lagen) {
                daemon.online = true; stelle();
                try {
                    const s = await I.stand(db);
                    assert.match(s.fehler, muster);
                    assert.strictEqual(s.gefragtBei, bei);
                    assert.strictEqual(s.zaehlung.aktuell, 0, 'ohne Auskunft gilt ein Paket als aktuell');
                    assert.strictEqual(s.zaehlung.neuer_bau, 0);
                    assert.strictEqual(s.zaehlung.unbekannt, pakete.length);
                    for (const p of s.pakete) assert.match(p.grund, muster, `${p.slug} nennt den Grund nicht`);
                } finally { daemon.online = true; }
            }
            // Ein einzelnes Image lässt sich nicht auflösen: Die übrigen bleiben beurteilt.
            const einAusfall = pakete[0];
            daemon.antwort = (n) => ({ success: true, data: { images: n.images.map(i => (i.ref === einAusfall.ref && i.tag === einAusfall.frageTag
                ? { ...i, fehler: 'image nicht vorhanden' }
                : { ...i, digest: 'sha256:' + 'e'.repeat(64), fassung: '2099.01' })) } });
            const s = await I.stand(db);
            const betroffen = pakete.filter(p => p.ref === einAusfall.ref && p.frageTag === einAusfall.frageTag).length;
            assert.strictEqual(s.zaehlung.unbekannt, betroffen);
            assert.strictEqual(s.zaehlung.neuer_bau, pakete.length - betroffen);
            assert.strictEqual(s.fehler, null, 'ein einzelner Ausfall gilt als Ausfall des Ganzen');
        });
    } finally {
        await c.end();
    }

    // ── 4) Der Vertrag ───────────────────────────────────────────────────────
    console.log('\nVertrag mit Daemon und bauen.sh');
    await pruefe('der Daemon kennt `image.stand`, antwortet unter „images" und nennt Digest und Fassung', async () => {
        const verteiler = ohneKommentare(lies(DAEMON, 'internal/websocket/client.go'));
        assert.match(verteiler, /case "image\.stand":\s*c\.handleImageStand\(/);
        assert.ok(verteiler.includes('"Gameserver nicht gefunden"'), 'ein Daemon ohne den Befehl antwortet anders als die Übersicht erwartet');
        const ws = ohneKommentare(lies(DAEMON, 'internal/websocket/werkbank.go'));
        assert.match(ws, /ausNutzlast\(payload\["images"\], &bilder\)/);
        assert.match(ws, /"image\.stand", "", true, "", map\[string\]interface\{\}\{"images": liste\}/);
        const stand = ohneKommentare(lies(DAEMON, 'internal/gameserver/imagestand.go'));
        for (const feld of ['ref', 'tag', 'digest', 'fassung', 'hinweis', 'fehler']) assert.ok(stand.includes(`json:"${feld}`), `der Daemon nennt „${feld}" nicht`);
    });
    await pruefe('der Prüfdurchlauf meldet die Fassung des Images — und das Veröffentlichen schreibt sie ins Paket', async () => {
        const pruef = ohneKommentare(lies(DAEMON, 'internal/gameserver/werkbank_pruefung.go'));
        assert.match(pruef, /ImageTag\s+string\s+`json:"image_tag,omitempty"`/);
        assert.match(pruef, /e\.ImageTag = m\.imageFassung\(img\)/);
        const werkbank = ohneKommentare(lies(WURZEL, 'plugins/werkbank/dashboard/helpers/Sitzungen.js'));
        assert.match(werkbank, /tag: paketTag\(pruefung\),\s*digest: pruefung\.ergebnis\?\.image_digest,/, 'der Tag im Paket kommt nicht aus dem Durchlauf');
        assert.match(werkbank, /else if \(!paketTag\(letzte\)\)/, 'ohne Fassung im Durchlauf wird trotzdem veröffentlicht');
    });
    await pruefe('bauen.sh schiebt `latest…` bei jedem Bau, und jedes Image trägt seine Fassung im Etikett', async () => {
        const bauen = ohneKommentareShell(lies(DAEMON, 'images/bauen.sh'));
        assert.match(bauen, /LATEST="latest\$\{VARIANTE:\+-\$VARIANTE\}"/, 'der Tag des neuesten Baus heisst anders als die Tag-Regeln annehmen');
        assert.match(bauen, /push "\$NAME:\$LATEST"/, '`latest…` wird nicht geschoben — die Übersicht fragte einen Tag, der stehen bleibt');
        assert.match(bauen, /--build-arg "FB_VERSION=\$FASSUNG"/);
        const etikett = /LabelFassung = "([^"]+)"/.exec(ohneKommentare(lies(DAEMON, 'internal/gameserver/docker/pull.go')));
        assert.ok(etikett, 'der Daemon nennt das Etikett nicht');
        for (const img of ['base', 'steamcmd', 'java', 'dotnet', 'proton']) {
            const d = ohneKommentareShell(lies(DAEMON, 'images', img, 'Dockerfile'));
            assert.ok(d.includes(`${etikett[1]}="\${FB_VERSION}"`), `fb/${img} trägt das Etikett ${etikett[1]} nicht`);
        }
    });

    // ── 5) Seite und Route ───────────────────────────────────────────────────
    console.log('\nSeite und Route');
    await pruefe('/admin/addons/imagestand steht vor /:id, und die Liste füllt ihre Spalte daraus', async () => {
        const router = ohneKommentare(lies(WURZEL, 'apps/dashboard/routes/admin/addons.router.js'));
        const stand = router.indexOf("router.get('/imagestand'"), einzeln = router.indexOf("router.get('/:id'");
        assert.ok(stand > 0 && einzeln > stand, '„imagestand" würde als Kennung eines Spiels gelesen');
        assert.match(router, /Imagestand\.stand\(dbService\)/);
        const ansicht = ohneKommentareEjs(lies(WURZEL, 'apps/dashboard/themes/default/views/admin/addons/index.ejs'));
        assert.ok(ansicht.includes('data-image-stand="<%= addon.id %>"'), 'die Zeile hat keine Zelle für den Image-Stand');
        assert.ok(ansicht.includes("fetch('/admin/addons/imagestand'"));
        for (const s of ["p.stand === 'aktuell'", "p.stand === 'neuer_bau'"]) assert.ok(ansicht.includes(s), `die Seite unterscheidet „${s}" nicht`);
        // Was aus Paketen kommt, wird als Text gesetzt.
        // Anker sind Code, keine Kommentare — die sind hier schon entfernt.
        const block = ansicht.slice(ansicht.indexOf("document.querySelectorAll('[data-image-stand]')"), ansicht.indexOf("document.getElementById('addonSearch')"));
        assert.ok(block.length > 500 && !/innerHTML/.test(block), 'die Spalte setzt HTML aus Paketdaten');
    });

    console.log(`\n  · gesehen: ${gesehen.pakete} Pakete auf ${gesehen.images} Images`);
    console.log(fehler === 0 ? '\n✅ Image-Stand: eine Regel für Tags, drei ehrliche Auskünfte, und der Umzug schreibt Tag und Digest des geprüften Baus\n' : `\n❌ ${fehler} Abweichung(en)\n`);
    process.exit(fehler === 0 ? 0 : 1);
})().catch((e) => { console.error('FEHLER:', e.message); process.exit(1); });
