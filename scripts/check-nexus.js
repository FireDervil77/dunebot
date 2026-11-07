#!/usr/bin/env node
/**
 * Nexus Mods ist ein Katalog und bleibt einer — ohne Netz.
 *
 * ── Warum es diesen Waechter gibt ───────────────────────────────────────────
 *
 * Entschieden am 2026-10-31 (F36, Baustelle 191): Das Panel sucht bei Nexus,
 * laedt dort aber nichts, weil die Nutzungsregeln und die API es fuer ein Panel
 * mit fremden Guilds nicht hergeben. Die Gefahr ist nicht die Suche, sondern
 * dass Nexus eines Tages in `ANBIETER` rutscht, weil der Eintrag dort einfacher
 * aussieht — dann standen Vorschau, Holen und Vormerken offen. Deshalb prueft
 * dieser Waechter den Weg von der Route aus, nicht nur die Listen.
 *
 * Die Attrappe von `fetch` antwortet mit einem Ausschnitt der echten Antwort vom
 * 2026-10-31. Eine unerwartete Adresse oder Abfrage WIRFT.
 *
 *   node scripts/check-nexus.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { ServiceManager } = require('dunebot-core');

const still = () => {};
if (!ServiceManager.has('Logger')) {
    ServiceManager.register('Logger', { debug: still, info: still, warn: still, error: still, success: still });
}

const WURZEL = path.join(__dirname, '..');
const HELFER = path.join(WURZEL, 'plugins/gameserver/dashboard/helpers');
const Quellen = require(path.join(HELFER, 'Quellen'));
const Nexus = require(path.join(HELFER, 'Nexus'));

// Gemessen am 2026-10-31; gekuerzt sind nur Felder, die der Code nicht liest.
const ANTWORT = {
    data: { mods: { totalCount: 2, nodes: [
        { modId: 1138, name: 'Jotunn the Valheim Library', summary: 'Jötunn, the Valheim Library',
          downloads: 908520, updatedAt: '2026-09-21T17:19:48Z',
          thumbnailUrl: 'https://staticdelivery.nexusmods.com/mods/3667/images/thumbnails/1138/1138-1619817736-1994493562.png' },
        { modId: 507, name: 'JotunnLib', summary: null, downloads: 102177,
          updatedAt: '2022-03-03T05:27:47Z', thumbnailUrl: null },
    ] } },
};

let anfragen = [];
global.fetch = async (adresse, optionen) => {
    if (adresse !== 'https://api.nexusmods.com/v2/graphql') throw new Error(`Unerwartete Adresse: ${adresse}`);
    anfragen.push({ koepfe: optionen.headers, koerper: JSON.parse(optionen.body) });
    return { ok: true, status: 200, json: async () => ANTWORT };
};

let fehler = 0;
async function pruefe(name, fn) {
    try { await fn(); console.log(`  ✓ ${name}`); }
    catch (e) { fehler++; console.log(`  ✗ ${name}\n    ${e.message}`); }
}

// Der Kommentar in Quellen.js nennt Nexus — gesucht wird nur im Code.
const ohneKommentare = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

(async () => {
    const inhalt = { supported: true, sources: ['upload', 'nexus', 'thunderstore'],
                     source_ids: { nexus: 'valheim', thunderstore: 'valheim' } };

    console.log('\nNichts holt von Nexus');

    await pruefe('Nexus steht nicht bei den Anbietern und hat keinen Holweg', async () => {
        assert.strictEqual(Quellen.ANBIETER.nexus, undefined);
        assert.strictEqual(Quellen.gibtEs('nexus'), false);
        assert.throws(() => Quellen.fuer('nexus'), /Unbekannte Quelle/);
        for (const f of ['paket', 'aufloesen', 'aktualisierungen', 'fassungen', 'HERKUNFT', 'istErlaubt']) {
            assert.strictEqual(Nexus[f], undefined, `Nexus.${f} gibt es — ein Katalog holt nichts`);
        }
        assert.ok(!Quellen.HERKUNFT.some(h => /nexus/i.test(h)), 'Nexus steht in der Herkunftsliste');
    });

    await pruefe('Die Wahl fuer alles, was installiert, sieht Nexus nicht', async () => {
        assert.deepStrictEqual(Quellen.ausPaket(inhalt), ['thunderstore']);
        assert.strictEqual(Quellen.waehle(inhalt), 'thunderstore');
        assert.strictEqual(Quellen.waehle(inhalt, 'nexus'), null, 'auf Wunsch aus der Adresszeile');
        assert.strictEqual(Quellen.waehle({ sources: ['nexus'], source_ids: { nexus: 'valheim' } }), null);
    });

    await pruefe('Die Suche sieht Nexus, nach den Anbietern', async () => {
        assert.deepStrictEqual(Quellen.katalogeAus(inhalt), ['thunderstore', 'nexus']);
        assert.strictEqual(Quellen.waehleKatalog(inhalt), 'thunderstore', 'Vorauswahl ist ein Anbieter');
        assert.strictEqual(Quellen.waehleKatalog(inhalt, 'nexus'), 'nexus');
        assert.strictEqual(Quellen.waehleKatalog({ sources: ['upload'] }, 'nexus'), null,
            'ein Spiel, dessen Paket Nexus nicht nennt, bekommt die Suche auch per Adresse nicht');
        assert.strictEqual(Quellen.katalog('nexus'), Nexus);
        assert.strictEqual(Quellen.katalog('thunderstore').KENNUNG, 'thunderstore');
    });

    await pruefe('Nur die Suchroute des Servers geht ueber katalogWaehlen', async () => {
        const quelltext = ohneKommentare(fs.readFileSync(
            path.join(WURZEL, 'plugins/gameserver/dashboard/routes/inhalte.js'), 'utf8'));
        const aufrufe = quelltext.split('\n').filter(z => /katalogWaehlen\(res/.test(z) && !/^function /.test(z));
        assert.strictEqual(aufrufe.length, 1, `katalogWaehlen wird ${aufrufe.length}-mal gerufen`);
        const stelle = quelltext.indexOf(aufrufe[0]);
        const route = quelltext.lastIndexOf('router.', stelle);
        assert.ok(quelltext.slice(route, stelle).includes("'/:serverId/inhalte/suche'"),
            'katalogWaehlen steht nicht in der Suchroute des Servers');
    });

    await pruefe('Die Vormerkliste beim Anlegen laesst Nexus nicht durch', async () => {
        const liesOhneKommentare = (datei) => ohneKommentare(fs.readFileSync(
            path.join(WURZEL, 'plugins/gameserver/dashboard', datei), 'utf8'));
        assert.ok(/\.filter\(m => m\.kennung && Quellen\.gibtEs\(m\.quelle\)\)/.test(liesOhneKommentare('routes/servers.js')),
            'die Vormerkliste prueft nicht mehr gegen gibtEs');
        for (const datei of ['routes/servers.js', 'index.js']) {
            assert.ok(!/katalogeAus|waehleKatalog/.test(liesOhneKommentare(datei)), `${datei} fragt reine Kataloge`);
        }
    });

    console.log('\nDie Suche');

    await pruefe('Mit Begriff: Spiel, Name, keine Erwachsenen-Mods, Koepfe laut Nutzungsregeln', async () => {
        anfragen = [];
        const roh = await Nexus.suche('valheim', ' jotunn ', { seite: 2 });
        const { koepfe, koerper } = anfragen[0];
        assert.strictEqual(koepfe['Application-Name'], 'firebot-dashboard');
        assert.ok(koepfe['Application-Version']);
        assert.ok(!Object.keys(koepfe).some(k => /^(apikey|authorization)$/i.test(k)), 'ein Schluessel reist mit');
        assert.deepStrictEqual(koerper.variables.filter, {
            gameDomainName: [{ value: 'valheim', op: 'EQUALS' }],
            adultContent: [{ value: false, op: 'EQUALS' }],
            name: [{ value: 'jotunn', op: 'WILDCARD' }],
        });
        assert.strictEqual(koerper.variables.offset, Nexus.PRO_SEITE);
        assert.strictEqual(roh.seite, 2);
        assert.strictEqual(roh.zurueck, true);
        assert.strictEqual(roh.weiter, false);
        assert.strictEqual(roh.gesamt, 2);
    });

    await pruefe('Ohne Begriff kein Namensfilter, Treffer in der gemeinsamen Form', async () => {
        anfragen = [];
        const roh = await Nexus.suche('valheim', '');
        assert.strictEqual(anfragen[0].koerper.variables.filter.name, undefined);
        assert.strictEqual(roh.treffer[0].kennung, '1138');
        assert.strictEqual(roh.treffer[0].name, 'Jotunn the Valheim Library');
        assert.strictEqual(roh.treffer[0].downloads, 908520);
        assert.ok(roh.treffer[0].bild.startsWith('https://staticdelivery.nexusmods.com/'));
        assert.strictEqual(roh.treffer[1].beschreibung, '', 'null wuerde die Ansicht als Text zeigen');
    });

    await pruefe('Adressen, und eine Spielkennung mit fremden Zeichen wird abgewiesen', async () => {
        assert.strictEqual(Nexus.adresse('valheim', '1138'), 'https://www.nexusmods.com/valheim/mods/1138');
        assert.strictEqual(Nexus.verzeichnis('valheim'), 'https://www.nexusmods.com/valheim/mods');
        await assert.rejects(() => Nexus.suche('', 'x'), /Spielkennung/);
        assert.throws(() => Nexus.adresse('a/b', '1'), /Spielkennung/);
    });

    await pruefe('Ein GraphQL-Fehler kommt als Fehler an, nicht als leere Liste', async () => {
        const echt = global.fetch;
        global.fetch = async () => ({ ok: true, status: 200, json: async () => ({ errors: [{ message: 'kaputt' }] }) });
        try { await assert.rejects(() => Nexus.suche('valheim', 'x'), /Nexus Mods: kaputt/); }
        finally { global.fetch = echt; }
    });

    await pruefe('Der Hinweis nennt den Weg und die Falle mit 7z und RAR', async () => {
        assert.ok(/Datei hochladen/.test(Nexus.HINWEIS));
        assert.ok(/7z und RAR/.test(Nexus.HINWEIS));
    });

    console.log(fehler ? `\n✗ ${fehler} Abweichung(en)` : '\n✓ Nexus bleibt ein Katalog');
    process.exit(fehler ? 1 : 0);
})();
