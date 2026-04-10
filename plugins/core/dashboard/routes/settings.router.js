const path = require("path");
const router = require("express").Router();
const { ServiceManager } = require("dunebot-core");
const { requirePermission } = require('../../../../apps/dashboard/middlewares/permissions.middleware');


router.get("/", requirePermission('CORE.SETTINGS.VIEW'), async (_req, res) => {
    const dbService = ServiceManager.get("dbService");
    const settings = await dbService.getSettings(res.locals.guild);
    res.render(path.join(__dirname, "views/settings.ejs"), { settings });
});

router.put("/", requirePermission('CORE.SETTINGS.EDIT'), async (req, res) => {
    const dbService = ServiceManager.get("dbService");
    const i18n = ServiceManager.get("i18n");
    const Logger = ServiceManager.get("Logger");

    try {
        const settings = await dbService.getSettings(res.locals.guild);
        const body = req.body;
        let needsUpdate = false;

        // Prefix-Update prüfen
        if (body.prefix && settings.prefix !== body.prefix) {
            settings.prefix = body.prefix;
            needsUpdate = true;
        }

        // Locale-Update prüfen
        if (body.locale) {
            if (!i18n.availableLanguages.find((lang) => lang === body.locale)) {
                return res.status(400).json({ error: "Invalid language" });
            }
            if (settings.locale !== body.locale) {
                const ipcResp = await req.broadcast("setGuildLocale", {
                    guildId: res.locals.guild.id,
                    locale: body.locale,
                });

                const status = ipcResp.find((d) => d.success)?.data;
                if (status !== "OK") {
                    return res.status(500).json({ error: "Failed to set locale" });
                }

                settings.locale = body.locale;
                needsUpdate = true;
            }
        }

        // Nur updaten wenn Änderungen vorliegen
        if (needsUpdate) {
            await dbService.query(`
                UPDATE settings 
                SET prefix = ?, 
                    locale = ?,
                    updated_at = NOW()
                WHERE _id = ?
            `, [
                settings.prefix,
                settings.locale,
                res.locals.guild.id
            ]);
            
            Logger.debug(`Settings für Guild ${res.locals.guild.id} aktualisiert`);
        }

        res.json({ 
            success: true, 
            message: needsUpdate ? 'Einstellungen erfolgreich gespeichert' : 'Keine Änderungen vorgenommen' 
        });
    } catch (error) {
        Logger.error(`Fehler beim Aktualisieren der Settings:`, error);
        res.status(500).json({ 
            success: false, 
            message: 'Fehler beim Speichern der Einstellungen' 
        });
    }
});

module.exports = router;
