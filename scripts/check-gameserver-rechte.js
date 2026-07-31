#!/usr/bin/env node
/**
 * Wer verliert durch die neuen Waechter welchen Zugriff?
 *
 * Bildet das flache Rechtemodell nach (zugewiesene Gruppen ∪ Direct Permissions,
 * Wildcards exakt → BEREICH.* → global) und prueft je Dashboard-Nutzer, welche
 * der neu bewachten Aktionen ihm ab jetzt verwehrt sind.
 */
'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '../apps/dashboard/.env') });
const mysql = require('mysql2/promise');

/** Was ab jetzt eine Berechtigung verlangt - vorher stand alles offen. */
const NEU_BEWACHT = [
    ['GAMESERVER.CREATE',          'Server anlegen / Installation wiederholen'],
    ['GAMESERVER.EDIT',            'Server bearbeiten, Addons schreiben, Plugin-Einstellungen'],
    ['GAMESERVER.DELETE',          'Server loeschen'],
    ['GAMESERVER.START',           'Server starten'],
    ['GAMESERVER.STOP',            'Server stoppen'],
    ['GAMESERVER.RESTART',         'Server neu starten'],
    ['GAMESERVER.VIEW',            'Dashboard, Statusliste, Einstellungen ansehen'],
    ['GAMESERVER.ADDONS.VIEW',     'Marktplatz ansehen'],
    ['GAMESERVER.FILES.VIEW',      'Dateien ansehen / herunterladen'],
    ['GAMESERVER.FILES.MANAGE',    'Dateien schreiben, loeschen, hochladen'],
    ['GAMESERVER.CONSOLE.VIEW',    'Konsole trennen (detach)'],
];

function normalisiere(roh) {
    if (!roh) return {};
    if (typeof roh === 'object') return roh;
    try { return JSON.parse(roh) || {}; } catch (_) { return {}; }
}

/** Aufloesung wie im PermissionManager: exakt → BEREICH.* (eng vor weit) → global. */
function hatRecht(rechte, schluessel) {
    if (Object.prototype.hasOwnProperty.call(rechte, schluessel)) return rechte[schluessel] === true;

    const teile = schluessel.split('.');
    for (let i = teile.length - 1; i >= 1; i--) {
        const wildcard = teile.slice(0, i).join('.') + '.*';
        if (Object.prototype.hasOwnProperty.call(rechte, wildcard)) return rechte[wildcard] === true;
    }
    return rechte.wildcard === true;
}

(async () => {
    const db = await mysql.createConnection({
        host: process.env.MYSQL_HOST, port: Number(process.env.MYSQL_PORT) || 3306,
        user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD,
        database: process.env.MYSQL_DATABASE,
    });

    const [nutzer] = await db.query(`
        SELECT gu.id, gu.user_id, gu.guild_id, gu.direct_permissions AS direkt, gu.is_owner,
               g.guild_name
        FROM guild_users gu
        LEFT JOIN guilds g ON g._id = gu.guild_id
        WHERE gu.status = 'active'
        ORDER BY gu.guild_id, gu.user_id
    `);

    console.log(`${nutzer.length} aktive Dashboard-Nutzer\n`);

    const proGuild = {};

    for (const n of nutzer) {
        const [gruppen] = await db.query(`
            SELECT gg.name, gg.permissions
            FROM guild_user_groups gug
            JOIN guild_groups gg ON gg.id = gug.group_id
            WHERE gug.guild_user_id = ?
        `, [n.id]);

        const rechte = {};
        for (const g of gruppen) {
            for (const [k, v] of Object.entries(normalisiere(g.permissions))) {
                if (v === true) rechte[k] = true;
            }
        }
        // Direct Permissions gewinnen - auch ein false.
        for (const [k, v] of Object.entries(normalisiere(n.direkt))) rechte[k] = v;

        const fehlt = NEU_BEWACHT.filter(([schluessel]) => !hatRecht(rechte, schluessel));

        const zeile = {
            user: n.user_id,
            gruppen: gruppen.map(g => g.name).join(', ') || '(keine)',
            fehlt: fehlt.map(([k]) => k),
        };
        (proGuild[`${n.guild_name || '?'} (${n.guild_id})`] ||= []).push(zeile);
    }

    for (const [guild, zeilen] of Object.entries(proGuild)) {
        console.log(`\n=== ${guild}`);
        for (const z of zeilen) {
            if (!z.fehlt.length) {
                console.log(`  ${z.user}  [${z.gruppen}]  → verliert nichts`);
            } else {
                console.log(`  ${z.user}  [${z.gruppen}]`);
                console.log(`      fehlt: ${z.fehlt.join(', ')}`);
            }
        }
    }

    console.log('\n\n=== Was die Gruppen heute erteilen (nur die neu bewachten Rechte) ===');
    const [gruppen] = await db.query(`
        SELECT gg.id, gg.name, gg.guild_id, gg.is_default, gg.permissions,
               (SELECT COUNT(*) FROM guild_user_groups WHERE group_id = gg.id) AS mitglieder
        FROM guild_groups gg ORDER BY gg.guild_id, gg.priority
    `);
    for (const g of gruppen) {
        const rechte = normalisiere(g.permissions);
        const hat = NEU_BEWACHT.filter(([k]) => hatRecht(rechte, k)).map(([k]) => k.replace('GAMESERVER.', ''));
        console.log(`  ${String(g.guild_id).padEnd(20)} ${g.name.padEnd(16)} ${g.is_default ? '(Standard)' : '          '} ${g.mitglieder} Mitglied(er)`);
        console.log(`      erteilt: ${hat.length ? hat.join(', ') : '— nichts davon —'}`);
    }

    await db.end();
})().catch(e => { console.error('FEHLER:', e.message); process.exit(1); });
