'use strict';

/**
 * Meldung „Daemon-Update verfügbar" oben im Guild-Bereich (2026-09-26).
 *
 * Wunsch des Betreibers: eine Meldung wie die übrigen, wegklickbar, die von
 * selbst verschwindet, wenn das Update durch ist. Deshalb wird sie bei jedem
 * Seitenaufruf AUSGERECHNET (Filter `guild_notices`), nicht gespeichert:
 * Meldet der Daemon die neue Fassung, entsteht sie nicht mehr.
 *
 * Quelle ist derselbe Stand, den die Rootserver-Seite zeigt
 * (`ipmServer.daemonUpdateStand`) — keine zweite Rechnung. Ein Daemon, der
 * gerade nicht verbunden ist, meldet keine Fassung; für ihn gibt es keine
 * Meldung (aktualisieren ließe er sich ohnehin nicht).
 *
 * Die Kennung trägt die Zielfassung: Weggeklickt gilt je Rootserver und
 * Fassung — kommt die nächste, erscheint die Meldung wieder.
 *
 * Die Vorlage gibt `message` ungeschützt aus (`<%-`); Rootserver-Namen tippen
 * Nutzer selbst. Deshalb wird hier escapt.
 */

function escape(text) {
    return String(text ?? '').replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
}

/**
 * @param {object} p
 * @param {string} p.guildId
 * @param {Array<{id:number, name:string, daemon_id:string}>} p.rootserver
 * @param {(daemonId:string) => {online:boolean, version:string|null, latestVersion:string|null, updateAvailable:boolean}} p.stand
 * @returns {Array<object>} Meldungen im Format der übrigen (id, title, message, type, action_url, action_text)
 */
function daemonUpdateMeldungen({ guildId, rootserver, stand }) {
    const offen = [];
    for (const rs of rootserver || []) {
        if (!rs?.daemon_id) continue;
        const s = stand(rs.daemon_id) || {};
        if (!s.online || !s.updateAvailable || !s.version || !s.latestVersion) continue;
        offen.push({ rs, von: s.version, nach: s.latestVersion });
    }
    return offen.map(({ rs, von, nach }) => ({
        id: `daemon-update-${rs.id}-${nach}`,
        type: 'info',
        title: 'Daemon-Update verfügbar',
        message: `<strong>${escape(rs.name || 'Rootserver ' + rs.id)}</strong> läuft mit ${escape(von)}, `
            + `verfügbar ist ${escape(nach)}. Beim Update startet der Daemon neu (typisch 10–30 Sekunden).`,
        action_url: `/guild/${encodeURIComponent(guildId)}/plugins/masterserver/rootservers`,
        action_text: 'Zu den Rootservern',
    }));
}

module.exports = { daemonUpdateMeldungen, escape };
