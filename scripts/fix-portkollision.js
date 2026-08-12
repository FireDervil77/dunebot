#!/usr/bin/env node
/**
 * Findet Server, bei denen ein Offset-Port und ein Pool-Port auf derselben
 * Nummer liegen — und raeumt sie auf Wunsch weg.
 *
 * Hintergrund: Spiele wie ARK belegen neben dem Spielport zwingend
 * `Spielport + N` fuer den Rohdaten-Socket (`game_plus_N`). Dieser Port wird
 * berechnet und verbraucht keinen Eintrag im Allocation-Pool. Die
 * sequenzielle Vergabe der uebrigen Ports (`query`, `rcon`, …) wusste davon
 * nichts und gab dieselbe Nummer ein zweites Mal aus.
 *
 * Folge bei ARK-Server 160: `query` und `game_plus_1` lagen beide auf 7001.
 * Steam-Abfrage und Spieldaten auf einem Port — der Beitritt lief in die
 * Zeitueberschreitung, im Client kam eine Verbindungsfehlermeldung.
 *
 * Ob es auftritt, haengt vom Zustand des Pools ab: Beim Vorgaenger 159 lag der
 * Query-Port zufaellig *unter* dem Spielport und kollidierte nicht. Deshalb
 * sucht dieses Skript nach dem Muster statt nach einem bekannten Server.
 *
 * Die Vergabe selbst ist repariert (routes/servers.js). Hier geht es nur um
 * die Server, die vorher angelegt wurden.
 *
 * Wirksam wird eine Aenderung beim naechsten **Containerstart** — die Ports
 * werden dort aus der Datenbank ins Payload gelegt. Ein laufender Server wird
 * nicht angefasst.
 *
 *   node scripts/fix-portkollision.js           # nur zeigen (Vorgabe)
 *   node scripts/fix-portkollision.js --apply   # wirklich aendern
 */

'use strict';

require('dotenv').config({ path: __dirname + '/../apps/dashboard/.env' });
const mysql = require('mysql2/promise');

const ANWENDEN = process.argv.includes('--apply');

/** Der Umgebungsname zu einem Port-Typ, so wie ihn die Addons schreiben. */
const ENV_NAME = { query: 'QUERY_PORT', rcon: 'RCON_PORT', game: 'SERVER_PORT' };

function alsObjekt(wert) {
    if (!wert) return null;
    return typeof wert === 'string' ? JSON.parse(wert) : wert;
}

function portNummer(eintrag) {
    return eintrag?.internal ?? eintrag?.external ?? null;
}

/**
 * Sucht die Kollisionen eines Servers.
 *
 * Ein Offset-Port (`x_plus_n`) darf nie dieselbe Nummer tragen wie ein
 * gewoehnlicher Port — der Offset gehoert dem Spiel, der andere dem Pool.
 *
 * @returns {Array<{offsetTyp: string, poolTyp: string, nummer: number}>}
 */
function findeKollisionen(ports) {
    const offsets = [];
    const normale = [];

    for (const [typ, daten] of Object.entries(ports)) {
        const nummer = portNummer(daten);
        if (nummer === null) continue;
        (/^(.+)_plus_(\d+)$/.test(typ) ? offsets : normale).push({ typ, nummer });
    }

    const treffer = [];
    for (const o of offsets) {
        for (const n of normale) {
            if (o.nummer === n.nummer) {
                treffer.push({ offsetTyp: o.typ, poolTyp: n.typ, nummer: o.nummer });
            }
        }
    }
    return treffer;
}

(async () => {
    const db = await mysql.createConnection({
        host: process.env.MYSQL_HOST,
        port: process.env.MYSQL_PORT,
        user: process.env.MYSQL_USER,
        password: process.env.MYSQL_PASSWORD,
        database: process.env.MYSQL_DATABASE,
    });

    const server = await db.query(
        'SELECT id, name, rootserver_id, ports, env_variables FROM gameservers WHERE ports IS NOT NULL'
    ).then(([r]) => r);

    let betroffen = 0;
    let geaendert = 0;

    for (const s of server) {
        let ports, env;
        try {
            ports = alsObjekt(s.ports) || {};
            env = alsObjekt(s.env_variables) || {};
        } catch (err) {
            console.log(`⚠️  Server ${s.id} (${s.name}): ports/env nicht lesbar — ${err.message}`);
            continue;
        }

        const kollisionen = findeKollisionen(ports);
        if (!kollisionen.length) continue;

        betroffen++;
        console.log(`\n── Server ${s.id} — ${s.name}`);
        for (const k of kollisionen) {
            console.log(`   ${k.offsetTyp} und ${k.poolTyp} liegen beide auf ${k.nummer}`);
        }

        // Der Offset-Port gewinnt: den nimmt sich das Spiel selbst, daran
        // laesst sich nichts drehen. Der Pool-Port zieht um.
        for (const k of kollisionen) {
            const belegt = new Set(
                Object.values(ports).map(portNummer).filter(n => n !== null)
            );

            const [frei] = await db.query(
                `SELECT id, port FROM port_allocations
                 WHERE rootserver_id = ? AND server_id IS NULL
                   AND port NOT IN (${[...belegt].map(() => '?').join(',')})
                 ORDER BY port ASC LIMIT 1`,
                [s.rootserver_id, ...belegt]
            ).then(([r]) => r);

            if (!frei) {
                console.log(`   ✗ kein freier Port im Pool für '${k.poolTyp}' — übersprungen`);
                continue;
            }

            console.log(`   → ${k.poolTyp}: ${k.nummer} → ${frei.port}`
                + (ENV_NAME[k.poolTyp] ? `  (${ENV_NAME[k.poolTyp]} zieht mit)` : ''));

            if (!ANWENDEN) continue;

            ports[k.poolTyp].internal = frei.port;
            ports[k.poolTyp].external = frei.port;
            if (ENV_NAME[k.poolTyp] && env[ENV_NAME[k.poolTyp]] !== undefined) {
                env[ENV_NAME[k.poolTyp]] = String(frei.port);
            }

            await db.beginTransaction();
            try {
                await db.query(
                    'UPDATE gameservers SET ports = ?, env_variables = ? WHERE id = ?',
                    [JSON.stringify(ports), JSON.stringify(env), s.id]
                );
                await db.query(
                    'UPDATE port_allocations SET server_id = ?, assigned_at = NOW() WHERE id = ?',
                    [s.id, frei.id]
                );
                await db.commit();
                geaendert++;
            } catch (err) {
                await db.rollback();
                console.log(`   ✗ zurückgerollt: ${err.message}`);
            }
        }
    }

    console.log(`\n${server.length} Server geprüft, ${betroffen} betroffen.`);
    if (!ANWENDEN) {
        console.log('Nur angesehen. Mit --apply wird geändert.');
    } else {
        console.log(`${geaendert} Port(s) umgezogen. Wirksam beim nächsten Containerstart.`);
    }

    await db.end();
})().catch(err => { console.error('FEHLER:', err.message); process.exit(1); });
