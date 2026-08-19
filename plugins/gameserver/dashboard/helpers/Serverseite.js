'use strict';

/**
 * Serverseite – was die Übersichtskarte anzeigt, und woher es kommt.
 *
 * Der Entwurf vom 2026-08-18 zeigt eine Seite, die ein Betreiber ohne Erklärung
 * bedienen kann. Diese Datei ist die Brücke dorthin: Sie sammelt die Werte aus
 * den vorhandenen Quellen und bringt sie in die Form, die die Ansicht braucht.
 *
 * ── Die eine Regel, die hier über allem steht ───────────────────────────────
 *
 * **Kein Feld bekommt eine erfundene Zahl.** Was keine Quelle hat, kommt als
 * `null` heraus und wird von der Ansicht als „noch nicht verbunden" gezeigt —
 * sichtbar, nicht mit einem hübschen Platzhalter überdeckt.
 *
 * Der Grund steht in `docs/Baustellen.md` (59, 61): In diesem Vorhaben wurden
 * sechs Mechaniken gefunden, die gebaut waren und nie liefen. Eine Oberfläche,
 * die Erfundenes zeigt, ist dieselbe Krankheit mit besserem Aussehen — nur fällt
 * sie später auf, weil sie ja „funktioniert".
 *
 * ── Wo die Werte herkommen (Bestandsaufnahme 2026-08-19) ────────────────────
 *
 *   Kopf, Adresse        gameservers + rootserver + packages
 *   Spieler samt Ping    QueryService (liefert name, ping, level, platform_id)
 *   Einstellungen        das PAKET (settings mit role/takes_effect/risk)
 *   deren Werte          gameservers.env_variables über die Übergangsdatei
 *   Laufzeit             gameservers.laeuft_seit (neu, Migration 20260819_170000)
 *   Sicherungen          gameserver_backups
 *   Bereitschaftsstufe   NOCH NICHT — fb-init meldet sie, der Daemon hört nicht
 *                        zu (Baustelle 58). Fällt auf den groben Zustand zurück.
 *
 * @module helpers/Serverseite
 */

const { ladeUebergang } = require('./StartPayload');

/** Höhenstufen (B.7): wer welche Einstellungen zu sehen bekommt. */
const HOEHE = {
    einfach:  new Set(['player']),
    fachlich: new Set(['player', 'owner', 'expert']),
};

/** Was `takes_effect` für einen Menschen bedeutet. */
const WIRKUNG = {
    instant:   { text: 'wirkt sofort',            ton: 'green'  },
    restart:   { text: 'wirkt beim Neustart',     ton: 'blue'   },
    new_world: { text: 'erzeugt eine neue Welt',  ton: 'orange' },
};

/**
 * Gruppenüberschriften.
 *
 * `group` ist das tragende Feld der Einstellungskarte (Papier 05): Es ordnet,
 * was sonst eine Liste aus elf gleich aussehenden Zeilen wäre. Ein unbekannter
 * Schlüssel bekommt KEINE erfundene Überschrift, sondern gar keine — dann steht
 * die Einstellung eben ohne Abschnitt da, statt unter einem Namen, den sich
 * niemand ausgedacht hat.
 */
const GRUPPE = {
    identity: 'Name und Auftritt',
    access:   'Zugang',
    world:    'Welt',
    comfort:  'Bequemlichkeit',
    upkeep:   'Pflege',
};

/**
 * Befehle: was das Spiel kann, und worüber.
 *
 * Der Entwurf zeigt diese Karte in der fachlichen Höhe — und sie ist die
 * ehrlichste Karte der ganzen Seite: Sie sagt auch, was NICHT geht, und warum.
 * Valheim hat keine Fernsteuerung; ein Panel, das trotzdem einen „Kicken"-Knopf
 * zeigt, belügt den Betreiber genau einmal, nämlich wenn er ihn braucht.
 */
const BEFEHL_NAME = {
    'players.list': 'Spielerliste',
    'players.kick': 'Spieler entfernen',
    'players.ban':  'Spieler sperren',
    'world.save':   'Welt speichern',
    'broadcast':    'Servernachricht',
};

const BEFEHL_QUELLE = {
    query:       { text: 'Abfrage',       ton: 'green'  },
    file:        { text: 'Datei',         ton: 'blue'   },
    rcon:        { text: 'Fernsteuerung', ton: 'green'  },
    console:     { text: 'Konsole',       ton: 'green'  },
    unsupported: { text: 'nicht möglich', ton: 'secondary' },
};

/** Was `risk` bedeutet — nur gezeigt, wo es etwas zu verlieren gibt. */
const RISIKO = {
    progress:    'Bestehender Fortschritt kann verlorengehen.',
    world_reset: 'Die Welt wird zurückgesetzt.',
};

/**
 * Baut die Anzeige-Daten der Übersichtskarte.
 *
 * @param {object} server        Zeile aus `gameservers` (mit rootserver-Feldern)
 * @param {object|null} paket    Das Spielpaket (FBPKG_v1), oder null
 * @param {object} [zusatz]      { letzteSicherung, live }
 * @returns {object}
 */
function baueUebersicht(server, paket, zusatz = {}) {
    const hoehe = server.ansicht === 'fachlich' ? 'fachlich' : 'einfach';

    return {
        hoehe,
        kopf:          baueKopf(server, paket),
        zustand:       baueZustand(server),
        adresse:       baueAdresse(server),
        laufzeit:      baueLaufzeit(server.laeuft_seit),
        spieler:       baueSpieler(server, zusatz.live),
        einstellungen: baueEinstellungen(server, paket, hoehe),
        befehle:       baueBefehle(paket),
        kennzahlen:    baueKennzahlen(server),
        welt:          baueWelt(zusatz.letzteSicherung),
    };
}

/** Kopfzeile: Spiel gross, Herkunft klein. */
function baueKopf(server, paket) {
    const teile = [server.name];
    if (server.rootserver_name) teile.push(server.rootserver_name);
    if (paket?.identity?.slug) {
        teile.push(`Paket ${paket.identity.slug} ${paket.identity.version || ''}`.trim());
    }
    return {
        spiel:    paket?.identity?.name || server.template_name || server.name,
        herkunft: teile.join(' · '),
        // Ohne Paket läuft der Server über den alten Weg. Das gehört gesagt,
        // nicht versteckt: Es erklärt, warum manche Karten leer bleiben.
        alterWeg: !paket,
    };
}

/**
 * Der Zustand in einem Satz, den ein Spieler versteht.
 *
 * ── Warum hier (noch) keine Bereitschaftsstufe steht ────────────────────────
 *
 * `fb-init` meldet über den Agent-Socket eine dreistufige Bereitschaft
 * (`process` → `port` → `query`) samt Begründung, etwa: „Port 2456 lauscht nach
 * 60 s noch nicht, der Prozess läuft aber. Bei einer neuen Welt ist das normal."
 * Genau der Satz, den der Entwurf zeigen will.
 *
 * Nur hört niemand zu: `agent.Neu(...)` wird im Daemon ausschliesslich vom
 * Prüfwerkzeug `fb-agentprobe` gerufen, nie im Startweg (Baustelle 58). Bis das
 * verdrahtet ist, bleibt es beim groben Zustand — und `stufe: null` sagt der
 * Ansicht, dass hier eine Auskunft FEHLT und nicht etwa alles geklärt ist.
 */
function baueZustand(server) {
    const s = String(server.status || 'unbekannt');
    const tafel = {
        online:     { text: 'Läuft',                    ton: 'green',  gut: true  },
        starting:   { text: 'Startet gerade',           ton: 'yellow', gut: false },
        stopping:   { text: 'Wird gestoppt',            ton: 'yellow', gut: false },
        offline:    { text: 'Aus',                      ton: 'gray',   gut: false },
        installing: { text: 'Wird installiert',         ton: 'blue',   gut: false },
        installed:  { text: 'Installiert, nie gestartet', ton: 'gray', gut: false },
        updating:   { text: 'Wird aktualisiert',        ton: 'blue',   gut: false },
        error:      { text: 'Fehler',                   ton: 'red',    gut: false },
    };
    const e = tafel[s] || { text: s, ton: 'gray', gut: false };
    return { schluessel: s, text: e.text, ton: e.ton, gut: e.gut, stufe: null };
}

/** Die Adresse zum Weitergeben — eine Zeile, kopierbar. */
function baueAdresse(server) {
    const host = server.bind_ip || server.rootserver_hostname || server.rootserver_ip || null;
    let port = null;
    try {
        const p = typeof server.ports === 'string' ? JSON.parse(server.ports) : server.ports;
        const eintrag = p?.game || p?.main || (p && Object.values(p)[0]);
        port = eintrag?.external ?? eintrag?.internal ?? (typeof eintrag === 'number' ? eintrag : null);
    } catch { /* eine unlesbare Portangabe ist kein Grund, die Seite zu verlieren */ }

    if (!host || !port) return null;   // null heisst: die Ansicht sagt „unbekannt"
    return { text: `${host}:${port}`, host, port };
}

/**
 * „Seit 4 Std. 12 Min. ohne Unterbrechung".
 *
 * Gerechnet, nicht gespeichert: Eine Dauer veraltet in dem Moment, in dem sie
 * geschrieben wird. Der Zeitpunkt nicht.
 */
function baueLaufzeit(seit) {
    if (!seit) return null;
    const ms = Date.now() - new Date(seit).getTime();
    if (!Number.isFinite(ms) || ms < 0) return null;

    const min = Math.floor(ms / 60000);
    if (min < 1)  return { text: 'Gerade eben gestartet', seit };
    if (min < 60) return { text: `Seit ${min} Min. ohne Unterbrechung`, seit };
    const std = Math.floor(min / 60), rest = min % 60;
    if (std < 24) return { text: `Seit ${std} Std. ${rest} Min. ohne Unterbrechung`, seit };
    const tage = Math.floor(std / 24);
    return { text: `Seit ${tage} Tg. ${std % 24} Std. ohne Unterbrechung`, seit };
}

/**
 * Spieler: Zahl und Liste.
 *
 * Die Liste kommt live aus der Abfrage (`QueryService` liefert Name, Ping, Level
 * und Plattform). Liegt keine vor, wird das gesagt — eine leere Liste zu zeigen
 * hiesse „niemand da", und das ist etwas anderes als „wir wissen es nicht".
 */
function baueSpieler(server, live) {
    const max = server.max_players ?? null;
    const jetzt = live?.players?.length ?? server.current_players ?? null;
    const liste = Array.isArray(live?.players) ? live.players.map(p => ({
        name:  p.name || 'Unbekannt',
        ping:  Number.isFinite(p.ping) ? p.ping : null,
        kuerzel: (p.name || '?').trim().charAt(0).toUpperCase(),
        avatar: p.avatar || null,
    })) : null;

    return { jetzt, max, liste, gefragt: Boolean(live) };
}

/**
 * Die Einstellungen der gewählten Höhe.
 *
 * ── Woher der aktuelle Wert kommt ───────────────────────────────────────────
 *
 * Das Paket nennt seine Schlüssel bei den EIGENEN Namen (`world_name`), der
 * Bestandsserver hat sie unter den Egg-Namen gespeichert (`WORLD`). Die Brücke
 * dazwischen ist die Übergangsdatei — dieselbe, die auch der Startweg benutzt.
 * Sie fällt mit Stufe 5a; bis dahin ist sie die einzige ehrliche Zuordnung.
 *
 * Ein Wert, der sich nicht auflösen lässt, wird NICHT durch die Paketvorgabe
 * ersetzt. Genau das hätte am 2026-08-19 eine Welt gekostet: Die Vorgabe für
 * `world_name` ist „Dedicated", der laufende Server spielt „BoomTown".
 */
function baueEinstellungen(server, paket, hoehe) {
    const alle = Array.isArray(paket?.settings) ? paket.settings : [];
    if (alle.length === 0) return { sichtbar: [], verborgen: 0, ohnePaket: !paket };

    const erlaubt = HOEHE[hoehe];
    const uebergang = ladeUebergang(paket?.identity?.slug || '');
    let env = {};
    try {
        env = typeof server.env_variables === 'string'
            ? JSON.parse(server.env_variables) : (server.env_variables || {});
    } catch { env = {}; }

    const sichtbar = [];
    let verborgen = 0;

    for (const e of alle) {
        if (!erlaubt.has(e.role || 'expert')) { verborgen++; continue; }

        const eggName = uebergang?.zuordnung?.[e.key] || null;
        const roh = eggName && Object.prototype.hasOwnProperty.call(env, eggName)
            ? env[eggName] : undefined;

        sichtbar.push({
            schluessel:  e.key,
            // Der Egg-Name ist das, was gespeichert wird. Ohne ihn lässt sich
            // die Einstellung ANZEIGEN, aber nicht ändern — und ein Feld, das
            // sich bedienen lässt und nichts bewirkt, ist schlimmer als keines.
            variable:    eggName,
            aenderbar:   Boolean(eggName),
            gruppe:      e.group || 'sonstiges',
            gruppeName:  GRUPPE[e.group] || null,
            name:        e.name?.de || e.name?.en || e.key,
            beschreibung: e.description?.de || e.description?.en || '',
            typ:         e.type || 'text',
            wirkung:     WIRKUNG[e.takes_effect] || null,
            risiko:      RISIKO[e.risk] || null,
            wirktBei:    e.takes_effect || null,
            wert:        roh,
            // Kein Wert heisst: der Server hat dazu nichts gespeichert. Die
            // Ansicht sagt das; sie setzt NICHT die Paketvorgabe ein.
            hatWert:     roh !== undefined,
            vorgabe:     e.default,
            geheim:      (e.type === 'password'),
            auswahl:     Array.isArray(e.choices) ? e.choices.map(c => ({
                wert: String(c.value),
                name: c.name?.de || c.name?.en || String(c.value),
            })) : null,
            min:         Number.isFinite(e.min) ? e.min : null,
            max:         Number.isFinite(e.max) ? e.max : null,
        });
    }
    // Nach Gruppen bündeln — in der Reihenfolge, in der sie im Paket stehen.
    // Eine eigene Sortierung wäre eine zweite Meinung darüber, was wichtig ist.
    const gruppen = [];
    for (const e of sichtbar) {
        let g = gruppen.find(x => x.schluessel === e.gruppe);
        if (!g) {
            g = { schluessel: e.gruppe, name: e.gruppeName, eintraege: [] };
            gruppen.push(g);
        }
        g.eintraege.push(e);
    }

    return { sichtbar, gruppen, verborgen, ohnePaket: false };
}

/** Die Befehlsliste des Pakets — samt dem, was nicht geht. */
function baueBefehle(paket) {
    const c = paket?.commands;
    if (!c || typeof c !== 'object') return [];
    return Object.entries(c).map(([key, v]) => {
        const via = v?.via || 'unsupported';
        return {
            schluessel: key,
            name:   BEFEHL_NAME[key] || key,
            quelle: BEFEHL_QUELLE[via] || BEFEHL_QUELLE.unsupported,
            geht:   via !== 'unsupported',
            grund:  v?.reason?.de || v?.reason?.en || null,
            // Woran es hängt, in einem Wort — der Entwurf zeigt das als
            // Kleingedrucktes neben dem Namen.
            detail: via === 'file' ? v.file
                  : via === 'query' ? (v.parse || 'Abfrage')
                  : null,
        };
    });
}

/**
 * Kennzahlen — nur was der Heartbeat wirklich mitbringt.
 *
 * CPU und RAM kommen alle 30 Sekunden vom Daemon. Der VERLAUF liegt in
 * `server_metrics` und bekommt einen eigenen Navigationseintrag (entschieden
 * 2026-08-18); hier steht nur der Augenblick.
 */
function baueKennzahlen(server) {
    const cpu = Number.isFinite(server.cpu_percent) ? server.cpu_percent : null;
    const ram = Number.isFinite(server.ram_used_mb) ? server.ram_used_mb : null;
    const ramMax = Number.isFinite(server.ram_total_mb) ? server.ram_total_mb : null;
    if (cpu === null && ram === null) return null;
    return { cpu, ram, ramMax };
}

/** Welt: wann zuletzt gesichert. */
function baueWelt(letzteSicherung) {
    if (!letzteSicherung) return { letzte: null };
    const ms = Date.now() - new Date(letzteSicherung).getTime();
    if (!Number.isFinite(ms) || ms < 0) return { letzte: null };
    const min = Math.floor(ms / 60000);
    const text = min < 1 ? 'gerade eben'
               : min < 60 ? `vor ${min} Minuten`
               : min < 1440 ? `vor ${Math.floor(min / 60)} Stunden`
               : `vor ${Math.floor(min / 1440)} Tagen`;
    return { letzte: letzteSicherung, text };
}

module.exports = { baueUebersicht, HOEHE, WIRKUNG, RISIKO, GRUPPE, BEFEHL_NAME, BEFEHL_QUELLE };
