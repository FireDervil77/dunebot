#!/usr/bin/env node
/**
 * Wer verliert durch die neuen Waechter im Masterserver-Plugin welchen Zugriff?
 *
 * Gegenstueck zu `check-gameserver-rechte.js`, gleiche Frage eine Ebene hoeher:
 * bis zum 2026-08-02 stand jede der 41 Masterserver-Routen jedem aktiven
 * Dashboard-Nutzer offen — die elf Rechte aus `permissions.json` haben nur
 * Menuepunkte ein- und ausgeblendet. Seit die Waechter haengen, entscheidet das
 * Rechtemodell wirklich, und dieses Skript sagt vorher, fuer wen sich dadurch
 * etwas aendert.
 *
 * Bildet das flache Rechtemodell nach (zugewiesene Gruppen ∪ Direct Permissions,
 * Wildcards exakt → BEREICH.* → global).
 */
'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '../apps/dashboard/.env') });
const mysql = require('mysql2/promise');

/** Was ab jetzt eine Berechtigung verlangt - vorher stand alles offen. */
const NEU_BEWACHT = [
    ['MASTERSERVER.VIEW',              'Einstieg, Uebersicht, Task-Ansichten'],
    ['MASTERSERVER.DAEMON.MANAGE',     'Daemon-Update ausloesen, Task abbrechen'],
    ['MASTERSERVER.ROOTSERVER.VIEW',   'RootServer-Liste, Details, Status, IPs, Port-Allocations'],
    ['MASTERSERVER.ROOTSERVER.CREATE', 'RootServer anlegen (Wizard + beide POST-Wege)'],
    ['MASTERSERVER.ROOTSERVER.EDIT',   'RootServer bearbeiten, IPs und Ports verwalten'],
    ['MASTERSERVER.ROOTSERVER.DELETE', 'RootServer loeschen'],
    ['MASTERSERVER.RESOURCES.VIEW',    'Ressourcen-Seite, Verfuegbarkeitspruefung'],
    ['MASTERSERVER.RESOURCES.MANAGE',  'Overallocation und Reserven aendern'],
    ['MASTERSERVER.TOKENS.VIEW',       'Token-Liste ansehen'],
    ['MASTERSERVER.TOKENS.MANAGE',     'Tokens erzeugen und widerrufen'],
    ['MASTERSERVER.LOGS.VIEW',         'Daemon-Logs ansehen'],
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

    // Nur Guilds betrachten, in denen das Plugin ueberhaupt laeuft - anderswo
    // aendert sich durch die Waechter nichts.
    const [aktiv] = await db.query(`
        SELECT guild_id FROM guild_plugins
        WHERE plugin_name = 'masterserver' AND is_enabled = 1
    `);
    const aktiveGuilds = new Set(aktiv.map(r => String(r.guild_id)));
    console.log(`Masterserver aktiv in ${aktiveGuilds.size} Guild(s)\n`);

    const [nutzer] = await db.query(`
        SELECT gu.id, gu.user_id, gu.guild_id, gu.direct_permissions AS direkt, gu.is_owner,
               g.guild_name
        FROM guild_users gu
        LEFT JOIN guilds g ON g._id = gu.guild_id
        WHERE gu.status = 'active'
        ORDER BY gu.guild_id, gu.user_id
    `);

    const betroffen = nutzer.filter(n => aktiveGuilds.has(String(n.guild_id)));
    console.log(`${betroffen.length} aktive Dashboard-Nutzer in diesen Guilds\n`);

    const proGuild = {};

    for (const n of betroffen) {
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

        (proGuild[`${n.guild_name || '?'} (${n.guild_id})`] ||= []).push({
            user: n.user_id,
            owner: n.is_owner === 1,
            gruppen: gruppen.map(g => g.name).join(', ') || '(keine)',
            fehlt: fehlt.map(([k]) => k.replace('MASTERSERVER.', '')),
        });
    }

    for (const [guild, zeilen] of Object.entries(proGuild)) {
        console.log(`\n=== ${guild}`);
        for (const z of zeilen) {
            const kopf = `  ${z.user}${z.owner ? ' (Owner)' : ''}  [${z.gruppen}]`;
            if (!z.fehlt.length) {
                console.log(`${kopf}  → verliert nichts`);
            } else {
                console.log(kopf);
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
        if (!aktiveGuilds.has(String(g.guild_id))) continue;
        const rechte = normalisiere(g.permissions);
        const hat = NEU_BEWACHT.filter(([k]) => hatRecht(rechte, k)).map(([k]) => k.replace('MASTERSERVER.', ''));
        console.log(`  ${String(g.guild_id).padEnd(20)} ${g.name.padEnd(16)} ${g.is_default ? '(Standard)' : '          '} ${g.mitglieder} Mitglied(er)`);
        console.log(`      erteilt: ${hat.length ? hat.join(', ') : '— nichts davon —'}`);
    }

    await db.end();
})().catch(e => { console.error('FEHLER:', e.message); process.exit(1); });
