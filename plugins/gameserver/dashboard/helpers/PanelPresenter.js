/**
 * PanelPresenter – baut die Nutzlast eines Discord-Status-Panels
 *
 * Reine Funktionen ohne Datenbank und ohne IPC, damit der Aufbau eines Panels
 * prüfbar ist, ohne einen Bot zu starten.
 *
 * Warum die Anzeige hier und nicht im Bot entsteht: Die Feldliste kommt seit E2
 * aus `game_data.status.display.fields` des Addons. Würde der Bot dieses Schema
 * ein zweites Mal auslegen, bräuchte ein neues Spiel wieder Code an zwei Stellen –
 * genau das sollte E2 abschaffen. Der Bot bekommt darum fertige Label/Wert-Paare
 * und setzt nur noch das Embed zusammen.
 *
 * @module helpers/PanelPresenter
 */

'use strict';

const crypto = require('crypto');

/** Discord-Farben nach Zustand */
const COLOR_ONLINE  = 0x57F287;
const COLOR_OFFLINE = 0x99AAB5;
const COLOR_ERROR   = 0xED4245;
/** Gelb für Übergänge – „gleich passiert etwas", nicht online und nicht aus. */
const COLOR_UEBERGANG = 0xFEE75C;

const { uebergangsText } = require('./ServerState');

/** Mehr Namen passen nicht sinnvoll in ein Embed-Feld (1024 Zeichen). */
const MAX_PLAYER_NAMES = 40;

/**
 * Lesbare Namen der Statusquellen.
 *
 * `daemon` heißt: Das Spiel bietet weder Query noch RCON (Hytale, Windrose) –
 * dann gilt, ob der Container läuft. Das steht bewusst im Panel, damit ein
 * fehlender Spielerzähler erklärt ist und nicht wie ein Defekt aussieht.
 */
const SOURCE_LABELS = {
    query:  'Query',
    rcon:   'RCON',
    merged: 'Query + RCON',
    daemon: 'Daemon (keine Spielerabfrage möglich)',
    none:   'keine',
};

/**
 * Wert über einen Punktpfad holen; `source` darf eine Liste sein, der erste
 * belegte Pfad gewinnt.
 *
 * Gleiche Regel wie im Browser (`renderStatusFields` in
 * server-detail-overview.ejs): Die Spielversion steht je nach Spiel in
 * `extra.gameVersion` oder direkt in `version`.
 *
 * @param {object} data
 * @param {string|string[]} source
 * @returns {*} Wert oder null
 */
function fieldValue(data, source) {
    for (const path of [].concat(source || [])) {
        const value = String(path).split('.')
            .reduce((acc, key) => (acc == null ? acc : acc[key]), data);
        if (value != null && value !== '') return value;
    }
    return null;
}

/**
 * Formatiert einen Feldwert für ein Discord-Embed.
 *
 * Dieselben `format`-Werte wie im Dashboard, aber als Text statt HTML: Ein
 * `<i class="fas fa-lock">` ergibt in einem Embed nichts als Leerraum.
 *
 * @param {*} value
 * @param {string} [format]
 * @returns {string|null} null = Feld weglassen
 */
function formatValue(value, format) {
    switch (format) {
        case 'ms':
            return value == null || value === '' ? null : `${value} ms`;
        case 'lock':
            // Nur zeigen, wenn die Quelle die Frage wirklich beantwortet hat.
            // Bei Palworld gibt es keine Query – "kein Passwort" wäre erfunden.
            if (typeof value !== 'boolean') return null;
            return value ? '🔒 Ja' : '🔓 Nein';
        case 'onoff':
            if (value == null) return null;
            return value ? 'An' : 'Aus';
        case 'code':
            return value ? `\`${value}\`` : null;
        case 'duration': {
            const seconds = Number(value);
            if (!Number.isFinite(seconds) || seconds <= 0) return null;
            const h = Math.floor(seconds / 3600);
            const m = Math.floor((seconds % 3600) / 60);
            return h > 0 ? `${h} h ${m} min` : `${m} min`;
        }
        default:
            return value == null || value === '' ? null : String(value);
    }
}

/**
 * Baut die Embed-Felder aus der Addon-Feldliste.
 *
 * Ein Feld ohne Wert fällt weg statt mit „–" zu erscheinen – dieselbe
 * Entscheidung wie bei den Statistik-Kacheln im Dashboard: Bei Palworld gibt es
 * weder Map noch Ping, und eine leere Zeile behauptet, der Wert fehle gerade,
 * dabei kann er nie kommen.
 *
 * @param {Array<object>} fields - display.fields des Addons
 * @param {object} data - Snapshot in Query-Form
 * @returns {Array<{name: string, value: string, inline: boolean}>}
 */
function buildFields(fields, data) {
    const out = [];

    for (const field of fields || []) {
        const raw = fieldValue(data, field.source || field.key);
        let text = formatValue(raw, field.format);

        if (text !== null && field.hide_when === 'zero' && Number(raw) === 0) {
            text = null;
        }
        if (text === null) continue;

        out.push({ name: field.label || field.key, value: text, inline: true });
    }

    return out;
}

/**
 * Spielerzahl als Text. Unterscheidet „0 Spieler" von „wir wissen es nicht".
 *
 * @param {object} snapshot
 * @returns {string}
 */
function playerCountText(snapshot) {
    const current = snapshot.players_current;
    const max     = snapshot.players_max;

    // Bei Spielen ohne Abfragemöglichkeit ist die Zahl nicht "gerade unbekannt",
    // sondern grundsätzlich nicht ermittelbar. Ein "? / 10" ließe auf eine
    // Störung schließen, die es nicht gibt.
    if (snapshot.source === 'daemon') {
        return max ? `nicht abfragbar (max. ${max})` : 'nicht abfragbar';
    }

    if (current == null) return max ? `? / ${max}` : 'unbekannt';
    return max ? `${current} / ${max}` : String(current);
}

/**
 * Spielernamen als Embed-Feld – nur wenn das Panel es ausdrücklich erlaubt.
 *
 * @param {Array<object>} players
 * @returns {{name: string, value: string, inline: boolean}|null}
 */
function playerListField(players) {
    const names = (players || []).map(p => p?.name).filter(Boolean);
    if (!names.length) return null;

    const shown = names.slice(0, MAX_PLAYER_NAMES);
    const rest  = names.length - shown.length;
    const value = shown.map(n => `• ${n}`).join('\n') + (rest > 0 ? `\n… und ${rest} weitere` : '');

    return { name: `Spieler (${names.length})`, value, inline: false };
}

/**
 * Baut die vollständige Panel-Nutzlast für den Bot.
 *
 * @param {object} args
 * @param {object} args.panel - Zeile aus gameserver_status_panels
 * @param {object} args.server - id, name, status
 * @param {object} args.snapshot - Snapshot aus dem StatusService
 * @param {object} args.display - display-Block des Addons
 * @param {string} [args.gameName]
 * @returns {object} Nutzlast für gameserver:UPDATE_STATUS_PANEL
 */
function buildPanelPayload({ panel, server, snapshot, display, gameName }) {
    const online = !!snapshot.online;

    // Die Feld-Quellen aus display.fields zeigen auf die Query-Form (map, ping,
    // extra.gameVersion, connect …). Der Snapshot trägt dieselben Werte, nur
    // anders benannt – hier die Übersetzung an einer Stelle statt in jedem Feld.
    const data = {
        map:     snapshot.map,
        ping:    snapshot.ping_ms,
        version: snapshot.version,
        bots:    snapshot.extra?.bots,
        connect: snapshot.extra?.connect,
        extra:   snapshot.extra || {},
    };

    const fields = [
        { name: 'Spieler', value: playerCountText(snapshot), inline: true },
        ...buildFields(display?.fields, data),
    ];

    if (online && panel.show_players) {
        const list = playerListField(snapshot.players);
        if (list) fields.push(list);
    }

    // Übergangszustände schlagen den Schnappschuss. Der Schnappschuss sagt nur,
    // ob eine Abfrage gerade antwortet – ein Server, der herunterfährt, antwortet
    // schon nicht mehr und sähe damit aus wie „offline, bitte starten". Genau
    // dieser Knopf lief dann in einen Fehler des Daemons.
    const uebergang = uebergangsText(server.status);

    const statusText = uebergang
        ? uebergang
        : (online ? '🟢 Online' : (server.status === 'error' ? '❌ Fehler' : '⚫ Offline'));

    return {
        panel_id:   panel.id,
        guild_id:   panel.guild_id,
        server_id:  server.id,
        channel_id: panel.channel_id,
        message_id: panel.message_id || null,
        embed: {
            title:       `${statusText} · ${server.name}`,
            description: gameName || null,
            color:       uebergang ? COLOR_UEBERGANG
                                   : (online ? COLOR_ONLINE
                                             : (server.status === 'error' ? COLOR_ERROR : COLOR_OFFLINE)),
            fields,
            // Der Zeitstempel ist die Antwort auf "ist das noch aktuell?" – ohne
            // ihn müsste das Panel bei jedem Poll editiert werden, nur um zu
            // zeigen, dass es lebt.
            footer:      `Stand · Quelle: ${SOURCE_LABELS[snapshot.source] || snapshot.source || 'keine'}`,
            timestamp:   new Date().toISOString(),
        },
        // "Neu laden" ist lesend, "Starten/Stoppen" ist es nicht – deshalb zwei
        // Schalter. Ein öffentliches Panel darf aktualisierbar sein, ohne dass
        // jemand den Server durchschalten kann.
        controls: (panel.show_controls || panel.show_refresh)
            ? {
                server_id:     server.id,
                online,
                show_controls: !!panel.show_controls,
                show_refresh:  !!panel.show_refresh,
                // Während eines Übergangs wird keiner der beiden Schalter
                // angeboten – „Neu laden" bleibt, das ist lesend und hilft
                // sogar: Damit sieht man, wann der Übergang vorbei ist.
                can_start:     !!panel.show_controls && !uebergang && !online,
                can_stop:      !!panel.show_controls && !uebergang && online,
            }
            : null,
    };
}

/**
 * Hash über genau das, was im Panel steht.
 *
 * Der Zeitstempel gehört ausdrücklich **nicht** dazu: Er ändert sich bei jedem
 * Poll, und ein Panel, das sich deswegen minütlich selbst neu schreibt, wäre
 * genau die Rate-Limit-Last, die vermieden werden soll.
 *
 * @param {object} payload - Ergebnis von buildPanelPayload
 * @returns {string} sha256-Hex
 */
function payloadHash(payload) {
    const relevant = {
        title:    payload.embed.title,
        color:    payload.embed.color,
        fields:   payload.embed.fields,
        footer:   payload.embed.footer,
        controls: payload.controls,
    };
    return crypto.createHash('sha256').update(JSON.stringify(relevant)).digest('hex');
}

module.exports = {
    buildPanelPayload,
    payloadHash,
    buildFields,
    formatValue,
    fieldValue,
    playerCountText,
    MAX_PLAYER_NAMES,
};
