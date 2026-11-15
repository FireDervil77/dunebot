'use strict';

const { beiLoeschung } = require('../chatxp');

/**
 * Leveling: gesammelt gelöschte Nachrichten (`/clear`, Moderation) → XP
 * zurück, je Nachricht wie beim einzelnen Löschen, wenn sie jung genug war
 * (K394). Discord meldet sie nicht einzeln. Das Alter steckt in der ID, die
 * meisten fallen ohne Abfrage heraus; nacheinander, damit ein großer
 * Sammelstoß nicht hundert Transaktionen auf einmal öffnet.
 *
 * @param {import('discord.js').ReadonlyCollection<string, import('discord.js').Message|import('discord.js').PartialMessage>} nachrichten
 * @returns {Promise<{storniert: number, geprueft: number}>}
 */
module.exports = async (nachrichten) => {
    let storniert = 0;
    let geprueft = 0;
    for (const message of nachrichten?.values?.() || []) {
        geprueft++;
        if ((await beiLoeschung(message)).storniert) storniert++;
    }
    return { storniert, geprueft };
};
