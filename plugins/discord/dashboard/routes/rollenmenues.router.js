'use strict';

/**
 * Discord — Rollenmenüs
 *
 * Mitglieder geben sich Rollen selbst: über Reaktionen, Knöpfe oder eine
 * Auswahlliste. Vier Modi bestimmen, was dabei geschieht — die Rechnung dazu
 * steht im Bot (`bot/rollenmenue/entscheidung.js`), hier steht nur die
 * Verwaltung.
 *
 * **Versendet wird ausdrücklich, nicht automatisch.** Eine Änderung an einem
 * Menü ändert nicht sofort die Nachricht im Kanal — sonst würde jeder Tippfehler
 * beim Bearbeiten für alle sichtbar. Wer fertig ist, drückt „Senden"; dann
 * bearbeitet der Bot die vorhandene Nachricht oder legt eine neue an.
 *
 * @module discord/routes/rollenmenues
 */

const express = require('express');
const router = express.Router({ mergeParams: true });
const { KanalTypen } = require('dunebot-core');
const { requirePermission } = require('../../../../apps/dashboard/middlewares/permissions.middleware');

const { BESCHREIBBARE_TYPEN } = KanalTypen;
const { DiscordRoleMenus } = require('../../shared/models');
const { renderView, fragBot, renderFehler, fehler } = require('./_shared');

/** Was die Datenbank an Werten zulässt — hier gespiegelt, um Eingaben zu prüfen. */
const DARSTELLUNGEN = ['reaktion', 'knopf', 'auswahl'];
const MODI = ['normal', 'einmalig', 'eindeutig', 'umgekehrt'];
const STILE = ['grau', 'blau', 'gruen', 'rot'];

/** Discord-Grenzen, die schon beim Speichern gelten sollen statt erst beim Senden. */
const MAX_EINTRAEGE = { reaktion: 20, knopf: 25, auswahl: 25 };

/**
 * Einen Wert gegen eine Liste prüfen, sonst den ersten nehmen.
 *
 * @param {*} wert
 * @param {string[]} erlaubt
 * @returns {string}
 */
const ausListe = (wert, erlaubt) => erlaubt.includes(wert) ? wert : erlaubt[0];

// ── Übersicht ────────────────────────────────────────────────────────────

router.get('/', requirePermission('DISCORD.ROLEMENUS.VIEW'), async (req, res) => {
    const guildId = res.locals.guildId;

    try {
        // Kanäle und Rollen kommen vom Bot. Antwortet er nicht, bleiben die
        // Auswahllisten leer — die Seite lädt trotzdem und zeigt die Menüs.
        //
        // `BESCHREIBBARE_TYPEN` statt der Vorgabe: Ein Rollenmenü ist ein
        // Zielkanal, der Bot schreibt dorthin. Sprachkanäle haben seit 2022
        // einen Textchat und kommen dafür ebenso in Frage wie Textkanäle.
        const [menus, kanalAntwort, rollenAntwort] = await Promise.all([
            DiscordRoleMenus.getMenus(guildId),
            fragBot('dashboard:GET_GUILD_CHANNELS', { guildId, types: BESCHREIBBARE_TYPEN }),
            fragBot('dashboard:GET_GUILD_ROLES', { guildId })
        ]);

        return await renderView(res, 'guild/discord-rollenmenues', {
            guildId,
            menus,
            channels: kanalAntwort?.channels || [],
            roles: rollenAntwort?.roles || [],
            darstellungen: DARSTELLUNGEN,
            modi: MODI,
            stile: STILE,
            maxEintraege: MAX_EINTRAEGE
        });
    } catch (error) {
        return renderFehler(res, error, 'Die Rollenmenüs konnten nicht geladen werden');
    }
});

// ── Ein Menü bearbeiten ──────────────────────────────────────────────────

router.get('/:menuId/bearbeiten', requirePermission('DISCORD.ROLEMENUS.VIEW'), async (req, res) => {
    const guildId = res.locals.guildId;
    const menuId = Number(req.params.menuId);

    if (!Number.isInteger(menuId)) {
        return res.redirect(`/guild/${guildId}/plugins/discord/rollenmenues`);
    }

    try {
        const [menu, kanalAntwort, rollenAntwort] = await Promise.all([
            DiscordRoleMenus.getMenu(guildId, menuId),
            fragBot('dashboard:GET_GUILD_CHANNELS', { guildId, types: BESCHREIBBARE_TYPEN }),
            fragBot('dashboard:GET_GUILD_ROLES', { guildId })
        ]);

        if (!menu) {
            return res.redirect(`/guild/${guildId}/plugins/discord/rollenmenues`);
        }

        const rollen = rollenAntwort?.roles || [];

        // Rollen, die der Bot gar nicht vergeben kann, werden nicht
        // ausgeblendet, sondern gekennzeichnet. Ausblenden liesse die
        // Serverleitung rätseln, wo die Rolle geblieben ist.
        const eintraege = menu.optionen.map(o => ({
            ...o,
            rolle: rollen.find(r => String(r.id) === String(o.role_id)) || null
        }));

        return await renderView(res, 'guild/discord-rollenmenue-bearbeiten', {
            guildId,
            menu,
            eintraege,
            channels: kanalAntwort?.channels || [],
            roles: rollen,
            darstellungen: DARSTELLUNGEN,
            modi: MODI,
            stile: STILE,
            maxEintraege: MAX_EINTRAEGE[menu.darstellung] || 25
        });
    } catch (error) {
        return renderFehler(res, error, 'Das Rollenmenü konnte nicht geladen werden');
    }
});

// ── Ein Menü ─────────────────────────────────────────────────────────────

/**
 * GET /guild/:guildId/plugins/discord/rollenmenues/emojis
 *
 * Die eigenen Emojis dieses Servers, fuer die Auswahl am Emoji-Feld.
 *
 * Standard-Emojis stehen im Dashboard selbst — die sind fuer jede Guild gleich
 * und muessen nicht ueber die Leitung. Hierher kommt nur, was guild-eigen ist:
 * dort braucht Discord die Form `<:name:id>`, und die ID kennt niemand
 * auswendig.
 *
 * MUSS vor `/:menuId` stehen: Express nimmt den zuerst passenden Handler, und
 * `/:menuId` schluckt jeden einzelnen Pfadabschnitt — auch "emojis".
 */
router.get('/emojis', requirePermission('DISCORD.ROLEMENUS.MANAGE'), async (req, res) => {
    const guildId = res.locals.guildId;

    const antwort = await fragBot('discord:holeEmojis', { guildId });
    if (!antwort) {
        return res.status(503).json({ success: false, message: 'Der Bot antwortet nicht. Läuft er?' });
    }
    if (!antwort.success) {
        return res.status(400).json({ success: false, message: antwort.message || 'Emojis nicht abrufbar' });
    }

    return res.json({ success: true, emojis: antwort.emojis || [] });
});

router.get('/:menuId', requirePermission('DISCORD.ROLEMENUS.VIEW'), async (req, res) => {
    const guildId = res.locals.guildId;
    const menuId = Number(req.params.menuId);

    if (!Number.isInteger(menuId)) {
        return res.status(400).json({ success: false, message: 'Ungültige Menü-ID' });
    }

    try {
        const menu = await DiscordRoleMenus.getMenu(guildId, menuId);
        if (!menu) {
            return res.status(404).json({ success: false, message: 'Menü nicht gefunden' });
        }
        return res.json({ success: true, menu });
    } catch (error) {
        return fehler(res, error, 'Das Menü konnte nicht geladen werden');
    }
});

router.post('/', requirePermission('DISCORD.ROLEMENUS.MANAGE'), async (req, res) => {
    const guildId = res.locals.guildId;
    const title = String(req.body?.title || '').trim();

    if (!title) {
        return res.status(400).json({ success: false, message: 'Der Titel darf nicht leer sein' });
    }
    if (title.length > 255) {
        return res.status(400).json({ success: false, message: 'Der Titel ist zu lang (höchstens 255 Zeichen)' });
    }

    try {
        const id = await DiscordRoleMenus.createMenu(guildId, {
            title,
            description: String(req.body?.description || '').trim() || null,
            channel_id: String(req.body?.channel_id || '').trim() || null,
            color: zuFarbe(req.body?.color) || '#5865F2',
            darstellung: ausListe(req.body?.darstellung, DARSTELLUNGEN),
            modus: ausListe(req.body?.modus, MODI),
            min_auswahl: zuZahl(req.body?.min_auswahl, 0, 0, 25),
            max_auswahl: zuZahl(req.body?.max_auswahl, 25, 1, 25)
        });

        return res.json({ success: true, id });
    } catch (error) {
        return fehler(res, error, 'Das Menü konnte nicht angelegt werden');
    }
});

router.put('/:menuId', requirePermission('DISCORD.ROLEMENUS.MANAGE'), async (req, res) => {
    const guildId = res.locals.guildId;
    const menuId = Number(req.params.menuId);

    if (!Number.isInteger(menuId)) {
        return res.status(400).json({ success: false, message: 'Ungültige Menü-ID' });
    }

    const felder = {};
    if (req.body?.title !== undefined) {
        const title = String(req.body.title).trim();
        if (!title) return res.status(400).json({ success: false, message: 'Der Titel darf nicht leer sein' });
        felder.title = title.slice(0, 255);
    }
    if (req.body?.description !== undefined) felder.description = String(req.body.description).trim() || null;
    if (req.body?.channel_id !== undefined) felder.channel_id = String(req.body.channel_id).trim() || null;
    if (req.body?.color !== undefined) felder.color = zuFarbe(req.body.color) || '#5865F2';
    if (req.body?.darstellung !== undefined) felder.darstellung = ausListe(req.body.darstellung, DARSTELLUNGEN);
    if (req.body?.modus !== undefined) felder.modus = ausListe(req.body.modus, MODI);
    if (req.body?.min_auswahl !== undefined) felder.min_auswahl = zuZahl(req.body.min_auswahl, 0, 0, 25);
    if (req.body?.max_auswahl !== undefined) felder.max_auswahl = zuZahl(req.body.max_auswahl, 25, 1, 25);
    if (req.body?.enabled !== undefined) felder.enabled = Boolean(req.body.enabled);

    try {
        // Hängt das Menü an einer fremden Nachricht, ist die Darstellung nicht
        // frei: Knöpfe und Auswahllisten gehören zur Nachricht, und die kann
        // der Bot nicht ändern. Beim Senden käme sonst eine Absage — hier ist
        // sie am richtigen Ort, nämlich beim Umstellen.
        if (felder.darstellung && felder.darstellung !== 'reaktion') {
            const vorher = await DiscordRoleMenus.getMenu(guildId, menuId);
            if (vorher?.fremde_nachricht) {
                return res.status(400).json({
                    success: false,
                    message: 'Dieses Menü hängt an einer fremden Nachricht — dort sind nur Reaktionen möglich. '
                           + 'Löse erst die Verknüpfung.'
                });
            }
        }

        // Der Wechsel auf `reaktion` setzt Emojis voraus — ohne sie gäbe es
        // nichts zum Anklicken, und das Menü wäre eine Nachricht ohne Funktion.
        if (felder.darstellung === 'reaktion') {
            const menu = await DiscordRoleMenus.getMenu(guildId, menuId);
            const ohneEmoji = (menu?.optionen || []).filter(o => !o.emoji);
            if (ohneEmoji.length > 0) {
                return res.status(400).json({
                    success: false,
                    message: `${ohneEmoji.length} Eintrag/Einträge haben kein Emoji. Reaktionen brauchen für jeden Eintrag eines.`
                });
            }
        }

        const geaendert = await DiscordRoleMenus.updateMenu(guildId, menuId, felder);
        if (!geaendert) {
            return res.status(404).json({ success: false, message: 'Menü nicht gefunden' });
        }
        return res.json({ success: true });
    } catch (error) {
        return fehler(res, error, 'Das Menü konnte nicht geändert werden');
    }
});

router.delete('/:menuId', requirePermission('DISCORD.ROLEMENUS.MANAGE'), async (req, res) => {
    const guildId = res.locals.guildId;
    const menuId = Number(req.params.menuId);

    if (!Number.isInteger(menuId)) {
        return res.status(400).json({ success: false, message: 'Ungültige Menü-ID' });
    }

    try {
        const geloescht = await DiscordRoleMenus.deleteMenu(guildId, menuId);
        if (!geloescht) {
            return res.status(404).json({ success: false, message: 'Menü nicht gefunden' });
        }
        // Die Nachricht im Kanal bleibt bewusst stehen: Sie zu löschen wäre ein
        // Eingriff in einen fremden Kanal, den niemand angefordert hat. Sie tut
        // ab jetzt nichts mehr — darauf weist die Oberfläche vor dem Löschen hin.
        return res.json({ success: true });
    } catch (error) {
        return fehler(res, error, 'Das Menü konnte nicht gelöscht werden');
    }
});

// ── Einträge ─────────────────────────────────────────────────────────────

router.post('/:menuId/eintraege', requirePermission('DISCORD.ROLEMENUS.MANAGE'), async (req, res) => {
    const guildId = res.locals.guildId;
    const menuId = Number(req.params.menuId);
    const roleId = String(req.body?.role_id || '').trim();
    const emoji = String(req.body?.emoji || '').trim() || null;

    if (!Number.isInteger(menuId)) {
        return res.status(400).json({ success: false, message: 'Ungültige Menü-ID' });
    }
    if (!roleId) {
        return res.status(400).json({ success: false, message: 'Es muss eine Rolle gewählt sein' });
    }

    try {
        const menu = await DiscordRoleMenus.getMenu(guildId, menuId);
        if (!menu) {
            return res.status(404).json({ success: false, message: 'Menü nicht gefunden' });
        }

        const grenze = MAX_EINTRAEGE[menu.darstellung] || 25;
        if (menu.optionen.length >= grenze) {
            return res.status(400).json({
                success: false,
                message: `Mehr als ${grenze} Einträge lässt Discord bei dieser Darstellung nicht zu`
            });
        }

        if (menu.darstellung === 'reaktion') {
            if (!emoji) {
                return res.status(400).json({
                    success: false,
                    message: 'Bei Reaktionen braucht jeder Eintrag ein Emoji'
                });
            }
            // Zwei Einträge mit demselben Emoji: Discord trägt dieselbe Reaktion
            // nur einmal — der zweite wäre über die Nachricht nicht erreichbar.
            if (menu.optionen.some(o => o.emoji === emoji)) {
                return res.status(409).json({
                    success: false,
                    message: 'Dieses Emoji ist in diesem Menü schon vergeben'
                });
            }
        }

        const id = await DiscordRoleMenus.addOption(guildId, menuId, {
            role_id: roleId,
            emoji,
            label: String(req.body?.label || '').trim().slice(0, 80) || null,
            description: String(req.body?.description || '').trim().slice(0, 100) || null,
            stil: ausListe(req.body?.stil, STILE)
        });

        return res.json({ success: true, id });
    } catch (error) {
        if (error?.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ success: false, message: 'Diese Rolle steht schon in dem Menü' });
        }
        return fehler(res, error, 'Der Eintrag konnte nicht gespeichert werden');
    }
});

router.delete('/eintraege/:optionId', requirePermission('DISCORD.ROLEMENUS.MANAGE'), async (req, res) => {
    const guildId = res.locals.guildId;
    const optionId = Number(req.params.optionId);

    if (!Number.isInteger(optionId)) {
        return res.status(400).json({ success: false, message: 'Ungültige Eintrags-ID' });
    }

    try {
        const geloescht = await DiscordRoleMenus.removeOption(guildId, optionId);
        if (!geloescht) {
            return res.status(404).json({ success: false, message: 'Eintrag nicht gefunden' });
        }
        return res.json({ success: true });
    } catch (error) {
        return fehler(res, error, 'Der Eintrag konnte nicht gelöscht werden');
    }
});

router.put('/:menuId/reihenfolge', requirePermission('DISCORD.ROLEMENUS.MANAGE'), async (req, res) => {
    const guildId = res.locals.guildId;
    const menuId = Number(req.params.menuId);
    const reihenfolge = Array.isArray(req.body?.reihenfolge) ? req.body.reihenfolge : null;

    if (!Number.isInteger(menuId) || !reihenfolge) {
        return res.status(400).json({ success: false, message: 'Ungültige Angaben' });
    }

    try {
        const geaendert = await DiscordRoleMenus.setOptionOrder(guildId, menuId, reihenfolge);
        return res.json({ success: true, geaendert });
    } catch (error) {
        return fehler(res, error, 'Die Reihenfolge konnte nicht gespeichert werden');
    }
});

// ── Bestehende Nachricht verknüpfen ──────────────────────────────────────

router.post('/:menuId/nachricht', requirePermission('DISCORD.ROLEMENUS.MANAGE'), async (req, res) => {
    const guildId = res.locals.guildId;
    const menuId = Number(req.params.menuId);
    const eingabe = String(req.body?.eingabe || '').trim();

    if (!Number.isInteger(menuId)) {
        return res.status(400).json({ success: false, message: 'Ungültige Menü-ID' });
    }
    if (!eingabe) {
        return res.status(400).json({ success: false, message: 'Bitte eine Nachrichten-ID oder einen Link angeben' });
    }

    try {
        const menu = await DiscordRoleMenus.getMenu(guildId, menuId);
        if (!menu) {
            return res.status(404).json({ success: false, message: 'Menü nicht gefunden' });
        }
        if (menu.message_id) {
            return res.status(409).json({
                success: false,
                message: 'Dieses Menü hängt bereits an einer Nachricht. Erst die Verknüpfung lösen.'
            });
        }

        const antwort = await fragBot('discord:pruefeNachricht', { guildId, eingabe });
        if (!antwort) {
            return res.status(503).json({ success: false, message: 'Der Bot antwortet nicht. Läuft er?' });
        }
        if (!antwort.ok) {
            return res.status(400).json({ success: false, message: antwort.fehler });
        }

        // An einer fremden Nachricht gehen nur Reaktionen. Statt das Verknüpfen
        // abzulehnen, wird die Darstellung mit umgestellt und gesagt, dass es
        // geschehen ist — abgelehnt zu werden ohne Ausweg hilft niemandem.
        const felder = {
            message_id: antwort.messageId,
            channel_id: antwort.channelId,
            fremde_nachricht: !antwort.vomBot
        };

        let umgestellt = false;
        if (!antwort.vomBot && menu.darstellung !== 'reaktion') {
            felder.darstellung = 'reaktion';
            umgestellt = true;
        }

        await DiscordRoleMenus.updateMenu(guildId, menuId, felder);

        return res.json({
            success: true,
            vomBot: antwort.vomBot,
            umgestellt,
            channelName: antwort.channelName,
            vorschau: antwort.vorschau,
            url: antwort.url
        });
    } catch (error) {
        return fehler(res, error, 'Die Nachricht konnte nicht verknüpft werden');
    }
});

router.delete('/:menuId/nachricht', requirePermission('DISCORD.ROLEMENUS.MANAGE'), async (req, res) => {
    const guildId = res.locals.guildId;
    const menuId = Number(req.params.menuId);

    if (!Number.isInteger(menuId)) {
        return res.status(400).json({ success: false, message: 'Ungültige Menü-ID' });
    }

    try {
        // Nur die Verknüpfung wird gelöst. Die Nachricht bleibt, wo sie ist —
        // besonders bei einer fremden wäre alles andere ein Übergriff. Die
        // Reaktionen des Bots bleiben ebenfalls stehen; sie wirken nicht mehr,
        // und sie ungefragt abzuräumen hiesse, in einem fremden Kanal
        // aufzuräumen.
        const geaendert = await DiscordRoleMenus.updateMenu(guildId, menuId, {
            message_id: null,
            fremde_nachricht: false
        });

        if (!geaendert) {
            return res.status(404).json({ success: false, message: 'Menü nicht gefunden' });
        }
        return res.json({ success: true });
    } catch (error) {
        return fehler(res, error, 'Die Verknüpfung konnte nicht gelöst werden');
    }
});

// ── Senden ───────────────────────────────────────────────────────────────

router.post('/:menuId/senden', requirePermission('DISCORD.ROLEMENUS.MANAGE'), async (req, res) => {
    const guildId = res.locals.guildId;
    const menuId = Number(req.params.menuId);

    if (!Number.isInteger(menuId)) {
        return res.status(400).json({ success: false, message: 'Ungültige Menü-ID' });
    }

    try {
        const antwort = await fragBot('discord:sendeRollenmenue', { guildId, menuId });

        if (!antwort) {
            return res.status(503).json({
                success: false,
                message: 'Der Bot antwortet nicht. Läuft er?'
            });
        }
        if (!antwort.ok) {
            return res.status(400).json({ success: false, message: antwort.fehler || 'Das Senden ist fehlgeschlagen' });
        }

        return res.json({
            success: true,
            neu: antwort.neu,
            url: antwort.url,
            uebersprungen: antwort.uebersprungen || []
        });
    } catch (error) {
        return fehler(res, error, 'Das Menü konnte nicht gesendet werden');
    }
});

/**
 * Eine Farbangabe auf `#RRGGBB` bringen.
 *
 * Nimmt die Kurzform `#RGB` an und schreibt sie aus. Alles andere ergibt null,
 * damit der Aufrufer auf die Vorgabe zurückfallen kann statt einen unbrauchbaren
 * Wert zu speichern.
 *
 * @param {*} wert
 * @returns {string|null}
 */
function zuFarbe(wert) {
    if (typeof wert !== 'string') return null;

    const roh = wert.trim().replace(/^#/, '');

    if (/^[0-9a-f]{3}$/i.test(roh)) {
        return ('#' + roh[0] + roh[0] + roh[1] + roh[1] + roh[2] + roh[2]).toUpperCase();
    }
    if (/^[0-9a-f]{6}$/i.test(roh)) {
        return ('#' + roh).toUpperCase();
    }
    return null;
}

/**
 * Eine Zahl aus einer Eingabe holen und in Grenzen halten.
 *
 * @param {*} wert
 * @param {number} vorgabe
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function zuZahl(wert, vorgabe, min, max) {
    const zahl = Number(wert);
    if (!Number.isFinite(zahl)) return vorgabe;
    return Math.min(Math.max(Math.trunc(zahl), min), max);
}

module.exports = router;
