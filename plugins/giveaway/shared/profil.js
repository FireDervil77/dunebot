'use strict';

/**
 * Profilabschnitt von giveaway (G-12, K382): Teilnahmen und Gewinne des
 * Mitglieds auf diesem Server. Erklärt in `package.json` unter `profil`
 * (sicht team, im Dashboard für andere mit GIVEAWAY.VIEW).
 *
 * Gezählt werden nur Gewinne aus Discord (`quelle = 'discord'`): Bei
 * Twitch-Giveaways steht in `user_id` keine Discord-ID.
 */
exports.giveaway = async ({ guildId, userId, t, db }) => {
    const [teil] = await db.query(
        `SELECT COUNT(*) AS n FROM giveaway_entries e JOIN giveaways g ON g.id = e.giveaway_id
         WHERE g.guild_id = ? AND e.user_id = ?`,
        [guildId, userId]
    );
    const gewinne = await db.query(
        `SELECT g.prize, w.won_at FROM giveaway_winners w JOIN giveaways g ON g.id = w.giveaway_id
         WHERE g.guild_id = ? AND w.user_id = ? AND w.quelle = 'discord'
         ORDER BY w.won_at DESC`,
        [guildId, userId]
    );
    const teilnahmen = Number(teil?.n || 0);
    if (!teilnahmen && !gewinne.length) return null;
    const felder = [
        { titel: t('PROFIL.TEILNAHMEN'), wert: teilnahmen },
        { titel: t('PROFIL.GEWONNEN'), wert: gewinne.length },
    ];
    if (gewinne.length) felder.push({ titel: t('PROFIL.ZULETZT'), liste: gewinne.slice(0, 3).map((g) => g.prize) });
    return { felder, kachel: { titel: t('PROFIL.KACHEL'), wert: gewinne.length } };
};
