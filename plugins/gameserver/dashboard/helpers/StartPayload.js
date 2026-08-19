/**
 * StartPayload – baut das IPM-Payload für Start und Neustart eines Gameservers
 *
 * Image, Startup-Command, Ports und Config leben nur im Speicher des Daemons und
 * kommen ausschließlich aus diesem Payload. Der Neustart-Befehl schickte bisher
 * nur server_id und guild_id – nach einem Daemon-Neustart fehlte dem Server
 * damit alles, der Restart stoppte ihn und scheiterte beim Start mit
 * "docker image not set". Deshalb bauen Start, Neustart und Cronjob ihr Payload
 * hier an einer gemeinsamen Stelle.
 *
 * @module helpers/StartPayload
 * @author FireBot Team
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const { resolveUpdateOptions } = require('./UpdateOptions');

/** Wo die Übergangs-Zuordnungen liegen (packages/fbpkg/uebergang/<slug>.json). */
const UEBERGANG_ORDNER = path.join(__dirname, '../../../../packages/fbpkg/uebergang');

/** Einmal gelesen, dann behalten — die Dateien ändern sich zur Laufzeit nicht. */
const uebergangCache = new Map();

/**
 * Lädt die Übergangs-Zuordnung „Paketschlüssel → Egg-Variablenname".
 *
 * WARUM ES SIE GIBT: Ein Paket nennt seine Einstellungen bei den eigenen
 * Schlüsseln (`world_name`), ein Bestandsserver hat den Wert unter dem
 * Egg-Namen gespeichert (`WORLD`). Zwischen beiden gibt es keine Brücke —
 * `start.args` verweist auf `setting:world_name`, aber nirgends steht, dass
 * dieser Wert einmal aus `WORLD` kam. Der Übersetzer hat die Herkunft nicht
 * mitgeschrieben.
 *
 * Diese Zuordnung stirbt mit 5a, sobald `gameservers` die Werte unter den
 * Paketschlüsseln speichert.
 *
 * @param {string} slug
 * @returns {object|null} Zuordnung oder null, wenn es keine gibt
 * @private
 */
function ladeUebergang(slug) {
    if (uebergangCache.has(slug)) return uebergangCache.get(slug);
    let uebergang = null;
    try {
        const datei = path.join(UEBERGANG_ORDNER, `${slug}.json`);
        if (fs.existsSync(datei)) {
            const roh = JSON.parse(fs.readFileSync(datei, 'utf8'));
            if (roh.zuordnung) {
                uebergang = {
                    zuordnung:          roh.zuordnung,
                    portzwecke:         roh.portzwecke || {},
                    arbeitsverzeichnis: roh.arbeitsverzeichnis || null,
                };
            }
        }
    } catch {
        uebergang = null;   // Der Aufrufer meldet es — hier wird nichts verschluckt
    }
    uebergangCache.set(slug, uebergang);
    return uebergang;
}

/**
 * Benennt die Portschlüssel des Servers auf die Zwecke des Pakets um.
 *
 * Das Paket nennt nur ZWECKE (Invariante I2) — `game`, `query`. Ein
 * Bestandsserver trägt die Schlüssel aus dem Egg-Import, bei Valheim
 * `game_plus_1`. Der Daemon löst den Zweck aus `payload.ports` auf und wies den
 * Auftrag am 2026-08-18 zu Recht ab: *„ready.query: Protokoll valheim genannt,
 * aber kein Port."* Er rät nicht.
 *
 * **Umbenennen, nicht ergänzen.** Stünden beide Schlüssel mit derselben Nummer
 * in der Liste, würde Docker denselben Host-Port zweimal binden.
 *
 * Schlüssel, die kein Paketzweck beansprucht, bleiben unverändert stehen — sie
 * gehören zur Portabbildung des Containers und gehen hier niemandem verloren.
 *
 * @returns {{ports: object, fehlend: Array<{purpose: string, alias: string}>}}
 * @private
 */
function benennePortzwecke(paket, ports, portzwecke) {
    const neu      = {};
    const benutzt  = new Set();
    const fehlend  = [];

    for (const eintrag of paket.ports || []) {
        const zweck = eintrag.purpose;
        const alias = portzwecke[zweck];
        if (ports[zweck] !== undefined) {
            neu[zweck] = ports[zweck];
            benutzt.add(zweck);
        } else if (alias && ports[alias] !== undefined) {
            neu[zweck] = ports[alias];
            benutzt.add(alias);
        } else if (eintrag.required) {
            fehlend.push({ purpose: zweck, alias: alias || '(nicht zugeordnet)' });
        }
    }
    for (const [k, v] of Object.entries(ports)) {
        if (!benutzt.has(k) && neu[k] === undefined) neu[k] = v;
    }
    return { ports: neu, fehlend };
}

/**
 * Die Image-Adresse aus dem Paket — gepinnt, wenn möglich.
 *
 * Der Daemon nimmt sein Container-Image AUSSCHLIESSLICH aus
 * `game_data.docker_image` (`websocket/client.go:1411` → `srv.SetImage`). Das
 * Paket trägt seine Adresse in `image`, und beides auseinanderlaufen zu lassen
 * ist genau die Falle, in die der erste Startversuch am 2026-08-18 gelaufen ist:
 * Das Paket zeigte auf `fb/steamcmd`, gestartet wurde `ghcr.io/parkervcp` — ein
 * Image ohne `fb-init`, also ohne alles.
 *
 * Deshalb gewinnt bei angehängtem Paket das Paket. Bevorzugt wird der **Digest**
 * (`ref@sha256:…`): Ein Tag kann wandern, ein Digest nicht.
 *
 * @param {object} paket
 * @returns {string|null}
 * @private
 */
function imageAusPaket(paket) {
    const img = paket?.image;
    if (!img?.ref) return null;
    if (img.digest) return `${img.ref}@${img.digest}`;
    if (img.tag)    return `${img.ref}:${img.tag}`;
    return img.ref;
}

/**
 * Baut `package` und `settings` für die Start-Payload — oder verweigert.
 *
 * ── Die Sperre, und warum sie existiert ─────────────────────────────────────
 *
 * Ohne Werte benutzt der Daemon die VORGABEN des Pakets. Bei Valheim steht dort
 * `world_name: "Dedicated"`, während der laufende Server `BoomTown` spielt —
 * und Valheim erzeugt bei einem unbekannten Weltnamen eine NEUE, LEERE Welt.
 * Ein stiller Rückfall auf Vorgaben kostet also einen Weltstand.
 *
 * Deshalb: Fehlt einer Einstellung mit `risk: progress` oder `world_reset` der
 * Wert, wird das Paket NICHT angehängt. Der Server geht dann den alten Weg
 * (`startup_command` liegt weiterhin bei) und die Meldung sagt, welcher
 * Schlüssel fehlte. Melden statt ausweichen.
 *
 * @param {object} server        - Zeile aus gameservers samt Paket-JOIN
 * @param {object} envVariables  - die gespeicherten Werte (Egg-Namen)
 * @param {function} melde       - Logger-Ausgabe
 * @returns {{paket: object, settings: object}|null}
 * @private
 */
function baueSpielpaket(server, envVariables, melde) {
    if (!server.paket_json) return null;

    let paket;
    try {
        paket = typeof server.paket_json === 'string'
              ? JSON.parse(server.paket_json) : server.paket_json;
    } catch (err) {
        melde(`[StartPayload] Paket ${server.paket_slug} nicht lesbar: ${err.message} — `
            + 'der alte Weg bleibt.');
        return null;
    }

    const uebergang = ladeUebergang(server.paket_slug);
    if (!uebergang) {
        melde(`[StartPayload] Für "${server.paket_slug}" gibt es keine Übergangs-Zuordnung `
            + `(packages/fbpkg/uebergang/${server.paket_slug}.json). Ohne sie liessen sich die `
            + 'gespeicherten Werte nicht zuordnen — der alte Weg bleibt.');
        return null;
    }

    const settings = {};
    const fehlend  = [];
    for (const eintrag of paket.settings || []) {
        const quelle = uebergang.zuordnung[eintrag.key];
        const wert   = quelle ? envVariables[quelle] : undefined;
        // Ein leerer String ist ein WERT (SRCDS_BETAID="" heisst "kein Beta-Zweig").
        // Nur `undefined` heisst "nicht vorhanden".
        if (wert === undefined) {
            fehlend.push({ key: eintrag.key, quelle: quelle || '(nicht zugeordnet)',
                           risk: eintrag.risk });
            continue;
        }
        settings[eintrag.key] = String(wert);
    }

    const gefaehrlich = fehlend.filter(f => f.risk === 'progress' || f.risk === 'world_reset');
    if (gefaehrlich.length) {
        melde(`[StartPayload] Paket ${server.paket_slug} NICHT angehängt: `
            + gefaehrlich.map(f => `"${f.key}" (aus ${f.quelle}, Risiko ${f.risk})`).join(', ')
            + ' hat keinen Wert. Der Daemon würde die Paketvorgabe nehmen, und die kostet '
            + 'hier einen Weltstand. Der alte Weg bleibt.');
        return null;
    }
    if (fehlend.length) {
        melde(`[StartPayload] Paket ${server.paket_slug}: ${fehlend.length} Einstellung(en) ohne `
            + `Wert (${fehlend.map(f => f.key).join(', ')}) — der Daemon nimmt dort die Vorgabe. `
            + 'Kein Risiko hinterlegt, deshalb kein Abbruch.');
    }

    // ── Arbeitsverzeichnis: Abweichung vom Verzeichnisvertrag ────────────────
    //
    // Der Vertrag (E-19) legt die Spieldateien nach `game/`. Ein Bestandsserver
    // hat sie in der Volume-Wurzel, weil der alte Installer dorthin schreibt.
    // Am 2026-08-19 gemessen: `fb-init` wechselte korrekt nach `game/`, fand
    // nichts und beendete sich mit 126 — im Daemon-Log sah das aus wie ein
    // Absturz des Spiels.
    //
    // Gesetzt wird es auf der KOPIE, die mitgeschickt wird — das gespeicherte
    // Paket bleibt unberührt. Es beschreibt das Spiel, nicht die Geschichte
    // eines einzelnen Volumes.
    if (uebergang.arbeitsverzeichnis) {
        paket.start = paket.start || {};
        if (paket.start.workdir !== uebergang.arbeitsverzeichnis) {
            melde(`[StartPayload] Paket ${server.paket_slug}: Arbeitsverzeichnis auf `
                + `${uebergang.arbeitsverzeichnis} gesetzt — dieser Bestandsserver hat seine `
                + 'Spieldateien in der Volume-Wurzel, nicht in game/. Übergangsweise, '
                + 'fällt mit dem Schritt-Ausführer weg.');
        }
        paket.start.workdir = uebergang.arbeitsverzeichnis;
    }

    return { paket, settings, portzwecke: uebergang.portzwecke };
}


/** @private */
function parseJson(value, fallback, onError) {
    if (value == null) return fallback;
    if (typeof value !== 'string') return value;
    try {
        return JSON.parse(value);
    } catch (err) {
        onError?.(err);
        return fallback;
    }
}

/**
 * Sieht der Text nach einer Docker-Image-Adresse aus?
 * @private
 */
function siehtNachImageAus(text) {
    const s = String(text || '').trim();
    if (!s || /\s/.test(s)) return false;      // "Wine Latest" ist ein Etikett
    return s.includes('/') || s.includes(':'); // ghcr.io/…  bzw.  image:tag
}

/**
 * Wählt aus `docker_images` die tatsächliche Image-Adresse.
 *
 * Pterodactyl-Eggs sind sich über die Richtung nicht einig, und beide Varianten
 * liegen in unserem Bestand nebeneinander:
 *
 *   factorio-arm64    { "Box64": "ghcr.io/parkervcp/yolks:box64" }   Etikett → Image
 *   windrose          { "ghcr.io/parkervcp/steamcmd:proton": "Proton" }  Image → Etikett
 *
 * Wer stur den Schlüssel nimmt, startet Factorio mit dem Image „Box64"; wer stur
 * den Wert nimmt, startet Windrose mit „Proton". Deshalb wird die Seite genommen,
 * die nach einer Image-Adresse aussieht, und der Schlüssel entscheidet nur, wenn
 * beide passen (der Normalfall: Schlüssel und Wert sind identisch).
 *
 * @param {object} dockerImages
 * @returns {string|null}
 * @private
 */
function waehleDockerImage(dockerImages) {
    const eintraege = Object.entries(dockerImages || {});
    if (!eintraege.length) return null;

    for (const [schluessel, wert] of eintraege) {
        if (siehtNachImageAus(schluessel)) return schluessel;
        if (siehtNachImageAus(wert)) return String(wert);
    }

    // Nichts sieht nach einem Image aus – dann der Schlüssel, wie bisher.
    return eintraege[0][0];
}

/**
 * Baut das vollständige Start-Payload für den Daemon.
 *
 * @param {object} server   - Zeile aus gameservers (inkl. frozen_game_data, ports,
 *                            env_variables, launch_params, install_path, bind_ip,
 *                            auto_update) plus daemon_id/system_user aus den JOINs
 * @param {string} guildId
 * @param {object} [Logger]
 * @returns {{payload: object|null, error: string|null, dockerImage: string|null,
 *            startupCommand: string, ports: object, envVariables: object}}
 */
function buildStartPayload(server, guildId, Logger = null) {
    const warn  = (msg) => Logger?.warn?.(msg);
    const debug = (msg) => Logger?.debug?.(msg);
    // Absichtlich info und nicht debug: Diese eine Zeile ist der Beleg dafür,
    // dass der neue Weg wirklich greift. Wer beim ersten Ausrollen zusehen will,
    // soll dafür nicht erst die Protokollstufe hochdrehen müssen.
    const melde = (msg) => (Logger?.info ? Logger.info(msg) : Logger?.debug?.(msg));

    const serverId = server.id;
    const ports        = parseJson(server.ports, {}, e => warn(`[StartPayload] ports: ${e.message}`)) || {};
    const envVariables = parseJson(server.env_variables, {}, e => warn(`[StartPayload] env_variables: ${e.message}`)) || {};
    const frozenData   = parseJson(server.frozen_game_data, null, e => warn(`[StartPayload] frozen_game_data: ${e.message}`));

    // Template-Overrides VOR der Substitution einmergen
    if (server.template_name && Array.isArray(frozenData?.templates)) {
        const tpl = frozenData.templates.find(t => t.name === server.template_name);
        if (tpl?.variables) {
            Object.assign(envVariables, tpl.variables);
            debug(`[StartPayload] Template "${server.template_name}" Variablen-Overrides angewendet`);
        }
    }

    // ════════════════════════════════════════════════════════════════════════
    // Portvariablen aus der Allocation speisen — VOR jeder Substitution.
    //
    // Ein Port hat einen Zweck (`game`, `query`, `rcon`), und die Nummer kommt
    // aus dem Pool. Eine Variable wie `RCON_PORT` ist nur die Art, wie das
    // Spiel davon erfaehrt — sie darf die belegte Nummer nicht bestimmen.
    //
    // Genau das geschah aber: `{{RCON_PORT}}` ist beides, ein Variablenname und
    // das Muster `{{<KEY>_PORT}}` fuer den belegten Port `rcon`. Die
    // Variablenschleife lief zuerst, also gewann der Wert aus den
    // Umgebungsvariablen — eine containerinterne Zahl, die Docker nie
    // veroeffentlicht. Der Dienst lauschte dort, erreichbar war er nirgends.
    //
    // Jetzt gewinnt der belegte Port, und zwar in beiden Richtungen: im
    // Startbefehl UND in der Umgebung, die der Container bekommt. Sonst stuende
    // im Befehl die eine und in der Umgebung die andere Zahl.
    // ════════════════════════════════════════════════════════════════════════
    for (const [zweck, portData] of Object.entries(ports)) {
        const belegt = typeof portData === 'object'
            ? (portData.internal ?? portData.external)
            : portData;
        if (belegt === undefined || belegt === null) continue;

        const variablenName = `${zweck.toUpperCase()}_PORT`;
        if (Object.prototype.hasOwnProperty.call(envVariables, variablenName)
            && String(envVariables[variablenName]) !== String(belegt)) {
            debug(`[StartPayload] ${variablenName}: ${envVariables[variablenName]} → ${belegt} (aus der Allocation)`);
        }
        if (Object.prototype.hasOwnProperty.call(envVariables, variablenName)) {
            envVariables[variablenName] = String(belegt);
        }
    }

    // Variablen-Substitution: {{WORLD}} → "BoomTown" usw.
    let startupCommand = server.launch_params || '';
    if (Array.isArray(frozenData?.variables)) {
        for (const varDef of frozenData.variables) {
            const envKey = varDef.env_variable;
            if (!envKey) continue;
            const value = envVariables[envKey] ?? envVariables[varDef.name] ?? varDef.default_value ?? '';
            startupCommand = startupCommand.replace(new RegExp(`{{${envKey}}}`, 'g'), String(value));
        }
    } else {
        // Altdaten ohne frozen_game_data: direkt mit den gespeicherten Keys ersetzen
        for (const [key, value] of Object.entries(envVariables)) {
            startupCommand = startupCommand.replace(new RegExp(`{{${key}}}`, 'g'), String(value));
        }
    }

    // Port-Platzhalter ersetzen
    for (const [key, portData] of Object.entries(ports)) {
        const portValue = typeof portData === 'object' ? (portData.internal || portData.external) : portData;
        if (portValue === undefined) continue;
        startupCommand = startupCommand.replace(new RegExp(`{{${key.toUpperCase()}_PORT}}`, 'g'), String(portValue));
        if (key === 'game' || key === 'main') {
            startupCommand = startupCommand.replace(/\{\{SERVER_PORT\}\}/g, String(portValue));
        }
    }

    // Docker-Image + Runtime-Infos aus frozen_game_data
    let dockerImage = null;
    const runtime = { stop_mode: 'sigterm', stop_command: '', stop_timeout_sec: 30, done_string: '' };
    let config = null;
    let fileDenylist = [];
    let platform = null;

    if (frozenData) {
        dockerImage = waehleDockerImage(frozenData.docker_images);

        const stopSignal = frozenData.startup?.stop || '';
        if (stopSignal === '^C') {
            runtime.stop_mode = 'sigint';
        } else if (stopSignal) {
            runtime.stop_mode = 'console_command';
            runtime.stop_command = stopSignal;
        }
        if (frozenData.startup?.done) {
            runtime.done_string = frozenData.startup.done;
        }

        if (frozenData.config?.files && Object.keys(frozenData.config.files).length > 0) {
            config = frozenData.config;
        }
        if (Array.isArray(frozenData.file_denylist)) {
            fileDenylist = frozenData.file_denylist;
        }
        if (frozenData.platform) {
            platform = frozenData.platform;
        }

        // Template-Config-Overrides mergen
        if (server.template_name && Array.isArray(frozenData.templates)) {
            const tpl = frozenData.templates.find(t => t.name === server.template_name);
            if (tpl?.config_overrides) {
                if (!config) config = { files: {} };
                if (!config.files) config.files = {};
                for (const [fname, overrides] of Object.entries(tpl.config_overrides)) {
                    if (!config.files[fname]) config.files[fname] = { parser: 'file', find: {} };
                    Object.assign(config.files[fname].find, overrides);
                }
                debug(`[StartPayload] Template "${server.template_name}" Config-Overrides angewendet`);
            }
        }
    }

    if (!dockerImage) {
        return {
            payload: null,
            error: 'Kein Docker-Image konfiguriert. Server muss neu installiert werden.',
            dockerImage: null, startupCommand, ports, envVariables,
        };
    }

    const updateOptions = resolveUpdateOptions(server);

    const payload = {
        server_id:       String(serverId),
        daemon_id:       server.daemon_id,
        rootserver_id:   server.rootserver_id,
        system_user:     server.system_user || 'gameserver',
        install_path:    server.install_path || `${serverId}-${server.addon_slug || ''}`,
        startup_command: startupCommand,
        ports,
        env_variables:   envVariables,
        guild_id:        String(guildId),
        bind_ip:         server.bind_ip || null,
        file_denylist:   fileDenylist,
        ...updateOptions,
        platform:        platform || 'linux',
        // Gebuchte Ressourcen bei JEDEM Start mitgeben, nicht nur bei der
        // Installation: Image, Ports und Limits leben im Daemon nur im Speicher.
        // Nach einem Daemon-Neustart wüsste er die Grenzen sonst nicht mehr und
        // startete den Container wieder unbegrenzt. NULL heisst "kein Limit" —
        // Bestandsserver ohne gepflegte Werte laufen also weiter wie bisher.
        resource_limits: {
            ram_mb:      server.allocated_ram_mb      ?? null,
            cpu_percent: server.allocated_cpu_percent ?? null,
            disk_gb:     server.allocated_disk_gb     ?? null,
        },
        game_data: {
            docker_image: dockerImage,
            runtime,
            ...(config   ? { config }   : {}),
            ...(platform ? { platform } : {}),
        },
    };

    // ── Der neue Weg: das Spielpaket mitschicken ────────────────────────────
    //
    // Liegt eines bei, baut der Daemon daraus einen Auftrag und startet über
    // fb-init statt über die Startzeile. `startup_command` bleibt trotzdem in
    // der Payload: Die INSTALLATION liest es weiterhin (install.go), und ein
    // Feld zu früh zu entfernen bräche die Neuanlage jedes Servers.
    //
    // Fehlt das Paket oder verweigert die Sperre, bleibt es beim alten Weg —
    // gemeldet, nicht verschwiegen.
    const spielpaket = baueSpielpaket(server, envVariables, warn);

    // ── Portzwecke, bevor irgendetwas angehängt wird ────────────────────────
    //
    // Das Paket nennt nur Zwecke (I2), der Bestandsserver trägt die Schlüssel
    // aus dem Egg-Import. Fehlt ein PFLICHT-Zweck, wird das Paket gar nicht
    // erst angehängt: Der Daemon lehnt den Auftrag sonst ohnehin ab — am
    // 2026-08-18 mit „ready.query: Protokoll valheim genannt, aber kein Port."
    // Diese Meldung dort zu erzeugen ist eine Umleitung; hier ist der Ort, wo
    // sie erklärbar ist.
    const zwecke = spielpaket
        ? benennePortzwecke(spielpaket.paket, ports, spielpaket.portzwecke)
        : null;

    if (spielpaket && zwecke.fehlend.length) {
        warn(`[StartPayload] Server ${serverId}: Paket ${server.paket_slug} NICHT angehängt — `
           + 'für '
           + zwecke.fehlend.map(f => `Zweck "${f.purpose}" (Alias ${f.alias})`).join(', ')
           + ` ist kein Port belegt. Vorhanden sind: ${Object.keys(ports).join(', ') || '(keine)'}. `
           + 'Der alte Weg bleibt.');
    } else if (spielpaket) {
        payload.package  = spielpaket.paket;
        payload.settings = spielpaket.settings;

        // Umbenannt, nicht ergänzt: Zwei Schlüssel mit derselben Nummer liessen
        // Docker denselben Host-Port zweimal binden.
        const umbenannt = Object.entries(zwecke.ports)
            .filter(([zweck]) => ports[zweck] === undefined)
            .map(([zweck]) => zweck);
        if (umbenannt.length) {
            melde(`[StartPayload] Server ${serverId}: Portzwecke auf das Paket gehoben — `
                + umbenannt.map(z => `${spielpaket.portzwecke[z]} → ${z}`).join(', '));
        }
        payload.ports = zwecke.ports;

        // Das Image kommt jetzt aus dem Paket, nicht aus frozen_game_data.
        // Ohne diese Zeile startet der Daemon das ALTE Image und findet darin
        // kein fb-init — der Startversuch vom 2026-08-18 ist genau daran
        // gescheitert. Das Feld selbst verschwindet mit frozen_game_data (5a);
        // bis dahin wird es aus dem Paket gefüllt statt daneben gepflegt.
        const paketImage = imageAusPaket(spielpaket.paket);
        if (paketImage) {
            if (paketImage !== dockerImage) {
                melde(`[StartPayload] Server ${serverId}: Image kommt aus dem Paket — `
                    + `${paketImage} (statt ${dockerImage})`);
            }
            payload.game_data.docker_image = paketImage;
            dockerImage = paketImage;
        } else {
            warn(`[StartPayload] Server ${serverId}: Paket ${server.paket_slug} nennt kein `
               + `image.ref — es bleibt bei ${dockerImage}. Enthält das Image kein fb-init, `
               + 'startet der Server nicht.');
        }

        melde(`[StartPayload] Server ${serverId}: Paket ${server.paket_slug} `
            + `${server.paket_version} (${server.paket_channel}) angehängt — `
            + `${Object.keys(spielpaket.settings).length} von `
            + `${(spielpaket.paket.settings || []).length} Werten zugeordnet. `
            + `Der Server startet über fb-init.`);
    }

    return { payload, error: null, dockerImage, startupCommand, ports, envVariables };
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
    // (siehe scripts/liefere-pakete.js). Ab 5a trägt `gameservers` stattdessen
    // `package_slug` und `channel`; bis dahin ist die Kennung die Brücke.
    //
    // Welche Fassung: `stable` schlägt `test`, danach die neueste. Solange
    // `gameservers.channel` nicht existiert, ist das die ehrlichste Regel —
    // sie bevorzugt das Freigegebene und nimmt sonst, was da ist.
    const [row] = await dbService.query(`
        SELECT gs.*,
               r.daemon_id, r.id AS rootserver_id, r.system_user,
               am.slug AS addon_slug, am.steam_app_id, am.steam_server_app_id,
               pk.slug AS paket_slug,
               pv.fbpkg AS paket_json, pv.version AS paket_version,
               pv.channel AS paket_channel, pv.checksum AS paket_checksum
        FROM gameservers gs
        LEFT JOIN rootserver r ON gs.rootserver_id = r.id
        LEFT JOIN addon_marketplace am ON gs.addon_marketplace_id = am.id
        LEFT JOIN packages pk ON pk.id = gs.addon_marketplace_id
        LEFT JOIN package_versions pv ON pv.id = (
            SELECT v.id FROM package_versions v
             WHERE v.package_id = pk.id
             ORDER BY (v.channel = 'stable') DESC, v.published_at DESC, v.id DESC
             LIMIT 1
        )
        WHERE ${where}
    `, params);
    return row || null;
}

module.exports = { buildStartPayload, loadServerForStart, waehleDockerImage,
                   baueSpielpaket, ladeUebergang, benennePortzwecke, imageAusPaket };
