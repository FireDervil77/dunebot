'use strict';

/**
 * Profilabschnitt von music (G-12, K382): Musikwünsche des Mitglieds auf
 * diesem Server aus `music_history` (sicht team, im Dashboard für andere
 * mit MUSIC.HISTORY.VIEW). Ältere Einträge löscht die Aufbewahrung (G-05),
 * die Zahl gilt also für deren Frist.
 */
exports.music = async ({ guildId, userId, t, db }) => {
    const [zahl] = await db.query(
        'SELECT COUNT(*) AS n, MAX(played_at) AS zuletzt FROM music_history WHERE guild_id = ? AND requested_by = ?',
        [guildId, userId]
    );
    const n = Number(zahl?.n || 0);
    if (!n) return null;
    const letzte = await db.query(
        'SELECT title FROM music_history WHERE guild_id = ? AND requested_by = ? ORDER BY played_at DESC, id DESC LIMIT 3',
        [guildId, userId]
    );
    const felder = [{ titel: t('PROFIL.WUENSCHE'), wert: n }];
    if (zahl.zuletzt) felder.push({ titel: t('PROFIL.ZULETZT_AM'), zeit: new Date(zahl.zuletzt).getTime() });
    felder.push({ titel: t('PROFIL.ZULETZT'), liste: letzte.map((z) => z.title) });
    return { felder, kachel: { titel: t('PROFIL.KACHEL'), wert: n } };
};
