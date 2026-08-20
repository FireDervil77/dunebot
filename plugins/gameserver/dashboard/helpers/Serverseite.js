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
        ports:         bauePorts(server, paket),
        paket:         bauePaketkarte(server, paket, zusatz.paketZeile),
        bereitschaft:  baueBereitschaft(paket),
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

/**
 * Die Adresse zum Weitergeben — eine Zeile, kopierbar.
 *
 * ── M-1: eine Adresse, an einer Stelle gebaut (2026-08-20) ──────────────────
 *
 * Hier stand bis heute `bind_ip || rootserver_hostname || rootserver_ip`. Drei
 * Felder rieten mit, und zwei Seiten kamen zu verschiedenen Ergebnissen: Die
 * Übersicht schob die IP in denselben Platz, die Serverseite den Hostnamen.
 * Derselbe Server hatte damit zwei Adressen, je nachdem, wo man hinsah.
 *
 * Schlimmer war, was gewann: `hostname` — ein Feld, das im Formular mit „nur
 * zur Anzeige" beschriftet ist. Am 2026-08-19 stand dort
 * `node1.firenetworks.de`, ein Name, der wegen eines Platzhalter-Eintrags
 * `*.firenetworks.de` auf den WEBHOST zeigte. Wer diese Adresse in Valheim
 * eingab, landete auf dem Dashboard.
 *
 * Die Reihenfolge jetzt, und warum sie so ist:
 *
 *   1. `bind_ip`        — bindet der Server an eine bestimmte Adresse, ist er
 *                         NUR dort erreichbar. Ein noch so schöner Name, der
 *                         auf eine andere Adresse derselben Maschine zeigt,
 *                         hilft dann niemandem.
 *   2. geprüfter Name   — nur wenn `fqdn_gilt` gesetzt ist, und das setzt
 *                         ausschliesslich eine Messung (M-3), nie eine Eingabe.
 *   3. die IP           — die Antwort, die immer stimmt.
 *
 * **Ein ungeprüfter Name erscheint nie.** Lieber eine nüchterne IP als ein
 * Name, der ins Leere führt: Der Fehler heisst dann „Server nicht gefunden",
 * und niemand sucht ihn in einem DNS-Eintrag.
 */
function baueAdresse(server) {
    const nameGilt = Boolean(server.fqdn_gilt) && Boolean(server.fqdn);
    const host = server.bind_ip
        || (nameGilt ? server.fqdn : null)
        || server.rootserver_ip
        || null;
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

/**
 * Ports mit ihrem ZWECK und ihrer Belegungsregel.
 *
 * Der Entwurf zeigt hier mehr als eine Zahl: „Abfrage 2457 — assign: game+1,
 * bei Valheim zwingend Spielport+1, keine freie Wahl." Genau diese Auskunft
 * steckt im Paket (Invariante I2: das Paket nennt Zwecke, nie Nummern) und war
 * bisher nirgends zu sehen — die alte Ansicht zeigte nackte Zahlen.
 */
function bauePorts(server, paket) {
    let belegt = {};
    try {
        belegt = typeof server.ports === 'string' ? JSON.parse(server.ports) : (server.ports || {});
    } catch { belegt = {}; }

    // Der Bestandsserver führt seine Ports unter den EGG-Schlüsseln
    // (`game_plus_1`), das Paket nennt Zwecke (`query`). Dieselbe Brücke wie im
    // Startweg — ohne sie stünde hier „Abfrage —", obwohl der Port belegt ist.
    // Genau diese Verwechslung wies der Daemon am 2026-08-18 zu Recht ab.
    const uebergang = ladeUebergang(paket?.identity?.slug || '');
    const zweckKey = (zweck) => uebergang?.portzwecke?.[zweck] || zweck;

    const ZWECK = { game: 'Spiel', query: 'Abfrage', rcon: 'Fernsteuerung' };
    const liste = [];

    for (const p of (paket?.ports || [])) {
        const eintrag = belegt[p.purpose] || belegt[zweckKey(p.purpose)] || belegt[p.variable] || null;
        const nummer = eintrag?.external ?? eintrag?.internal
                    ?? (typeof eintrag === 'number' ? eintrag : null);
        liste.push({
            zweck:    ZWECK[p.purpose] || p.purpose,
            nummer,
            protokoll: p.protocol || null,
            regel:    p.assign || null,
            variable: p.variable || null,
            pflicht:  p.required !== false,
        });
    }

    // Belegte Ports, die das Paket nicht kennt, gehören trotzdem gezeigt: Sie
    // sind belegt, und wer sie sucht, soll sie finden.
    const schonGezeigt = new Set((paket?.ports || []).flatMap(p =>
        [p.purpose, zweckKey(p.purpose), p.variable].filter(Boolean)));
    for (const [schluessel, eintrag] of Object.entries(belegt)) {
        if (schonGezeigt.has(schluessel)) continue;
        const nummer = eintrag?.external ?? eintrag?.internal
                    ?? (typeof eintrag === 'number' ? eintrag : null);
        if (nummer) liste.push({ zweck: schluessel, nummer, protokoll: null, regel: null, ausserhalb: true });
    }
    return liste;
}

/**
 * Paket und Image — die technische Identität.
 *
 * Sie gehört in die fachliche Höhe und nirgends anders hin: Ein Digest ist für
 * niemanden eine Auskunft, der einen Server bloss betreibt. Für den, der einen
 * Fehler sucht, ist er die wichtigste Zeile der Seite.
 */
function bauePaketkarte(server, paket, zeile) {
    if (!paket) return null;
    const img = paket.image || {};
    return {
        slug:    paket.identity?.slug || null,
        version: paket.identity?.version || null,
        kanal:   zeile?.paket_channel || null,
        image:   img.ref ? (img.tag ? img.ref + ':' + img.tag : img.ref) : null,
        digest:  img.digest || null,
        // Woher die Dateien kommen — der erste Installationsschritt.
        quelle:  (paket.install?.steps || []).map(s =>
                    s.type === 'steamcmd' ? 'steamcmd · App ' + s.app : s.type).join(', ') || null,
        welten:  paket.management?.saves || null,
    };
}

/**
 * Die Bereitschaftsleiter — drei Stufen, wie fb-init sie meldet.
 *
 * ── Warum hier „nicht gemessen" steht und keine Häkchen ─────────────────────
 *
 * Der Entwurf zeigt drei erfüllte Stufen mit Zeiten: Prozess 0,3 s · Port 31 s ·
 * Abfrage 31 s. Diese Angaben entstehen wirklich — `fb-init` meldet sie über den
 * Agent-Socket. Nur ruft `agent.Neu(...)` im Daemon ausschliesslich das
 * Prüfwerkzeug `fb-agentprobe`, nie der Startweg (Baustelle 58).
 *
 * Die Karte zeigt deshalb, WAS das Paket zu prüfen verlangt, und dass die
 * Messung fehlt. Drei grüne Häkchen zu malen wäre die eine Zeile auf dieser
 * Seite, die einen Betreiber wirklich in die Irre führen würde: Er würde
 * glauben, ein Spieler kommt rein.
 */
function baueBereitschaft(paket) {
    const r = paket?.start?.ready_when;
    if (!r) return null;
    const stufen = [
        { name: 'Prozess', verlangt: true,
          erklaerung: 'Das Programm läuft — PID 1 ist fb-init, exec ohne Shell.' },
        { name: 'Port', verlangt: Boolean(r.port),
          erklaerung: r.port ? 'Der Port „' + r.port + '" lauscht.' : 'Kein Port im Paket genannt.' },
        { name: 'Abfrage', verlangt: r.query === true,
          erklaerung: r.query === true ? 'Das Spiel antwortet auf eine Abfrage.' : 'Keine Abfrage verlangt.' },
    ];
    return {
        stufen,
        frist: r.timeout_sec || null,
        gemessen: false,   // siehe Baustelle 58
    };
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

/**
 * Die Serverliste — Entwurf vom 2026-08-18, Artboard 1.
 *
 * ── Woher die Bereitschaftsbalken kommen, ohne dass jemand sie meldet ───────
 *
 * Die volle Leiter (Prozess → Port → Abfrage) meldet `fb-init` über den
 * Agent-Socket, und sie kommt nicht an (Baustelle 58). Was wir trotzdem WISSEN,
 * ohne etwas zu erfinden:
 *
 *   Prozess   der Zustand ist `online` — der Container läuft, das hat der
 *             Daemon gemeldet
 *   Abfrage   eine Spielerzahl liegt vor. Sie entsteht NUR, wenn das Spiel auf
 *             eine Abfrage geantwortet hat. Wer antwortet, lauscht auch —
 *             also ist Port damit ebenfalls belegt.
 *
 * Alles andere bleibt „nicht gemessen". Das ist keine Verlegenheitslösung,
 * sondern die Aussage: Wir wissen es nicht. Der Entwurf sagt es in der Legende
 * selbst — „nicht gemessen heisst: wir wissen es nicht. 0 heisst: gemessen,
 * niemand da."
 */
function baueServerListe(zeilen, paketNachAddon = {}) {
    const liste = (zeilen || []).map((s) => {
        const paket = paketNachAddon[s.addon_marketplace_id] || null;
        const zustand = baueZustand(s);

        const laeuft  = s.status === 'online';
        const gefragt = s.current_players !== null && s.current_players !== undefined;

        const stufen = [
            { name: 'Prozess', erfuellt: laeuft },
            { name: 'Port',    erfuellt: gefragt },
            { name: 'Abfrage', erfuellt: gefragt },
        ];
        const erfuellt = stufen.filter(x => x.erfuellt).length;

        return {
            id:      s.id,
            name:    s.name,
            spiel:   paket?.identity?.name || s.game_name || s.template_name || '—',
            zustand,
            stufen,
            bereit:  erfuellt === 3,
            bereitschaftText:
                erfuellt === 3 ? 'bereit'
              : laeuft         ? 'Abfrage antwortet nicht'
              : s.status === 'starting' ? 'startet'
              : 'aus',
            spieler: {
                jetzt: gefragt ? s.current_players : null,
                max:   s.max_players ?? null,
            },
            // Dieselben Felder wie auf der Serverseite — sonst entstehen wieder
            // zwei Adressen für denselben Server.
            adresse: baueAdresse({
                bind_ip:       s.bind_ip,
                fqdn:          s.fqdn,
                fqdn_gilt:     s.fqdn_gilt,
                rootserver_ip: s.server_ip,
                ports:         s.ports,
            }),
            maschine: s.rootserver_name || null,
            paket:    paket ? `${paket.identity.slug} ${paket.identity.version || ''}`.trim() : null,
        };
    });

    const maschinen = new Set(liste.map(x => x.maschine).filter(Boolean));
    return {
        liste,
        zahlen: {
            alle:   liste.length,
            bereit: liste.filter(x => x.bereit).length,
            aus:    liste.filter(x => x.zustand.schluessel === 'offline').length,
            maschinen: maschinen.size,
        },
    };
}

module.exports.baueServerListe = baueServerListe;

/**
 * Die Spielauswahl beim Anlegen — Entwurf vom 2026-08-18, Artboard 5a.
 *
 * ── Was diese Karte ehrlicher macht als eine Kachel mit Bild ────────────────
 *
 * Sie zeigt, was das Paket über sich selbst NICHT weiss. `status.open` ist
 * genau dafür da, und es stand bisher nirgends: „7 Punkte an diesem Paket
 * ungeprüft — Mindest-RAM und Plattenbedarf nicht gemessen, nicht geraten."
 *
 * Der Nachsatz ist der Punkt. Eine geratene Zahl sähe hilfreicher aus und wäre
 * schlechter: Wer 2 GB liest, bucht 2 GB, und der Server stirbt beim dritten
 * Spieler. „Nicht gemessen" kostet eine Rückfrage, eine falsche Zahl kostet
 * einen Abend.
 *
 * @param {Array} paketZeilen  { id, slug, fbpkg } aus packages/package_versions
 * @param {Array} ohnePaket    Addons, zu denen es noch kein Paket gibt
 */
function bauePaketAuswahl(paketZeilen, ohnePaket = []) {
    const pakete = [];
    for (const z of (paketZeilen || [])) {
        let p;
        try {
            p = typeof z.fbpkg === 'string' ? JSON.parse(z.fbpkg) : z.fbpkg;
        } catch { continue; }
        if (!p) continue;

        const id = p.identity || {};
        const r  = p.requirements || null;

        pakete.push({
            addonId:  z.id,
            slug:     id.slug || z.slug,
            name:     id.name || z.slug,
            kategorie: id.category || null,
            beschreibung: id.description?.de || id.description?.en || '',
            version:  id.version || z.version || null,
            kanal:    z.channel || null,
            // Bedarf: gemessen oder ausdrücklich nicht.
            bedarf: r ? {
                ram:    r.min_ram_mb ? (r.min_ram_mb / 1024).toFixed(1).replace('.', ',') + ' GB RAM' : null,
                platte: r.min_disk_mb ? (r.min_disk_mb / 1024).toFixed(1).replace('.', ',') + ' GB Platte' : null,
                grundlage: r.measured_at ? 'gemessen am ' + r.measured_at : null,
            } : null,
            offen:    Array.isArray(p.status?.open) ? p.status.open : [],
            vollstaendig: p.status?.complete === true,
            // Woher die Dateien kommen — beantwortet „was passiert gleich".
            quelle:   (p.install?.steps || []).map(s =>
                        s.type === 'steamcmd' ? 'SteamCMD lädt App ' + s.app : s.type).join(', ') || null,
            image:    p.image?.ref ? (p.image.tag ? p.image.ref + ':' + p.image.tag : p.image.ref) : null,
        });
    }

    return {
        pakete,
        // Spiele ohne Paket verschwinden NICHT aus der Auswahl. Heute hat genau
        // eines von acht ein Paket; sie wegzulassen hiesse, sieben Spiele
        // unanlegbar zu machen, um eine Liste sauber aussehen zu lassen.
        ohnePaket: (ohnePaket || []).map(a => ({
            addonId: a.id, slug: a.slug, name: a.name,
            beschreibung: a.short_description || a.description || '',
        })),
    };
}

module.exports.bauePaketAuswahl = bauePaketAuswahl;

/**
 * Die Maschinenwahl beim Anlegen — Entwurf vom 2026-08-18, Artboard 5b.
 *
 * ── Warum „gebucht" und nicht „benutzt" ─────────────────────────────────────
 *
 * Die Vorlage sagt „RAM gebucht 38 / 64 GB", und das ist der richtige Wert. Was
 * ein Server GERADE braucht, schwankt mit den Spielern; was er BEKOMMEN DARF,
 * steht fest. Wer nach der Momentanlast bucht, stellt neun Server auf eine
 * Maschine, weil abends gerade keiner spielt.
 *
 * ── Warum die Portprüfung hier steht und nicht erst beim Anlegen ────────────
 *
 * Valheim verlangt Spielport+1 — das ist keine Vorliebe, sondern eine
 * Eigenschaft des Spiels (`assign: game+1`). Ist der Nachbarport belegt, taugt
 * die Maschine für DIESES Spiel nicht, und das gehört gesagt, bevor jemand
 * durch zwei weitere Schritte klickt.
 *
 * Ausgewichen wird bewusst NICHT auf einen anderen Port: Der Client sucht dann
 * an einer Stelle, an der nichts lauscht, und der Fehler heisst „Server nicht
 * gefunden" — weit weg von seiner Ursache.
 */
function baueMaschinenAuswahl(maschinen, gebucht, belegtePorts, paket) {
    // Welche Zwecke braucht das Paket, und wie hängen sie zusammen?
    const ports = paket?.ports || [];
    const spielPort = ports.find(p => p.assign === 'pool') || ports[0] || null;
    const gekoppelt = ports
        .filter(p => typeof p.assign === 'string' && p.assign.includes('+'))
        .map(p => ({ zweck: p.purpose, abstand: parseInt(p.assign.split('+')[1], 10) || 0 }));

    const belegt = new Set((belegtePorts || []).map(x => Number(x.port)));

    return (maschinen || []).map((m) => {
        const g = gebucht[m.id] || { ram_mb: 0, cpu: 0, disk_gb: 0, anzahl: 0 };

        // Ein freies Portpaar suchen — dieselbe Regel, die der Daemon später
        // anwendet. Gefunden wird das erste, bei dem ALLE Zwecke frei sind.
        let paar = null, grund = null;
        const von = m.port_range_start || 0, bis = m.port_range_end || 0;
        if (!spielPort) {
            grund = 'Das Paket nennt keine Ports.';
        } else if (!von || !bis) {
            grund = 'Für diese Maschine ist kein Portbereich hinterlegt.';
        } else {
            for (let n = von; n <= bis; n++) {
                if (belegt.has(n)) continue;
                const noetig = gekoppelt.map(k => n + k.abstand);
                if (noetig.some(x => belegt.has(x) || x > bis)) continue;
                paar = { spiel: n, weitere: gekoppelt.map(k => ({ zweck: k.zweck, port: n + k.abstand })) };
                break;
            }
            if (!paar) {
                grund = gekoppelt.length
                    ? `Kein freies Portpaar. ${paket?.identity?.name || 'Das Spiel'} verlangt ` +
                      gekoppelt.map(k => 'Spielport+' + k.abstand).join(' und ') +
                      ' — wir weichen bewusst nicht auf einen anderen Port aus.'
                    : 'Kein freier Port im hinterlegten Bereich.';
            }
        }

        return {
            id:    m.id,
            name:  m.name,
            host:  m.hostname || m.host || null,
            erreichbar: m.daemon_status === 'online',
            platte: { gebucht: g.disk_gb, gesamt: m.disk_total_gb ?? null },
            ram:    { gebucht: Math.round((g.ram_mb || 0) / 1024), gesamt: m.ram_total_gb ?? null },
            cpu:    { gebucht: g.cpu, gesamt: (m.cpu_cores || 0) * 100 },
            server: g.anzahl,
            paar, grund,
            waehlbar: Boolean(paar) && m.daemon_status === 'online',
        };
    });
}

module.exports.baueMaschinenAuswahl = baueMaschinenAuswahl;

/**
 * Die Werte beim Anlegen — Entwurf vom 2026-08-18, Artboard 5c.
 *
 * Gefragt wird nur, was ein Spieler entscheiden muss (`role: player`). Alles
 * andere bleibt auf der Vorgabe des Pakets und wird als Satz gesagt: „Fünf
 * weitere Einstellungen bleiben auf ihrer Vorgabe." Nicht verschwiegen, aber
 * auch nicht als Formular vorgelegt — die fachliche Höhe gibt es danach.
 *
 * Der zweite Teil ist der eigentliche Gewinn: „Was jetzt passiert". Er sagt
 * VORHER, was die Installation tun wird — welche App, welches Image, ob es
 * schon auf der Maschine liegt. Das steht alles im Paket und war nie zu sehen;
 * bisher klickte man „Erstellen" und wartete auf etwas Unbenanntes.
 */
function baueWerteSchritt(paket, maschine, imageLiegtDa) {
    const alle = Array.isArray(paket?.settings) ? paket.settings : [];
    const gefragt = alle.filter(e => (e.role || 'expert') === 'player');

    // Gespeichert wird unter dem EGG-Namen, nicht unter dem Paketschlüssel: Die
    // Anlegeroute schreibt `variable_<ENV>` nach `env_variables`, und von dort
    // liest der Startweg. Dieselbe Brücke wie überall — ohne sie landete der
    // Servername unter „name" statt unter „SERVER_NAME" und käme nie an.
    const uebergang = ladeUebergang(paket?.identity?.slug || '');

    return {
        felder: gefragt.map(e => ({
            schluessel: e.key,
            variable: uebergang?.zuordnung?.[e.key] || null,
            // Der Servername ist zugleich der Name des Servers in der Datenbank.
            // Die Anlegeroute verlangt ihn als `server_name`; ihn zweimal
            // abzufragen wäre die Sorte Formular, die niemand ausfüllen will.
            istServerName: e.key === 'name',
            name: e.name?.de || e.name?.en || e.key,
            beschreibung: e.description?.de || e.description?.en || '',
            typ: e.type || 'text',
            vorgabe: e.default,
            pflicht: e.required === true || e.type === 'password',
            geheim: e.type === 'password',
            wirkung: WIRKUNG[e.takes_effect] || null,
            hinweis: e.takes_effect === 'new_world'
                ? 'später nur mit neuer Welt änderbar' : null,
            auswahl: Array.isArray(e.choices) ? e.choices.map(c => ({
                wert: String(c.value), name: c.name?.de || c.name?.en || String(c.value),
            })) : null,
            min: Number.isFinite(e.min) ? e.min : null,
            max: Number.isFinite(e.max) ? e.max : null,
        })),
        aufVorgabe: alle.length - gefragt.length,

        passiert: {
            quelle: (paket?.install?.steps || []).map(s =>
                s.type === 'steamcmd' ? 'SteamCMD lädt App ' + s.app : s.type).join(', ') || null,
            depotCache: paket?.install?.cache?.steam_depot !== false,
            image: paket?.image?.ref
                ? (paket.image.tag ? paket.image.ref + ':' + paket.image.tag : paket.image.ref) : null,
            imageLiegtDa: imageLiegtDa === true,
            // Keine Dauerangabe: Wir haben keine gemessene. Eine geschätzte
            // stünde da wie eine Zusage, und die erste Installation, die zwanzig
            // Minuten braucht, macht sie zur Lüge.
            maschine: maschine ? maschine.name : null,
            adresse: maschine && maschine.paar
                ? (maschine.host || maschine.name) + ':' + maschine.paar.spiel : null,
        },
    };
}

module.exports.baueWerteSchritt = baueWerteSchritt;
