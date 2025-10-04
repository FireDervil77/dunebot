const path = require("path");
const router = require("express").Router();
const { ServiceManager } = require("dunebot-sdk");

// GET Route bleibt unverändert
router.get("/", (_req, res) => {
    res.render(path.join(__dirname, "views", "guild.ejs"), {
        config: res.locals.config,
    });
});

router.put("/", async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');

    try {
        const body = req.body;
        const { config } = res.locals;

        // Server Config
        if (Object.prototype.hasOwnProperty.call(body, "server_config")) {
            if (
                (body.prefix && typeof body.prefix !== "string") ||
                (body.locale && typeof body.locale !== "string") ||
                (body.support_server && typeof body.support_server !== "string")
            ) {
                return res.status(400);
            }

            config.PREFIX_COMMANDS_PREFIX = body.prefix;
            config.LOCALE = body.locale;
            config.SUPPORT_SERVER = body.support_server;

            body.slash_commands = body.slash_commands === "on";
            config.INTERACTIONS_SLASH = body.slash_commands;

            body.context_menus = body.context_menus === "on";
            config.INTERACTIONS_CONTEXT = body.context_menus;

            // Statt ConfigModel.upsert() nutzen wir direkte MySQL Queries
            await dbService.query(`
                INSERT INTO configs (config_key, config_value, context) 
                VALUES (?, ?, 'server')
                ON DUPLICATE KEY UPDATE config_value = VALUES(config_value)
            `, [
                'server_config',
                JSON.stringify(config)
            ]);

            Logger.debug('Server Config aktualisiert');
        }

        // Dashboard Config
        if (Object.prototype.hasOwnProperty.call(body, "dash_config")) {
            if (
                (body.logo && typeof body.logo !== "string") ||
                (body.logo_url && typeof body.logo_url !== "string")
            ) {
                return res.status(400);
            }

            config.DASHBOARD_LOGO_NAME = body.logo;
            config.DASHBOARD_LOGO_URL = body.logo_url;

            // Statt ConfigModel.upsert() nutzen wir direkte MySQL Queries
            await dbService.query(`
                INSERT INTO configs (config_key, config_value, context) 
                VALUES (?, ?, 'dashboard')
                ON DUPLICATE KEY UPDATE config_value = VALUES(config_value)
            `, [
                'dashboard_config',
                JSON.stringify(config.DASHBOARD)
            ]);

            Logger.debug('Dashboard Config aktualisiert');
        }

        res.sendStatus(200);
    } catch (error) {
        Logger.error('Fehler beim Aktualisieren der Konfiguration:', error);
        res.sendStatus(500);
    }
});

module.exports = router;