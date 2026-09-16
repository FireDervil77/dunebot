#!/usr/bin/env node
/**
 * Prueft die Sperrkette (docs/Sperrsystem.md).
 *
 * Der Betreiber am 2026-09-16: *„man kann auch mal ein Sperrsystem bauen, das
 * wirklich nur die Bösewichte aussperrt und nicht normale Benutzer."*
 *
 * Genau das misst dieses Skript, und zwar in **beide** Richtungen:
 *
 *   1. Kein echter Seitenpfad darf ein Exploit-Muster treffen. Das ist die
 *      wichtigere Richtung — ein zu breites Muster sperrt lautlos Besucher.
 *   2. Bekannte Scanner-Pfade muessen treffen. Sonst schuetzt die Liste nichts.
 *   3. Die Kette hat je Glied genau einen Ort: kein zweiter Mustersatz, kein
 *      Begrenzer ohne Aufrufer, kein Name, der nur an einer Stelle stimmt.
 *
 * Keine Datenbank, kein Netz.
 *
 *   node scripts/check-sperrkette.js
 *
 * Exitcode 1, wenn ein Fall scheitert.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { ohneKommentare } = require('./lib/quelltext');

const WURZEL = path.join(__dirname, '..');
const lies = (p) => fs.readFileSync(path.join(WURZEL, p), 'utf8');

let geprueft = 0, gescheitert = 0;
function pruefe(was, gut, hinweis = '') {
    geprueft++;
    if (!gut) gescheitert++;
    console.log(`  ${gut ? '✓' : '✗'} ${was}${gut || !hinweis ? '' : ` — ${hinweis}`}`);
}

// Logger stellen, BEVOR der Pruefling geladen wird: `ServiceManager.get()`
// wirft, wenn ein Dienst fehlt — `?.` faengt das nicht ab.
const { ServiceManager } = require('../packages/dunebot-core');
ServiceManager.register('Logger', { info(){}, warn(){}, error(){}, debug(){}, success(){} });

const blocker = require('../apps/dashboard/middlewares/security/exploit-blocker.middleware');
const MUSTER = blocker.EXPLOIT_PATTERNS;

/** Welches Muster trifft diesen Pfad? `null`, wenn keins. */
function trifft(pfad) {
    const m = MUSTER.find((r) => r.test(pfad));
    return m ? String(m) : null;
}

// ---------------------------------------------------------------------------
console.log('\n1. Echte Seitenpfade — KEINER darf treffen');
// ---------------------------------------------------------------------------
//
// Geprueft wird `req.path`, ohne Abfrageparameter (exploit-blocker:417).
// Deshalb stehen hier Pfade, keine Query-Strings.
const ECHTE_PFADE = [
    '/',
    '/docs',
    '/docs/installation.md',
    '/changelogs',
    '/changelogs/2.3.0',
    '/privacy',
    '/tos',
    '/blog/ein-beitrag',
    '/page/impressum',
    '/auth/login',
    '/auth/callback',
    '/auth/server-selector',
    '/guild/565123525795643393',
    '/guild/565123525795643393/willkommen',
    '/guild/565123525795643393/settings/general',
    '/guild/565123525795643393/plugins',
    '/guild/565123525795643393/permissions',
    '/guild/565123525795643393/media',
    '/guild/565123525795643393/feedback/feature-request',
    // Der Masterserver-Tab: heisst „logs", liegt aber NICHT auf oberster Ebene.
    // Genau daran haette sich das uebernommene Muster `^/logs` verschlucken
    // koennen — deshalb steht er hier.
    '/guild/565123525795643393/plugins/masterserver/logs',
    '/themes/default/assets/images/firebot-logo-rund-256.png',
    '/themes/default/assets/js/guild.js',
    '/uploads/media/565123525795643393/1789541313521-96bd449dc4649a72.png',
    '/downloads/daemon/install.sh',
    '/api/notifications',
    '/robots.txt',
    '/favicon.ico',
];
for (const pfad of ECHTE_PFADE) {
    const m = trifft(pfad);
    pruefe(`${pfad}`, m === null, `getroffen von ${m}`);
}

// ---------------------------------------------------------------------------
console.log('\n2. Scanner-Pfade — JEDER muss treffen');
// ---------------------------------------------------------------------------
const SCANNER = [
    '/wp-login.php',
    '/wp-admin/install.php',
    '/wp-content/plugins/hellopress/wp_filemanager.php',
    '/wp-includes/widgets/',
    '/xmlrpc.php',
    '/phpmyadmin/index.php',
    '/x.php',
    '/.env',
    '/.env.local',
    '/.git/config',
    '/../../etc/passwd',
    '/server-status',
    // Die elf aus `blockSensitiveFiles.js`, damit die Zusammenlegung belegt ist
    '/.vscode/settings.json',
    '/.pm2/dump.pm2',
    '/node_modules/express/index.js',
    '/logs/dashboard.log',
    '/package.json',
    '/ecosystem.config.js',
    '/dump.sql',
    '/index.bak',
    '/.index.swp',
    '/server.key',
    '/cert.pem',
];
for (const pfad of SCANNER) {
    pruefe(`${pfad}`, trifft(pfad) !== null, 'kein Muster trifft');
}

// ---------------------------------------------------------------------------
console.log('\n3. Je Glied ein Ort');
// ---------------------------------------------------------------------------
const app = ohneKommentare(lies('apps/dashboard/app.js'));

pruefe('die zweite Musterliste ist weg (blockSensitiveFiles)',
    !fs.existsSync(path.join(WURZEL, 'apps/dashboard/middlewares/blockSensitiveFiles.js')));
pruefe('… und wird auch nicht mehr eingebunden', !/blockSensitiveFiles/.test(app));
pruefe('der Exploit-Blocker haengt genau einmal in der Kette',
    (app.match(/this\.app\.use\(exploitBlocker\)/g) || []).length === 1);

const begrenzer = ohneKommentare(lies('apps/dashboard/middlewares/security/rate-limiter.middleware.js'));
const exportiert = [...begrenzer.matchAll(/^\s+(\w+Limiter),?$/gm)].map((m) => m[1]);
pruefe('mindestens ein Begrenzer exportiert', exportiert.length > 0, JSON.stringify(exportiert));

// Jeder exportierte Begrenzer braucht einen Aufrufer ausserhalb seiner
// eigenen Datei. `guildActionLimiter` hatte seit jeher keinen — ein Begrenzer
// ohne Aufrufer ist kein Schutz, nur der Eindruck davon.
for (const name of exportiert) {
    let treffer = 0;
    const suchen = (verzeichnis) => {
        for (const eintrag of fs.readdirSync(verzeichnis, { withFileTypes: true })) {
            if (eintrag.name === 'node_modules' || eintrag.name.startsWith('.')) continue;
            const voll = path.join(verzeichnis, eintrag.name);
            if (eintrag.isDirectory()) { suchen(voll); continue; }
            if (!eintrag.name.endsWith('.js')) continue;
            if (voll.endsWith('rate-limiter.middleware.js')) continue;
            if (ohneKommentare(fs.readFileSync(voll, 'utf8')).includes(name)) treffer++;
        }
    };
    suchen(path.join(WURZEL, 'apps/dashboard'));
    pruefe(`\`${name}\` hat einen Aufrufer`, treffer > 0, 'nirgends benutzt');
}

// ---------------------------------------------------------------------------
console.log('\n4. Der Name, der dreimal verschieden war');
// ---------------------------------------------------------------------------
//
// Die Middleware schrieb `FireBot-Exploit-Blocker`, der fail2ban-Filter suchte
// `DuneBot-Exploit-Blocker`, die Projektkopie `EXPLOIT-SCANNER`. Die Regel
// bannte dadurch niemanden. Sie ist am 2026-09-16 entfernt worden statt
// repariert — hier wird belegt, dass sie nicht heimlich zurueckkommt.
const mw = lies('apps/dashboard/middlewares/security/exploit-blocker.middleware.js');
const kennung = (mw.match(/"([A-Za-z]+-Exploit-Blocker)"/) || [])[1] || null;
pruefe('die Middleware schreibt eine Kennung ins Log', Boolean(kennung), String(kennung));

const filterDatei = 'security/fail2ban-dunebot-exploits.conf';
if (fs.existsSync(path.join(WURZEL, filterDatei))) {
    const filter = lies(filterDatei);
    pruefe(`${filterDatei} sucht dieselbe Kennung (${kennung})`,
        kennung !== null && filter.includes(kennung),
        'Filter und Middleware sind wieder auseinander');
} else {
    console.log(`  – ${filterDatei} — Ausnahme: entfernt, die Regel sperrt bewusst nicht mehr`);
}

console.log(`\nErgebnis: ${geprueft} Pruefungen, ${gescheitert} Abweichungen.`);
// Der Exploit-Blocker startet beim Laden einen setInterval — ohne exit
// haengt der Prozess.
process.exit(gescheitert > 0 ? 1 : 0);
