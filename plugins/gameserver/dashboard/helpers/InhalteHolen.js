'use strict';

/**
 * Einen Mod von Thunderstore auf den Server holen (E6/B.12).
 *
 * ── Ein Weg, zwei Momente ───────────────────────────────────────────────────
 *
 * Im Tab „Mods" eines laufenden Servers und beim Anlegen eines neuen ist es
 * dieselbe Arbeit: aufloesen, Zeilen schreiben, holen lassen, Zeilen
 * fortschreiben. Der Unterschied ist nur, WANN sie losläuft — beim Anlegen erst
 * nach der Grundinstallation, denn vorher gibt es kein Serververzeichnis.
 * Deshalb steht sie hier und nicht in der Route.
 *
 * ── Wer was tut ─────────────────────────────────────────────────────────────
 *
 *   Dashboard  suchen, Fassung waehlen, Abhaengigkeiten aufloesen  (Entscheidungen)
 *   Daemon     die Datei holen und ablegen                          (Arbeit)
 *
 * Der Daemon laedt selbst. Liefe die Datei durch das Dashboard, muesste sie
 * base64-kodiert durch die WebSocket-Leitung (45-MB-Grenze) — ein Mod von
 * 60 MB waere unmoeglich, obwohl die Maschine ihn in Sekunden hat.
 *
 * ⚠ Damit laedt der Daemon eine Adresse, die ihm jemand nennt. Die
 * Herkunftsliste steht deshalb auf BEIDEN Seiten (`Quellen.HERKUNFT` und
 * `inhalte_holen.go`), und `scripts/check-herkunftsliste.js` haelt sie
 * zusammen.
 *
 * ── Der Weg kennt seinen Anbieter nicht ─────────────────────────────────────
 *
 * Seit dem 2026-09-14 steht hier kein Anbietername mehr. Welcher gefragt wird,
 * entscheidet `Quellen.waehle()` aus dem Paket, und die Zeile in
 * `gameserver_content.quelle` haelt fest, woher sie kam. Was ein Anbieter
 * koennen muss, steht in `Quellen.js`.
 */

const { ServiceManager } = require('dunebot-core');
const Quellen = require('./Quellen');
const Inhalte = require('./Inhalte');

/**
 * Frist fuer einen Abruf. Grosszuegig: Der Daemon laedt und entpackt, und ein
 * Modpack von 200 MB ueber eine langsame Leitung ist kein Fehler.
 */
const FRIST_MS = 180000;

/** Der Daemon dieses Servers — ohne ihn geht nichts auf die Maschine. */
async function daemonVon(dbService, server) {
    const [zeile] = await dbService.query(
        'SELECT daemon_id FROM rootserver WHERE id = ?', [server.rootserver_id]);
    return zeile ? zeile.daemon_id : null;
}

/**
 * Ist dieses Paket der Lader des Spiels?
 *
 * Nur das Paket weiss es (`content.loader.packages.<quelle>`). Zu raten —
 * „enthaelt BepInEx im Namen" — traefe auch jeden Mod, der BepInEx im Titel
 * fuehrt, und der laege dann in der Serverwurzel statt bei den Mods.
 */
function istLader(inhalt, kennung, quelle) {
    const name = inhalt?.loader?.packages?.[quelle];
    return Boolean(name) && String(name).toLowerCase() === String(kennung).toLowerCase();
}

/**
 * Wohin gehoert dieses Paket?
 *
 * Beide Pfade sind RELATIV ZUR VOLUME-WURZEL — auch der des Laders. Wer neben
 * das Spiel legen will, schreibt `game/` selbst davor (Entscheidung des
 * Betreibers, 2026-09-12).
 *
 * Warum das wichtig ist: Das Spiel laeuft in `game/`, und ein Lader wie BepInEx
 * wird ueber Doorstop mit Pfaden RELATIV ZUM ARBEITSVERZEICHNIS geladen. Lag er
 * in der Volume-Wurzel, zeigten `./doorstop_libs` und
 * `./BepInEx/core/BepInEx.Preloader.dll` ins Leere — die Dateien lagen da, und
 * nichts lud. Am 2026-09-12 an Server 188 gemessen.
 */
/**
 * Bleibt der gewaehlte Lader, statt herabgestuft zu werden?
 *
 * Entscheidung des Betreibers (2026-09-13): **Den Lader darf man nie
 * herabstufen, wenn er gewaehlt ist.** Anlass war Server 189:
 * TeleportEverything verlangte BepInEx 5.4.2200, installiert war 5.4.2333 — und
 * der eigene Code des Mods wollte 5.4.23.3. Die Angabe war veraltet und zog den
 * Lader fuer ALLE Mods des Servers herunter.
 *
 * Gewaehlt heisst: installiert oder vorgemerkt. Eine fehlgeschlagene Zeile
 * zaehlt nicht — da liegt kein Lader, den man schuetzen koennte. Hochstufen
 * bleibt erlaubt, gleiche Fassung laeuft wie bisher.
 *
 * Vorschau und Installation fragen DIESE Funktion. Zwei Stellen mit derselben
 * Regel zeigen sonst "ersetzt", waehrend in Wahrheit nichts ersetzt wird.
 */
function laderBleibt(inhalt, paket, da, anbieter) {
    return Boolean(da)
        && istLader(inhalt, paket.kennung, anbieter.KENNUNG)
        && ['installiert', 'geplant'].includes(da.status)
        && Boolean(da.fassung)
        && anbieter.hoeher(da.fassung, paket.fassung);
}

function zielFuer(inhalt, art) {
    if (art === Inhalte.ART_LADER) return inhalt.loader?.path || '';
    return inhalt.path || '';
}

/**
 * Was wuerde installiert — mit dem, was schon da ist.
 *
 * Der Lader kommt bei Thunderstore meist als ABHAENGIGKEIT mit: Wer Jotunn
 * waehlt, bekommt BepInEx, ohne es zu wissen. Genau das soll die Vorschau
 * zeigen, bevor jemand klickt.
 */
async function vorschau({ serverId, inhalt, quelle, kennung, fassung = null }) {
    const anbieter = Quellen.fuer(quelle);
    const raum = Quellen.raumAus(inhalt, quelle);

    const { pakete, fehlend } = await anbieter.aufloesen(raum, kennung, fassung);

    let vorhanden = new Map();
    if (serverId) {
        const liste = await Inhalte.fuerServer(serverId);
        // Verglichen wird NUR innerhalb derselben Quelle: `essentialsx` bei
        // Modrinth und `essentialsx` bei einem anderen Anbieter waeren zwei
        // Dinge, und „schon da" waere dann eine Verwechslung.
        for (const z of [liste.lader, ...liste.mods].filter(Boolean)) {
            if (z.quelle === quelle) vorhanden.set(z.kennung, z);
        }
    }

    return {
        quelle,
        fehlend,
        pakete: pakete.map(p => {
            const art = istLader(inhalt, p.kennung, quelle) ? Inhalte.ART_LADER : Inhalte.ART_MOD;
            const da = vorhanden.get(p.kennung) || null;
            return {
                kennung: p.kennung, name: p.name, fassung: p.fassung, bytes: p.bytes, art,
                schonDa: Boolean(da),
                schonFassung: da ? da.fassung : null,
                bleibt: laderBleibt(inhalt, p, da, anbieter),
                // Vorschlag A: der Verdacht gehoert VOR die Installation. Der
                // Vergleich mit dem Spielstand passiert in der Karte — sie hat
                // beides, den Ladestand und diese Liste.
                veroeffentlicht: p.veroeffentlicht || null,
                // Was nur manche Anbieter wissen — Modrinth nennt beides je
                // Fassung, Thunderstore gar nicht. Fehlt es, fehlt es; erfunden
                // wird nichts.
                spielfassungen: p.spielfassungen || null,
            };
        }),
    };
}

/**
 * Die aufgeloesten Pakete wirklich ablegen.
 *
 * **Die Zeile wird VOR dem Abruf geschrieben** (`geplant`) und danach
 * fortgeschrieben. Bricht der Daemon mittendrin ab, steht die Absicht trotzdem
 * da — sonst waere ein halb installierter Mod ein Zustand ohne Spur.
 *
 * @private
 */
async function legeAb({ server, inhalt, guildId, quelle, pakete, fehlend = [] }) {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    const ipmServer = ServiceManager.get('ipmServer');

    const anbieter = Quellen.fuer(quelle);
    const daemonId = await daemonVon(dbService, server);
    if (!daemonId) throw new Error('Kein Daemon zugewiesen');
    if (!ipmServer?.isDaemonOnline(daemonId)) throw new Error('Daemon ist offline');

    const ergebnis = {
        installiert: [], fehlgeschlagen: [], fehlend, beibehalten: [], aufgeraeumt: [],
        neustartNoetig: inhalt.needs_restart !== false,
    };

    // ── Liegt schon eine ANDERE Fassung da? ─────────────────────────────────
    //
    // Gemessen am 2026-09-13 an Server 189: Ein Mod verlangte BepInEx 5.4.2200,
    // installiert war 5.4.2333. `Inhalte.eintragen` schreibt per
    // ON DUPLICATE KEY UPDATE die neue Dateiliste ueber die alte — die Dateien
    // der alten Fassung bleiben liegen und stehen danach in KEINER Liste mehr.
    // Fuenf Waisen blieben so zurueck, darunter `.doorstop_version`, die den
    // Lader faelschlich als Doorstop 4 auswies, obwohl Doorstop 3 installiert
    // war. Genau daran laesst sich der Fehler dann nicht mehr erkennen.
    //
    // ── Hier und NUR hier wird aufgeraeumt (Betreiber, 2026-09-14) ──────────
    //
    // Bis zum 2026-09-14 tat `aktualisiere` es noch einmal selbst, vor dem
    // Aufruf: zwei Wege fuer dieselbe Sache, belegt im Log vom 13.09. (dieselbe
    // Zeile „111 alte Datei(en) entfernt" zweimal). Der aeltere Weg ist der
    // raus, weil er nur den Knopf „Aktualisieren" kennt. Eine Fassung wechselt
    // aber auch ueber Abhaengigkeiten — XPortal 1.2.24 verlangt Jotunn 2.27.1,
    // waehrend 2.30.0 liegt — und diesen Weg deckt nur diese Stelle ab.
    // Was entfernt wurde, steht in `ergebnis.aufgeraeumt`; `aktualisiere`
    // meldet es von dort weiter, statt es selbst zu tun.
    const vorhanden = new Map();
    {
        const { lader, mods } = await Inhalte.fuerServer(server.id);
        for (const z of [lader, ...mods]) if (z && z.quelle === quelle) vorhanden.set(z.kennung, z);
    }

    for (let i = 0; i < pakete.length; i++) {
        const p = pakete[i];
        const art = istLader(inhalt, p.kennung, quelle) ? Inhalte.ART_LADER : Inhalte.ART_MOD;

        // Der gewaehlte Lader wird nie herabgestuft (siehe laderBleibt). Die
        // Zeile bleibt unberuehrt — auch nicht auf "geplant" umgeschrieben,
        // sonst stuende dort kurz die niedrigere Fassung.
        const schon = vorhanden.get(p.kennung);
        if (laderBleibt(inhalt, p, schon, anbieter)) {
            ergebnis.beibehalten.push({ kennung: p.kennung, fassung: schon.fassung, verlangt: p.fassung });
            Logger.info(`[Gameserver/Inhalte] ${p.kennung} ${schon.fassung} bleibt auf Server ${server.id} `
                + `— verlangt war ${p.fassung}, der Lader wird nicht herabgestuft`);
            continue;
        }

        const grundzeile = {
            serverId: server.id, guildId, art, quelle,
            kennung: p.kennung, name: p.name, fassung: p.fassung,
            // Der Erscheinungstag gehoert an JEDE Zeile, auch an die geplante
            // und die fehlgeschlagene: `eintragen` schreibt per ON DUPLICATE
            // KEY UPDATE alle Felder, und was hier fehlt, loescht den Wert der
            // vorigen Runde.
            veroeffentlicht: p.veroeffentlicht || null,
            reihenfolge: i,
            // Sagt der Anbieter es je MOD, gilt seine Angabe; sonst die des
            // Pakets. Modrinth fuehrt `client_side` je Projekt, Thunderstore
            // nicht — und „alle Mods dieses Spiels brauchen die Mitspieler
            // auch" ist die gröbere Auskunft von beiden.
            clientSide: typeof p.clientSeitig === 'boolean'
                ? p.clientSeitig : Boolean(inhalt.client_side),
        };

        if (art === Inhalte.ART_MOD && !inhalt.path) {
            // Kein Ablageort im Paket: Raten waere hier der teure Fehler.
            await Inhalte.eintragen({ ...grundzeile, status: 'fehlgeschlagen',
                fehler: 'Das Paket nennt keinen Ablageort fuer Mods (content.path)' });
            ergebnis.fehlgeschlagen.push({ kennung: p.kennung,
                fehler: 'Das Paket nennt keinen Ablageort fuer Mods (content.path)' });
            continue;
        }

        // Aufraeumen VOR dem Umschreiben der Zeile: Der Schritt auf "geplant"
        // setzt `dateien` auf NULL. Danach waere die Liste der alten Fassung
        // nur noch in einer Kopie im Speicher — und wer sich darauf verlaesst,
        // baut auf das Kopierverhalten des Treibers statt auf die Reihenfolge.
        const alt = vorhanden.get(p.kennung);
        if (alt && alt.status === 'installiert' && alt.fassung && alt.fassung !== p.fassung) {
            const weg = await entferneDateien({ server, zeile: alt, inhalt });
            ergebnis.aufgeraeumt.push({ kennung: p.kennung,
                vorher: alt.fassung, nachher: p.fassung, ...weg });
            Logger.info(`[Gameserver/Inhalte] ${p.kennung}: ${alt.fassung} → ${p.fassung}, `
                + `${weg.bestaetigt} von ${weg.gesamt} Datei(en) der alten Fassung bestaetigt weg`
                + (weg.blieb.length ? `, ${weg.blieb.length} blieben liegen` : '')
                + (weg.ohneListe ? ' (alte Zeile ohne Dateiliste — nichts zu entfernen)' : ''));
        }

        await Inhalte.eintragen({ ...grundzeile, status: 'geplant' });

        const ziel = zielFuer(inhalt, art);
        const antwort = await ipmServer.sendCommand(daemonId, 'gameserver.content.fetch', {
            server_id:     String(server.id),
            rootserver_id: String(server.rootserver_id),
            install_path:  server.install_path,
            ziel,
            adresse:       p.adresse,
            dateiname:     `${p.kennung}-${p.fassung}.zip`,
            entpacken:     true,
        }, FRIST_MS).catch(fehler => ({ success: false, error: fehler.message }));

        if (!antwort?.success) {
            const fehler = antwort?.error || 'Der Daemon hat nicht geantwortet';
            Logger.warn(`[Gameserver/Inhalte] ${p.kennung} ${p.fassung} nicht geholt: ${fehler}`);
            await Inhalte.eintragen({ ...grundzeile, status: 'fehlgeschlagen', fehler });
            ergebnis.fehlgeschlagen.push({ kennung: p.kennung, fassung: p.fassung, fehler });
            continue;
        }

        const dateien = antwort.data?.dateien || [];
        await Inhalte.eintragen({
            ...grundzeile,
            status: 'installiert',
            // `ablage` ist die Anzeige, `dateien` die Wahrheit fuers Entfernen.
            ablage: dateien.length === 1 ? dateien[0] : (ziel || '.'),
            dateien,
        });
        Logger.info(`[Gameserver/Inhalte] ${p.kennung} ${p.fassung} auf Server ${server.id}: `
            + `${dateien.length} Datei(en)`);
        ergebnis.installiert.push({ kennung: p.kennung, fassung: p.fassung,
            art, dateien: dateien.length });
    }

    return ergebnis;
}

/**
 * Ein Paket samt Abhaengigkeiten installieren.
 *
 * @param {{server: object, inhalt: object, guildId: string, quelle?: string,
 *          kennung: string, fassung?: string}} auftrag
 */
async function installiere({ server, inhalt, guildId, quelle, kennung, fassung = null }) {
    if (!inhalt?.supported) {
        throw new Error('Dieses Spiel nimmt laut seinem Paket keine Inhalte auf.');
    }
    const gewaehlt = Quellen.waehle(inhalt, quelle);
    if (!gewaehlt) {
        throw new Error(quelle
            ? `Das Paket nennt ${quelle} nicht als Quelle.`
            : 'Das Paket nennt keine Quelle, aus der sich Inhalte holen lassen.');
    }
    const anbieter = Quellen.fuer(gewaehlt);
    const raum = Quellen.raumAus(inhalt, gewaehlt);

    const { pakete, fehlend } = await anbieter.aufloesen(raum, kennung, fassung);
    return legeAb({ server, inhalt, guildId, quelle: gewaehlt, pakete, fehlend });
}

/**
 * Die beim Anlegen vorgemerkten Mods holen — nach der Grundinstallation.
 *
 * Schlaegt einer fehl, steht seine Zeile auf `fehlgeschlagen` und die anderen
 * laufen weiter: Ein Mod, den Thunderstore gerade nicht ausliefert, darf keine
 * Serveranlage kaputtmachen.
 *
 * @returns {Promise<object|null>} null, wenn nichts vorgemerkt war
 */
async function holeGeplante({ server, inhalt, guildId }) {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');

    // Jede Zeile bringt ihre Quelle mit. Gefragt wird nach den Anbietern, die
    // es gibt — eine hochgeladene Datei ist nicht „vorgemerkt", die liegt schon.
    const namen = Object.keys(Quellen.ANBIETER);
    const zeilen = await dbService.query(
        `SELECT id, kennung, fassung, quelle FROM gameserver_content
          WHERE server_id = ? AND quelle IN (${namen.map(() => '?').join(', ')})
            AND status = 'geplant'
          ORDER BY reihenfolge ASC, id ASC`,
        [server.id, ...namen]
    );
    if (!zeilen || !zeilen.length) return null;

    Logger.info(`[Gameserver/Inhalte] Server ${server.id}: ${zeilen.length} vorgemerkte(r) Mod(s)`);

    const gesamt = { installiert: [], fehlgeschlagen: [], fehlend: [], beibehalten: [],
                     aufgeraeumt: [], neustartNoetig: false };
    for (const zeile of zeilen) {
        try {
            const e = await installiere({ server, inhalt, guildId, quelle: zeile.quelle,
                kennung: zeile.kennung, fassung: zeile.fassung });
            gesamt.installiert.push(...e.installiert);
            gesamt.fehlgeschlagen.push(...e.fehlgeschlagen);
            gesamt.fehlend.push(...e.fehlend);
            gesamt.beibehalten.push(...(e.beibehalten || []));
            gesamt.aufgeraeumt.push(...(e.aufgeraeumt || []));
            gesamt.neustartNoetig = gesamt.neustartNoetig || e.neustartNoetig;
        } catch (fehler) {
            // Die Zeile traegt den Grund, nicht nur das Log: Wer den Server
            // spaeter aufmacht, soll sehen, warum der Mod fehlt.
            Logger.warn(`[Gameserver/Inhalte] ${zeile.kennung} nicht installierbar: ${fehler.message}`);
            await dbService.query(
                "UPDATE gameserver_content SET status = 'fehlgeschlagen', fehler = ? WHERE id = ?",
                [fehler.message, zeile.id]
            );
            gesamt.fehlgeschlagen.push({ kennung: zeile.kennung, fehler: fehler.message });
        }
    }
    return gesamt;
}

/**
 * Die Dateien einer Zeile vom Server nehmen.
 *
 * Nur die aufgehobene Liste, keine Ordner: `ablage` traegt bei einem Mod aus
 * mehreren Dateien den ZIELORDNER (`BepInEx/plugins`), und den zu loeschen
 * naehme alle Mods mit. Hat eine alte Zeile keine Liste, wird nichts geloescht
 * und das gesagt.
 *
 * ── `bestaetigt` heisst „ist weg", nicht „war da" (gemessen 2026-09-14) ────
 *
 * Der Daemon antwortet auf einen Loeschauftrag fuer eine Datei, die es gar
 * nicht gibt, mit Erfolg: `HandleFileDelete` ruft `os.RemoveAll`
 * (`internal/gameserver/files.go`), und das gibt bei einem fehlenden Pfad
 * `nil` zurueck — in Go nachgestellt; die Pfadpruefung davor fragt nicht nach
 * Existenz. Das ist fuer die HANDLUNG richtig so: „weg damit" darf beliebig oft
 * laufen. Fuer die MELDUNG ist es eine Falle, und sie ist einmal zugeschnappt —
 * der doppelte Aufraeumlauf vom 13.09. meldete beim zweiten Mal dieselben 111
 * Dateien wie beim ersten und war im Log nicht von einem echten zu
 * unterscheiden.
 *
 * Deshalb heisst die Zahl hier `bestaetigt` und nicht `weg`: Sie sagt, fuer wie
 * viele Pfade der Server bestaetigt hat, dass dort nichts mehr liegt — ob wir
 * sie geloescht haben oder ob sie schon fehlten, sagt sie NICHT. Die Gegenzahl
 * `blieb` ist dagegen hart: Diese Pfade liegen sicher noch da.
 *
 * @returns {Promise<{bestaetigt: number, gesamt: number, blieb: string[], ohneListe: boolean}>}
 */
async function entferneDateien({ server, zeile, inhalt = null }) {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    const ipmServer = ServiceManager.get('ipmServer');

    let dateien = Inhalte.dateienAus(zeile);
    if (!dateien.length) {
        // Zeilen von vor dem 2026-09-11 haben keine Liste. Aus `ablage` laesst
        // sich nur eine EINZELNE Datei sicher ableiten — steht dort der
        // Zielordner (`BepInEx/plugins`), naehme ein Loeschen alle Mods mit.
        const ablage = String(zeile.ablage || '').replace(/^\/+/, '');
        const einzeln = ablage && ablage !== (inhalt?.path || '')
            && /\.[A-Za-z0-9]{1,8}$/.test(ablage);
        if (!einzeln) return { bestaetigt: 0, gesamt: 0, blieb: [], ohneListe: true };
        dateien = [ablage];
    }

    const daemonId = await daemonVon(dbService, server);
    if (!daemonId || !ipmServer?.isDaemonOnline(daemonId)) {
        return { bestaetigt: 0, gesamt: dateien.length, blieb: dateien, ohneListe: false };
    }

    let bestaetigt = 0;
    const blieb = [];
    for (const datei of dateien) {
        const antwort = await ipmServer.sendCommand(daemonId, 'gameserver.files.delete', {
            server_id:     String(server.id),
            rootserver_id: String(server.rootserver_id),
            install_path:  server.install_path,
            path:          '/' + String(datei).replace(/^\/+/, ''),
        }, 30000).catch(fehler => ({ success: false, error: fehler.message }));

        if (antwort?.success) bestaetigt++;
        else {
            blieb.push(datei);
            Logger.warn(`[Gameserver/Inhalte] Datei blieb liegen (${datei}): `
                + `${antwort?.error || 'keine Antwort'}`);
        }
    }
    return { bestaetigt, gesamt: dateien.length, blieb, ohneListe: false };
}

/**
 * Auf die neueste Fassung bringen.
 *
 * **Erst die alten Dateien weg, dann die neuen holen.** Eine umbenannte DLL
 * bliebe sonst liegen, der Lader faende beide Fassungen — und der Fehler zeigt
 * sich erst im Spiel. Getan wird das in `legeAb` (siehe dort), nicht hier:
 * Seit dem 2026-09-14 gibt es dafuer genau EINEN Weg, und der ist der, den
 * auch eine Abhaengigkeit nimmt. Hier wird nur weitergemeldet, was dort
 * geschah.
 *
 * @returns {Promise<object>} wie `installiere`, zusaetzlich `vorher`/`nachher`
 */
async function aktualisiere({ server, inhalt, guildId, zeile }) {
    // Aktualisiert wird bei DEM Anbieter, von dem die Zeile kam — nicht bei dem,
    // den das Paket zuerst nennt. Ein Mod wandert nicht die Quelle.
    const anbieter = Quellen.fuer(zeile.quelle);
    const raum = Quellen.raumAus(inhalt, zeile.quelle);

    // Die alte Fassung wird JETZT festgehalten, nicht am Ende abgelesen:
    // Zwischen hier und der Rueckgabe schreibt `legeAb` dieselbe Zeile fort.
    // Wer sie danach noch einmal liest, meldet „2.30.0 → 2.30.0".
    const vorher = zeile.fassung;

    const neuestes = await anbieter.paket(raum, zeile.kennung);
    if (!anbieter.neuerAls(neuestes, zeile)) {
        return { geaendert: false, vorher, nachher: neuestes.fassung,
                 installiert: [], fehlgeschlagen: [], fehlend: [] };
    }

    const ergebnis = await installiere({ server, inhalt, guildId,
        quelle: zeile.quelle, kennung: zeile.kennung });

    // Aufgeraeumt hat `legeAb` — hier wird der Eintrag DIESES Mods gesucht.
    // Ein leerer Eintrag heisst: Es gab nichts zu entfernen (gleiche Fassung
    // oder Zeile ohne Dateiliste), nicht „es wurde vergessen".
    const weg = (ergebnis.aufgeraeumt || []).find(a => a.kennung === zeile.kennung)
        || { bestaetigt: 0, gesamt: 0, blieb: [], ohneListe: false };

    return {
        ...ergebnis,
        geaendert: true,
        vorher,
        nachher: neuestes.fassung,
        alteDateienBestaetigtWeg: weg.bestaetigt,
        alteDateienBlieben: weg.blieb,
        ohneListe: weg.ohneListe,
    };
}

module.exports = {
    daemonVon, istLader,
    vorschau, installiere, holeGeplante, aktualisiere, entferneDateien,
};
