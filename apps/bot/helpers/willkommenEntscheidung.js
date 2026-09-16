'use strict';

/**
 * Die Entscheidungen der Begruessung — ohne Discord, ohne Datenbank.
 *
 * Drei Fragen stellen sich, wenn der Bot einer Guild beitritt:
 *   1. Wer hat ihn eingeladen?      → `einladerAusProtokoll()`
 *   2. Wohin darf er schreiben?     → `kanalWaehlen()`
 *   3. Wohin sollen die Links gehen? → `linksBauen()`
 *
 * Alle drei sind reine Funktionen. Der Teil, der wirklich sendet, steht in
 * `Willkommen.js`. Geprueft von `scripts/check-willkommen.js`.
 */

/**
 * Wie alt ein Protokolleintrag hoechstens sein darf, damit er zu *diesem*
 * Beitritt gehoert. Discord haelt Eintraege 45 Tage vor; ohne Frist wuerde bei
 * einem Re-Join der Einlader von damals eine DM bekommen.
 */
const PROTOKOLL_FRIST_MS = 10 * 60 * 1000;

/**
 * Sucht im Audit-Log den, der genau diesen Bot gerade hinzugefuegt hat.
 *
 * Erwartet die Eintraege bereits abgeflacht — `Willkommen.js` reicht sie so
 * herein, damit hier nichts von discord.js bekannt sein muss.
 *
 * @param {Array<{zielId: string, ausfuehrenderId: string|null, erstelltMs: number}>} eintraege
 * @param {string} botId - Die Nutzer-ID des eigenen Bots
 * @param {number} jetztMs
 * @returns {string|null} Nutzer-ID des Einladers, oder null
 */
function einladerAusProtokoll(eintraege, botId, jetztMs) {
    if (!Array.isArray(eintraege) || !botId) return null;

    const passend = eintraege
        .filter((e) => e && e.zielId === botId && e.ausfuehrenderId)
        .filter((e) => Number.isFinite(e.erstelltMs))
        .filter((e) => jetztMs - e.erstelltMs >= 0 && jetztMs - e.erstelltMs <= PROTOKOLL_FRIST_MS)
        .sort((a, b) => b.erstelltMs - a.erstelltMs);

    return passend.length > 0 ? passend[0].ausfuehrenderId : null;
}

/**
 * Waehlt den Kanal fuer die Begruessung.
 *
 * Der Systemkanal zuerst — das ist der, den Discord selbst fuer Beitritte
 * vorsieht. Gibt es ihn nicht oder darf der Bot dort nicht schreiben, faellt
 * die Wahl auf den obersten Kanal, in dem er schreiben darf. Darf er nirgends
 * schreiben, kommt `null` zurueck; dann bleibt nur die DM.
 *
 * @param {Object} argumente
 * @param {string|null} argumente.systemKanalId
 * @param {Array<{id: string, position: number, darfSchreiben: boolean}>} argumente.kanaele
 * @returns {string|null} Kanal-ID
 */
function kanalWaehlen({ systemKanalId = null, kanaele = [] } = {}) {
    const moeglich = (Array.isArray(kanaele) ? kanaele : []).filter((k) => k && k.darfSchreiben);
    if (moeglich.length === 0) return null;

    if (systemKanalId && moeglich.some((k) => k.id === systemKanalId)) {
        return systemKanalId;
    }

    const sortiert = [...moeglich].sort((a, b) => {
        const pa = Number.isFinite(a.position) ? a.position : Number.MAX_SAFE_INTEGER;
        const pb = Number.isFinite(b.position) ? b.position : Number.MAX_SAFE_INTEGER;
        if (pa !== pb) return pa - pb;
        return String(a.id).localeCompare(String(b.id));
    });

    return sortiert[0].id;
}

/**
 * Baut die Links der ersten Schritte.
 *
 * Ohne Basisadresse gibt es `null` — der Aufrufer schreibt dann eine
 * Begruessung ohne Links und **meldet die fehlende Variable**. Erfundene
 * relative Links waeren in Discord nicht anklickbar.
 *
 * @param {string|null} basis - z. B. „https://firenetworks.de"
 * @param {string} guildId
 * @returns {Object|null}
 */
function linksBauen(basis, guildId) {
    const sauber = String(basis || "").trim().replace(/\/+$/, "");
    if (!sauber || !guildId) return null;

    return {
        willkommen: `${sauber}/guild/${guildId}/willkommen`,
        sprache: `${sauber}/guild/${guildId}/settings/general`,
        plugins: `${sauber}/guild/${guildId}/plugins`,
        rechte: `${sauber}/guild/${guildId}/permissions`,
        hilfe: `${sauber}/docs`,
    };
}

module.exports = {
    PROTOKOLL_FRIST_MS,
    einladerAusProtokoll,
    kanalWaehlen,
    linksBauen,
};
