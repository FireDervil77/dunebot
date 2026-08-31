#!/usr/bin/env node
/**
 * Findet abgebrochene Client-Downloads im Apache-Log des Downloads-VHosts.
 *
 * ── Warum `diagnose-` und nicht `check-` (umbenannt 2026-08-31) ──────────────
 *
 * Die Trennlinie ist NICHT "misst ein lebendes System" — 31 der 63 Waechter
 * fragen die echte Datenbank, und das ist hier Absicht (check-kollationen misst
 * dort ausdruecklich den Bestand). Nachgezaehlt am 2026-08-31, weil die erste
 * Fassung dieses Absatzes genau das behauptete und damit falsch lag.
 *
 * Die Linie ist: Ein Waechter kommt mit den Rechten aus, die der Lauf hat.
 * Dieses Skript braucht sudo und eine Apache-Logdatei, die nicht zum Produkt
 * gehoert. Es stand deshalb im Lauf ueber alle Waechter dauerhaft rot — nicht
 * wegen eines Mangels am Bestand, sondern weil die Datei nicht lesbar war
 * (Baustelle 87).
 *
 * Ein Lauf, in dem ein Rot nichts bedeutet, bringt einem bei, Rot zu
 * uebersehen. Also raus aus dem Namensraum statt Ausnahme in der Schleife.
 *
 *   sudo "$(which node)" scripts/diagnose-download-aborts.js
 *   sudo "$(which node)" scripts/diagnose-download-aborts.js /var/log/apache2/spacecluster_downloads_access.log.1
 *
 * Wie das funktioniert: Das LogFormat "combined" nutzt %O — tatsaechlich
 * gesendete Bytes. Bricht ein Download ab, ist %O deutlich kleiner als die
 * Dateigroesse aus dem Manifest. Genau das sucht dieses Skript.
 *
 * (Bei TLS liegt %O ~0,3 % UEBER der Dateigroesse: TLS-Record-Overhead plus
 * Handshake. Deshalb wird erst unter 95 % Auslieferung Alarm geschlagen.)
 *
 * Hintergrund 2026-07-28: Tester melden Abbruch bei ~15 %. Das ist exakt die
 * Position von UnityPlayer.dll (34 MB, spannt 12,4 %–19,8 % des Downloads) —
 * der ersten wirklich grossen Datei. Serverseitig wird sie hash-korrekt
 * ausgeliefert, der Abbruch muss also unterwegs oder im Launcher passieren.
 */

const fs = require('fs');
const path = require('path');

const DOWNLOADS_ROOT = path.join(__dirname, '../apps/dashboard/downloads');
const DEFAULT_LOG = '/var/log/apache2/spacecluster_downloads_access.log';
const COMPLETE_THRESHOLD = 0.95;

// Erwartete Groessen aus allen Kanal-Manifesten einlesen -> "/<channel>/files/<pfad>"
function loadExpectedSizes() {
    const sizes = new Map();
    for (const channel of ['client', 'client-alpha', 'client-beta']) {
        const manifestPath = path.join(DOWNLOADS_ROOT, channel, 'manifest.json');
        if (!fs.existsSync(manifestPath)) continue;
        // PowerShell schreibt die Manifeste mit UTF-8-BOM — der muss weg, sonst wirft JSON.parse
        const raw = fs.readFileSync(manifestPath, 'utf8').replace(/^﻿/, '');
        for (const f of JSON.parse(raw).files || []) {
            sizes.set(`/${channel}/files/${f.path}`, f.size);
        }
    }
    return sizes;
}

const LOG_LINE = /^(\S+) \S+ \S+ \[([^\]]+)\] "(?:GET|HEAD) (\S+) [^"]*" (\d{3}) (\d+)/;

/**
 * --ip <adresse>: Vollstaendige Zeitleiste EINER IP statt der Abbruch-Uebersicht.
 * Zeigt jeden Request mit Auslieferungsgrad — damit sieht man, ob der Launcher
 * parallel laedt und wo genau die Sitzung endet.
 */
function timelineForIP(logPath, ip, sizes) {
    const rows = [];
    for (const line of fs.readFileSync(logPath, 'utf8').split('\n')) {
        const m = LOG_LINE.exec(line);
        if (!m || m[1] !== ip) continue;
        const [, , ts, url, status, sent] = m;
        const expected = sizes.get(decodeURIComponent(url.split('?')[0]));
        rows.push({ ts, url, status, sent: Number(sent), expected });
    }
    if (rows.length === 0) {
        console.log(`Keine Requests von ${ip} in ${logPath}`);
        return;
    }
    console.log(`Zeitleiste für ${ip} — ${rows.length} Requests\n`);
    // Requests pro Sekunde zaehlen: zeigt Parallelitaet und Request-Rate
    const perSecond = new Map();
    for (const r of rows) perSecond.set(r.ts, (perSecond.get(r.ts) || 0) + 1);

    for (const r of rows) {
        const pct = r.expected ? `${(r.sent / r.expected * 100).toFixed(1).padStart(6)}%` : '     —';
        const flag = r.expected && r.sent / r.expected < COMPLETE_THRESHOLD ? '  <-- ABBRUCH' : '';
        console.log(`  ${r.ts}  ${r.status}  ${pct}  ${String(r.sent).padStart(10)}B  ${r.url}${flag}`);
    }

    const secs = [...perSecond.entries()].sort((a, b) => b[1] - a[1]);
    console.log(`\nHöchste Request-Rate: ${secs[0][1]} Requests in Sekunde ${secs[0][0]}`);
    console.log(`Zeitraum: ${rows[0].ts}  bis  ${rows[rows.length - 1].ts}`);
    console.log(`\nHinweis: >150 gezählte Requests in 60 s hätten den alten dunebot-ddos-Jail ausgelöst.`);
}

function main() {
    const args = process.argv.slice(2);
    const ipIdx = args.indexOf('--ip');
    const ip = ipIdx !== -1 ? args[ipIdx + 1] : null;
    if (ipIdx !== -1) args.splice(ipIdx, 2);
    const logPath = args[0] || DEFAULT_LOG;

    if (ip) {
        if (!fs.existsSync(logPath)) {
            console.error(`Logdatei nicht gefunden: ${logPath}`);
            process.exit(1);
        }
        timelineForIP(logPath, ip, loadExpectedSizes());
        return;
    }
    mainSummary(logPath);
}

function mainSummary(logPath) {
    if (!fs.existsSync(logPath)) {
        console.error(`Logdatei nicht gefunden: ${logPath}`);
        process.exit(1);
    }

    const sizes = loadExpectedSizes();
    console.log(`Manifest-Eintraege geladen: ${sizes.size}`);
    console.log(`Analysiere: ${logPath}\n`);

    const byIP = new Map();
    let checked = 0;

    for (const line of fs.readFileSync(logPath, 'utf8').split('\n')) {
        const m = LOG_LINE.exec(line);
        if (!m) continue;
        const [, ip, ts, url, status, sent] = m;
        const expected = sizes.get(decodeURIComponent(url.split('?')[0]));
        if (expected === undefined || status !== '200') continue;

        checked++;
        const ratio = Number(sent) / expected;
        if (ratio >= COMPLETE_THRESHOLD) continue;

        if (!byIP.has(ip)) byIP.set(ip, []);
        byIP.get(ip).push({ ts, url, expected, sent: Number(sent), ratio });
    }

    console.log(`Geprüfte Datei-Requests: ${checked}`);
    if (checked === 0) {
        console.log('\nKeine Client-Downloads im Log. Entweder hat noch niemand geladen,');
        console.log('oder das Log wurde rotiert — dann die .1/.gz-Dateien mitgeben:');
        console.log(`  ls ${DEFAULT_LOG}*`);
        return;
    }
    if (byIP.size === 0) {
        console.log('\n✅ Keine abgebrochenen Downloads gefunden.');
        return;
    }

    console.log(`\n⚠️  ABGEBROCHENE DOWNLOADS bei ${byIP.size} IP(s):\n`);
    for (const [ip, aborts] of byIP) {
        console.log(`${ip}  (${aborts.length} Abbrüche)`);
        for (const a of aborts.slice(0, 10)) {
            const mb = (a.expected / 1048576).toFixed(1);
            console.log(`   ${a.ts}  ${(a.ratio * 100).toFixed(1).padStart(5)}% von ${mb.padStart(7)} MB  ${a.url}`);
        }
        if (aborts.length > 10) console.log(`   ... und ${aborts.length - 10} weitere`);
        console.log('');
    }
    console.log('Betroffene IP gegen die Sperrlisten prüfen:');
    console.log('  sudo "$(which node)" security/manage-blocked-ips.js status <ip>');
}

main();
