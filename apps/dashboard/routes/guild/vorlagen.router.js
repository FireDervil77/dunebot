/**
 * Kern-Teil „Nachricht“ (G-08, K382, 2026-11-14): Vorschau einer Vorlage.
 *
 * Routes: /guild/:guildId/vorlagen/*
 *
 *   POST /vorschau { anlass, vorlage, mitKarte } → alle drei Formen, mit dem
 *        angemeldeten Nutzer als Mitglied und den Beispielwerten aus dem
 *        Register gefüllt. Die Seite zeichnet daraus, was der Bot senden
 *        würde. Dieselbe Rechnung wie im Bot (`Vorlage.fuelle`), keine Kopie
 *        im Browser.
 *
 *        Hängt das Plugin an diesen Anlass eine Bildkarte (`bildkarte` in der
 *        Erklärung) und ist `mitKarte` nicht false, steht sie als Anhang dort,
 *        wo Discord sie zeigt; `bilder` nennt die Adresse des gezeichneten
 *        Bildes (Bereich Bildkarten, gespeicherter Stand). Ohne Recht auf die
 *        Karte (helpers/BildkartenRecht) bleibt der Platzhalter.
 *
 * Gespeichert wird nicht hier, sondern über die Route des Plugins, dem der
 * Anlass gehört (`Vorlage.speichere`), zusammen mit dessen übrigen
 * Einstellungen. Das Recht steht in der Erklärung des Plugins
 * (`vorlagen.recht`) und ist deshalb erst nach dem Lesen des Anlasses bekannt.
 *
 * Wächter: scripts/check-vorlagen.js
 */

const express = require('express');
const router = express.Router({ mergeParams: true });
const { ServiceManager } = require('dunebot-core');
const { Vorlage } = require('dunebot-sdk');
const { requirePermission } = require('../../middlewares/permissions.middleware');
const { csrfProtection } = require('../../middlewares/security/csrf-protection.middleware');
const BildkartenRecht = require('../../helpers/BildkartenRecht');
const { Bildkarte } = require('dunebot-sdk');

/**
 * Die Karte, die das Plugin an den Anlass hängt, als Anhang für die Vorschau
 * samt Bildadresse; leer, wenn keine erklärt, ausgeschaltet oder ohne Recht.
 */
async function kartenAnhang(a, req, guildId) {
    if (!a.bildkarte || req.body?.mitKarte === false) return { anhaenge: [], bilder: {} };
    const n = (Bildkarte.nutzungen().karten.get(a.bildkarte.karte) || []).find((x) => x.plugin === a.plugin);
    if (!n) return { anhaenge: [], bilder: {} };
    const name = `${a.bildkarte.karte.replace(/[^a-z0-9]+/gi, '-')}.png`;
    if (!(await BildkartenRecht.darf(req.session?.user?.info?.id, guildId, n, 'sehen'))) {
        return { anhaenge: [{ name }], bilder: {} };
    }
    const adresse = `/guild/${guildId}/bildkarten/einstellen/${encodeURIComponent(n.plugin)}/${encodeURIComponent(n.karte)}/vorschau`;
    return { anhaenge: [{ name }], bilder: { [name]: adresse } };
}

/** Kern-Text übersetzen, mit Rückfall auf den Schlüssel. */
function uebersetzer(req) {
    return (schluessel, werte = {}) => {
        try {
            if (typeof req.translate === 'function') return req.translate(schluessel, werte);
        } catch { /* Schlüssel zeigen */ }
        return schluessel;
    };
}

const alsText = Vorlage.alsText;

// POST /vorlagen/vorschau
router.post('/vorschau', csrfProtection, async (req, res) => {
    const guildId = res.locals.guildId;
    const tr = uebersetzer(req);
    let a;
    try {
        a = Vorlage.anlass(String(req.body?.anlass || ''));
    } catch (err) {
        if (err instanceof Vorlage.Eingabefehler) return res.status(404).json({ success: false, message: alsText(tr, 'FEHLER', err) });
        throw err;
    }
    if (!a.recht) return res.status(404).json({ success: false, message: `${a.plugin} erklärt kein Recht für Vorlagen` });

    return requirePermission(a.recht)(req, res, async () => {
        const dbService = ServiceManager.get('dbService');
        try {
            if (!(await dbService.isPluginEnabledForGuild(guildId, a.plugin))) {
                return res.status(404).json({ success: false, message: `${a.plugin} ist auf diesem Server nicht eingeschaltet.` });
            }
            const zeilen = await dbService.query('SELECT guild_name FROM guilds WHERE _id = ?', [guildId]);
            const karte = await kartenAnhang(a, req, guildId);
            const v = await Vorlage.vorschau(a.anlass, req.body?.vorlage, {
                guildId,
                guildName: zeilen?.[0]?.guild_name || '',
                guildIcon: (req.session.user.guilds || []).find((g) => String(g.id) === String(guildId))?.icon || null,
                nutzer: req.session.user.info,
                anhaenge: karte.anhaenge,
            });
            res.json({
                success: true,
                data: {
                    form: v.vorlage.form,
                    formen: v.formen,
                    namen: v.namen,
                    bilder: karte.bilder,
                    hinweise: v.hinweise.map((h) => alsText(tr, 'HINWEIS', h)),
                    unbekannt: v.unbekannt,
                },
            });
        } catch (err) {
            if (err instanceof Vorlage.Eingabefehler) return res.status(400).json({ success: false, message: alsText(tr, 'FEHLER', err) });
            ServiceManager.get('Logger').error(`[Vorlagen] Vorschau ${a.anlass} in ${guildId}:`, err);
            res.status(500).json({ success: false, message: err.message });
        }
    });
});

module.exports = router;
