#!/usr/bin/env node
/**
 * Prüft das Öffnen fertiger Pakete in der Werkbank (Durchreichen, 2026-10-07).
 *
 * Betreiber: *„die werkbank muss genau das liefern können … wenn das fehlt muss
 * es rein"* — und als Weg: erst durchreichen, dann Karte für Karte. Die fünf
 * Bestandspakete tragen Teile, für die die Werkbank keine Karte hat (Abfrage,
 * Fernsteuerung, Mods, Befehle, Sperrliste, feste Zeilen in Dateien). Öffnet
 * sie ein solches Paket, muss am Ende DASSELBE Paket wieder herauskommen.
 *
 * Geprüft wird an JEDEM eingelieferten Paket (neueste Fassung, nur lesend):
 *
 *   1. zerlegen und zusammensetzen ergibt dasselbe Paket
 *   2. veröffentlichen OHNE einen einzigen Nachweis nimmt ihm nichts — und das
 *      Ergebnis besteht dasselbe Tor wie jede Einlieferung (check-pakete)
 *   3. den Startteil unverändert speichern ändert nichts
 *   4. eine Einstellung unverändert speichern ändert nichts
 *   5. einen Port übernehmen lässt Kopplung und Platz stehen
 *
 * Dazu die Sperre: Eine Sitzung, die ein Bestandspaket NEU baut, darf es nicht
 * überschreiben.
 *
 *   node scripts/check-werkbank-oeffnen.js
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const WURZEL = path.join(__dirname, '..');
require('dotenv').config({ path: path.join(WURZEL, 'apps/dashboard/.env'), quiet: true });
const mysql = require('mysql2/promise');
const { ServiceManager } = require('dunebot-core');

// Die Werkbank schreibt ihren Entwurf über den dbService. Hier gibt es genau
// eine Schreibabfrage, und die geht ins Leere — alles andere wäre ein Befund.
let erlaubt = () => null;
ServiceManager.register('dbService', {
    query: async (sql, params) => {
        if (/^UPDATE werkbank_sitzungen SET entwurf = \? WHERE id = \?$/.test(sql.trim())) return {};
        const r = erlaubt(sql, params);
        if (r !== null) return r;
        throw new Error(`Attrappe kennt die Abfrage nicht: ${sql.trim().slice(0, 90)}`);
    },
});
const S = require('../plugins/werkbank/dashboard/helpers/Sitzungen');
const { startAusFormular, startAlsFormular } = require('../plugins/werkbank/dashboard/routes/guild.router');
const einl = require('../packages/fbpkg/lib/einlieferung');

let fehler = 0;
async function pruefe(was, tun) {
    try { await tun(); console.log(`  ✓ ${was}`); }
    catch (e) { fehler++; console.log(`  ✗ ${was}\n      ${String(e.message).split('\n').slice(0, 3).join('\n      ')}`); }
}
const j = (v) => (typeof v === 'string' ? JSON.parse(v) : v);

/**
 * Gleichheit, wie das Paket sie meint: Schlüsselreihenfolge egal; ein leeres
 * `env` ist kein `env`; eine Startzeile mit EINEM Stück ist dieselbe, ob sie als
 * Text oder als Liste mit einem Eintrag steht (so schreibt es das Formular).
 */
function norm(v, pfad = '') {
    if (Array.isArray(v)) return v.map((x, i) => norm(x, `${pfad}[${i}]`));
    if (v && typeof v === 'object') {
        const aus = {};
        for (const k of Object.keys(v).sort()) {
            let w = v[k];
            if (k === 'form' && Array.isArray(w) && w.length === 1) w = w[0];
            if (k === 'env' && w && typeof w === 'object' && !Object.keys(w).length) continue;
            aus[k] = norm(w, `${pfad}.${k}`);
        }
        return aus;
    }
    return v;
}
function abweichungen(a, b, pfad = '') {
    const x = norm(a), y = norm(b);
    if (JSON.stringify(x) === JSON.stringify(y)) return [];
    if (x && y && typeof x === 'object' && typeof y === 'object' && Array.isArray(x) === Array.isArray(y)) {
        let aus = [];
        for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) {
            aus = aus.concat(abweichungen(x[k], y[k], pfad + (Array.isArray(x) ? `[${k}]` : `.${k}`)));
        }
        return aus;
    }
    return [`${pfad}: ${JSON.stringify(x)?.slice(0, 70)} → ${JSON.stringify(y)?.slice(0, 70)}`];
}
const TEILE = ['ports', 'install', 'start', 'env', 'settings', 'hints', ...S.DURCHGEREICHT];
const vergleiche = (alt, neu) => TEILE.flatMap(t => abweichungen({ [t]: alt[t] }, { [t]: neu[t] }));

/** Eine Einstellung so ins Formular legen, wie der Knopf „Bearbeiten" es tut. */
function alsFormular(e) {
    return {
        alt: e.key, key: e.key,
        name_de: (e.name && e.name.de) || '', name_en: (e.name && e.name.en) || '',
        beschreibung_de: (e.description && e.description.de) || '', beschreibung_en: (e.description && e.description.en) || '',
        group: e.group || '', type: e.type,
        default: e.default === undefined || e.default === null ? '' : (e.type === 'boolean' ? (e.default ? '1' : '0') : String(e.default)),
        min: e.min === undefined ? '' : String(e.min), max: e.max === undefined ? '' : String(e.max),
        required: Boolean(e.required),
        choices: (e.choices || []).map(c => c.value + (c.name && c.name.de ? '=' + c.name.de : '')).join('\n'),
        role: e.role, takes_effect: e.takes_effect, risk: e.risk || 'none',
        apply: (e.apply || []).map(z => Object.fromEntries(Object.entries(z).map(([k, v]) => [k, String(v)]))),
    };
}

(async () => {
    const c = await mysql.createConnection({
        host: process.env.MYSQL_HOST, port: process.env.MYSQL_PORT,
        user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD,
        database: process.env.MYSQL_DATABASE, dateStrings: true,
    });
    const [zeilen] = await c.query('SELECT v.fbpkg FROM package_versions v ORDER BY v.published_at, v.id');
    await c.end();
    const neueste = new Map();
    for (const z of zeilen) { const p = j(z.fbpkg); neueste.set(p.identity.slug, p); }
    assert.ok(neueste.size > 0, 'kein einziges Paket in der Datenbank — der Wächter mässe nichts');

    const gesamt = { einstellungen: 0, ziele: 0, durchgereicht: new Set() };
    const ohneZiel = [];
    for (const [slug, paket] of neueste) {
        console.log(`\n${slug} ${paket.identity.version}`);
        const { entwurf, image, schritte, rest } = S.entwurfAusPaket(paket);
        entwurf.werkbank = { geoeffnet: { slug, version: paket.identity.version, ziele: S.zieleAusPaket(paket) } };
        const sitzung = { id: 1, kennung: 'wbprobe', entwurf, image };
        const liste = schritte.map(schritt => ({ status: 'uebernommen', schritt }));
        for (const k of Object.keys(entwurf.durchgereicht || {})) gesamt.durchgereicht.add(k);

        await pruefe('nichts bleibt liegen: jedes Feld des Pakets hat eine Karte oder reist mit', async () => {
            assert.deepStrictEqual(rest, []);
        });

        await pruefe('zerlegen und zusammensetzen ergibt dasselbe Paket', async () => {
            const zurueck = S.entwurfAlsPaket(sitzung, liste);
            assert.deepStrictEqual(vergleiche(paket, zurueck), []);
            assert.strictEqual(`${zurueck.image.ref}:${zurueck.image.tag}`, `${paket.image.ref}:${paket.image.tag}`);
            assert.strictEqual(zurueck.identity.slug, slug);
            assert.strictEqual(zurueck.identity.version, S.naechsteFassung(paket.identity.version), 'vorgeschlagen wird die nächste Fassung');
        });

        await pruefe('veröffentlichen ohne einen einzigen Nachweis nimmt dem Paket nichts — und besteht das Tor', async () => {
            const geprueft = S.entwurfAlsPaket(sitzung, liste);
            const pruefung = { id: 1, status: 'gruen', entwurf: geprueft, beendet_am: new Date(),
                ergebnis: { gruen: true, image_digest: paket.image.digest, einstellungen: [] } };
            const neu = S.veroeffentlichungsPaket(sitzung, liste, pruefung, 'waechter');
            assert.deepStrictEqual(vergleiche(paket, neu), []);
            gesamt.einstellungen += (neu.settings || []).length;
            gesamt.ziele += (neu.settings || []).reduce((n, e) => n + (e.apply || []).length, 0);
            const teile = S.DURCHGEREICHT.filter(k => paket[k] !== undefined);
            if (teile.length) {
                assert.ok(neu.status.open.some(z => /Unverändert übernommen/.test(z) && teile.every(t => z.includes(t))),
                    'das Paket sagt nicht, was ungeprüft mitreist');
            }
            const ordner = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-oeffnen-'));
            try {
                const datei = path.join(ordner, `${slug}.json`);
                fs.writeFileSync(datei, JSON.stringify(neu));
                const tor = einl.bestehtPruefung(datei);
                assert.ok(tor.ok, einl.grundZeilen(tor.text || '').slice(0, 3).join(' | '));
            } finally { fs.rmSync(ordner, { recursive: true, force: true }); }
        });

        await pruefe('Startteil unverändert speichern ändert nichts', async () => {
            const s2 = { ...sitzung, entwurf: JSON.parse(JSON.stringify(entwurf)) };
            await S.startSpeichern(s2, { start: startAusFormular(startAlsFormular(paket.start), paket.settings), memory_mb: 4096, cpu_prozent: 200 });
            assert.deepStrictEqual(abweichungen(paket.start, s2.entwurf.start, 'start'), []);
        });

        await pruefe(`Einstellungen unverändert speichern ändert nichts (${(paket.settings || []).length})`, async () => {
            const ab = [];
            for (const e of paket.settings || []) {
                // Eine Einstellung ohne Ziel kann das Formular nicht speichern (es
                // verlangt eins) — sie ist dort nicht bearbeitbar, bis ihr Teil eine
                // Karte hat. Verloren gehen darf sie trotzdem nicht: Das prüft die
                // Probe „veröffentlichen ohne Nachweis" oben.
                if (!(e.apply || []).length) {
                    assert.throws(() => S.einstellungAusFormular(alsFormular(e)), /Mindestens ein Ziel/);
                    ohneZiel.push(`${slug}/${e.key}`);
                    continue;
                }
                const neu = S.mischeEinstellung(e, S.einstellungAusFormular(alsFormular(e)));
                for (const x of abweichungen(e, neu, e.key)) ab.push(x);
            }
            assert.deepStrictEqual(ab.slice(0, 8), []);
        });

        await pruefe('Port übernehmen: Kopplung, Beschreibung und Platz in der Liste bleiben', async () => {
            const s2 = { ...sitzung, entwurf: JSON.parse(JSON.stringify(entwurf)) };
            const vorher = JSON.parse(JSON.stringify(s2.entwurf.ports));
            let nr = 30000;
            for (const p of vorher) {
                await S.portUebernehmen(s2, { zweck: p.purpose, protocol: p.protocol === 'both' ? 'udp' : p.protocol, port: nr });
                if (p.protocol === 'both') await S.portUebernehmen(s2, { zweck: p.purpose, protocol: 'tcp', port: nr });
                nr++;
            }
            assert.deepStrictEqual(abweichungen(vorher, s2.entwurf.ports, 'ports'), []);
            assert.strictEqual(Object.keys(s2.entwurf.werkbank.portnummern).length, vorher.length, 'jeder Zweck hat seine Nummer');
        });
    }

    console.log('\nSperre: ein Bestandspaket neu bauen statt öffnen');
    const mitTeilen = [...neueste].find(([, p]) => S.DURCHGEREICHT.some(k => p[k] !== undefined));
    await pruefe('eine frische Sitzung darf ein Paket mit durchgereichten Teilen nicht überschreiben', async () => {
        assert.ok(mitTeilen, 'kein Paket mit durchgereichten Teilen gefunden — die Sperre wäre ungeprüft');
        const [slug, alt] = mitTeilen;
        erlaubt = (sql) => {
            if (/^SELECT pv\.version FROM package_versions pv JOIN packages p ON p\.id = pv\.package_id WHERE p\.slug = \?$/.test(sql.trim())) return [{ version: alt.identity.version }];
            if (/FROM packages pk\s+JOIN package_versions v ON v\.package_id = pk\.id/.test(sql)) return [{ paket_id: 1, slug, version: alt.identity.version, channel: 'test', fbpkg: JSON.stringify(alt) }];
            return null;
        };
        const frisch = { id: 2, kennung: 'wbneu', image: { ref: alt.image.ref, tag: alt.image.tag },
            entwurf: { identity: { slug, name: slug, version: S.naechsteFassung(alt.identity.version) }, ports: alt.ports, start: alt.start } };
        const liste = alt.install.steps.map(schritt => ({ status: 'ok', schritt }));
        const paket = S.entwurfAlsPaket(frisch, liste);
        const gruen = [{ id: 1, status: 'gruen', entwurf: paket, ergebnis: { image_digest: 'sha256:' + 'a'.repeat(64), einstellungen: [] } }];
        const st = await S.veroeffentlichungsStand(frisch, liste, gruen);
        assert.strictEqual(st.darf, false);
        assert.match(st.gruende.join(' '), /ginge das verloren/);
        // Gegenprobe: dieselbe Lage, aber aus dem Paket GEÖFFNET — dann darf sie.
        const offen = S.entwurfAusPaket(alt);
        offen.entwurf.werkbank = { geoeffnet: { slug, version: alt.identity.version, ziele: S.zieleAusPaket(alt) } };
        const geoeffnet = { id: 3, kennung: 'wboffen', image: offen.image, entwurf: offen.entwurf };
        const liste2 = offen.schritte.map(schritt => ({ status: 'uebernommen', schritt }));
        const p2 = S.entwurfAlsPaket(geoeffnet, liste2);
        const st2 = await S.veroeffentlichungsStand(geoeffnet, liste2,
            [{ id: 2, status: 'gruen', entwurf: p2, ergebnis: { image_digest: 'sha256:' + 'a'.repeat(64), einstellungen: [] } }]);
        assert.deepStrictEqual(st2.gruende, [], 'eine geöffnete Sitzung darf wieder einliefern');
        erlaubt = () => null;
    });

    await pruefe('eine Sitzung ohne geöffnetes Paket verhält sich wie bisher: unbelegte Einstellung fällt weg', async () => {
        const e = { key: 'slots', name: { de: 'Plätze' }, type: 'number', role: 'player', takes_effect: 'restart', risk: 'none',
            apply: [{ target: 'env', variable: 'SLOTS' }] };
        const b = S.belegteEinstellungen({ settings: [e], env: { SLOTS: '{{setting:slots}}' } }, { einstellungen: [] }, {});
        assert.deepStrictEqual([b.behalten.length, b.weg.length, b.ohneBeleg, Object.keys(b.env).length], [0, 1, 0, 0]);
        // … und mit demselben Ziel als „übernommen" bleibt sie, gezählt als ohne Beleg.
        const b2 = S.belegteEinstellungen({ settings: [e], env: {} }, { einstellungen: [] }, S.zieleAusPaket({ settings: [e] }));
        assert.deepStrictEqual([b2.behalten.length, b2.weg.length, b2.ohneBeleg], [1, 0, 1]);
        // Wird das Ziel geändert, ist es nicht mehr das übernommene — dann zählt wieder der Beleg.
        const geaendert = { ...e, apply: [{ target: 'env', variable: 'MAX_SLOTS' }] };
        const b3 = S.belegteEinstellungen({ settings: [geaendert], env: {} }, { einstellungen: [] }, S.zieleAusPaket({ settings: [e] }));
        assert.deepStrictEqual([b3.behalten.length, b3.weg.length], [0, 1]);
    });

    // ── Der ganze Weg durch die Datenbank ───────────────────────────────────
    //
    // Bis hier lief alles im Speicher. Jetzt `paketOeffnen` selbst: Sitzung und
    // Schritte werden angelegt, wieder geladen, zum Paket gebaut. Geschrieben
    // wird in TEMPORÄRE Tabellen, die die echten in dieser einen Verbindung
    // verdecken — am Ende wird nachgezählt, dass die echten unverändert sind.
    console.log('\nÖffnen über die Datenbank (temporäre Tabellen)');
    const c2 = await mysql.createConnection({
        host: process.env.MYSQL_HOST, port: process.env.MYSQL_PORT,
        user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD,
        database: process.env.MYSQL_DATABASE, dateStrings: true,
    });
    const zaehle = async () => JSON.stringify((await c2.query(
        `SELECT (SELECT COUNT(*) FROM werkbank_sitzungen) s, (SELECT COUNT(*) FROM werkbank_schritte) x,
                (SELECT COALESCE(MAX(id), 0) FROM werkbank_sitzungen) m`))[0][0]);
    const vorher = await zaehle();
    await c2.query('CREATE TEMPORARY TABLE wb_form_s LIKE werkbank_sitzungen');
    await c2.query('CREATE TEMPORARY TABLE wb_form_x LIKE werkbank_schritte');
    await c2.query('CREATE TEMPORARY TABLE werkbank_sitzungen LIKE wb_form_s');
    await c2.query('CREATE TEMPORARY TABLE werkbank_schritte LIKE wb_form_x');
    await c2.query('DROP TEMPORARY TABLE wb_form_s, wb_form_x');
    ServiceManager.register('dbService', {
        query: async (sql, params) => {
            const t = sql.trim();
            // Lesen darf alles; schreiben nur in die beiden verdeckten Tabellen.
            if (!/^SELECT\b/i.test(t)) {
                assert.match(t, /^(INSERT INTO|UPDATE|ALTER TABLE) werkbank_(sitzungen|schritte)\b/,
                    `der Wächter schreibt nur in die temporären Werkbank-Tabellen: ${t.slice(0, 70)}`);
            }
            const [zeilen] = await c2.query(sql, params);
            return zeilen;
        },
    });
    // Der Zustand `uebernommen` kommt mit der Migration — hier an der temporären Tabelle.
    await require('../plugins/werkbank/migrations/20261007_160000_werkbank_schritt_uebernommen.js')
        .up({ query: async (sql, params) => (await c2.query(sql, params))[0] });

    const [[maschine]] = await c2.query(
        "SELECT id, guild_id FROM rootserver WHERE install_status = 'completed' ORDER BY id LIMIT 1");
    const [paketZeilen] = await c2.query('SELECT id, slug FROM packages ORDER BY slug');
    for (const z of paketZeilen) {
        const alt = neueste.get(z.slug);
        await pruefe(`${z.slug}: öffnen, laden, bauen — dasselbe Paket`, async () => {
            assert.ok(maschine, 'keine Maschine in der Datenbank');
            const r = await S.paketOeffnen({ guildId: maschine.guild_id, userId: '1', paketId: z.id, rootserverId: maschine.id });
            assert.strictEqual(r.version, alt.identity.version, 'geöffnet wird die neueste Fassung');
            const sitzung = await S.laden(maschine.guild_id, r.kennung);
            const liste = await S.schritte(sitzung.id);
            assert.strictEqual(liste.length, alt.install.steps.length);
            assert.ok(liste.every(x => x.status === 'uebernommen'), 'die Schritte stehen als übernommen da');
            assert.deepStrictEqual(vergleiche(alt, S.entwurfAlsPaket(sitzung, liste)), []);
            // Jeder Zweck hat eine Nummer — sonst liesse sich kein Prüfdurchlauf starten.
            const nr = sitzung.entwurf.werkbank.portnummern;
            for (const p of alt.ports || []) assert.ok(Number.isInteger(nr[p.purpose]), `Port „${p.purpose}" ohne Nummer`);
            for (const p of alt.ports || []) {
                const m = /^([a-z_]+)\+(\d+)$/.exec(p.assign || '');
                if (m) assert.strictEqual(nr[p.purpose], nr[m[1]] + Number(m[2]), `„${p.purpose}" ist nicht an „${m[1]}" gekoppelt`);
            }
            assert.strictEqual(sitzung.entwurf.werkbank.geoeffnet.slug, z.slug);
            // Was der Daemon für Start und Durchlauf bekommt, sind genau die vier Laufzeit-Teile des Pakets.
            const ganz = S.entwurfAlsPaket(sitzung, liste);
            for (const k of S.LAUFZEIT_TEILE) assert.deepStrictEqual(ganz[k], alt[k], `„${k}" käme beim Daemon anders an`);
            // Einen übernommenen Schritt herausnehmen: Er verlässt den Entwurf.
            if (liste.length) {
                await S.herausnehmen(sitzung, liste[0].id);
                const danach = await S.schritte(sitzung.id);
                assert.strictEqual(S.entwurfAlsPaket(sitzung, danach).install.steps.length, liste.length - 1);
            }
        });
    }
    await pruefe('ein Paket, das es nicht gibt, und eine fremde Maschine werden abgewiesen', async () => {
        await assert.rejects(S.paketOeffnen({ guildId: maschine.guild_id, userId: '1', paketId: 99999999, rootserverId: maschine.id }), /gibt es nicht/);
        await assert.rejects(S.paketOeffnen({ guildId: 'fremd', userId: '1', paketId: paketZeilen[0].id, rootserverId: maschine.id }), /gehört nicht zu dieser Guild/);
    });
    await c2.query('DROP TEMPORARY TABLE werkbank_sitzungen, werkbank_schritte');
    await pruefe('die echten Werkbank-Tabellen sind unberührt', async () => {
        assert.strictEqual(await zaehle(), vorher);
    });
    await c2.end();

    if (ohneZiel.length) console.log(`\n  · im Formular nicht bearbeitbar (ohne Ziel), bleiben aber erhalten: ${ohneZiel.join(', ')}`);
    console.log(`  · ${neueste.size} Pakete, ${gesamt.einstellungen} Einstellungen mit ${gesamt.ziele} Zielen; durchgereicht: ${[...gesamt.durchgereicht].sort().join(', ')}`);
    console.log(fehler === 0 ? '\n✅ Öffnen: jedes Paket kommt unverändert wieder heraus\n' : `\n❌ ${fehler} Abweichung(en)\n`);
    process.exit(fehler === 0 ? 0 : 1);
})().catch((e) => { console.error('FEHLER:', e.message); process.exit(1); });
