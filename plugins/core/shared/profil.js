'use strict';

/**
 * Profilabschnitte des Kerns (G-12, K382). Erklärt in `plugins/core/package.json`
 * unter `profil`; Vertrag in `packages/dunebot-sdk/lib/Profil.js`.
 *
 *   - `discord`: was Discord über das Mitglied zeigt (beigetreten, Konto,
 *     Rollen). Bis 2026-11-14 sammelte `/info user` das selbst.
 *   - `konten`: verbundene Konten (`user_connections`). Gelten für alle
 *     Guilds, deshalb nur für das Mitglied selbst.
 *
 * `stand` gehört zur Bildkarte `kern:profil` (Bereich „Bildkarten“): Der Kern
 * ist immer an.
 */

exports.discord = async ({ mitglied, t }) => {
    if (!mitglied) return null;
    const felder = [];
    if (mitglied.beigetreten) felder.push({ titel: t('PROFIL.BEIGETRETEN'), zeit: mitglied.beigetreten });
    if (mitglied.erstellt) felder.push({ titel: t('PROFIL.KONTO_ERSTELLT'), zeit: mitglied.erstellt });
    felder.push({ titel: t('PROFIL.ROLLEN', { n: mitglied.rollen.length }), liste: mitglied.rollen.map((r) => r.name) });
    return { felder, kachel: { titel: t('PROFIL.KACHEL_ROLLEN'), wert: mitglied.rollen.length } };
};

exports.konten = async ({ userId, t, db }) => {
    const zeilen = await db.query(
        'SELECT plattform, konto_name, konto_id FROM user_connections WHERE user_id = ? ORDER BY plattform, angelegt_am',
        [userId]
    );
    if (!zeilen?.length) return null;
    return {
        felder: [{ titel: t('PROFIL.KONTEN', { n: zeilen.length }), liste: zeilen.map((z) => `${z.plattform}: ${z.konto_name || z.konto_id}`) }],
    };
};

/** Bildkarte `kern:profil`: Der Kern ist immer an; Werte zeigt die Schablone als Beispiel. */
exports.stand = async () => ({ an: true, werte: null });
