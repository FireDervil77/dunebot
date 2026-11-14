'use strict';

/**
 * Profilabschnitte von moderation (G-12, K382). Nie in Discord, im Dashboard
 * nur mit Recht (Betreiber 2026-11-14), auch für das Mitglied selbst.
 *
 *   - `faelle`  (MODERATION.LOGS.VIEW): Fälle gegen das Mitglied, je Art
 *     gezählt, und der letzte. `PURGE` zählt nicht: Dort ist das Mitglied
 *     kein Betroffener.
 *   - `notizen` (MODERATION.NOTES.VIEW): Zahl und Datum der letzten Notiz,
 *     ohne Text (der steht in Moderation → Notizen).
 */

/** Arten, die ein Mitglied betreffen, in der Reihenfolge der Anzeige. */
const ARTEN = ['WARN', 'TIMEOUT', 'UNTIMEOUT', 'KICK', 'SOFTBAN', 'BAN', 'UNBAN', 'VMUTE', 'VUNMUTE', 'DEAFEN', 'UNDEAFEN', 'DISCONNECT', 'MOVE'];

exports.ARTEN = ARTEN;

exports.faelle = async ({ guildId, userId, t, db }) => {
    const zeilen = await db.query(
        `SELECT type, COUNT(*) AS n FROM moderation_logs
         WHERE guild_id = ? AND member_id = ? AND deleted = 0 AND type <> 'PURGE'
         GROUP BY type`,
        [guildId, userId]
    );
    if (!zeilen.length) return null;
    const je = new Map(zeilen.map((z) => [z.type, Number(z.n)]));
    const summe = [...je.values()].reduce((a, b) => a + b, 0);
    const [letzter] = await db.query(
        `SELECT case_number, type, created_at FROM moderation_logs
         WHERE guild_id = ? AND member_id = ? AND deleted = 0 AND type <> 'PURGE'
         ORDER BY created_at DESC, id DESC LIMIT 1`,
        [guildId, userId]
    );
    return {
        felder: [
            { titel: t('PROFIL.FAELLE'), wert: summe },
            { titel: t('PROFIL.JE_ART'), liste: ARTEN.filter((a) => je.has(a)).map((a) => `${t(`PROFIL.ART.${a}`)} ${je.get(a)}`) },
            { titel: t('PROFIL.LETZTER_FALL', { nr: letzter.case_number, art: t(`PROFIL.ART.${letzter.type}`) }), zeit: new Date(letzter.created_at).getTime() },
        ],
    };
};

exports.notizen = async ({ guildId, userId, t, db }) => {
    const [z] = await db.query(
        'SELECT COUNT(*) AS n, MAX(created_at) AS zuletzt FROM moderation_notes WHERE guild_id = ? AND user_id = ?',
        [guildId, userId]
    );
    const n = Number(z?.n || 0);
    if (!n) return null;
    return {
        felder: [
            { titel: t('PROFIL.NOTIZEN'), wert: n },
            { titel: t('PROFIL.LETZTE_NOTIZ'), zeit: new Date(z.zuletzt).getTime() },
        ],
    };
};
