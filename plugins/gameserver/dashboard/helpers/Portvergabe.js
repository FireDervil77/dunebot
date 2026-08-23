'use strict';

/**
 * Portvergabe nach dem PAKET — nicht mehr nach dem Egg.
 *
 * ── Der Fehler, den das ablöst ──────────────────────────────────────────────
 *
 * Gemessen an Server 161 (2026-08-22) und noch einmal an 162 (2026-08-23):
 *
 *   gebucht aus dem Vorrat:  game 25000,  query 25002
 *   berechnet, nicht gebucht: game_plus_1 25001
 *   das Paket sagt:           query = game+1
 *
 * Valheim lauscht auf 25001. Gebucht war 25002 — ein Port, auf dem nie etwas
 * läuft. Der Start ging trotzdem gut, weil die Übergangsdatei `query` auf
 * `game_plus_1` abbildet; das Buch stimmte also nicht mit der Wirklichkeit
 * überein, und niemandem fiel es auf.
 *
 * Die Ursache ist das Egg-Modell: Dort heisst der Nachbarport `game_plus_1` und
 * ist ein eigener Eintrag, während `query` als weiterer Zweck danebensteht. Das
 * Paket kennt diese Trennung nicht — es sagt schlicht: `query` liegt bei
 * `game+1`.
 *
 * ── Die Regel hier ──────────────────────────────────────────────────────────
 *
 * **Jeder Port, den der Server benutzt, wird gebucht. Und nur die.**
 *
 * Das ist der Unterschied zum alten Weg, der Offset-Ports bewusst NICHT buchte.
 * Ein nicht gebuchter Port ist beim nächsten Server wieder frei — genau so
 * entstand die ARK-Kollision, bei der zwei Zwecke auf derselben Nummer landeten.
 */

/**
 * Liest die Portzwecke eines Pakets.
 *
 * @returns {{basis: object|null, gekoppelt: Array<{zweck,abstand,protokoll}>}}
 */
function lesePortzwecke(paket) {
    const ports = Array.isArray(paket?.ports) ? paket.ports : [];
    const basis = ports.find(p => p.assign === 'pool') || null;
    const gekoppelt = ports
        .filter(p => typeof p.assign === 'string' && p.assign.includes('+'))
        .map(p => ({
            zweck: p.purpose,
            abstand: parseInt(p.assign.split('+')[1], 10) || 0,
            protokoll: p.protocol || 'udp',
        }));
    return { basis, gekoppelt };
}

/**
 * Sucht ein freies Portpaar im Vorrat und bucht es.
 *
 * Dieselbe Regel wie in der Maschinenwahl (`baueMaschinenAuswahl`): Ein
 * gekoppelter Port muss **im Vorrat stehen und frei sein**. Wären beide Stellen
 * verschieden, würde die Auswahl eine Maschine anbieten, an der das Anlegen
 * scheitert — und der Betreiber stünde vor einem Widerspruch ohne Erklärung.
 *
 * @param {object} dbService
 * @param {number} rootserverId
 * @param {object} paket        FBPKG_v1
 * @param {number|null} wunschPort  vom Betreiber gewählter Spielport, oder null
 * @returns {Promise<{ports:object, belegt:object}>}
 * @throws {Error} mit einem Satz, der sagt, was zu tun ist
 */
async function vergibPortsAusPaket(dbService, rootserverId, paket, wunschPort = null) {
    const { basis, gekoppelt } = lesePortzwecke(paket);
    if (!basis) {
        throw new Error('Das Paket nennt keinen Spielport (kein Zweck mit assign: pool).');
    }

    const frei = await dbService.query(
        `SELECT id, port FROM port_allocations
          WHERE rootserver_id = ? AND server_id IS NULL
          ORDER BY port ASC`,
        [rootserverId]
    );
    if (!frei.length) {
        throw new Error('Für diese Maschine ist kein freier Port im Vorrat. '
                      + 'Masterserver → RootServer → Ports.');
    }

    const nachNummer = new Map(frei.map(z => [Number(z.port), z.id]));

    // Kandidaten: der Wunsch, sonst alle freien aufsteigend.
    const kandidaten = wunschPort
        ? [Number(wunschPort)]
        : frei.map(z => Number(z.port));

    let gewaehlt = null;
    for (const n of kandidaten) {
        if (!nachNummer.has(n)) continue;
        const noetig = gekoppelt.map(k => n + k.abstand);
        if (noetig.some(x => !nachNummer.has(x))) continue;
        gewaehlt = n;
        break;
    }

    if (gewaehlt === null) {
        if (wunschPort) {
            throw new Error(`Port ${wunschPort} ist nicht frei oder der benötigte Nachbarport fehlt. `
                          + (gekoppelt.length
                              ? `${paket?.identity?.name || 'Das Spiel'} verlangt zusätzlich `
                                + gekoppelt.map(k => `Port+${k.abstand}`).join(' und ') + '.'
                              : ''));
        }
        throw new Error('Kein freies Portpaar im Vorrat dieser Maschine. '
                      + (gekoppelt.length
                          ? `${paket?.identity?.name || 'Das Spiel'} verlangt `
                            + gekoppelt.map(k => 'Spielport+' + k.abstand).join(' und ')
                            + ' — und beide müssen im Vorrat stehen und frei sein.'
                          : ''));
    }

    // ── Buchen: alle benutzten Nummern, keine weitere ────────────────────────
    const ports = {};
    const belegt = {};

    const eintragen = async (zweck, nummer, protokoll) => {
        const allocId = nachNummer.get(nummer);
        await dbService.query(
            'UPDATE port_allocations SET server_id = 0, assigned_at = NOW() WHERE id = ?',
            [allocId]
        );
        ports[zweck] = { internal: nummer, external: nummer, protocol: protokoll };
        belegt[zweck] = { allocId, port: nummer };
    };

    await eintragen(basis.purpose, gewaehlt, basis.protocol || 'udp');
    for (const k of gekoppelt) {
        await eintragen(k.zweck, gewaehlt + k.abstand, k.protokoll);
    }

    return { ports, belegt };
}

module.exports = { vergibPortsAusPaket, lesePortzwecke };
