#!/usr/bin/env node
/**
 * Pakete nach einem Image-Bau neu anheften — nur auf Kommando.
 *
 * Jedes Paket trägt `image.digest`, und der Daemon nimmt den Digest vor dem Tag
 * (rezept.ImageAus). Ein neu gebautes und geschobenes Image erreicht deshalb
 * KEINEN Server, bis das Paket auf den neuen Digest zeigt und eingeliefert ist.
 * Am 2026-09-25 zweimal von Hand nachgezogen; danach dieses Skript
 * (Baustelle 166, Schritt 2).
 *
 * Mit Absicht NICHT automatisch: Das Anheften ist der Schutz davor, dass ein
 * ungeprüftes Image still auf alle Server geht (am 25.09. fehlte im ersten
 * Image-Bau noch die Abfrage-Kennung a2s).
 *
 *   node scripts/hefte-images-an.js             Probelauf: was wäre neu anzuheften
 *   node scripts/hefte-images-an.js --wirklich  Dateien ändern (danach liefere-pakete.js)
 *
 * Quelle sind die Paketdateien in packages/fbpkg/beispiele. Pakete, die es nur
 * in der Datenbank gibt (aus der Werkbank veröffentlicht), werden genannt, aber
 * nicht angefasst: Sie gehören über die Werkbank neu geprüft — dort heftet das
 * Veröffentlichen den Digest des grünen Durchlaufs an.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ORDNER = path.join(__dirname, '../packages/fbpkg/beispiele');
const wirklich = process.argv.includes('--wirklich');
const heute = new Date().toISOString().slice(0, 10);

/** Aktueller Digest eines Tags — aus der Registry, ohne das Image zu ziehen. */
function aktuellerDigest(ref, tag) {
    const aus = execFileSync('docker',
        ['buildx', 'imagetools', 'inspect', `${ref}:${tag}`, '--format', '{{json .Manifest.Digest}}'],
        { encoding: 'utf8', timeout: 60000, stdio: ['ignore', 'pipe', 'pipe'] });
    const digest = JSON.parse(aus.trim());
    if (!/^sha256:[0-9a-f]{64}$/.test(digest)) throw new Error(`unerwartete Antwort: ${aus.trim()}`);
    return digest;
}

/** Fassung um eins im letzten Glied erhöhen: 1.5.3 → 1.5.4. */
function naechsteFassung(v) {
    const teile = String(v).split('.');
    teile[teile.length - 1] = String(Number(teile[teile.length - 1]) + 1);
    return teile.join('.');
}

/**
 * Im Dateitext ersetzen statt JSON neu schreiben: Die Pakete sind von Hand
 * formatiert, und ein Neu-Schreiben machte jeden Diff unlesbar.
 */
function einmal(text, alt, neu, was) {
    const n = text.split(alt).length - 1;
    if (n !== 1) throw new Error(`${was}: ${n} Treffer statt 1`);
    return text.replace(alt, neu);
}

function vermerk(text, satz) {
    const m = /"open": \[\n(\s*)/.exec(text);
    if (!m) throw new Error('status.open nicht gefunden');
    const stelle = m.index + m[0].length;
    return text.slice(0, stelle) + JSON.stringify(satz) + ',\n' + m[1] + text.slice(stelle);
}

(async () => {
    let zuAendern = 0, fehler = 0;
    const slugsAusDateien = new Set();
    console.log(`\nPakete neu anheften${wirklich ? '' : '  (PROBELAUF — es wird nichts geschrieben)'}\n`);

    for (const name of fs.readdirSync(ORDNER).filter(n => n.endsWith('.json')).sort()) {
        const datei = path.join(ORDNER, name);
        let text = fs.readFileSync(datei, 'utf8');
        const p = JSON.parse(text);
        slugsAusDateien.add(p.identity?.slug);
        const img = p.image || {};
        if (!img.ref || !img.tag || !img.digest) {
            console.log(`? ${name.padEnd(28)} kein ref/tag/digest — übersprungen`);
            continue;
        }
        let neu;
        try {
            neu = aktuellerDigest(img.ref, img.tag);
        } catch (e) {
            fehler++;
            console.log(`! ${name.padEnd(28)} ${img.ref}:${img.tag} nicht abfragbar: ${e.message.split('\n')[0]}`);
            continue;
        }
        if (neu === img.digest) {
            console.log(`= ${name.padEnd(28)} ${img.tag.padEnd(26)} aktuell`);
            continue;
        }
        zuAendern++;
        const alt = p.identity.version;
        const nv = naechsteFassung(alt);
        console.log(`+ ${name.padEnd(28)} ${img.tag.padEnd(26)} ${img.digest.slice(7, 19)} → ${neu.slice(7, 19)}  ${alt} → ${nv}`);
        if (!wirklich) continue;

        text = einmal(text, `"digest": "${img.digest}"`, `"digest": "${neu}"`, `${name}: digest`);
        text = text.replace(/("pinned_at": ")[^"]*(")/, `$1${heute}$2`);
        text = einmal(text, `"version": "${alt}",`, `"version": "${nv}",`, `${name}: version`);
        text = vermerk(text, `IMAGE NEU ANGEHEFTET (${nv}, ${heute}): ${img.ref.replace(/^.*\//, '')}:${img.tag} `
            + `${img.digest.slice(0, 19)}… → ${neu.slice(0, 19)}… (scripts/hefte-images-an.js). `
            + 'Der Daemon nimmt den Digest vor dem Tag — ohne diese Zeile liefen die Server weiter mit dem alten Image.');
        JSON.parse(text); // lieber hier scheitern als mit kaputter Datei weitermachen
        fs.writeFileSync(datei, text);
    }

    // ── Was es nur in der Datenbank gibt ─────────────────────────────────────
    try {
        require('dotenv').config({ path: path.join(__dirname, '../apps/dashboard/.env'), quiet: true });
        const mysql = require('mysql2/promise');
        const c = await mysql.createConnection({
            host: process.env.MYSQL_HOST, port: process.env.MYSQL_PORT,
            user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD,
            database: process.env.MYSQL_DATABASE,
        });
        const [zeilen] = await c.query('SELECT slug FROM packages ORDER BY slug');
        await c.end();
        const nurDb = zeilen.map(z => z.slug).filter(s => !slugsAusDateien.has(s));
        if (nurDb.length) {
            console.log(`\nNur in der Datenbank (nicht angefasst — über die Werkbank neu prüfen und veröffentlichen):`);
            for (const s of nurDb) console.log(`  · ${s}`);
        }
    } catch (e) {
        console.log(`\n(Datenbank nicht befragt: ${e.message})`);
    }

    console.log(`\nNeu anzuheften: ${zuAendern} · nicht abfragbar: ${fehler}`);
    if (zuAendern && !wirklich) console.log('Das war ein Probelauf. Mit --wirklich werden die Dateien geändert.');
    if (zuAendern && wirklich) console.log('Geändert. Jetzt: node scripts/liefere-pakete.js (Probelauf), dann --wirklich.');
    process.exit(fehler ? 1 : 0);
})();
