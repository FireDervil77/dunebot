#!/usr/bin/env node
/**
 * Vergleicht das alte und das neue Rechtemodell für JEDEN Nutzer jeder Guild.
 *
 * ALT (heute): `_buildAndCachePermissions()` lädt alle Gruppen mit
 *   `priority <= max_priority` des Nutzers und legt sie übereinander. Priorität
 *   ist damit eine Stufe auf einer Leiter – wer oben steht, erbt alles darunter.
 *
 * NEU: Nur die tatsächlich **zugewiesenen** Gruppen zählen, danach die
 *   Direct Permissions.
 *
 * Dieses Skript ist die Absicherung des Umbaus: Vor der Migration zeigt es die
 * Abweichungen (dort wird heute geerbt), nach der Migration muss es **null**
 * melden – dann ist der Umstieg wirkungsneutral.
 *
 *   node scripts/check-permissions-model.js
 *   node scripts/check-permissions-model.js --details
 */

'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../apps/dashboard/.env') });
const mysql = require('mysql2/promise');

const ZEIGE_DETAILS = process.argv.includes('--details');

/** Permissions-Spalte robust auslesen (JSON-String oder Objekt). */
function parsePerms(value) {
    if (!value) return {};
    if (typeof value === 'string') {
        try { return JSON.parse(value); } catch (_) { return {}; }
    }
    return typeof value === 'object' ? value : {};
}

/** Nur die erteilten Rechte, Schlüssel normalisiert wie im PermissionManager. */
function granted(perms) {
    const out = new Set();
    for (const [key, value] of Object.entries(perms || {})) {
        if (value === true || value === 'true') out.add(String(key).toUpperCase().trim());
    }
    return out;
}

async function main() {
    const db = await mysql.createConnection({
        host:     process.env.MYSQL_HOST,
        port:     Number(process.env.MYSQL_PORT) || 3306,
        user:     process.env.MYSQL_USER,
        password: process.env.MYSQL_PASSWORD,
        database: process.env.MYSQL_DATABASE,
    });

    const [users] = await db.query('SELECT id, guild_id, user_id FROM guild_users ORDER BY guild_id, user_id');

    let geprueft = 0, abweichend = 0, verloreneGesamt = 0, gewonneneGesamt = 0;

    for (const user of users) {
        // Zugewiesene Gruppen
        const [assigned] = await db.query(
            `SELECT gg.id, gg.name, gg.priority, gg.permissions
             FROM guild_user_groups x JOIN guild_groups gg ON gg.id = x.group_id
             WHERE x.guild_user_id = ?`,
            [user.id]
        );

        // Guild-Owner haben immer alles – für den Vergleich uninteressant.
        const [[guild]] = await db.query('SELECT owner_id FROM guilds WHERE _id = ?', [user.guild_id]);
        if (guild && guild.owner_id === user.user_id) continue;

        geprueft++;

        // ── ALT: Vererbung über die Priorität ──────────────────────────────
        const alt = new Set();
        if (assigned.length) {
            const maxPriority = Math.max(...assigned.map(g => Number(g.priority)));
            const [inherited] = await db.query(
                'SELECT name, permissions FROM guild_groups WHERE guild_id = ? AND priority <= ? ORDER BY priority ASC',
                [user.guild_id, maxPriority]
            );
            for (const group of inherited) {
                for (const key of granted(parsePerms(group.permissions))) alt.add(key);
            }
        }

        // ── NEU: nur zugewiesene Gruppen ───────────────────────────────────
        const neu = new Set();
        for (const group of assigned) {
            for (const key of granted(parsePerms(group.permissions))) neu.add(key);
        }

        const verloren = [...alt].filter(k => !neu.has(k));
        const gewonnen = [...neu].filter(k => !alt.has(k));

        if (verloren.length || gewonnen.length) {
            abweichend++;
            verloreneGesamt += verloren.length;
            gewonneneGesamt += gewonnen.length;

            console.log(`\n  Guild …${user.guild_id.slice(-6)}  User …${user.user_id.slice(-6)}`);
            console.log(`     Gruppen: ${assigned.map(g => `${g.name}(${g.priority})`).join(', ') || '–'}`);
            if (verloren.length) {
                console.log(`     verliert ${verloren.length}: ${(ZEIGE_DETAILS ? verloren : verloren.slice(0, 6)).join(', ')}`
                    + (!ZEIGE_DETAILS && verloren.length > 6 ? ` … (--details für alle)` : ''));
            }
            if (gewonnen.length) {
                console.log(`     gewinnt ${gewonnen.length}: ${(ZEIGE_DETAILS ? gewonnen : gewonnen.slice(0, 6)).join(', ')}`);
            }
        }
    }

    console.log('\n' + '─'.repeat(70));
    console.log(`  ${geprueft} Nutzer geprüft (Guild-Owner ausgenommen, die haben immer alles)`);
    console.log(`  ${abweichend} mit Abweichung · ${verloreneGesamt} verlorene, ${gewonneneGesamt} gewonnene Rechte`);
    console.log(abweichend === 0
        ? '  ✓ Beide Modelle liefern dasselbe – der Umstieg ist wirkungsneutral.'
        : '  ⚠ Noch nicht wirkungsneutral: erst die Gruppen flach klopfen (Migration).');
    console.log('─'.repeat(70) + '\n');

    await db.end();
    process.exitCode = 0; // Abweichungen sind vor der Migration erwartet
}

main().catch(err => {
    console.error('FEHLER:', err.message);
    process.exit(1);
});
