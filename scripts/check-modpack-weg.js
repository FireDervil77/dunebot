#!/usr/bin/env node
'use strict';

/**
 * Wächter: Modpacks im Mods-Tab — ein Weg, und er filtert richtig.
 *
 * ── Woher er kommt ───────────────────────────────────────────────────────────
 *
 * Betreiber am 2026-09-23: *„ist es mir nicht möglich, auf der mods seite auch
 * modpacks zu installieren / zu suchen? … passend zum lader wie das mod pack
 * selbst."*
 *
 * Bis dahin gab es Modpacks nur beim Anlegen. Sie jetzt auch im Mods-Tab
 * anzubieten hängt an einer Bedingung, und die ist der Kern dieses Wächters:
 *
 *   **Ohne Neuinstallation geht es nur, wenn das Paket zum Lader des Servers
 *   passt.** Ein Modpack bestimmt Lader UND Spielfassung; eines mit dem
 *   falschen Lader wäre keine Ergänzung, sondern ein Neubau.
 *
 * ── Warum die Modrinth-Kategorie dafür NICHT taugt (gemessen 2026-09-23) ─────
 *
 * Es lag nahe, nach `categories:fabric` zu filtern. An den je 20 größten
 * Modpacks je Kategorie nachgemessen, gegen den Lader ihrer neuesten Fassung:
 *
 *     categories:fabric     20 von 20 richtig
 *     categories:forge      17 von 20 richtig
 *     categories:neoforge   10 von 20 richtig
 *
 * Die Hälfte daneben — und die Ursache ist NICHT, dass Modrinth lügt. Ein
 * Projekt trägt mehrere Kategorien, und Lader und Themen stehen im selben Feld:
 * `battlearmorytacz` führt `combat, forge, multiplayer, neoforge, optimization`.
 * `categories:neoforge` fragt also „hat neoforge irgendwo stehen", nicht „ist
 * neoforge".
 *
 * Wahr ist, was an der FASSUNG steht (`loaders`). Genau das prüft dieser
 * Wächter — an einer Attrappe, die den gemessenen Fall nachstellt.
 *
 * Aufruf:  node scripts/check-modpack-weg.js
 * Rückgabe: 0 = der Weg trägt.
 */

const fs = require('fs');
const path = require('path');

const WURZEL = path.join(__dirname, '..');
let geprueft = 0;
let fehler = 0;

function pruefe(bedingung, was, warum = '') {
    geprueft++;
    if (bedingung) {
        console.log(`  ✅ ${was}`);
    } else {
        fehler++;
        console.log(`  ❌ ${was}`);
        if (warum) console.log(`       ${warum}`);
    }
}

function roh(p) {
    try { return fs.readFileSync(p, 'utf8'); } catch { return null; }
}

// Kommentare heraus, bevor gesucht wird — mit der gemeinsamen Funktion und
// keiner eigenen Kopie (die gab es einmal in vier Fassungen, die sich
// verschieden verhielten).
//
// Gebraucht wird sie hier besonders: Die Dateien BESCHREIBEN den Filter
// ausführlich, mit denselben Wörtern, nach denen gesucht wird. Ein grep über
// den rohen Text fände jede Prüfung in der Prosa wieder und meldete grün, auch
// wenn der Code fehlte.
const { ohneKommentare } = require('./lib/quelltext');

// ════════════════════════════════════════════════════════════════════════════
console.log('\nDie Suche filtert nach dem Lader — an der Fassung, nicht an der Kategorie');
// ════════════════════════════════════════════════════════════════════════════
//
// Die Attrappe stellt den gemessenen Fall nach: Ein Projekt, das unter
// `categories:neoforge` steht und `fabric` verlangt. Genau daran ist die
// naheliegende Lösung gescheitert.

const TREFFER = [
    // Der Fall aus der Messung: Kategorie sagt neoforge, Fassung sagt fabric.
    { slug: 'max-fps-optimized', title: 'MAX FPS', project_id: 'p1', latest_version: 'v1',
      description: '', icon_url: null, downloads: 100, date_modified: '2026-09-01T00:00:00Z',
      categories: ['neoforge', 'optimization'] },
    // Ein echtes NeoForge-Paket.
    { slug: 'echtes-neoforge', title: 'Echt NeoForge', project_id: 'p2', latest_version: 'v2',
      description: '', icon_url: null, downloads: 90, date_modified: '2026-09-01T00:00:00Z',
      categories: ['neoforge'] },
    // Dessen NEUESTE Fassung zur falschen Spielausgabe gehört — eine ältere
    // passt aber. Das ist die zweite Stufe des Filters.
    { slug: 'schon-weiter', title: 'Schon weiter', project_id: 'p3', latest_version: 'v3',
      description: '', icon_url: null, downloads: 80, date_modified: '2026-09-01T00:00:00Z',
      categories: ['neoforge'] },
];

const FASSUNGEN = {
    v1: { project_id: 'p1', version_number: '1.0', loaders: ['fabric'],   game_versions: ['26.2'] },
    v2: { project_id: 'p2', version_number: '2.0', loaders: ['neoforge'], game_versions: ['26.2'] },
    v3: { project_id: 'p3', version_number: '3.0', loaders: ['neoforge'], game_versions: ['26.3'] },
};

const abrufe = [];
global.fetch = async (adresse) => {
    abrufe.push(String(adresse));
    const u = new URL(String(adresse));
    const antwort = (koerper) => ({ ok: true, status: 200, json: async () => koerper });

    if (u.pathname === '/v2/search') return antwort({ hits: TREFFER, total_hits: TREFFER.length });

    // Der Sammelabruf — eine Anfrage für die ganze Seite.
    if (u.pathname === '/v2/versions') {
        const ids = JSON.parse(u.searchParams.get('ids') || '[]');
        return antwort(ids.map(i => FASSUNGEN[i]).filter(Boolean));
    }

    // Die zweite Stufe: einzeln, serverseitig gefiltert.
    const einzeln = u.pathname.match(/^\/v2\/project\/([^/]+)\/version$/);
    if (einzeln) {
        const lader = JSON.parse(u.searchParams.get('loaders') || '[]');
        const spiele = JSON.parse(u.searchParams.get('game_versions') || '[]');
        if (einzeln[1] === 'schon-weiter') {
            const alt = { project_id: 'p3', version_number: '2.9',
                          loaders: ['neoforge'], game_versions: ['26.2'] };
            const passt = lader.includes('neoforge')
                && (!spiele.length || spiele.includes('26.2'));
            return antwort(passt ? [alt] : []);
        }
        return antwort([]);
    }

    // Eine Attrappe, die Unbekanntes still beantwortet, wird blind, sobald sich
    // die Abfrage ändert.
    throw new Error('Unerwarteter Abruf: ' + adresse);
};

const Modrinth = require(path.join(WURZEL, 'plugins/gameserver/dashboard/helpers/Modrinth.js'));

(async () => {
    // ── Mit Lader: der Fall, um den es geht ────────────────────────────────
    abrufe.length = 0;
    const gefiltert = await Modrinth.sucheModpacks('', { lader: 'neoforge', spielfassung: '26.2' });
    const slugs = gefiltert.treffer.map(t => t.kennung);

    pruefe(!slugs.includes('max-fps-optimized'),
        'ein Paket, das unter `categories:neoforge` steht und fabric verlangt, faellt heraus',
        'Gemessen am 2026-09-23: Bei neoforge sind 10 von 20 Treffern so. Wer der Kategorie glaubt, '
      + 'bietet die Haelfte falsch an.');
    pruefe(slugs.includes('echtes-neoforge'),
        'ein echtes NeoForge-Paket bleibt drin');
    pruefe(slugs.includes('schon-weiter'),
        'und eines, dessen NEUESTE Fassung schon weiter ist, wird einzeln nachgefragt',
        'Sonst verliert man jedes Paket, das bereits auf die naechste Spielausgabe gezogen ist — '
      + 'obwohl es fuer die eigene eine passende Fassung hat.');

    const nachgefragt = gefiltert.treffer.find(t => t.kennung === 'schon-weiter');
    pruefe(nachgefragt && nachgefragt.fassung === '2.9' && nachgefragt.spielfassung === '26.2',
        'und die Karte nennt die Fassung, die WIRKLICH passt',
        nachgefragt ? `steht auf ${nachgefragt.fassung} / ${nachgefragt.spielfassung}` : 'fehlt ganz');

    pruefe(gefiltert.treffer.every(t => t.lader === 'neoforge'),
        'kein einziger Treffer traegt einen anderen Lader',
        'Das ist die Zusicherung, auf der „ohne Neuinstallation" beruht.');

    pruefe(gefiltert.gefiltert === true,
        'und die Antwort SAGT, dass gefiltert wurde',
        'Die Trefferzahl ist die ungefilterte — ohne diesen Hinweis liest die Seite sie als genau.');

    // Der Sammelabruf ist der Grund, warum das bezahlbar ist: EINE Abfrage für
    // die Seite statt einer je Treffer.
    const sammel = abrufe.filter(a => a.includes('/v2/versions?'));
    pruefe(sammel.length >= 1,
        'die Lader kommen als Sammelabruf, nicht einzeln',
        'Gemessen: 0,33 s fuer 20 Fassungen in einem Abruf. Einzeln waeren es 20 Abrufe je Suchseite.');

    const einzelabrufe = abrufe.filter(a => /\/v2\/project\/[^/]+\/version/.test(a));
    pruefe(einzelabrufe.length <= 2,
        'und einzeln wird nur nachgefragt, wo die neueste Fassung nicht passt',
        `${einzelabrufe.length} Einzelabrufe bei 3 Treffern — erwartet hoechstens 2.`);

    // ── Ohne Lader: der Anlege-Fall, und er darf NICHT filtern ─────────────
    //
    // Beim Anlegen bestimmt das Modpack den Lader. Würde hier gefiltert, gäbe
    // es beim Anlegen kein einziges Paket zur Wahl.
    const roh2 = await Modrinth.sucheModpacks('', {});
    pruefe(roh2.treffer.length === TREFFER.length,
        'ohne Lader bleibt alles stehen — das ist der Anlege-Fall',
        'Dort BESTIMMT das Modpack den Lader. Ein Filter waere dort falsch herum.');
    pruefe(roh2.gefiltert === false,
        'und die Antwort sagt auch das');

    // ════════════════════════════════════════════════════════════════════════
    console.log('\nDie Zusicherung haengt nicht an der Suche');
    // ════════════════════════════════════════════════════════════════════════
    //
    // Eine Kennung kommt nicht nur aus einer Trefferliste: Adresszeile, ein
    // späterer Discord-Befehl, ein Wiederholversuch auf einer alten Zeile.
    // Dieselbe Überlegung wie bei den zwei Toren gegen Modpacks in der
    // Mod-Suche (2026-09-22).
    const holen = ohneKommentare(roh(path.join(WURZEL,
        'plugins/gameserver/dashboard/helpers/InhalteHolen.js')));

    pruefe(/paket\.lader !== laderDesServers/.test(holen),
        'die Installation prueft den Lader selbst',
        'Sonst waere die Suche die einzige Sperre — und sie ist Bequemlichkeit, keine Zusicherung.');
    pruefe(/async function installiereModpack/.test(holen)
        && /gameserver\.content\.modpack/.test(holen),
        'und ruft den EINEN Weg im Daemon',
        'Zwei Fassungen desselben Ablaufs waeren zwei Orte, an denen der naechste Fund nachgezogen '
      + 'werden muesste — einer wuerde vergessen.');

    // ── Das Alte muss weg, bevor das Neue eintraegt ────────────────────────
    //
    // Gemessen wird INNERHALB der Funktion, nicht in der ganzen Datei: Der erste
    // Anlauf dieses Waechters suchte `status: 'geplant'` global und fand die
    // Stelle in `legeAb`, die weiter oben steht. Er meldete rot, obwohl die
    // Reihenfolge stimmte — ein Waechter, der am falschen Ort misst, ist
    // schlimmer als keiner.
    const nurModpack = holen.slice(holen.indexOf('async function installiereModpack'));
    const iWeg  = nurModpack.indexOf('entferneDateien({ server, zeile: altes');
    const iNeu  = nurModpack.indexOf("status: 'geplant'");
    pruefe(iWeg > -1 && iNeu > -1 && iWeg < iNeu,
        'ein altes Modpack wird entfernt, BEVOR das neue eintraegt',
        'Sonst ueberschreibt ON DUPLICATE KEY UPDATE die Dateiliste, und die Dateien der alten '
      + 'Fassung liegen in keiner Liste mehr — bei einem Modpack sind das hunderte.');

    // ════════════════════════════════════════════════════════════════════════
    console.log('\nDie Einstellung wird dort gefuehrt, wo sie wirkt');
    // ════════════════════════════════════════════════════════════════════════
    const paket = JSON.parse(roh(path.join(WURZEL, 'packages/fbpkg/beispiele/minecraft.json')));
    const mp = (paket.settings || []).find(e => e.key === 'modpack');

    pruefe(mp && mp.managed_by === 'content',
        '`modpack` ist als `managed_by: "content"` gekennzeichnet',
        'Ohne die Kennzeichnung stuende im Einstellungen-Tab ein nacktes Textfeld, das niemand '
      + 'mehr ausfuehrt — „ein Feld, das sich bedienen laesst und nichts bewirkt".');
    pruefe(mp && !mp.apply,
        'und hat kein `apply` mehr — das Skript liest sie nicht',
        'Ein `apply` auf eine Variable, die niemand auswertet, ist ein toter Haken.');

    const seite = ohneKommentare(roh(path.join(WURZEL,
        'plugins/gameserver/dashboard/helpers/Serverseite.js')));
    pruefe(/e\.managed_by === 'content'/.test(seite),
        'der Einstellungen-Tab blendet solche Felder aus');

    // Aber NICHT beim Anlegen: Dort gibt es den Mods-Tab noch nicht.
    const anlegen = seite.slice(seite.indexOf('function baueWerteSchritt'));
    pruefe(!/managed_by/.test(anlegen),
        'das Anlegen fragt sie trotzdem',
        'Dort bestimmt das Modpack den Lader, und einen Reiter zum Nachholen gibt es noch nicht.');

    // ════════════════════════════════════════════════════════════════════════
    console.log('\nDer Mods-Tab hat die Bedienung wirklich');
    // ════════════════════════════════════════════════════════════════════════
    //
    // „Gibt es die Funktion" genügt hier nicht: Ein Knopf ohne Zuhörer und ein
    // Zuhörer ohne Knopf sehen im Quelltext gleich aus.
    const tab = roh(path.join(WURZEL,
        'plugins/gameserver/dashboard/views/guild/partials/server-detail-inhalte.ejs'));
    const routen = ohneKommentare(roh(path.join(WURZEL,
        'plugins/gameserver/dashboard/routes/inhalte.js')));

    for (const name of ['modpackSuche', 'modpackSuchen', 'modpackInstallieren']) {
        pruefe(new RegExp(`window\\.${name} = function`).test(tab)
            && new RegExp(`onclick="${name}\\(`).test(tab),
            `${name}: es gibt die Funktion UND einen Knopf, der sie ruft`,
            'Eine ungenutzte Funktion versagt beim ersten Einsatz lautlos.');
    }

    pruefe(/data-modpack=/.test(tab) && /\[data-modpack\]/.test(tab),
        'die Rueckfrage vor dem Ersetzen findet das alte Paket wirklich',
        'Sie sucht `[data-modpack]` — steht das Attribut nirgends, kommt die Rueckfrage nie, und '
      + 'ein Modpack wird ohne Nachfrage ersetzt.');

    pruefe(/inhalte\/modpacks\/suche/.test(routen) && /modpacks\/suche/.test(tab),
        'die Suchadresse des Tabs gibt es als Route');
    pruefe(/'\/:serverId\/inhalte\/modpack'/.test(routen) && /\$\{BASIS\}\/modpack`/.test(tab),
        'und die Installationsadresse ebenso');

    console.log(`\n${fehler === 0 ? '✅' : '❌'} ${geprueft - fehler} von ${geprueft} Prüfungen bestanden`);
    if (fehler === 0) {
        console.log('   Ein Modpack kommt nur auf einen Server, dessen Lader dazu passt.\n');
    }
    process.exit(fehler === 0 ? 0 : 1);
})().catch(e => {
    console.error('\n❌ Der Wächter selbst ist gescheitert:', e.message);
    console.error('   Das ist keine bestandene Prüfung, sondern eine Lücke.');
    process.exit(1);
});
