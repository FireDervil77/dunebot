#!/usr/bin/env node
/**
 * Die Liste für Mitspieler (Stufe 10 S4, 2026-10-27).
 *
 * Betreiber: „wie bei den anderen Mods auch Listenansicht oder downloadbares
 * .txt erzeugen. In einem extra Modal anzeigen. Wie auch immer die benötigten
 * Mods für die Spieler müssen mit dabei sein."
 *
 * ── Was hier geprüft wird ───────────────────────────────────────────────────
 *
 * Das ECHTE Skript des Reiters (server-detail-inhalte.ejs), gezeichnet und in
 * einer nachgebauten Seite ausgeführt — mit einer Liste, wie die Route sie
 * schickt:
 *   - im Reiter nur Satz und Knopf, kein Textfeld mehr
 *   - das Modal zeigt den Lader zuerst, dann die Mods, die Spieler brauchen —
 *     nichts Ausgeschaltetes, nichts, was nur der Server braucht
 *   - der Mod-Manager kommt von der QUELLE (bis dahin stand „r2modman" fest,
 *     auch bei Modrinth)
 *   - Kopieren und .txt liefern denselben Text, mit Adressen und Fassungen
 *   - Hochladen fragt nach dem Ordner, wenn das Spiel einen je Mod will (S2)
 * Dazu: Jede Quelle nennt ihren Manager, und die Route reicht ihn weiter.
 *
 *   node scripts/check-spieler-liste.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const ejs = require('ejs');

const WURZEL = path.join(__dirname, '..');
const ANSICHT = path.join(WURZEL, 'plugins/gameserver/dashboard/views/guild/partials/server-detail-inhalte.ejs');
const HELFER = path.join(WURZEL, 'plugins/gameserver/dashboard/helpers');

let fehler = 0, bestanden = 0;
async function pruefe(was, tun) {
    try { await tun(); bestanden++; console.log(`  ✓ ${was}`); }
    catch (e) { fehler++; console.log(`  ✗ ${was}\n      ${String(e.message).split('\n').slice(0, 4).join('\n      ')}`); }
}

// Eine Liste, wie GET /inhalte sie schickt — Satisfactory-artig.
const LISTE = {
    success: true, unterstuetzt: true, laderAlsInhalt: true, lader: 'sml', pfad: 'game/FactoryGame/Mods/<Mod>',
    quellen: [{ kennung: 'ficsit', titel: 'ficsit.app', raumName: 'Spiel', raum: 'satisfactory',
        manager: { name: 'Satisfactory Mod Manager', url: 'https://github.com/satisfactorymodding/SatisfactoryModManager' } }],
    raeume: { ficsit: 'satisfactory' }, quellenImPaket: ['ficsit'],
    lader: { id: 1, art: 'loader', quelle: 'ficsit', kennung: 'SML', name: 'SML', fassung: '3.12.0', aktiv: 1, client_side: 1, status: 'installiert', url: 'https://ficsit.app/mod/SML' },
    mods: [
        { id: 2, art: 'mod', quelle: 'ficsit', kennung: 'PowerChecker', name: 'Power Checker', fassung: '2.4.10', aktiv: 1, client_side: 1, status: 'installiert', url: 'https://ficsit.app/mod/PowerChecker' },
        { id: 3, art: 'mod', quelle: 'ficsit', kennung: 'NurServer', name: 'Nur Server', fassung: '1.0.0', aktiv: 1, client_side: 0, status: 'installiert', url: 'https://ficsit.app/mod/NurServer' },
        { id: 4, art: 'mod', quelle: 'ficsit', kennung: 'Aus', name: 'Ausgeschaltet', fassung: '1.0.0', aktiv: 0, client_side: 1, status: 'installiert', url: 'https://ficsit.app/mod/Aus' },
        { id: 5, art: 'mod', quelle: 'upload', kennung: 'Eigen.zip', name: 'Eigenbau', fassung: null, aktiv: 1, client_side: 1, status: 'installiert', url: null },
    ],
    entfernt: [],
};

function seite(liste = LISTE) {
    const gezeichnet = ejs.render(fs.readFileSync(ANSICHT, 'utf8'), {
        server: { id: 222, name: 'Fires Satisfactory Bude' }, guildId: 'g1',
        userPermissions: { permissions: { 'GAMESERVER.FILES.MANAGE': true } },
    }, { filename: ANSICHT });
    const skript = /<script>([\s\S]*?)<\/script>/.exec(gezeichnet)[1];
    const knoten = {};
    const k = (id, extra = {}) => (knoten[id] = knoten[id] || { id, innerHTML: '', style: {}, dataset: {}, value: '', ...extra });
    k('inhalte-wurzel', { dataset: { server: '222', guild: 'g1', name: 'Fires Satisfactory Bude' } });
    k('inhalte-spieler-inhalt'); k('inhalte-spieler-modal'); k('inhalte-formular', { style: { display: 'none' } });
    const spur = { toasts: [], kopiert: null, geladen: null, gezeigt: 0, geklickt: [] };
    const umgebung = {
        document: {
            getElementById: (id) => knoten[id] || null,
            querySelectorAll: () => [], querySelector: () => null,
            createElement: () => ({ click() { spur.geklickt.push({ href: this.href, download: this.download }); }, remove() {} }),
            body: { appendChild() {} },
        },
        fetch: async (adresse) => ({ ok: true, status: 200, json: async () => (String(adresse).endsWith('/ladestand') ? { success: true, verfuegbar: false } : liste) }),
        showToast: (typ, text) => spur.toasts.push([typ, text]),
        bootstrap: { Modal: { getOrCreateInstance: () => ({ show: () => { spur.gezeigt++; } }) } },
        navigator: { clipboard: { writeText: async (t) => { spur.kopiert = t; } } },
        Blob: class { constructor(teile, o) { this.text = teile.join(''); this.type = o.type; } },
        URL: { createObjectURL: (b) => { spur.geladen = b; return 'blob:x'; }, revokeObjectURL() {} },
        setTimeout: () => 0, Promise, Date, Set, Math, JSON, String, Number, Array, Object, FormData: class {},
    };
    umgebung.window = umgebung;
    vm.runInNewContext(skript, umgebung);
    return { knoten, spur, w: umgebung };
}
const warte = () => new Promise(r => setImmediate(r));

(async () => {
    console.log('\nReiter und Modal');

    const s = seite();
    await warte(); await warte();

    await pruefe('im Reiter nur Satz und Knopf — kein Textfeld, kein festes r2modman', () => {
        const html = s.knoten['inhalte-wurzel'].innerHTML;
        assert.match(html, /Der Lader und 2 Mods müssen auch bei deinen Mitspielern liegen\./);
        assert.ok(html.includes('inhaltSpielerListe()'), 'der Knopf fehlt');
        assert.ok(!/<textarea/.test(html) && !/r2modman/.test(html));
    });

    await pruefe('das Modal: Lader zuerst, dann was Spieler brauchen — nichts Ausgeschaltetes, nichts nur für den Server', () => {
        s.w.inhaltSpielerListe();
        assert.strictEqual(s.spur.gezeigt, 1);
        const html = s.knoten['inhalte-spieler-inhalt'].innerHTML;
        const reihen = [...html.matchAll(/<tr>\s*<td>([^<]+)/g)].map(m => m[1].trim());
        assert.deepStrictEqual(reihen, ['SML', 'Power Checker', 'Eigenbau']);
        assert.match(html, /SML <span class="badge[^"]*">zuerst installieren/);
        assert.match(html, /href="https:\/\/github\.com\/satisfactorymodding\/SatisfactoryModManager"[^>]*>Satisfactory Mod Manager</);
        assert.match(html, /Hochgeladene Einträge haben keine Seite/);
        assert.ok(!html.includes('Nur Server') && !html.includes('Ausgeschaltet'));
    });

    await pruefe('Kopieren und .txt: derselbe Text, mit Fassungen, Adressen und Manager', async () => {
        s.w.inhaltKopieren();
        await warte();
        s.w.inhaltTxt();
        const text = s.spur.kopiert;
        assert.ok(text, 'nichts kopiert');
        assert.strictEqual(s.spur.geladen.text, text, 'Kopie und .txt unterscheiden sich');
        assert.match(s.spur.geladen.type, /^text\/plain/);
        assert.deepStrictEqual(s.spur.geklickt.map(x => x.download), ['mods-Fires-Satisfactory-Bude.txt']);
        const z = text.split('\n');
        assert.match(z[0], /^Mods für Fires Satisfactory Bude — Stand /);
        assert.deepStrictEqual(z.slice(2, 8), [
            'SML 3.12.0   ← zuerst installieren', '  https://ficsit.app/mod/SML',
            'Power Checker 2.4.10', '  https://ficsit.app/mod/PowerChecker',
            'Eigenbau', '  (hochgeladen — die Datei gibt es nur vom Server)']);
        assert.ok(text.includes('  Satisfactory Mod Manager — https://github.com/satisfactorymodding/SatisfactoryModManager'));
        assert.deepStrictEqual(s.spur.toasts.at(-1), ['success', 'Liste kopiert.']);
    });

    await pruefe('Hochladen fragt nach dem Ordner, wenn das Spiel einen je Mod will — sonst nicht', async () => {
        s.w.inhaltFormular();
        assert.match(s.knoten['inhalte-formular'].innerHTML, /id="inhalt-ordner"/);
        const v = seite({ ...LISTE, pfad: 'game/BepInEx/plugins' });
        await warte(); await warte();
        v.w.inhaltFormular();
        assert.ok(!/id="inhalt-ordner"/.test(v.knoten['inhalte-formular'].innerHTML));
        const quelle = fs.readFileSync(ANSICHT, 'utf8');
        assert.ok(/daten\.append\('ordner', ordner\.value\.trim\(\)\)/.test(quelle), 'der Ordner geht nicht mit');
    });

    console.log('\nQuellen und Route');

    await pruefe('jede Quelle nennt ihren Manager; die Route reicht ihn weiter', () => {
        const Quellen = require(path.join(HELFER, 'Quellen.js'));
        for (const [name, a] of Object.entries(Quellen.ANBIETER)) {
            assert.ok(a.MANAGER && a.MANAGER.name && /^https:\/\//.test(a.MANAGER.url), `${name} nennt keinen Manager`);
        }
        assert.ok(!/smm\.ficsit\.app/.test(Quellen.fuer('ficsit').MANAGER.url), 'smm.ficsit.app startet einen Download');
        const route = fs.readFileSync(path.join(WURZEL, 'plugins/gameserver/dashboard/routes/inhalte.js'), 'utf8');
        assert.ok(/manager: Quellen\.fuer\(q\)\.MANAGER \|\| null/.test(route));
    });

    console.log(fehler ? `\n✗ ${fehler} gescheitert, ${bestanden} bestanden` : `\n✓ ${bestanden} bestanden`);
    process.exit(fehler ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
