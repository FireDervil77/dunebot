'use strict';

/**
 * Profilabschnitt von automod (G-12, K382): Verwarnstand und Verstöße des
 * Mitglieds. Nie in Discord, im Dashboard nur mit AUTOMOD.LOGS.VIEW
 * (Betreiber 2026-11-14), auch für das Mitglied selbst. Der Nachrichtentext
 * der Verstöße bleibt draußen.
 */
exports.automod = async ({ guildId, userId, t, db }) => {
    const [stand] = await db.query('SELECT strikes FROM automod_strikes WHERE guild_id = ? AND member_id = ?', [guildId, userId]);
    const [log] = await db.query(
        'SELECT COUNT(*) AS n, MAX(logged_at) AS zuletzt FROM automod_logs WHERE guild_id = ? AND member_id = ?',
        [guildId, userId]
    );
    const n = Number(log?.n || 0);
    if (!stand && !n) return null;
    const felder = [
        { titel: t('PROFIL.STRIKES'), wert: Number(stand?.strikes || 0) },
        { titel: t('PROFIL.VERSTOESSE'), wert: n },
    ];
    if (log?.zuletzt) felder.push({ titel: t('PROFIL.LETZTER'), zeit: new Date(log.zuletzt).getTime() });
    return { felder };
};
