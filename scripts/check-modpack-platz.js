#!/usr/bin/env node
/**
 * Ein Modpack wird vor dem Stopp gegen den gebuchten Platz geprüft
 * (Kassensturz K190, Baustelle 151, 2026-11-07).
 *
 * Bis dahin stoppte die Route den Server zuerst, und der Daemon prüfte nur das
 * Archiv — die Mods (bei Pixelmon ~600 MB) kamen ungeprüft dazu, und danach
 * startete der Server nicht mehr, weil er über seiner Grenze lag. Betreiber:
 * „Erst prüfen, dann stoppen". Das Gegenstück im Daemon (Befehl
 * `gameserver.content.modpack.pruefen`) hat seine eigenen Go-Tests.
 *
 *   Helfer   falscher Lader: nichts geht zum Daemon; der Auftrag trägt Adresse,
 *            Prüfsummen und die Dateien des alten Pakets (`weicht`); passt es
 *            nicht, kommt der Satz des Daemons mit „nichts geändert"; ein
 *            Daemon ohne den Befehl wird genannt, nicht übergangen
 *   Route    passt es nicht, wird NICHT gestoppt und nichts installiert, und
 *            das Ende sagt, dass der Server noch läuft; passt es, erst prüfen,
 *            dann stoppen, dann installieren — mit derselben Modrinth-Antwort
 *   Seite    kennt die Phase „Platz wird geprüft"
 *   Fahrplan der neue Name steht in beiden Kopien
 *
 *   node scripts/check-modpack-platz.js
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const WURZEL = path.join(__dirname, '..');
require('dotenv').config({ path: path.join(WURZEL, 'apps/dashboard/.env'), quiet: true });
const { ServiceManager } = require('dunebot-core');

const still = () => {};
ServiceManager.register('Logger', { debug: still, info: still, warn: still, error: still, success: still });
ServiceManager.register('sseManager', { broadcast: still });

const unbekannt = [];
let SERVER = null;
ServiceManager.register('dbService', { query: async (sql) => {
    const s = String(sql).replace(/\s+/g, ' ').trim();
    if (/FROM gameservers WHERE id = \? AND guild_id = \?/.test(s)) return SERVER ? [{ ...SERVER }] : [];
    if (/pv\.fbpkg AS paket_json/.test(s)) {
        return [{ paket_json: JSON.stringify({ settings: [{ key: 'modpack', managed_by: 'content' }], content: { source: 'modrinth' } }) }];
    }
    if (s.startsWith('SELECT daemon_id FROM rootserver')) return [{ daemon_id: 'd1' }];
    unbekannt.push(s.slice(0, 90));
    return [];
} });

let gesendet = [];
let antwortVon = () => ({ success: true, data: { passt: true, gemessen: true } });
ServiceManager.register('ipmServer', {
    isDaemonOnline: () => true,
    sendCommand: async (daemon, aktion, nutzlast) => { gesendet.push({ aktion, nutzlast }); return antwortVon(aktion); },
});

const H = (d) => path.join(WURZEL, 'plugins/gameserver/dashboard/helpers', d);
const InhalteHolen = require(H('InhalteHolen'));
const Inhalte = require(H('Inhalte'));
const Modrinth = require(H('Modrinth'));
const Modpackstand = require(H('Modpackstand'));
const Spielfassung = require(H('Spielfassung'));

const ALT = { status: 'installiert', kennung: 'alt', dateien: JSON.stringify(['game/mods/alt.jar', 'game/config/alt.toml']) };
Inhalte.fuerServer = async () => ({ modpack: ALT, mods: [], lader: null });
let modrinthFragen = 0;
// Seit K226 kommt die Liste aus dem Pack-Befund (eine Stelle), nicht mehr aus
// `Modrinth.clientDateien`.
const PackBefund = require(H('PackBefund'));
PackBefund.befund = async () => { modrinthFragen++; return { urteil: 'laeuft_ohne_client', stufe: 2,
    auslassen: { sha1: ['aa11'], namen: ['Optik'] }, fehlt: [], einzelheiten: { mit_herkunft: 3, ohne_herkunft: 0 } }; };
const PAKET = { kennung: 'pixel', name: 'Pixelmon', fassung: '9.1', lader: 'forge', url: 'https://cdn.modrinth.com/data/p/p.mrpack', sha1: 'ff00' };
Modrinth.modpackFassung = async () => ({ ...PAKET });
Spielfassung.merkzettel = async () => 'forge';

let fehler = 0;
async function pruefe(was, tun) {
    try { await tun(); console.log(`  ✓ ${was}`); }
    catch (e) { fehler++; console.log(`  ✗ ${was}\n      ${String(e.message).split('\n').slice(0, 8).join('\n      ')}`); }
}

const SERVERZEILE = { id: 7, guild_id: 'g', rootserver_id: 3, install_path: '', status: 'online', paket_werte: '{}' };

(async () => {
    console.log('\nModpack: erst prüfen, dann stoppen (K190)');

    await pruefe('Helfer: falscher Lader geht gar nicht erst zum Daemon', async () => {
        gesendet = [];
        const p = await InhalteHolen.pruefeModpack({ server: SERVERZEILE, paket: { ...PAKET, lader: 'fabric' }, laderDesServers: 'forge' });
        assert.strictEqual(p.passt, false);
        assert.match(p.fehler, /verlangt fabric/);
        assert.strictEqual(gesendet.length, 0);
    });

    await pruefe('Helfer: der Auftrag trägt Adresse, Prüfsummen und die Dateien des alten Pakets', async () => {
        gesendet = []; modrinthFragen = 0;
        const phasen = [];
        antwortVon = () => ({ success: true, data: { passt: true, gemessen: true, bedarf_bytes: 5, grenze_bytes: 10, belegt_bytes: 1, wird_frei_bytes: 2 } });
        const p = await InhalteHolen.pruefeModpack({ server: SERVERZEILE, paket: PAKET, laderDesServers: 'forge', beiFortschritt: (f) => phasen.push(f.phase) });
        assert.strictEqual(p.passt, true);
        assert.strictEqual(gesendet.length, 1);
        assert.strictEqual(gesendet[0].aktion, 'gameserver.content.modpack.pruefen');
        const n = gesendet[0].nutzlast;
        assert.deepStrictEqual({ adresse: n.adresse, sha1: n.sha1, auslassen: n.auslassen, weicht: n.weicht },
            { adresse: PAKET.url, sha1: 'ff00', auslassen: ['aa11'], weicht: ['game/mods/alt.jar', 'game/config/alt.toml'] });
        assert.deepStrictEqual(phasen, ['abgleich', 'pruefen']);
        assert.strictEqual(modrinthFragen, 1);
        assert.deepStrictEqual(p.zahlen, { bedarf: 5, grenze: 10, belegt: 1, wirdFrei: 2 });
    });

    await pruefe('Helfer: passt es nicht, kommt der Satz des Daemons mit „nichts geändert"', async () => {
        antwortVon = () => ({ success: true, data: { passt: false, gemessen: true,
            grund: 'das Modpack braucht 610 MiB, im gebuchten Platz des Servers sind noch 400 MiB frei (1.0 GiB gebucht) — mehr Platz buchen oder aufräumen' } });
        const p = await InhalteHolen.pruefeModpack({ server: SERVERZEILE, paket: PAKET, laderDesServers: 'forge' });
        assert.strictEqual(p.passt, false);
        assert.match(p.fehler, /^Das Modpack braucht 610 MiB, .* noch 400 MiB frei .*\. Am Server wurde nichts geändert\.$/);
    });

    await pruefe('Helfer: ein Daemon ohne den Befehl wird genannt, nicht übergangen', async () => {
        antwortVon = () => ({ success: false, error: 'unbekannter Befehl gameserver.content.modpack.pruefen' });
        const p = await InhalteHolen.pruefeModpack({ server: SERVERZEILE, paket: PAKET, laderDesServers: 'forge' });
        assert.strictEqual(p.passt, false);
        assert.match(p.fehler, /erst den Daemon aktualisieren/);
    });

    // ── Ein unvollständiges Paket wird nicht eingespielt (K226) ──────────────
    const befundEcht = PackBefund.befund;
    const UNVOLLSTAENDIG = { urteil: 'unvollstaendig', stufe: 2, auslassen: { sha1: [], namen: [] },
        fehlt: [{ kennung: 'flib', name: 'FLIB', gebraucht_von: ['Simple Storage Network'], grund: 'extern', host: 'www.curseforge.com' }],
        einzelheiten: { mit_herkunft: 3, ohne_herkunft: 0 } };

    await pruefe('Helfer: ein unvollständiges Paket geht gar nicht erst zum Daemon, und der Satz nennt, was fehlt', async () => {
        gesendet = [];
        PackBefund.befund = async () => UNVOLLSTAENDIG;
        try {
            const p = await InhalteHolen.pruefeModpack({ server: SERVERZEILE, paket: PAKET, laderDesServers: 'forge' });
            assert.strictEqual(p.passt, false);
            assert.match(p.fehler, /Pixelmon/);
            assert.match(p.fehler, /FLIB \(gebraucht von Simple Storage Network\)/);
            assert.match(p.fehler, /Am Server wurde nichts geändert/);
            assert.strictEqual(gesendet.length, 0);
        } finally { PackBefund.befund = befundEcht; }
    });

    await pruefe('Helfer: auch die Installation selbst lehnt es ab — bevor das alte Paket weicht', async () => {
        gesendet = [];
        const eingetragen = [];
        const eintragenEcht = Inhalte.eintragen;
        Inhalte.eintragen = async (z) => { eingetragen.push(z.status); };
        PackBefund.befund = async () => UNVOLLSTAENDIG;
        try {
            const e = await InhalteHolen.installiereModpack({ server: SERVERZEILE, guildId: 'g', paket: PAKET, laderDesServers: 'forge' });
            assert.strictEqual(e.success, false);
            assert.match(e.fehler, /FLIB/);
            // Kein Auftrag an den Daemon: nichts entfernt, nichts eingespielt. Und
            // die Zeile des alten, installierten Pakets bleibt, wie sie ist.
            assert.deepStrictEqual(gesendet, []);
            assert.deepStrictEqual(eingetragen, []);
        } finally { PackBefund.befund = befundEcht; Inhalte.eintragen = eintragenEcht; }
    });

    // Die Route, echt — ersetzt sind nur Stopp, Installation und das Ende.
    const router = require(path.join(WURZEL, 'plugins/gameserver/dashboard/routes/inhalte.js'));
    const schicht = router.stack.find(l => l.route && l.route.path === '/:serverId/inhalte/modpack' && l.route.methods.post);
    const handler = schicht.route.stack[schicht.route.stack.length - 1].handle;
    const echt = { beginne: Modpackstand.beginne, nachStopp: Modpackstand.nachStopp, beende: Modpackstand.beende,
        fortschritt: Modpackstand.fortschritt, installiere: InhalteHolen.installiereModpack };
    const spiele = async () => {
        const ablauf = [];
        let ende;
        const fertig = new Promise(r => { ende = r; });
        Modpackstand.beginne = async () => true;
        Modpackstand.fortschritt = (id, f) => ablauf.push(`phase ${f.phase}`);
        Modpackstand.nachStopp = async (id, g, arbeit) => { ablauf.push('stopp'); return { ...await arbeit(), gestoppt: true }; };
        Modpackstand.beende = async (id, g, name, ergebnis) => { ablauf.push('ende'); ende(ergebnis); };
        InhalteHolen.installiereModpack = async (a) => { ablauf.push(`installiere ${a.abgleich ? 'mit-abgleich' : 'ohne'}`); return { success: true }; };
        let status = null;
        await handler({ params: { serverId: '7' }, body: { kennung: 'pixel' } },
            { locals: { guildId: 'g' }, status(c) { status = c; return this; }, json() { return this; } });
        const ergebnis = await Promise.race([fertig, new Promise(r => setTimeout(() => r('frist'), 3000))]);
        Object.assign(Modpackstand, { beginne: echt.beginne, nachStopp: echt.nachStopp, beende: echt.beende, fortschritt: echt.fortschritt });
        InhalteHolen.installiereModpack = echt.installiere;
        return { status, ablauf, ergebnis };
    };

    await pruefe('Route: passt es nicht, wird nicht gestoppt und nichts installiert, und das Ende sagt, dass er läuft', async () => {
        SERVER = SERVERZEILE; gesendet = [];
        antwortVon = () => ({ success: true, data: { passt: false, gemessen: true, grund: 'das Modpack braucht 610 MiB' } });
        const { status, ablauf, ergebnis } = await spiele();
        assert.strictEqual(status, 202);
        assert.notStrictEqual(ergebnis, 'frist', 'der Vorgang wurde nie beendet');
        assert.deepStrictEqual(ablauf, ['phase abgleich', 'phase pruefen', 'ende']);
        assert.strictEqual(ergebnis.success, false);
        assert.match(ergebnis.fehler, /^Das Modpack braucht 610 MiB\. Am Server wurde nichts geändert\.$/);
        assert.strictEqual(ergebnis.laeuft, true, 'der Server lief und läuft noch');
    });

    await pruefe('Route: passt es, erst prüfen, dann stoppen, dann installieren — mit derselben Modrinth-Antwort', async () => {
        gesendet = []; modrinthFragen = 0;
        antwortVon = () => ({ success: true, data: { passt: true, gemessen: true } });
        const { ablauf, ergebnis } = await spiele();
        assert.deepStrictEqual(ablauf, ['phase abgleich', 'phase pruefen', 'stopp', 'installiere mit-abgleich', 'ende']);
        assert.strictEqual(ergebnis.success, true);
        assert.strictEqual(ergebnis.laeuft, false);
        assert.strictEqual(modrinthFragen, 1, 'Modrinth wurde zweimal gefragt');
    });

    await pruefe('Seite und Fahrplan: Phase „Platz wird geprüft", der Name in beiden Kopien', async () => {
        const seite = fs.readFileSync(path.join(WURZEL, 'plugins/gameserver/dashboard/views/guild/partials/server-detail-inhalte.ejs'), 'utf8');
        assert.match(seite, /pruefen: 'Platz wird geprüft'/);
        const zeile = (datei) => JSON.parse(fs.readFileSync(datei, 'utf8')).zeilen.find(z => z.name === 'gameserver.content.modpack.pruefen');
        const hier = zeile(path.join(WURZEL, 'packages/firebus/fahrplan.json'));
        assert.ok(hier && hier.von === 'dashboard' && hier.art === 'befehl', 'fehlt im Fahrplan des Dashboards');
        const daemon = path.join(WURZEL, '../firebot_daemon/pkg/firebus/fahrplan.json');
        if (fs.existsSync(daemon)) assert.deepStrictEqual(zeile(daemon), hier, 'die Kopie im Daemon weicht ab');
    });

    await pruefe('Attrappe: keine Abfrage lief an ihr vorbei', async () => {
        assert.deepStrictEqual(unbekannt, []);
    });

    console.log(fehler ? `\n✗ ${fehler} Prüfung(en) rot` : '\n✅ Ein Modpack, das nicht passt, lässt den Server, wie er ist');
    process.exit(fehler ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
