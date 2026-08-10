#!/usr/bin/env node
/**
 * Prueft, ob RCON ueberhaupt funktionieren KANN — je Addon und je Server.
 *
 * Hintergrund (Baustellen 39): Die Eggs benutzen RCON container-intern, ueber
 * eine Bruecke von der Standardeingabe (`rcon -a localhost:$RCON_PORT`). Fuer
 * den Egg-Zweck reicht das, und Palworlds Variable sagt woertlich "Does not
 * need to be allocated!".
 *
 * Unser Dashboard verbindet aber von aussen: `_executeRcon` schickt
 * `gameserver.rcon` an den Daemon, und der oeffnet eine TCP-Verbindung auf
 * `bind_ip:port`. Das braucht einen Port, der belegt UND von Docker
 * veroeffentlicht ist. Deklariert den keiner, laeuft der ganze Weg ins Leere —
 * lautlos, weil niemand ihn je ausprobiert hat.
 *
 * Aufruf:
 *   node scripts/check-rcon.js            Bestandsaufnahme
 *   node scripts/check-rcon.js --live     zusaetzlich echte TCP-Verbindung testen
 */
'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', 'apps', 'dashboard', '.env') });
const mysql = require('mysql2/promise');
const net = require('net');

const LIVE = process.argv.includes('--live');

const alsJson = (v, vorgabe = {}) => {
    if (v == null) return vorgabe;
    if (typeof v !== 'string') return v;
    try { return JSON.parse(v); } catch (_) { return vorgabe; }
};

/** Kurzer TCP-Verbindungsversuch — offen oder nicht. */
function erreichbar(host, port, msTimeout = 3000) {
    return new Promise((fertig) => {
        const s = new net.Socket();
        const schliessen = (antwort) => { s.destroy(); fertig(antwort); };
        s.setTimeout(msTimeout);
        s.once('connect', () => schliessen(true));
        s.once('timeout', () => schliessen(false));
        s.once('error',   () => schliessen(false));
        s.connect(port, host);
    });
}

(async () => {
    const c = await mysql.createConnection({
        host: process.env.MYSQL_HOST, port: process.env.MYSQL_PORT,
        user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD,
        database: process.env.MYSQL_DATABASE,
    });

    // ── Teil 1: die Addons ───────────────────────────────────────────────────
    const [addons] = await c.query(
        "SELECT id, name, game_data FROM addon_marketplace WHERE status = 'approved' ORDER BY name"
    );

    console.log('\nAddons — deklarieren sie RCON, und haben sie einen Port dafuer?\n');
    let mitRcon = 0, ohnePort = 0, grossVar = 0;

    for (const a of addons) {
        const gd = alsJson(a.game_data);
        const rcon = gd?.config?.rcon;
        if (!rcon) continue;
        mitRcon++;

        const portZwecke = Object.keys(gd.ports || {});
        const portVar = rcon.port_var || '';
        const zeigtAufPort = portVar && portVar === portVar.toLowerCase();
        const hatPort = zeigtAufPort && portZwecke.includes(portVar);
        const fest = Number.isFinite(Number(rcon.port)) && Number(rcon.port) > 0;

        // Ein eigener rcon-Port ist NICHT die einzige richtige Loesung: manche
        // Spiele fahren RCON ueber den Spielport (CS2), und `resolveRcon` kann
        // das ausdruecklich. Gemeldet wird deshalb nur, was wirklich ins Leere
        // laeuft — sonst steht in der Liste ein Fehler, wo keiner ist.
        const befunde = [];
        if (!fest && !zeigtAufPort) {
            befunde.push(`port_var "${portVar}" ist eine Umgebungsvariable, kein belegter Port`);
            grossVar++;
            ohnePort++;
        } else if (!fest && !hatPort) {
            befunde.push(`port_var "${portVar}" zeigt auf einen Port, den "ports" nicht deklariert`);
            ohnePort++;
        }

        console.log(`  ${befunde.length ? '✗' : '✔'} ${String(a.id).padEnd(5)} ${a.name}`);
        console.log(`        ports: ${portZwecke.join(', ') || '—'} · port_var: ${portVar || '(fest: ' + rcon.port + ')'}`);
        befunde.forEach(b => console.log(`        → ${b}`));
    }

    console.log(`\n  ${mitRcon} Addons deklarieren RCON, ${ohnePort} davon ohne eigenen Port,`);
    console.log(`  ${grossVar} zeigen auf eine Umgebungsvariable statt auf eine Allocation.\n`);

    // ── Teil 2: die laufenden Server ─────────────────────────────────────────
    const [server] = await c.query(`
        SELECT gs.id, gs.name, gs.status, gs.bind_ip, gs.ports, gs.env_variables,
               gs.frozen_game_data, r.host AS rootserver_ip
        FROM gameservers gs
        LEFT JOIN rootserver r ON gs.rootserver_id = r.id
        ORDER BY gs.id
    `);

    console.log('Server — waere RCON von aussen erreichbar?\n');

    for (const s of server) {
        const gd    = alsJson(s.frozen_game_data, null);
        const rcon  = gd?.config?.rcon;
        if (!rcon) { console.log(`  ·  ${String(s.id).padEnd(5)} ${s.name.padEnd(24)} kein RCON deklariert`); continue; }

        const ports   = alsJson(s.ports);
        const envVars = alsJson(s.env_variables);
        const portVar = rcon.port_var || '';

        let port = Number(rcon.port) || null;
        let quelle = 'fest im Addon';
        if (!port && portVar === portVar.toLowerCase()) {
            const e = ports[portVar];
            port = e?.external ?? e?.internal ?? null;
            quelle = `Allocation "${portVar}"`;
        } else if (!port) {
            port = parseInt(envVars[portVar], 10) || null;
            quelle = `Umgebungsvariable ${portVar}`;
        }

        const belegt = Object.entries(ports).some(([, p]) =>
            String(p?.external ?? p?.internal) === String(port));

        const host = s.bind_ip || s.rootserver_ip;
        let live = null;
        if (LIVE && port && host && s.status === 'online') {
            live = await erreichbar(host, port);
        }

        const marke = belegt ? '✔' : '✗';
        console.log(`  ${marke}  ${String(s.id).padEnd(5)} ${s.name.padEnd(24)} Port ${String(port || '—').padEnd(6)} (${quelle})`);
        if (!belegt) {
            console.log(`        → dieser Port ist KEINE Allocation dieses Servers — Docker veroeffentlicht ihn nicht`);
        }
        if (live !== null) {
            console.log(`        → TCP ${host}:${port} ${live ? 'offen' : 'geschlossen'}`);
        }
    }

    console.log('');
    await c.end();
    process.exit(0);
})().catch(e => { console.error('FEHLER:', e.message); process.exit(1); });
