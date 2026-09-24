#!/usr/bin/env node
/**
 * Hat jede Minecraft-Ausgabe eine Laufzeit, die sie traegt?
 *
 * ── Warum es diesen Waechter gibt (Baustelle 154, 2026-09-24) ───────────────
 *
 * Am 2026-09-23 lief Forge auf dem ausgelieferten Image in KEINER Fassung:
 * `fb/java` trug nur Java 25, Forge 1.12.2/1.16.5 brauchen 8, Forge 1.20.1
 * braucht 17. Seit `fb/java:2026.09` liegen mehrere Laufzeiten nebeneinander im
 * Image, und das Installationsskript des Pakets waehlt je Server eine davon
 * (`pruefe_java` → `.fb/java`, gelesen vom Starter `/usr/local/bin/java`).
 *
 * Dieser Waechter haelt drei Enden zusammen, die in zwei Repositories liegen:
 *
 *   Daemon   images/java/Dockerfile   FB_LAUFZEITEN, FB_VORGABE
 *   Daemon   images/java/java         der Starter (Java 8 + @Argumentdatei)
 *   Paket    minecraft.json           pruefe_java im Installationsskript
 *
 * Die Wahl wird nicht nachgebildet, sondern AUSGEFUEHRT: Die Funktion wird aus
 * dem Skript geschnitten und in bash mit jeder gemessenen Anforderung
 * aufgerufen.
 *
 * ── Was er NICHT sieht ──────────────────────────────────────────────────────
 *
 * Die Tabelle von Mojang ist ein Messstand vom 2026-09-24. Verlangt eine neue
 * Ausgabe Java 29, faellt das ohne Netz nicht auf — dafuer gibt es `--netz`,
 * das die neueste Ausgabe bei Mojang nachfragt. Und ob das GESCHOBENE Image
 * dem Dockerfile entspricht, prueft `images/pruefe.sh java`, nicht dieser.
 *
 *   node scripts/check-java-laufzeiten.js
 *   node scripts/check-java-laufzeiten.js --netz
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { ohneKommentareShell } = require('./lib/quelltext');

const WURZEL = path.join(__dirname, '..');
const DAEMON = '/home/firedervil/firebot_daemon';

let fehler = 0;
const pruefe = (ok, was, zusatz = '') => {
    console.log(`  ${ok ? '✅' : '❌'} ${was}${zusatz ? '\n       ' + zusatz : ''}`);
    if (!ok) fehler++;
};

// ── Gemessen am 2026-09-24: javaVersion.majorVersion aller 103 Releases ─────
const MOJANG = [
    { verlangt: 25, ausgaben: '26.1 – 26.3',      soll: 25 },
    { verlangt: 21, ausgaben: '1.20.5 – 1.21.11', soll: 21 },
    { verlangt: 17, ausgaben: '1.18 – 1.20.4',    soll: 17 },
    { verlangt: 16, ausgaben: '1.17 – 1.17.1',    soll: 17 },  // Adoptium fuehrt keine 16
    { verlangt: 8,  ausgaben: '1.0 – 1.16.5',     soll: 8 },
];

// ── Gemessen am 2026-09-23/24: wo Forge WIRKLICH laeuft ─────────────────────
// Die Obergrenze, die Mojangs Zahl nicht nennt. Wer die Wahl auf „das Neueste,
// das reicht" umstellt, faellt hier auf.
//
// 1.20.1 ist BUILD-ABHAENGIG und steht deshalb ohne `stirbt`: Build 47.4.0
// starb am 2026-09-23 auf 21 und 25 — Build 47.4.23 lief auf Server 202 dagegen
// 14 Stunden auf Java 25.0.4 (ModLauncher-Zeile im Log, 2026-09-24). Getragen
// hat 17 beide. Die Wahl nimmt 17, weil Mojang 17 nennt, nicht weil 25 sicher
// scheitert.
const FORGE = [
    { ausgabe: '1.12.2', verlangt: 8,  laeuft: [8],  stirbt: [17, 25] },
    { ausgabe: '1.16.5', verlangt: 8,  laeuft: [8],  stirbt: [17, 25] },
    { ausgabe: '1.20.1', verlangt: 17, laeuft: [17], stirbt: [] },
];

// ── Das Image ───────────────────────────────────────────────────────────────
console.log('\n▸ Was fb/java mitbringt (images/java/Dockerfile)');
// Ohne Kommentarzeilen: Beide Dateien erklaeren ausfuehrlich, was sie tun —
// ein Treffer in der Erklaerung hielte die Pruefung gruen.
const dockerfile = ohneKommentareShell(fs.readFileSync(path.join(DAEMON, 'images/java/Dockerfile'), 'utf8'));
const laufzeiten = ((dockerfile.match(/^ARG FB_LAUFZEITEN="([^"]*)"/m) || [])[1] || '')
    .split(/\s+/).filter(Boolean).map(Number);
const vorgabe = Number((dockerfile.match(/^ARG FB_VORGABE=(\d+)/m) || [])[1]);
pruefe(laufzeiten.length > 1, `FB_LAUFZEITEN nennt mehrere Fassungen: ${laufzeiten.join(', ') || '—'}`);
pruefe(laufzeiten.includes(vorgabe), `Die Vorgabe ${vorgabe} ist eine davon`,
    'Sie greift fuer jeden Server ohne .fb/java — also fuer alle, die vor 2026.09 installiert wurden');

const starter = ohneKommentareShell(fs.readFileSync(path.join(DAEMON, 'images/java/java'), 'utf8'));
pruefe(/COPY images\/java\/java \/usr\/local\/bin\/java/.test(dockerfile),
    'Der Starter kommt als /usr/local/bin/java ins Image');
pruefe(/FB_STATE_DIR/.test(starter) && /\/java"/.test(starter),
    'Der Starter liest $FB_STATE_DIR/java');
pruefe(!laufzeiten.includes(8) || /"\$fassung" = 8/.test(starter),
    'Mit Java 8 im Image loest der Starter @Argumentdateien selbst auf',
    'Sonst: „Could not find or load main class @forge_args.txt" (Forge ≤1.16.5, gemessen 2026-09-24)');

// ── Das Paket ───────────────────────────────────────────────────────────────
console.log('\n▸ Was das Paket verlangt (minecraft.json)');
const paket = JSON.parse(fs.readFileSync(path.join(WURZEL, 'packages/fbpkg/beispiele/minecraft.json'), 'utf8'));
const skript = ohneKommentareShell(paket.install.steps.map(s => s.script || '').join('\n'));
pruefe(/\/fb\/java$/.test(paket.image.ref), `Das Paket nimmt fb/java (${paket.image.ref})`);
pruefe(!/-\d+$/.test(paket.image.tag || ''),
    `Das Tag nennt keine einzelne Fassung (${paket.image.tag})`,
    'Ein Tag wie 2026.08-25 ist das Image mit NUR Java 25 — dort waehlt der Starter nichts');

const anfang = skript.indexOf('WAEHLBAR=');
const funk = skript.match(/\npruefe_java\(\) \{\n[\s\S]*?\n\}\n/);
pruefe(anfang >= 0 && !!funk, 'Das Skript enthaelt die Wahl (WAEHLBAR + pruefe_java)');
if (!funk) { console.log(`\n${fehler} Befund(e).\n`); process.exit(1); }

const aufrufe = (skript.match(/^\s*pruefe_java /gm) || []).length;
pruefe(aufrufe === 5, `pruefe_java steht in allen fuenf Ladern (${aufrufe})`,
    'Ein Lader ohne Aufruf schreibt kein .fb/java und startet auf der Vorgabe');

// Die Wahl steht VOR dem Installer: Forge/NeoForge laufen sonst auf der Vorgabe.
for (const lader of ['forge', 'neoforge']) {
    const zweig = skript.slice(skript.indexOf(`\n${lader})\n`));
    const a = zweig.indexOf('pruefe_java'), b = zweig.indexOf('-installer.jar --installServer');
    pruefe(a >= 0 && b > a, `${lader}: die Laufzeit steht fest, bevor der Installer laeuft`);
}

// ── Die Wahl ausfuehren ─────────────────────────────────────────────────────
function waehle(verlangt) {
    const ablage = fs.mkdtempSync(path.join(os.tmpdir(), 'fbjava-'));
    const prog = `set -euo pipefail\nABLAGE="${ablage}"\nWAEHLBAR="${laufzeiten.join(' ')}"\n`
        + funk[0] + `\npruefe_java "${verlangt}" "Probe" >/dev/null\ncat "$ABLAGE/java"\n`;
    try {
        return Number(execFileSync('bash', ['-c', prog], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim());
    } catch (e) {
        return `Abbruch: ${(e.stderr || '').trim()}`;
    } finally {
        fs.rmSync(ablage, { recursive: true, force: true });
    }
}

console.log('\n▸ Jede Anforderung von Mojang trifft eine Laufzeit im Image');
for (const m of MOJANG) {
    const ist = waehle(m.verlangt);
    pruefe(ist === m.soll && laufzeiten.includes(ist),
        `${m.ausgaben.padEnd(17)} verlangt ${String(m.verlangt).padStart(2)} → Java ${ist}`,
        ist === m.soll ? '' : `erwartet Java ${m.soll}`);
}

console.log('\n▸ Forge landet dort, wo es gemessen lief');
for (const f of FORGE) {
    const ist = waehle(f.verlangt);
    pruefe(f.laeuft.includes(ist) && !f.stirbt.includes(ist),
        `Forge ${f.ausgabe} → Java ${ist}`,
        f.laeuft.includes(ist) ? '' : `laeuft nur auf ${f.laeuft.join('/')}, stirbt auf ${f.stirbt.join('/')}`);
}

// Gegenprobe: Die Wahl muss eine Anforderung ueber dem Image ablehnen, statt
// still die hoechste zu nehmen.
const zuHoch = Math.max(...laufzeiten) + 4;
const antwort = waehle(zuHoch);
pruefe(typeof antwort === 'string' && /verlangt Java/.test(antwort),
    `Gegenprobe: Java ${zuHoch} wird abgelehnt, nicht still ersetzt`,
    typeof antwort === 'string' ? '' : `gewaehlt wurde ${antwort}`);

// ── Optional: Mojangs neueste Ausgabe ───────────────────────────────────────
async function netz() {
    console.log('\n▸ Mojangs neueste Ausgabe (--netz)');
    const liste = await (await fetch('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json')).json();
    const neu = liste.versions.find(v => v.id === liste.latest.release);
    const meta = await (await fetch(neu.url)).json();
    const braucht = meta.javaVersion?.majorVersion;
    pruefe(laufzeiten.some(l => l >= braucht),
        `Minecraft ${neu.id} verlangt Java ${braucht}, das Image traegt bis ${Math.max(...laufzeiten)}`,
        'Neue Laufzeit in FB_LAUFZEITEN eintragen, Image bauen, Paket neu anheften');
}

(async () => {
    if (process.argv.includes('--netz')) await netz();
    console.log(fehler ? `\n${fehler} Befund(e).\n` : '\nAlles gruen.\n');
    process.exit(fehler ? 1 : 0);
})();
