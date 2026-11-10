#!/usr/bin/env node
'use strict';

/**
 * Ein Weg in die Tabelle `notifications` (K360, 2026-11-10).
 *
 * Bis zum 2026-11-10 gab es vier: `NotificationManager.addNotification` schrieb
 * in Spalten, die es seit der Mehrsprachigkeit (Migration 20260327_111415) nicht
 * mehr gibt (`_id`, `title`, `message`), und fiel nur deshalb nicht auf, weil
 * sein einziger Aufrufer (`UpdatesManager`) seit dem 2026-03-18 nicht mehr lief.
 * Daneben schrieb der Admin-Bereich mit drei eigenen `INSERT`, einem `UPDATE`
 * und einem `DELETE`. `cleanupExpiredNotifications` hatte keinen Aufrufer.
 *
 * Geprueft wird:
 * 1. Anlegen, Aendern (Inhalt) und Loeschen stehen nur im NotificationManager.
 *    Ausnahmen: Migrationen (Schema) und der Bot, der nach dem Discord-Versand
 *    `sent_to_discord`/`discord_message_ids` setzt (anderer Prozess, nur diese
 *    zwei Spalten).
 * 2. Der Manager schreibt keine der Spalten, die es nicht mehr gibt.
 * 3. Das Dashboard ruft `cleanupExpiredNotifications`.
 *
 * Der echte Lauf gegen die Datenbank (TEMPORARY-Kopie) steht nicht hier - ein
 * Waechter schreibt nicht in die Datenbank. Er ist im Commit beschrieben.
 *
 *     node scripts/check-notifications-ein-weg.js
 */

const fs = require('fs');
const path = require('path');
const { ohneKommentare } = require('./lib/quelltext');
const WURZEL = path.resolve(__dirname, '..');

let faelle = 0, abweichungen = 0;
function pruefe(gut, text, zusatz = '') {
    faelle++;
    if (!gut) abweichungen++;
    console.log(`  ${gut ? '✓' : '✗'} ${text}${zusatz ? '  — ' + zusatz : ''}`);
}

const MANAGER = 'packages/dunebot-sdk/lib/NotificationManager.js';

/** @returns {string[]} JS-Dateien, relativ zur Wurzel */
function dateien() {
    const aus = new Set(['node_modules', 'backups', 'vendor', '.git', 'docs', 'docs_bak', 'migrations', 'public']);
    const liste = [];
    (function lauf(rel) {
        for (const e of fs.readdirSync(path.join(WURZEL, rel), { withFileTypes: true })) {
            if (aus.has(e.name)) continue;
            const r = rel ? `${rel}/${e.name}` : e.name;
            if (e.isDirectory()) lauf(r);
            else if (e.name.endsWith('.js')) liste.push(r);
        }
    })('');
    return liste;
}

const lies = (rel) => ohneKommentare(fs.readFileSync(path.join(WURZEL, rel), 'utf8'));

console.log('\n1. Anlegen, Ändern und Löschen nur im NotificationManager');
{
    const SCHREIBEN = /\b(INSERT\s+INTO|DELETE\s+FROM|UPDATE)\s+`?notifications`?\s/i;
    // Der Bot setzt nach dem Versand nur die Discord-Spalten.
    const NUR_DISCORD = /UPDATE\s+`?notifications`?\s+SET\s+sent_to_discord\s*=\s*\S+\s*,\s*discord_message_ids\s*=\s*\?\s+WHERE\s+id\s*=\s*\?/i;

    const fremd = [];
    for (const rel of dateien()) {
        if (rel === MANAGER || rel.startsWith('scripts/')) continue;
        const code = lies(rel).replace(new RegExp(NUR_DISCORD.source, 'gi'), '');
        if (SCHREIBEN.test(code)) fremd.push(rel);
    }
    pruefe(fremd.length === 0, 'kein zweiter Schreibweg', fremd.join(', '));
}

console.log('\n2. Der Manager schreibt nur Spalten, die es gibt');
{
    const code = lies(MANAGER);
    const insert = code.match(/INSERT\s+INTO\s+notifications\s*\(([^)]*)\)/i);
    pruefe(Boolean(insert), 'addNotification hat ein INSERT mit Spaltenliste');
    const spalten = insert ? insert[1].split(',').map(s => s.trim()) : [];
    const weg = ['_id', 'title', 'message', 'action_text'];
    const tot = spalten.filter(s => weg.includes(s));
    pruefe(insert && tot.length === 0, 'keine Spalte von vor der Mehrsprachigkeit', tot.join(', '));
    pruefe(/updateNotification\s*\(/.test(code) && /deleteNotification\s*\(/.test(code),
        'Ändern und Löschen stehen im Manager');
}

console.log('\n3. Abgelaufene Meldungen werden gelöscht');
pruefe(/cleanupExpiredNotifications\s*\?*\.?\s*\(/.test(lies('apps/dashboard/app.js')),
    'das Dashboard ruft cleanupExpiredNotifications');

console.log('\n4. Der UpdatesManager bleibt weg');
pruefe(!fs.existsSync(path.join(WURZEL, 'packages/dunebot-sdk/lib/UpdatesManager.js')),
    'packages/dunebot-sdk/lib/UpdatesManager.js gibt es nicht');

console.log(abweichungen === 0
    ? `\nErgebnis: ${faelle} Pruefungen, 0 Abweichungen.\n`
    : `\nErgebnis: ${faelle} Pruefungen, ${abweichungen} Abweichung(en).\n`);
process.exit(abweichungen === 0 ? 0 : 1);
