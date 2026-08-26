/**
 * Profil des angemeldeten Benutzers.
 * Routen: /guild/:guildId/profile
 *
 * **Warum diese Datei neu ist, obwohl es den Bereich zu geben schien:** Der
 * Profilbereich lag seit jeher in drei Teilen herum, die nie verbunden wurden
 * (Baustelle 73, gefunden 2026-08-26):
 *
 *   - ein Menuepunkt `partials/guild/topbar.ejs:203` auf `/guild/<id>/profile`
 *     — ohne jede Route dahinter, also 404 bei jedem Klick
 *   - eine Ansicht `views/guild/profile/tokens.ejs`, gerendert von
 *     `/auth/tokens`, worauf im ganzen Theme nichts verwies
 *   - die Uebersetzungen `MEMBER_SINCE`, `DAYS`, `LAST_LOGIN` in **beiden**
 *     Sprachdateien, verwendet an null Stellen
 *
 * Drei vorhandene Teile ergeben keinen funktionierenden Bereich. Beim Lesen
 * des Codes sah jeder einzelne so aus, als sei die Sache erledigt.
 *
 * **Kein Recht ausser Anmeldung.** `CheckAuth` und `CheckGuildAccess` haengen
 * am Einhaengepunkt; ein `requirePermission` waere hier falsch: Das eigene
 * Profil gehoert niemandem sonst. Die Guild-Einstellungen nebenan verlangen
 * `CORE.SETTINGS.VIEW` — genau der Unterschied, den der Betreiber bemaengelt
 * hat: Der Menuepunkt "Einstellungen" steht im persoenlichen Menue, fuehrt
 * aber in den Serverbereich.
 *
 * **Nichts wird hier erfunden.** Jedes Feld der Seite hat eine nachgesehene
 * Quelle — Sitzung, `users`-Zeile oder `res.locals.userPermissions`. Ein
 * Platzhalter fuer spaeter (etwa verbundene Konten, siehe F-16) steht
 * ausdruecklich **nicht** drin: Genau so entstand der Zustand, den diese Datei
 * repariert.
 *
 * @author FireDervil
 */

const express = require('express');
const router = express.Router({ mergeParams: true });
const { ServiceManager } = require('dunebot-core');

/**
 * Die eigene Zeile aus `users`.
 *
 * Sie kann fehlen: Der Eintrag entsteht erst beim Anmelde-Rueckruf. Wer eine
 * alte Sitzung hat und dessen Zeile geloescht wurde, bekommt `null` — die
 * Seite zeigt dann weniger, statt zu scheitern.
 *
 * @param {string} userId Discord-ID
 * @returns {Promise<Object|null>} Zeile oder null
 */
async function eigeneZeile(userId) {
    const dbService = ServiceManager.get('dbService');
    const zeilen = await dbService.query(
        'SELECT locale, logged_in, tokens, created_at, updated_at FROM users WHERE _id = ? LIMIT 1',
        [userId]);
    return zeilen[0] || null;
}

/**
 * Ablauf des Discord-Anmeldetokens, ohne den Token selbst.
 *
 * **Der Token wird bewusst nicht angezeigt** — auch nicht abgeschnitten. Die
 * alte Ansicht zeigte die ersten zehn Zeichen; das nuetzt niemandem und steht
 * dafuer im Bildschirmfoto jeder Hilfeanfrage. Was der Benutzer wissen will,
 * ist "bin ich noch angemeldet und wie lange" — und das ist der Ablauf.
 *
 * @param {Object|null} zeile Zeile aus `users`
 * @returns {{typ: string, ablauf: Date|null, abgelaufen: boolean}|null} Angaben
 */
function anmeldung(zeile) {
    if (!zeile || !zeile.tokens) return null;
    try {
        const t = typeof zeile.tokens === 'string' ? JSON.parse(zeile.tokens) : zeile.tokens;
        const ablauf = t.expires_at ? new Date(Number(t.expires_at)) : null;
        return {
            typ: t.token_type || 'Bearer',
            ablauf,
            abgelaufen: Boolean(ablauf && ablauf.getTime() < Date.now())
        };
    } catch {
        // Kaputtes JSON ist kein Grund, die Seite zu verweigern. Melden statt
        // ausweichen: Der Block faellt weg, der Rest steht.
        return null;
    }
}

// GET /profile
router.get('/', async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const themeManager = ServiceManager.get('themeManager');
    const guildId = res.locals.guildId;
    const userId = req.session?.user?.info?.id || null;

    let zeile = null;
    try {
        if (userId) zeile = await eigeneZeile(userId);
    } catch (error) {
        // Die Seite zeigt dann "unbekannt" statt einer Fehlerseite. Das Profil
        // ohne Anmeldedatum ist immer noch ein Profil.
        Logger.error('[Profil] Benutzerzeile konnte nicht geladen werden:', error);
    }

    const rechte = res.locals.userPermissions || { permissions: {}, groups: [], is_owner: false };

    await themeManager.renderView(res, 'guild/profile', {
        title: 'Profil',
        activeMenu: `/guild/${guildId}/profile`,
        guildId,
        zeile,
        anmeldung: anmeldung(zeile),
        gruppen: Array.isArray(rechte.groups) ? rechte.groups : [],
        // **`wildcard` getrennt melden.** Fuer den Serverbesitzer schreibt
        // `getUserPermissions` den gesamten Rechtekatalog in die Antwort
        // (PermissionManager.js:445) — eine Zahl wie "312 Rechte" waere zwar
        // wahr, wuerde aber etwas anderes behaupten als "darf alles".
        alleRechte: Boolean(rechte.permissions && rechte.permissions.wildcard),
        anzahlRechte: Object.keys(rechte.permissions || {})
            .filter(k => k !== 'wildcard').length,
        istBesitzer: Boolean(rechte.is_owner),
        hatSystemzugang: Boolean(res.locals.user?.hasSystemAccess)
    });
});

module.exports = router;
