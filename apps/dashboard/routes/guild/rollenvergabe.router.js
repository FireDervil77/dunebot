/**
 * Kern-Seite „Rollenvergabe“ je Guild (G-07, F-G12 Punkt 4, K382, 2026-11-14).
 *
 * Routes: /guild/:guildId/rollenvergabe/*
 *
 *   GET /          → jede Rolle, die ein System des Bots in dieser Guild
 *                    verwaltet: Besitzer, Träger je Besitzer, Träger ohne
 *                    Besitzer (von Hand), Rangfolge-Probleme
 *   GET /hinweis   → JSON für den Kern-Teil am Rollenfeld
 *                    (`shared/rollen-hinweis`): `?besitzer=plugin:zweck&rollen=ID,ID`
 *
 * Welche Rollen ein Plugin vergibt, erklärt es in seiner package.json unter
 * `rollen` (Besitzer, Titel, Seite) und liest die Einstellung in
 * `shared/rollen.js` (`Rollen.eingestellt`). Die Seite kennt keine Plugins.
 * Name, Rangfolge und Träger kommen vom Bot (IPC ROLLEN_STAND), das Buch aus
 * `rollen_vergaben`.
 *
 * Recht: Seite `CORE.ROLLEN.VIEW`. Der Hinweis braucht nur Zugang zur Guild:
 * Wer ein Rollenfeld eines Plugins sieht, soll dort auch sehen, wer die Rolle
 * noch verwaltet.
 *
 * Wächter: scripts/check-rollenvergabe.js
 */

'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router({ mergeParams: true });
const { ServiceManager } = require('dunebot-core');
const { Rollen } = require('dunebot-sdk');
const { requirePermission } = require('../../middlewares/permissions.middleware');

const PLUGINS = path.join(__dirname, '..', '..', '..', '..', 'plugins');
const ID = /^\d{5,32}$/;
/** Träger holt der Bot über die Mitgliederliste (15 s); etwas Luft dazu. */
const FRIST_MS = 20_000;

/** Kern-IPC an den Bot: die Antwort des Shards, der die Guild hat. */
async function frageBot(event, payload) {
    const antworten = await ServiceManager.get('ipcServer').broadcast(`dashboard:${event}`, payload, true, { timeout: FRIST_MS });
    const innen = (antworten || []).map((h) => h?.data ?? h);
    const gut = innen.find((a) => a?.success);
    if (gut) return gut;
    const grund = innen.map((a) => a?.error).find(Boolean) || (antworten?.length ? 'keine Antwort' : 'Kein Bot verbunden');
    throw new Error(grund);
}

function pluginName(plugin) {
    if (plugin === 'core') return null;
    try {
        return JSON.parse(fs.readFileSync(path.join(PLUGINS, plugin, 'package.json'), 'utf8')).displayName || plugin;
    } catch {
        return plugin;
    }
}

/**
 * Was die Guild eingestellt hat und was im Buch steht, je Rolle zusammen.
 *
 * @param {string} guildId
 * @param {Function} tr
 * @returns {Promise<{rollen: Map<string, Object>, fehler: string[]}>}
 */
async function sammle(guildId, tr) {
    const rollen = new Map();
    const fehler = [];
    const rolle = (id) => {
        if (!rollen.has(id)) rollen.set(id, { id, besitzer: new Map() });
        return rollen.get(id);
    };
    const besitzerEintrag = (r, e) => {
        if (!r.besitzer.has(e.besitzer)) {
            r.besitzer.set(e.besitzer, {
                besitzer: e.besitzer,
                titel: e.titel ? tr(e.titel) : e.besitzer,
                plugin: e.plugin || e.besitzer.split(':')[0],
                pluginName: e.plugin ? pluginName(e.plugin) : null,
                seite: e.seite ? `/guild/${guildId}${e.seite}` : null,
                eingestellt: false,
                mitglieder: new Set(),
            });
        }
        return r.besitzer.get(e.besitzer);
    };

    for (const e of await Rollen.eingestellt(guildId)) {
        if (e.fehler) fehler.push(`${e.besitzer}: ${e.fehler}`);
        for (const id of e.rollen) besitzerEintrag(rolle(id), e).eingestellt = true;
    }

    const erklaert = new Map(Rollen.erklaerungen().liste.map((e) => [e.besitzer, e]));
    for (const z of await Rollen.eintraege(guildId)) {
        const e = erklaert.get(z.besitzer) || { besitzer: z.besitzer };
        besitzerEintrag(rolle(z.rolle_id), e).mitglieder.add(z.mitglied_id);
    }
    return { rollen, fehler };
}

// GET /rollenvergabe
router.get('/', requirePermission('CORE.ROLLEN.VIEW'), async (req, res) => {
    const guildId = res.locals.guildId;
    const tr = res.locals.tr || ((k) => k);
    const Logger = ServiceManager.get('Logger');

    let gesammelt = { rollen: new Map(), fehler: [] };
    let stand = null;
    let botFehler = null;
    try {
        gesammelt = await sammle(guildId, tr);
    } catch (err) {
        Logger.error(`[Rollenvergabe] ${guildId}: Buch oder Erklärungen nicht lesbar`, err);
        gesammelt.fehler.push(err.message);
    }
    const ids = [...gesammelt.rollen.keys()];
    if (ids.length) {
        try {
            stand = await frageBot('ROLLEN_STAND', { guildId, rollen: ids, traeger: true });
        } catch (err) {
            botFehler = err.message;
            Logger.warn(`[Rollenvergabe] ${guildId}: Bot ohne Antwort (${err.message})`);
        }
    }
    const vomBot = new Map((stand?.rollen || []).map((r) => [String(r.id), r]));

    const liste = [...gesammelt.rollen.values()].map((r) => {
        const b = vomBot.get(r.id) || null;
        const traeger = b && Array.isArray(b.traeger) ? new Set(b.traeger) : null;
        const gebucht = new Set();
        const besitzer = [...r.besitzer.values()].map((x) => {
            for (const m of x.mitglieder) gebucht.add(m);
            return {
                ...x,
                gebucht: x.mitglieder.size,
                // Im Buch, trägt sie aber nicht (mehr): holt der tägliche Abgleich nach.
                veraltet: traeger ? [...x.mitglieder].filter((m) => !traeger.has(m)).length : null,
                mitglieder: undefined,
            };
        }).sort((a, c) => a.besitzer.localeCompare(c.besitzer));
        return {
            id: r.id,
            name: b?.name ?? null,
            farbe: b?.farbe && b.farbe !== '#000000' ? b.farbe : null,
            position: b?.position ?? -1,
            problem: b ? b.problem : null,
            traeger: traeger ? traeger.size : null,
            vonHand: traeger ? [...traeger].filter((m) => !gebucht.has(m)).length : null,
            besitzer,
        };
    }).sort((a, c) => c.position - a.position || String(a.name || a.id).localeCompare(String(c.name || c.id)));

    await ServiceManager.get('themeManager').renderView(res, 'guild/rollenvergabe', {
        title: tr('core:ROLLENVERGABE.TITEL'),
        activeMenu: `/guild/${guildId}/rollenvergabe`,
        guildId,
        rollen: liste,
        botFehler,
        bot: stand?.bot || null,
        vollstaendig: stand ? stand.vollstaendig : null,
        grund: stand?.grund || null,
        fehler: gesammelt.fehler,
    });
});

// GET /rollenvergabe/hinweis?besitzer=…&rollen=…
router.get('/hinweis', async (req, res) => {
    const guildId = res.locals.guildId;
    const tr = res.locals.tr || ((k) => k);
    const besitzer = String(req.query.besitzer || '');
    const ids = [...new Set(String(req.query.rollen || '').split(',').map((s) => s.trim()).filter((s) => ID.test(s)))].slice(0, 50);
    if (!Rollen.BESITZER.test(besitzer)) return res.status(400).json({ success: false, error: 'besitzer ungültig' });
    if (!ids.length) return res.json({ success: true, rollen: [] });

    try {
        const { rollen } = await sammle(guildId, tr);
        let stand = null;
        let botFehler = null;
        try {
            stand = await frageBot('ROLLEN_STAND', { guildId, rollen: ids, traeger: false });
        } catch (err) {
            botFehler = err.message;
        }
        const vomBot = new Map((stand?.rollen || []).map((r) => [String(r.id), r]));
        return res.json({
            success: true,
            botFehler,
            bot: stand?.bot || null,
            rollen: ids.map((id) => ({
                id,
                name: vomBot.get(id)?.name ?? null,
                problem: vomBot.get(id)?.problem ?? null,
                auch: [...(rollen.get(id)?.besitzer.values() || [])]
                    .filter((x) => x.besitzer !== besitzer && x.eingestellt)
                    .map((x) => (x.pluginName ? `${x.pluginName}: ${x.titel}` : x.titel)),
            })),
        });
    } catch (err) {
        ServiceManager.get('Logger').error(`[Rollenvergabe] Hinweis ${guildId}`, err);
        return res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
