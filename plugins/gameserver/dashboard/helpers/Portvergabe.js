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

    // ── Warum hier ALLE Pool-Zwecke stehen (Befund vom 2026-09-22) ──────────
    //
    // Bis heute nahm diese Funktion `ports.find(p => p.assign === 'pool')` —
    // also GENAU EINEN. Alles Weitere musste die Form `game+N` haben.
    //
    // Das ging gut, solange jedes Paket so gebaut war: Valheim und Astro Colony
    // nennen `game(pool)` und `query(game+1)`. **Minecraft nennt zwei
    // unabhaengige Pool-Ports — `game` und `rcon` — und der zweite fiel auf den
    // Boden.** Gebucht wurde nur der Spielport.
    //
    // Die Folge sah der Betreiber als „rcon port problem": Der Daemon meldet
    // „die Fernsteuerung soll auf 'rcon' laufen, fuer diesen Server ist aber
    // kein solcher Port belegt", und in `server.properties` landet
    // `rcon.port={{port:rcon}}` als Text, weil es keine Nummer einzusetzen gibt.
    //
    // Ein gekoppelter Port ist etwas anderes als ein zweiter Pool-Port, und
    // beides gibt es: `query` MUSS neben dem Spielport liegen (das Spiel
    // rechnet es sich aus), `rcon` darf irgendwo liegen (es steht in einer
    // Datei). Deshalb zwei Listen statt einer.
    const ausPool = ports.filter(p => p.assign === 'pool');
    const basis = ausPool[0] || null;
    const weiterePool = ausPool.slice(1).map(p => ({
        zweck: p.purpose,
        // Anders als beim Spielport ist tcp die richtige Vorgabe: Was frei
        // liegen darf, ist in aller Regel eine Fernsteuerung.
        protokoll: p.protocol || 'tcp',
    }));
    const gekoppelt = ports
        .filter(p => typeof p.assign === 'string' && p.assign.includes('+'))
        .map(p => ({
            zweck: p.purpose,
            abstand: parseInt(p.assign.split('+')[1], 10) || 0,
            protokoll: p.protocol || 'udp',
        }));
    return { basis, weiterePool, gekoppelt };
}

/**
 * Wie viele Ports braucht dieses Paket insgesamt?
 *
 * Eine Zahl, zwei Leser: die Maschinenwahl (reicht der Vorrat?) und die Vergabe
 * (ist noch genug frei?). Bis zum 2026-09-22 rechneten beide selbst — und beide
 * falsch, auf dieselbe Weise.
 */
function portBedarf(paket) {
    const { basis, weiterePool, gekoppelt } = lesePortzwecke(paket);
    return (basis ? 1 : 0) + weiterePool.length + gekoppelt.length;
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
    const { basis, weiterePool, gekoppelt } = lesePortzwecke(paket);
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
        // Die weiteren Pool-Ports duerfen irgendwo liegen — aber sie muessen DA
        // sein. Ohne diese Zaehlung bekaeme der Server einen Spielport und
        // danach die Absage „kein solcher Port belegt" erst beim Start.
        const belegtDurchPaar = new Set([n, ...noetig]);
        const restFrei = frei.filter(z => !belegtDurchPaar.has(Number(z.port))).length;
        if (restFrei < weiterePool.length) continue;
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
        // Der Satz muss sagen, WAS fehlt. „Kein freies Portpaar" allein liess den
        // Betreiber am 2026-09-22 raten, warum ein Vorrat mit freien Ports nicht
        // reichte — es fehlte der zweite, unabhaengige.
        const verlangt = [
            ...gekoppelt.map(k => 'Spielport+' + k.abstand),
            ...weiterePool.map(w => `einen weiteren freien Port für „${w.zweck}"`),
        ];
        throw new Error('Nicht genug freie Ports im Vorrat dieser Maschine. '
                      + (verlangt.length
                          ? `${paket?.identity?.name || 'Das Spiel'} verlangt `
                            + verlangt.join(' und ')
                            + '. Gekoppelte Ports müssen im Vorrat stehen und frei sein.'
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
    // Und die unabhaengigen: die naechsten freien, die nicht schon zum Paar
    // gehoeren. Aufsteigend, damit die Vergabe nachvollziehbar bleibt.
    if (weiterePool.length) {
        const schonBelegt = new Set(Object.values(belegt).map(b => b.port));
        const uebrig = frei.map(z => Number(z.port)).filter(n => !schonBelegt.has(n));
        for (const w of weiterePool) {
            const nummer = uebrig.shift();
            if (nummer === undefined) {
                // Kann nach der Zaehlung oben nicht mehr passieren — bliebe es
                // stumm, waere der Server halb gebucht.
                throw new Error(`Für „${w.zweck}" ist kein freier Port mehr im Vorrat dieser Maschine.`);
            }
            await eintragen(w.zweck, nummer, w.protokoll);
        }
    }

    return { ports, belegt };
}

module.exports = { vergibPortsAusPaket, lesePortzwecke, portBedarf };
