/**
 * StartPayload – die Aufträge des Dashboards an den Daemon: Start, Neustart,
 * Installation, und die Werte eines neuen Servers.
 *
 * ── Eine Quelle: das Paket (Vertrag V2, entschieden 2026-08-15) ─────────────
 *
 * Das Dashboard schickt Paket, Werte und Zuteilung; der Daemon setzt selbst
 * zusammen. Bis zum 2026-09-10 baute diese Datei die Nutzlast aus
 * `frozen_game_data`, `launch_params` und `env_variables` — dem Egg — und legte
 * das Paket obendrauf. Ohne Egg-Image brach der Start ab, obwohl das Paket eines
 * hatte; fehlte ein Wert, hieß es „der alte Weg bleibt", den es im Daemon seit
 * Stufe 4.2 gar nicht mehr gab. Und `install_image` kam aus den Egg-Skripten
 * (UpdateOptions.js): Jedes Auto-Update lief so in
 * `ghcr.io/parkervcp/installers:debian`.
 *
 * Betreiber am 2026-09-10: „wir brauchen keine rückfall lösung auf ein fremdes
 * system." Fehlt das Paket oder ein Wert, der eine Welt kostet, gibt es keinen
 * Auftrag, sondern einen Fehler, der sagt, was fehlt.
 *
 * Start und Neustart (Knopf, Discord, Cronjob) und alle Installationswege
 * (Anlegen, Discord, Erneut versuchen, Neuinstallieren, Wiederanstoß) bauen
 * hier — sonst driften sie auseinander, wie es beim Neustart schon zweimal
 * passiert ist.
 *
 * @module helpers/StartPayload
 * @author FireBot Team
 */

'use strict';

const crypto = require('crypto');
const { loeseInhaltAuf } = require('./InhaltJeLader');
const { FASSUNG_FUER_SERVER, ladePaketFuerServer, ladePaketFuerAnlegen } = require('./Paketfassung');

/**
 * Die Image-Adresse aus dem Paket — gepinnt, wenn möglich.
 *
 * Dieselbe Regel wie im Daemon (rezept.ImageAus): Bevorzugt wird der **Digest**
 * (`ref@sha256:…`). Ein Tag kann wandern, ein Digest nicht.
 *
 * @param {object} paket
 * @returns {string|null}
 */
function imageAusPaket(paket) {
    const img = paket?.image;
    if (!img?.ref) return null;
    if (img.digest) return `${img.ref}@${img.digest}`;
    if (img.tag)    return `${img.ref}:${img.tag}`;
    return img.ref;
}

/** @private */
function parseJson(value, fallback) {
    if (value == null) return fallback;
    if (typeof value !== 'string') return value;
    try {
        return JSON.parse(value);
    } catch {
        return fallback;
    }
}

/**
 * Ja/Nein, wie Formulare und Pakete es schreiben: `1`, `true`, `on`, `yes`.
 *
 * @param {*} wert
 * @returns {boolean}
 */
function istWahr(wert) {
    if (wert === true) return true;
    if (wert === false || wert === null || wert === undefined) return false;
    const v = String(wert).trim().toLowerCase();
    return v === '1' || v === 'true' || v === 'on' || v === 'yes';
}

/**
 * Wird vor dem Start aktualisiert? Die Paketeinstellung `auto_update`
 * entscheidet.
 *
 * ── Zwei Schalter, eine Wahrheit ────────────────────────────────────────────
 *
 * Bis zum 2026-09-10 gab es zwei: die Spalte `gameservers.auto_update` (die
 * alte Bearbeitungsseite) und die Paketeinstellung „Automatisch aktualisieren"
 * auf der Einstellungskarte. Wirksam war nur die Spalte — bei Server 186 stand
 * die Karte auf „an", die Spalte auf 0, und es wurde nie aktualisiert. Jetzt
 * gilt die Einstellung, die man sieht. Kennt ein Paket sie nicht, gibt es kein
 * Auto-Update.
 *
 * @param {object} paket
 * @param {object} werte  paket_werte des Servers
 * @returns {boolean}
 */
function autoUpdateAus(paket, werte) {
    const eintrag = (paket?.settings || []).find(e => e.key === 'auto_update');
    if (!eintrag) return false;
    const wert = werte && Object.prototype.hasOwnProperty.call(werte, 'auto_update')
        ? werte.auto_update : eintrag.default;
    return istWahr(wert);
}

/**
 * Die Werte für den Daemon: je Einstellung des Pakets der gespeicherte Wert,
 * als Text. Fehlt einer, geht er nicht mit — der Daemon nimmt die Vorgabe des
 * Pakets und meldet die Lücke.
 *
 * Außer bei Einstellungen, deren Vorgabe einen Weltstand kostet (`risk:
 * progress` oder `world_reset`): Valheim erzeugt bei unbekanntem Weltnamen eine
 * neue, LEERE Welt. Die werden als `gefaehrlich` gemeldet, und der Aufrufer
 * verweigert den Auftrag.
 *
 * @returns {{settings: object, gefaehrlich: string[]}}
 * @private
 */
function werteFuerDaemon(paket, werte) {
    const settings = {};
    const gefaehrlich = [];
    for (const eintrag of paket.settings || []) {
        const wert = werte ? werte[eintrag.key] : undefined;
        // Ein leerer Text ist ein WERT (beta_branch "" heisst „kein Beta-Zweig").
        if (wert === undefined || wert === null) {
            if (eintrag.risk === 'progress' || eintrag.risk === 'world_reset') {
                gefaehrlich.push(eintrag.key);
                continue;
            }
            // ── Die Vorgabe des Pakets gilt (2026-09-20) ────────────────────
            //
            // Hier stand bis dahin nur `continue` — die Einstellung wurde
            // still weggelassen, und der Daemon setzt KEINE Vorgabe ein
            // (`holeWert` meldet schlicht „fehlt", das Argument entfaellt).
            // Damit wirkte `default` im Paket beim Start ueberhaupt nicht; es
            // war nur Vorbelegung im Formular.
            //
            // **Das Panel zeigt die Vorgabe aber an.** Wer sie dort liest,
            // glaubt, sie gelte — und sie galt nicht. Das ist der Unterschied
            // zwischen einer Luecke und einer Luege in der Oberflaeche.
            //
            // Gefunden an Server 186 (Valheim, 2026-09-20): Er wurde am 18.08.
            // mit Paketfassung 1.0.0 angelegt. `mod_verwalten` kam spaeter
            // dazu und stand deshalb NIE in seinen Werten — also kam
            // `-resetmodifiers` nie an, waehrend `-modifier deathpenalty
            // veryeasy` bei jedem Start mitging. Valheim schreibt
            // Modifikatoren dauerhaft in die Welt; nur `-resetmodifiers`
            // raeumt auf. Rein ja, raus nie, und niemand sah warum.
            //
            // Das trifft JEDEN Bestandsserver, dessen Paket spaeter eine
            // Einstellung dazubekommt — nicht nur Valheim.
            //
            // Riskante Einstellungen bleiben ausgenommen (oben): Dort kostet
            // eine Vorgabe einen Weltstand, und dann ist ein abgelehnter Start
            // die richtige Antwort.
            if (eintrag.default === undefined || eintrag.default === null) continue;
            settings[eintrag.key] = String(eintrag.default);
            continue;
        }
        settings[eintrag.key] = String(wert);
    }
    return { settings, gefaehrlich };
}

/**
 * Welche Pflicht-Portzwecke des Pakets hat der Server nicht belegt?
 *
 * Der Daemon löst Zwecke aus `ports` auf und weist einen Auftrag ohne sie ab
 * (am 2026-08-18: „ready.query: Protokoll valheim genannt, aber kein Port").
 * Hier ist der Ort, an dem es sich erklären lässt.
 *
 * @private
 */
function fehlendePorts(paket, ports) {
    return (paket.ports || [])
        .filter(p => p.required && ports[p.purpose] === undefined)
        .map(p => p.purpose);
}

/** @private */
function grenzenAus(server) {
    // Gebuchte Ressourcen bei JEDEM Auftrag: Sie leben im Daemon nur im
    // Speicher. NULL heisst "kein Limit".
    return {
        ram_mb:      server.allocated_ram_mb      ?? null,
        cpu_percent: server.allocated_cpu_percent ?? null,
        disk_gb:     server.allocated_disk_gb     ?? null,
    };
}

/**
 * Baut den Start- oder Neustartauftrag.
 *
 * @param {object} server   - Zeile aus loadServerForStart (gs.* samt Paket-JOIN)
 * @param {string} guildId
 * @param {object} [Logger]
 * @returns {Promise<{payload: object|null, error: string|null, dockerImage: string|null}>}
 */
async function buildStartPayload(server, guildId, Logger = null) {
    const serverId = server.id;

    // Der Inhaltsvertrag wird HIER aufgeloest, nicht im Daemon: Er bekommt das
    // Paket des gewaehlten Laders, nicht die Auswahl. Sonst muesste er dieselbe
    // Regel ein zweites Mal kennen — und zwei Regeln driften (Stufe 3).
    const paket = loeseInhaltAuf(parseJson(server.paket_json, null),
        parseJson(server.paket_werte, {}) || {});
    if (!paket) {
        // Ein Server auf `stable`, dessen Spiel keine freigegebene Fassung hat,
        // bekommt keine — und das wird gesagt, statt still eine Testfassung zu
        // starten (Paketfassung.js). Entsteht, wenn eine Freigabe zurückgenommen
        // wird; beim Anlegen kann es nicht passieren.
        if (server.paket_slug && server.channel === 'stable') {
            return {
                payload: null, dockerImage: null,
                error: `Kein Start: Für „${server.paket_slug}" ist keine Fassung freigegeben, und dieser Server `
                     + 'folgt dem Kanal „stable". Gib im Adminbereich eine Fassung frei.',
            };
        }
        return {
            payload: null, dockerImage: null,
            error: `Server ${serverId} hat kein Spielpaket — ohne Paket gibt es keinen Start.`,
        };
    }
    const image = imageAusPaket(paket);
    if (!image) {
        return {
            payload: null, dockerImage: null,
            error: `Das Paket ${server.paket_slug || paket.identity?.slug} nennt kein Image.`,
        };
    }

    const werte = parseJson(server.paket_werte, {}) || {};
    const { settings, gefaehrlich } = werteFuerDaemon(paket, werte);
    if (gefaehrlich.length) {
        return {
            payload: null, dockerImage: image,
            error: `Kein Start: ${gefaehrlich.map(k => `„${k}"`).join(', ')} hat keinen gespeicherten `
                 + 'Wert. Der Daemon nähme die Vorgabe des Pakets, und die kostet hier einen Weltstand.',
        };
    }

    // ── Ports, die erst ein Mod mitbringt (Baustelle 156) ────────────────────
    //
    // Vor dem Lesen der Ports: Liegt eine Datei, die einen `needed_by`-Port
    // verlangt, wird er hier gebucht — liegt keine mehr, freigegeben. Hier und
    // nicht in einer Route, damit JEDER Startweg es hat (Panel, Neustart, Cron,
    // Discord). Ein Fehler startet den Server trotzdem, mit den Ports, die er
    // hatte — aber laut.
    let zusatz = null;
    try {
        zusatz = await require('./Zusatzports').gleicheAb({ server, paket });
        if (zusatz.geaendert) server.ports = JSON.stringify(zusatz.ports);
        for (const h of zusatz.hinweise) Logger?.warn?.(`[StartPayload] Server ${serverId}: ${h}`);
    } catch (fehler) {
        Logger?.error?.(`[StartPayload] Server ${serverId}: Zusatzports nicht abgeglichen — `
            + `der Server startet mit den Ports, die er hatte: ${fehler.message}`);
    }

    const ports = parseJson(server.ports, {}) || {};
    const ohnePort = fehlendePorts(paket, ports);
    if (ohnePort.length) {
        return {
            payload: null, dockerImage: image,
            error: `Kein Start: Für ${ohnePort.map(z => `Zweck „${z}"`).join(', ')} ist kein Port belegt. `
                 + `Vorhanden: ${Object.keys(ports).join(', ') || '(keine)'}.`,
        };
    }

    // ── Ist der Mod-Lader dieses Servers scharf? (E6/B.12) ───────────────────
    //
    // Die Liste der Inhalte liegt in `gameserver_content`; von hier geht der
    // Schalter mit dem Auftrag. **Ein Fehlschlag hier startet den Server
    // trotzdem, aber laut** — ein Server, der wegen eines
    // Datenbankschluckaufs gar nicht hochkommt, wäre schlimmer.
    let laderAktiv = false;
    try {
        laderAktiv = await require('./Inhalte').laderAktiv(serverId);
    } catch (fehler) {
        Logger?.error?.('[StartPayload] Inhalte nicht lesbar — der Server startet OHNE '
            + `seinen Mod-Lader, auch wenn einer eingerichtet ist: ${fehler.message}`);
    }

    const payload = {
        server_id:       String(serverId),
        daemon_id:       server.daemon_id,
        rootserver_id:   server.rootserver_id,
        guild_id:        String(guildId),
        system_user:     server.system_user || 'gameserver',
        install_path:    server.install_path || `${serverId}-${server.addon_slug || paket.identity?.slug || ''}`,
        bind_ip:         server.bind_ip || null,
        ports,
        package:         paket,
        settings,
        lader_aktiv:     laderAktiv,
        auto_update:     autoUpdateAus(paket, werte),
        resource_limits: grenzenAus(server),
    };

    // Absichtlich info und nicht debug: Diese Zeile ist der Beleg, womit ein
    // Server gestartet wurde.
    const melde = (msg) => (Logger?.info ? Logger.info(msg) : Logger?.debug?.(msg));
    melde(`[StartPayload] Server ${serverId}: Paket ${server.paket_slug || paket.identity?.slug} `
        + `${server.paket_version || paket.identity?.version} (${server.paket_channel || '?'}) — `
        + `${Object.keys(settings).length} von ${(paket.settings || []).length} Werten, `
        + `Auto-Update ${payload.auto_update ? 'an' : 'aus'}.`);

    return { payload, error: null, dockerImage: image, zusatzports: zusatz };
}

/**
 * Baut den Installationsauftrag — für Anlegen, Discord, Erneut versuchen,
 * Neuinstallieren und den Wiederanstoß beim Reconnect.
 *
 * Bis zum 2026-09-10 schickte jede dieser Stellen ihre eigene Nutzlast aus
 * dem Egg (`game_data`, `startup_command`, `env_variables`), zwei davon ganz
 * ohne Paket. Jetzt kommt alles aus der Zeile des Servers, wie beim Start.
 *
 * @param {object} server   - Zeile aus loadServerForStart
 * @param {string} guildId
 * @param {{runInstall?: boolean, startAfter?: boolean, reinstall?: boolean}} [optionen]
 * @returns {{payload: object|null, error: string|null}}
 */
function baueInstallNutzlast(server, guildId, optionen = {}) {
    if (!server) return { payload: null, error: 'Server nicht gefunden.' };

    // Der Inhaltsvertrag wird HIER aufgeloest, nicht im Daemon: Er bekommt das
    // Paket des gewaehlten Laders, nicht die Auswahl. Sonst muesste er dieselbe
    // Regel ein zweites Mal kennen — und zwei Regeln driften (Stufe 3).
    const paket = loeseInhaltAuf(parseJson(server.paket_json, null),
        parseJson(server.paket_werte, {}) || {});
    if (!paket) {
        return {
            payload: null,
            error: `Für Server ${server.id} gibt es kein Spielpaket — ohne Paket gibt es keine Installation.`,
        };
    }
    const werte = parseJson(server.paket_werte, {}) || {};
    const { settings } = werteFuerDaemon(paket, werte);

    return {
        error: null,
        payload: {
            server_id:       String(server.id),
            rootserver_id:   String(server.rootserver_id),
            daemon_id:       server.daemon_id,
            guild_id:        String(guildId || server.guild_id),
            addon_slug:      server.addon_slug || server.paket_slug || paket.identity?.slug,
            install_path:    server.install_path,
            ports:           parseJson(server.ports, {}) || {},
            package:         paket,
            // Aus ihnen löst das Rezept {{setting:…}} auf — den Zweig bei
            // Valheim, die INI bei Astro Colony.
            settings,
            run_install:     optionen.runInstall !== false,
            start_after:     optionen.startAfter === true,
            reinstall:       optionen.reinstall === true,
            resource_limits: grenzenAus(server),
        },
    };
}

/**
 * Die Werte eines NEUEN Servers, nach den Schlüsseln des Pakets.
 *
 * Jede Einstellung bekommt einen Wert: die Eingabe, sonst die Vorgabe des
 * Pakets. Danach muss kein Start raten, und die Einstellungskarte zeigt, was
 * wirklich gilt. Der Servername ist zugleich die Einstellung `name` — ihn
 * zweimal abzufragen wäre die Sorte Formular, die niemand ausfüllen will.
 *
 * Bis zum 2026-09-10 kamen die Eingaben unter den EGG-Namen
 * (`variable_SERVER_NAME`) und wurden über die Übergangsdatei zurückübersetzt.
 *
 * @param {object} paket
 * @param {object} eingaben   Schlüssel des Pakets → eingegebener Wert
 * @param {string|null} serverName
 * @returns {object}
 */
function paketWerteAnlegen(paket, eingaben = {}, serverName = null) {
    const werte = {};
    for (const eintrag of paket?.settings || []) {
        let wert = eingaben[eintrag.key];
        if (eintrag.key === 'name' && serverName) wert = serverName;
        if (wert === undefined || wert === null) wert = eintrag.default;
        if (wert === undefined || wert === null) continue;
        // Ja/Nein immer als 1/0, wie die Werte-Karte es schickt. Aus dem
        // Discord-Modal kommt Freitext („true", „on").
        werte[eintrag.key] = eintrag.type === 'boolean' ? (istWahr(wert) ? '1' : '0') : String(wert);
    }

    // ── Das Kennwort der Fernsteuerung wird ERZEUGT (2026-09-22) ────────────
    //
    // Befund am ersten Minecraft-Server: `rcon_password` hat `default: null`
    // und `role: owner` — es wurde also weder gefragt noch vorbelegt und fehlte
    // in den Werten. Dann bleibt der Verweis stehen, und in `server.properties`
    // landet `rcon.password={{setting:rcon_password}}` als TEXT. Ein Platzhalter
    // als Geheimnis.
    //
    // Es abzufragen waere die falsche Abhilfe: **Dieses Kennwort sieht nie ein
    // Mensch.** Das Paket sagt es selbst — „Es geht nie an Spieler, nur der
    // Daemon benutzt es." Wer es tippen muss, tippt beim zehnten Server
    // „test123" und hat nichts gewonnen ausser einem Formularfeld mehr.
    //
    // Die Regel ist eng gefasst und folgt dem Paket statt einer Vermutung ueber
    // Feldnamen: Genommen wird genau die Einstellung, die die Variable fuellt,
    // die `management.rcon.password_variable` nennt. Hat sie schon einen Wert
    // (weil das Paket eine Vorgabe hat oder jemand einen eingetippt hat), bleibt
    // er stehen.
    //
    // base64url, weil `server.properties` ein Zeichen wie `\` oder `:` nicht
    // verzeiht und die Datei zeilenweise gelesen wird.
    const rconVariable = paket?.management?.rcon?.password_variable;
    if (rconVariable) {
        const eintrag = (paket.settings || []).find(e =>
            Array.isArray(e.apply) && e.apply.some(a => a.target === 'env' && a.variable === rconVariable));
        if (eintrag && !werte[eintrag.key]) {
            werte[eintrag.key] = crypto.randomBytes(18).toString('base64url');
        }
    }

    return werte;
}

/**
 * Lädt einen Server samt JOINs so, wie buildStartPayload ihn erwartet.
 *
 * @param {object} dbService
 * @param {number|string} serverId
 * @param {string} [guildId] - wenn gesetzt, wird zusätzlich auf die Guild geprüft
 * @returns {Promise<object|null>}
 */
async function loadServerForStart(dbService, serverId, guildId = null) {
    const params = [serverId];
    let where = 'gs.id = ?';
    if (guildId) {
        where += ' AND gs.guild_id = ?';
        params.push(guildId);
    }
    // Das Spielpaket kommt über `packages.id = gs.addon_marketplace_id` — die
    // Einlieferung übernimmt die Kennung des Vorgängers ausdrücklich dafür
    // (siehe scripts/liefere-pakete.js). Ab dem Tabellenschnitt (E-1) trägt
    // `gameservers` stattdessen `package_slug` und `channel`.
    //
    // Welche Fassung: die des Kanals, dem der Server folgt (`gs.channel`) —
    // die Regel steht in Paketfassung.js, nur dort.
    const [row] = await dbService.query(`
        SELECT gs.*,
               r.daemon_id, r.id AS rootserver_id, r.system_user,
               am.slug AS addon_slug,
               pk.slug AS paket_slug,
               pv.fbpkg AS paket_json, pv.version AS paket_version,
               pv.channel AS paket_channel, pv.checksum AS paket_checksum
        FROM gameservers gs
        LEFT JOIN rootserver r ON gs.rootserver_id = r.id
        LEFT JOIN addon_marketplace am ON gs.addon_marketplace_id = am.id
        LEFT JOIN packages pk ON pk.id = gs.addon_marketplace_id
        LEFT JOIN package_versions pv ON pv.id = ${FASSUNG_FUER_SERVER}
        WHERE ${where}
    `, params);
    return row || null;
}

// `ladePaketFuerAddon(addonId)` stand hier bis zum 2026-10-07. Es kannte weder
// den Server noch die Guild und konnte deshalb nur „stable zuerst, sonst die
// neueste" — für beide Fälle dieselbe Antwort. Seit ein Server einem Kanal
// folgt, sind es zwei Fragen (Paketfassung.js):
//
//   ladePaketFuerServer(dbService, serverId)            ein bestehender Server
//   ladePaketFuerAnlegen(dbService, addonId, guildId)   ein Server, der entsteht
//
// Die alte Funktion gibt es absichtlich nicht mehr: Ein Aufrufer, der sie
// weiter benutzte, bekäme still die alte Regel.

module.exports = {
    buildStartPayload, baueInstallNutzlast, paketWerteAnlegen, autoUpdateAus, istWahr,
    loadServerForStart, ladePaketFuerServer, ladePaketFuerAnlegen, imageAusPaket,
    // Nur fuer scripts/check-startpayload.js: Die Regel, welcher Wert beim
    // Start gilt, ist zu teuer erkauft, um sie nur indirekt zu pruefen.
    werteFuerDaemon,
};
