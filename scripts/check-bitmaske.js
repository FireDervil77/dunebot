#!/usr/bin/env node
/**
 * Bitmaske (`type: flags`) — von der Werkbank bis in die gespeicherte Zahl.
 *
 * ── Was hier gehalten wird (2026-10-11) ─────────────────────────────────────
 *
 * Eine Bitmaske ist eine Einstellung, deren Wert die SUMME angekreuzter
 * Möglichkeiten ist. Sie geht durch fünf Hände, und jede kann sie still
 * verderben:
 *
 *   Werkbank      nimmt 3 als „Bit" an — dann lässt sich „beides" nicht mehr
 *                 unabhängig abwählen
 *   Anlegen       zeichnet sie als Aufklappliste (auch sie trägt `choices`) —
 *                 dann ist nur EIN Bit wählbar
 *   Serverseite   zeigt ein Zahlenfeld — dann rechnet der Spieler selbst
 *   Speichern     prüft „ist einer der Werte" — dann wird 5 abgewiesen
 *   Browser       bildet die Summe falsch oder meldet die Änderung nicht —
 *                 dann erscheint die Fußleiste mit „Speichern" nie
 *
 * Die Regel steht in EINER Datei (`helpers/Bitmaske.js`); dieser Wächter prüft
 * die Regel und dass jede der fünf Stellen sie fragt.
 *
 * Der Daemon kommt nicht vor: Er kennt den Typ nicht und bekommt die Zahl wie
 * jede andere (`pkgspec.Setting.Type` entscheidet dort nur über Ja/Nein).
 *
 *   node scripts/check-bitmaske.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { spawnSync } = require('child_process');
const { ServiceManager } = require('dunebot-core');
const { ohneKommentare, ohneKommentareEjs } = require('./lib/quelltext');

const still = () => {};
if (!ServiceManager.has('Logger')) {
    ServiceManager.register('Logger', { debug: still, info: still, warn: still, error: still, success: still });
}

const WURZEL = path.join(__dirname, '..');
const ANSICHTEN = path.join(WURZEL, 'plugins/gameserver/dashboard/views/guild');
const Bitmaske = require(path.join(WURZEL, 'plugins/gameserver/dashboard/helpers/Bitmaske'));
const Serverseite = require(path.join(WURZEL, 'plugins/gameserver/dashboard/helpers/Serverseite'));
const { paketWerteAnlegen } = require(path.join(WURZEL, 'plugins/gameserver/dashboard/helpers/StartPayload'));
const Sitzungen = require(path.join(WURZEL, 'plugins/werkbank/dashboard/helpers/Sitzungen'));
const ejs = require('ejs');

let bestanden = 0;
const pruefe = async (name, fn) => {
    try { await fn(); console.log(`  ✓ ${name}`); bestanden++; }
    catch (fehler) { console.error(`  ✗ ${name}\n    ${fehler.message}`); process.exitCode = 1; }
};

const bit = (wert, name) => ({ value: wert, name: { de: name } });
const BOTS = {
    key: 'bot_flags', group: 'bots', name: { de: 'Bot-Verhalten' }, type: 'flags', default: 5, role: 'player',
    choices: [bit(1, 'Bots dürfen Fahrzeuge nutzen'), bit(2, 'Bots dürfen Minen legen'), bit(4, 'Bots zählen als Spieler')],
    apply: [{ target: 'file', file: 'server.cfg', parser: 'cfg', path: 'bot_flags' }],
};
const VIELE = {
    key: 'abstimmungen', group: 'votes', name: { de: 'Abstimmungen' }, type: 'flags', default: 0, role: 'player',
    choices: Array.from({ length: 12 }, (_, i) => bit(2 ** i, 'Abstimmung ' + (i + 1))),
    apply: [{ target: 'file', file: 'server.cfg', parser: 'cfg', path: 'g_voting' }],
};
const PAKET = { identity: { name: 'Probe' }, settings: [BOTS, VIELE] };

const zeichne = (daten) => ejs.renderFile(path.join(ANSICHTEN, 'partials/bitmaske.ejs'),
    { maskeName: '', maskeFeld: '', maskeZahl: false, maskeHinweis: '', ...daten });

(async () => {
    console.log('Bitmaske');

    await pruefe('Regel: ein Bit ist eine Zweierpotenz, keines doppelt, keines über 2^30', () => {
        assert.strictEqual(Bitmaske.fehlerDerBits(BOTS), null);
        assert.match(Bitmaske.fehlerDerBits({ choices: [bit(1, 'a'), bit(3, 'b')] }), /„3" ist kein einzelnes Bit/);
        assert.match(Bitmaske.fehlerDerBits({ choices: [bit(0, 'a')] }), /kein einzelnes Bit/);
        assert.match(Bitmaske.fehlerDerBits({ choices: [bit('vier', 'a')] }), /kein einzelnes Bit/);
        assert.match(Bitmaske.fehlerDerBits({ choices: [bit(2, 'a'), bit('2', 'b')] }), /Bit 2 steht zweimal/);
        assert.match(Bitmaske.fehlerDerBits({ choices: [bit(2 ** 31, 'a')] }), /zu groß/);
        assert.match(Bitmaske.fehlerDerBits({ choices: [] }), /mindestens eine/);
        // Handgeschriebene Pakete tragen die Bits auch als Text.
        assert.strictEqual(Bitmaske.fehlerDerBits({ choices: [bit('1', 'a'), bit('8', 'b')] }), null);
        assert.strictEqual(Bitmaske.maske(BOTS), 7);
    });

    await pruefe('Regel: ein Wert ist eine Summe aus den Möglichkeiten — nichts sonst', () => {
        for (const gut of [0, 5, 7, '0', '5', ' 6 ']) assert.strictEqual(Bitmaske.fehlerDesWerts(BOTS, gut), null, String(gut));
        assert.match(Bitmaske.fehlerDesWerts(BOTS, 8), /8 enthält 8, das keine der Möglichkeiten ist — möglich ist höchstens 7/);
        assert.match(Bitmaske.fehlerDesWerts(BOTS, '13'), /13 enthält 8/);
        for (const schlecht of ['', 'fünf', '-1', '1.5', '0x4', null, undefined, true]) {
            assert.match(String(Bitmaske.fehlerDesWerts(BOTS, schlecht)), /keine Summe/, String(schlecht));
        }
        // Lücken in der Maske: 2 fehlt, also ist 3 nicht möglich.
        const mitLuecke = { choices: [bit(1, 'a'), bit(4, 'b')] };
        assert.strictEqual(Bitmaske.fehlerDesWerts(mitLuecke, 5), null);
        assert.match(Bitmaske.fehlerDesWerts(mitLuecke, 3), /3 enthält 2/);
    });

    await pruefe('Schema: `flags` ist ein Typ, die Bits stehen als Zahl in `choices`', () => {
        const Ajv = require('ajv');
        const schema = require(path.join(WURZEL, 'packages/fbpkg/schema/fbpkg-v1.schema.json'));
        const ajv = new Ajv({ allErrors: true, strict: false });
        ajv.addSchema(schema, 'fbpkg');
        const pruef = ajv.compile({ $ref: 'fbpkg#/properties/settings/items' });
        assert.ok(pruef(BOTS), JSON.stringify(pruef.errors));
        assert.ok(!pruef({ ...BOTS, type: 'bitmaske' }), 'das Schema nimmt einen erfundenen Typ an — es prüft nichts');
    });

    await pruefe('Werkbank: Formular → Bitmaske, Fehler dort gesagt, wo getippt wird', () => {
        const formular = (x = {}) => ({
            key: 'bot_flags', name_de: 'Bot-Verhalten', type: 'flags', default: '5', group: 'bots',
            choices: '1=Bots dürfen Fahrzeuge nutzen\n2=Bots dürfen Minen legen\n4=Bots zählen als Spieler',
            role: 'player', takes_effect: 'restart', risk: 'none',
            apply: [{ target: 'file', file: 'server.cfg', parser: 'cfg', path: 'bot_flags' }], ...x,
        });
        assert.ok(Sitzungen.EINSTELLUNG.typen.includes('flags'), 'die Werkbank bietet den Typ nicht an');
        const e = Sitzungen.einstellungAusFormular(formular());
        assert.deepStrictEqual(e.choices, BOTS.choices);
        assert.strictEqual(e.default, 5);
        assert.strictEqual(Sitzungen.einstellungAusFormular(formular({ default: '0' })).default, 0);

        const wirft = (x, muster) => assert.throws(() => Sitzungen.einstellungAusFormular(formular(x)), muster);
        wirft({ choices: '1=a\n3=beides' }, /„3" ist kein einzelnes Bit/);
        wirft({ choices: '1=a\n1=b' }, /Bit 1 steht zweimal/);
        wirft({ choices: 'hart=Schwer' }, /kein einzelnes Bit/);
        wirft({ choices: '1=a\n2' }, /Bit 2 hat keinen Anzeigenamen/);
        wirft({ choices: '' }, /mindestens eine/);
        wirft({ default: '8' }, /Vorgabe: 8 enthält 8/);
        wirft({ default: 'alle' }, /Vorgabe: .*keine Summe/);
        // Keine stille 0 — wo das Spiel mit 7 ausgeliefert wird, schaltete sie alles ab.
        wirft({ default: '' }, /Vorgabe: die Summe, mit der das Spiel startet/);

        // Auswahl bleibt, was sie war: Text als Wert, mindestens zwei, eine davon als Vorgabe.
        const wahl = Sitzungen.einstellungAusFormular(formular({ type: 'choice', default: '2', choices: '1=a\n2=b' }));
        assert.deepStrictEqual(wahl.choices.map(c => c.value), ['1', '2']);
    });

    await pruefe('Werkbank: die Seite bietet den Typ an und zeigt die Möglichkeiten für beide', () => {
        const seite = ohneKommentareEjs(fs.readFileSync(
            path.join(WURZEL, 'plugins/werkbank/dashboard/views/guild/werkbank-sitzung.ejs'), 'utf8'));
        assert.match(seite, /<option value="flags">Bitmaske<\/option>/);
        assert.match(seite, /data-nur-typ="choice flags"/);
        // Ohne diese Zeile bliebe das Feld bei „Bitmaske" versteckt: Verglichen
        // wurde bis dahin der ganze Text mit dem Typ.
        assert.match(seite, /dataset\.nurTyp\.split\(' '\)\.indexOf\(typE\.value\) === -1/);
    });

    await pruefe('Werkbank: ein Probewert, der nicht aufgeht, wird nicht gespeichert', async () => {
        const sitzung = { entwurf: { settings: [BOTS] } };
        await assert.rejects(Sitzungen.probewerteSetzen(sitzung, { bot_flags: '9' }), /„bot_flags": 9 enthält 8/);
        await assert.rejects(Sitzungen.probewerteSetzen(sitzung, { bot_flags: 'x' }), /keine Summe/);
        assert.ok(!sitzung.entwurf.werkbank, 'abgewiesen, aber trotzdem geschrieben');
    });

    await pruefe('Wächter check-pakete: ein Paket mit falschem Bit oder falscher Vorgabe fällt durch', () => {
        const ordner = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-bitmaske-'));
        try {
            const vorlage = require(path.join(WURZEL, 'packages/fbpkg/beispiele/factorio.json'));
            const lauf = (einstellung) => {
                const datei = path.join(ordner, 'paket.json');
                fs.writeFileSync(datei, JSON.stringify({ ...vorlage, settings: [...vorlage.settings, einstellung] }));
                const r = spawnSync(process.execPath, [path.join(__dirname, 'check-pakete.js'), datei], { encoding: 'utf8' });
                return { code: r.status, text: r.stdout + r.stderr };
            };
            const gut = lauf(BOTS);
            assert.strictEqual(gut.code, 0, 'ein gültiges Paket mit Bitmaske fällt durch:\n' + gut.text.slice(-600));
            const bit3 = lauf({ ...BOTS, choices: [bit(1, 'a'), bit(3, 'b')], default: 1 });
            assert.strictEqual(bit3.code, 1);
            assert.match(bit3.text, /"bot_flags": type "flags" — „3" ist kein einzelnes Bit/);
            const vorgabe = lauf({ ...BOTS, default: 8 });
            assert.strictEqual(vorgabe.code, 1);
            assert.match(vorgabe.text, /"bot_flags": Vorgabe — 8 enthält 8/);
        } finally {
            fs.rmSync(ordner, { recursive: true, force: true });
        }
    });

    await pruefe('Anzeige: der gespeicherte Wert gilt, sonst die Vorgabe; Fremdes wird gemeldet', () => {
        const an = (m) => m.bits.filter(b => b.an).map(b => b.wert);
        assert.strictEqual(Bitmaske.fuerAnzeige({ ...BOTS, type: 'choice' }, 5), null);
        assert.deepStrictEqual(an(Bitmaske.fuerAnzeige(BOTS, '6')), [2, 4]);
        const m = Bitmaske.fuerAnzeige(BOTS, '6');
        assert.deepStrictEqual([m.summe, m.aktiv, m.gesamt, m.fremd, m.lesbar, m.zugeklappt], [6, 2, 3, 0, true, false]);
        // 69 = 64 + 4 + 1 — die 64 bietet das Paket nicht an.
        const fremd = Bitmaske.fuerAnzeige(BOTS, '69');
        assert.deepStrictEqual([an(fremd), fremd.summe, fremd.fremd], [[1, 4], 5, 64]);
        const kaputt = Bitmaske.fuerAnzeige(BOTS, 'viel');
        assert.deepStrictEqual([an(kaputt), kaputt.lesbar], [[], false]);
        assert.strictEqual(Bitmaske.fuerAnzeige(VIELE, 0).zugeklappt, true);
        assert.strictEqual(VIELE.choices.length >= Bitmaske.ZUGEKLAPPT_AB, true);

        // Die Karte: Server ohne gespeicherten Wert zeigt die Vorgabe (5).
        const karte = (werte, ansicht) => Serverseite.baueUebersicht(
            { id: 1, name: 'x', status: 'offline', ansicht, paket_werte: JSON.stringify(werte) }, PAKET, {}).einstellungen.sichtbar;
        const ohne = karte({}, 'einfach').find(e => e.schluessel === 'bot_flags');
        assert.deepStrictEqual([ohne.hatWert, an(ohne.maske)], [false, [1, 4]]);
        const mit = karte({ bot_flags: '2' }, 'einfach').find(e => e.schluessel === 'bot_flags');
        assert.deepStrictEqual([mit.hatWert, an(mit.maske)], [true, [2]]);
        // Anlegen: vorbelegt mit der Vorgabe.
        const feld = Serverseite.baueWerteSchritt(PAKET, null, false).felder.find(f => f.schluessel === 'bot_flags');
        assert.deepStrictEqual([feld.typ, an(feld.maske)], ['flags', [1, 4]]);
    });

    await pruefe('Vorlage: Kästchen je Bit, die Summe im versteckten Feld — zugeklappt ab neun', async () => {
        const offen = await zeichne({ maske: Bitmaske.fuerAnzeige(BOTS, '5'), maskeFeld: 'bot_flags', maskeZahl: true });
        assert.match(offen, /<input type="hidden" data-fb-summe autocomplete="off" value="5"\s+data-fb-feld="bot_flags" data-fb-alt="5">/);
        assert.strictEqual((offen.match(/type="checkbox"/g) || []).length, 3);
        assert.match(offen, /data-fb-bit="1" checked>/);
        assert.match(offen, /data-fb-bit="2" >/);
        assert.match(offen, /data-fb-bit="4" checked>/);
        assert.match(offen, /Summe: <span class="fb-mono" data-fb-summe-text>5<\/span>/);
        assert.ok(!offen.includes('<details'), 'drei Bits stehen zugeklappt da');

        // Anlegen: ein Formularname, keine Zahl, kein data-fb-feld.
        const anlegen = await zeichne({ maske: Bitmaske.fuerAnzeige(BOTS, 5), maskeName: 'setting_bot_flags' });
        assert.match(anlegen, /value="5"\s+name="setting_bot_flags"\s*>/);
        const markup = anlegen.split('<script>')[0];
        assert.ok(!markup.includes('data-fb-feld') && !markup.includes('data-fb-summe-text'));

        const zu = await zeichne({ maske: Bitmaske.fuerAnzeige(VIELE, '2053'), maskeFeld: 'abstimmungen' });
        assert.match(zu, /<summary class="fb-bits-kopf"><span data-fb-aktiv>3<\/span> von 12 aktiv<\/summary>/);
        assert.strictEqual((zu.match(/<details>/g) || []).length, (zu.match(/<\/details>/g) || []).length);

        // Fremdes Bit: gesagt, und `alt` ist der GESPEICHERTE Wert — sonst gälte
        // An- und wieder Abwählen als „nichts geändert" und die 64 bliebe.
        const fremd = await zeichne({ maske: Bitmaske.fuerAnzeige(BOTS, '69'), maskeFeld: 'bot_flags' });
        assert.match(fremd, /value="5"\s+data-fb-feld="bot_flags" data-fb-alt="69">/);
        assert.match(fremd, /Gespeichert ist zusätzlich <span class="fb-mono">64<\/span>/);
        const kaputt = await zeichne({ maske: Bitmaske.fuerAnzeige(BOTS, 'viel'), maskeFeld: 'bot_flags' });
        assert.match(kaputt, /data-fb-alt="">/);
        assert.match(kaputt, /Der gespeicherte Wert ist keine Zahl/);
    });

    await pruefe('Serverseite und Anlegen zeichnen die Vorlage — vor der Aufklappliste', async () => {
        for (const ansicht of ['einfach', 'fachlich']) {
            const u = Serverseite.baueUebersicht({ id: 1, name: 'x', status: 'offline', ansicht,
                paket_werte: JSON.stringify({ abstimmungen: '2053' }) }, PAKET, {});
            const html = await ejs.renderFile(path.join(ANSICHTEN, 'partials/server-detail-uebersicht.ejs'), { uebersicht: u, server: { id: 1 }, guildId: '1' });
            assert.strictEqual((html.match(/<div data-fb-maske>/g) || []).length, 2, ansicht);
            assert.match(html, /data-fb-feld="abstimmungen" data-fb-alt="2053"/);
            assert.match(html, /Noch nichts gespeichert — es gilt die Vorgabe des Pakets\./);
            // Die Zahl nur in der fachlichen Höhe.
            assert.strictEqual(html.includes('<span class="fb-mono" data-fb-summe-text>'), ansicht === 'fachlich', ansicht);
            // Kein Zahlenfeld daneben, das dieselbe Einstellung ein zweites Mal anböte.
            assert.ok(!/<input class="fb-feld"[^>]*data-fb-feld="bot_flags"/.test(html));
        }
        const anlegen = ohneKommentareEjs(fs.readFileSync(path.join(ANSICHTEN, 'server-create-step3.ejs'), 'utf8'));
        const maske = anlegen.indexOf("f.typ === 'flags' && f.maske");
        const liste = anlegen.indexOf('if (f.auswahl)');
        assert.ok(maske > -1 && liste > -1 && maske < liste,
            'Anlegen prüft die Aufklappliste zuerst — eine Bitmaske trägt auch `auswahl` und würde zur Einfachwahl');
        assert.match(anlegen, /include\('partials\/bitmaske',\s*\{\s*maske: f\.maske, maskeName: 'setting_' \+ f\.schluessel/);
    });

    await pruefe('Browser: Ankreuzen bildet die Summe und meldet sich an der Karte', async () => {
        const html = await zeichne({ maske: Bitmaske.fuerAnzeige(VIELE, '2053'), maskeFeld: 'abstimmungen', maskeZahl: true });
        const skript = /<script>([\s\S]*?)<\/script>/.exec(html)[1];

        // Eine Attrappe mit genau dem, was das Skript benutzt. Alles andere
        // gibt es nicht — ein neuer Aufruf wirft, statt still nichts zu tun.
        const gemeldet = [];
        const feld = { value: '2053', dispatchEvent(e) { gemeldet.push([e.type, e.bubbles, this.value]); } };
        const zahl = { textContent: '2053' };
        const zaehler = { textContent: '3' };
        const kasten = {
            querySelectorAll(s) { assert.strictEqual(s, '[data-fb-bit]'); return bitsImKasten; },
            querySelector(s) {
                const ziel = { '[data-fb-summe]': feld, '[data-fb-summe-text]': zahl, '[data-fb-aktiv]': zaehler }[s];
                if (ziel === undefined) throw new Error('unbekannte Abfrage ' + s);
                return ziel;
            },
        };
        const neuesBit = (wert, an) => ({
            checked: an,
            hasAttribute: (a) => a === 'data-fb-bit',
            getAttribute(a) { assert.strictEqual(a, 'data-fb-bit'); return String(wert); },
            closest(s) { assert.strictEqual(s, '[data-fb-maske]'); return kasten; },
        });
        const bitsImKasten = VIELE.choices.map(c => neuesBit(c.value, [1, 4, 2048].includes(c.value)));
        const hoerer = [];
        const fenster = {};
        const umgebung = {
            window: fenster,
            document: { addEventListener(art, fn) { hoerer.push([art, fn]); } },
            Event: function (type, o) { this.type = type; this.bubbles = !!(o && o.bubbles); },
            Number, String,
        };
        vm.runInNewContext(skript, umgebung);
        // Zwei Masken auf einer Seite: Das Skript steht zweimal da, hört aber einmal.
        vm.runInNewContext(skript, umgebung);
        assert.deepStrictEqual(hoerer.map(h => h[0]), ['change']);

        const klick = (b) => hoerer[0][1]({ target: b });
        bitsImKasten[1].checked = true;                       // + 2
        klick(bitsImKasten[1]);
        assert.deepStrictEqual([feld.value, zahl.textContent, zaehler.textContent], ['2055', '2055', '4']);
        bitsImKasten[11].checked = false;                     // − 2048
        klick(bitsImKasten[11]);
        assert.deepStrictEqual([feld.value, zaehler.textContent], ['7', '3']);
        assert.deepStrictEqual(gemeldet, [['input', true, '2055'], ['input', true, '7']]);
        // Ein fremdes Kästchen auf derselben Seite (Dateiauswahl) rührt nichts an.
        klick({ hasAttribute: () => false });
        assert.strictEqual(gemeldet.length, 2);

        // Und die Karte hört wirklich auf `input` an JEDEM Feld mit data-fb-feld —
        // auch an einem versteckten. Seit der Liste (2026-10-15) steht dort
        // zusätzlich `textarea[data-fb-feld]`; entscheidend ist der input-Teil.
        const karte = ohneKommentareEjs(fs.readFileSync(path.join(ANSICHTEN, 'partials/server-detail-uebersicht.ejs'), 'utf8'));
        assert.match(karte, /querySelectorAll\('input\[data-fb-feld\](?:, textarea\[data-fb-feld\])?'\)\.forEach\(function \(i\) \{\s*i\.addEventListener\('input'/);
    });

    await pruefe('Speichern und Anlegen: die Summe wird geprüft, nicht „ist einer der Werte"', () => {
        const route = ohneKommentare(fs.readFileSync(path.join(WURZEL, 'plugins/gameserver/dashboard/routes/servers.js'), 'utf8'));
        assert.match(route, /const Bitmaske = require\('\.\.\/helpers\/Bitmaske'\)/);
        // Die Reihenfolge trägt: Stünde die Auswahlprüfung zuerst, wiese sie 5 ab.
        assert.match(route, /if \(Bitmaske\.istBitmaske\(eintrag\)\) \{[\s\S]{0,260}\} else if \(Array\.isArray\(eintrag\.choices\)/);
        assert.match(route, /paketWerteAnlegen\(paket, eingaben, server_name\);\s*const maskenFehler = Bitmaske\.fehlerInWerten\(paket, paketWerte\);\s*if \(maskenFehler\) return res\.status\(400\)/);
        const ipc = ohneKommentare(fs.readFileSync(path.join(WURZEL, 'apps/dashboard/helpers/IPCServer.js'), 'utf8'));
        assert.match(ipc, /helpers\/Bitmaske'\)\s*\.fehlerInWerten\(paket, paketWerte\);\s*if \(maskenFehler\) return message\.reply\(\{ success: false/);

        // Anlegen: die Summe aus dem Formular, 0 ist ein Wert, leer heißt „nicht gefragt".
        assert.strictEqual(paketWerteAnlegen(PAKET, { bot_flags: '6' }, 'x').bot_flags, '6');
        assert.strictEqual(paketWerteAnlegen(PAKET, { bot_flags: '0' }, 'x').bot_flags, '0');
        assert.strictEqual(paketWerteAnlegen(PAKET, { bot_flags: '' }, 'x').bot_flags, '5');
        assert.strictEqual(paketWerteAnlegen(PAKET, {}, 'x').bot_flags, '5');
        assert.strictEqual(Bitmaske.fehlerInWerten(PAKET, paketWerteAnlegen(PAKET, { bot_flags: '6' }, 'x')), null);
        assert.match(Bitmaske.fehlerInWerten(PAKET, paketWerteAnlegen(PAKET, { bot_flags: '9' }, 'x')), /„Bot-Verhalten": 9 enthält 8/);
        assert.match(Bitmaske.fehlerInWerten(PAKET, paketWerteAnlegen(PAKET, { abstimmungen: 'alle' }, 'x')), /„Abstimmungen": .*keine Summe/);
    });

    console.log(process.exitCode ? '\n❌ Bitmaske: mindestens eine Prüfung ist rot' : `\n✅ ${bestanden} Prüfung(en) bestanden.`);
})();
