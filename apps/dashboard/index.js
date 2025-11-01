const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });
const { Logger } = require("dunebot-sdk/utils");
const {ServiceManager} = require("dunebot-core");
const PathConfig = require("dunebot-sdk/lib/utils/PathConfig"); // Hier PathConfig importieren


// Logger initialisieren
const logsDir = path.join(__dirname, "..", "..", "logs");
const today = new Date();
const logsFile = `dashboard-${today.getFullYear()}.${today.getMonth() + 1}.${today.getDate()}.log`;
Logger.init(path.join(logsDir, logsFile));

// Logger im ServiceManager registrieren
ServiceManager.register("Logger", Logger);

// PathConfig initialisieren
PathConfig.init(path.join(__dirname, "..", "..")); // Root-Verzeichnis übergeben


const { DBService, models } = require("dunebot-db-client");
const App = require("./app");
const IPCServer = require("./helpers/IPCServer");
const IPMServer = require('./helpers/IPMServer');

/**
 * Hauptfunktion zum Starten des Dashboards
 */
(async () => {
    try {
        const Logger = ServiceManager.get('Logger');
        Logger.info("Starte Dashboard...");

        // Datenbank-Service initialisieren
        Logger.info("Verbinde mit der Datenbank...");
        const dbService = new DBService({
            database: process.env.MYSQL_DATABASE,
            username: process.env.MYSQL_USER,
            password: process.env.MYSQL_PASSWORD,
            host: process.env.MYSQL_HOST,
            port: process.env.MYSQL_PORT
        });
        await dbService.connect(models);
        Logger.success("Datenbankverbindung hergestellt");

        // DBService im ServiceManager registrieren
        ServiceManager.register("dbService", dbService);

        // PermissionManager initialisieren
        Logger.info("Initialisiere PermissionManager...");
        const permissionManager = require("dunebot-sdk/lib/PermissionManager");
        await permissionManager.initialize();
        ServiceManager.register("permissionManager", permissionManager);
        Logger.success("PermissionManager initialisiert");

        // IPC-Server initialisieren
        Logger.info("Initialisiere IPC-Server...");
        const ipcServer = new IPCServer();
        await ipcServer.initialize();
        Logger.success("IPC-Server initialisiert");
        ServiceManager.register("ipcServer", ipcServer);
        
        // IPM Server initialisieren (WebSocket für Daemons)
        Logger.info("Starte IPM-Server (WebSocket Port 9340)...");
        const ipmServer = new IPMServer(parseInt(process.env.IPM_SERVER_PORT || '9340'));
        await ipmServer.start();
        Logger.success("IPM-Server gestartet");
        ServiceManager.register('ipmServer', ipmServer);

        // SSE Manager initialisieren (Server-Sent Events für Browser)
        Logger.info("Initialisiere SSE-Manager...");
        const sseManager = require('./helpers/SSEManager');
        ServiceManager.register('sseManager', sseManager);
        Logger.success("SSE-Manager initialisiert");

        // Dashboard-App initialisieren
        Logger.info("Initialisiere Dashboard-App...");
        const app = new App(ipcServer, dbService);
        
        // Die neue initialize()-Methode ruft loadTranslations() und loadPlugins() intern auf
        await app.initialize();
        Logger.success("Dashboard-App erfolgreich initialisiert");

        // Post-Deployment: Plugin-Update-Check (SOFORT nach Start)
        Logger.info("🚀 Post-Deployment: Prüfe auf verfügbare Plugin-Updates...");
        try {
            await app.checkAndApplyPendingUpdates();
        } catch (updateError) {
            Logger.error("Fehler beim Post-Deployment Update-Check:", updateError);
            // Nicht abbrechen, Dashboard startet trotzdem
        }

        // Server starten
        const port = process.env.DASHBOARD_PORT || 3000;
        app.listen(port);

        // Toast-Logs Cleanup: Einmalig beim Start
        Logger.info("Führe Toast-Logs Cleanup durch...");
        try {
            const cleanupResult = await dbService.query(`
                DELETE FROM guild_toast_logs 
                WHERE created_at < DATE_SUB(NOW(), INTERVAL 7 DAY)
            `);
            Logger.info(`🗑️  Toast-Logs Cleanup: ${cleanupResult.affectedRows || 0} alte Einträge entfernt`);
        } catch (cleanupError) {
            Logger.warn('Fehler beim Toast-Logs Cleanup:', cleanupError.message);
        }

        // Toast-Logs Cleanup: Cronjob (täglich um 3 Uhr)
        const cron = require('node-cron');
        cron.schedule('0 3 * * *', async () => {
            Logger.info('[Cron] Starte Toast-Logs Cleanup...');
            try {
                const result = await dbService.query(`
                    DELETE FROM guild_toast_logs 
                    WHERE created_at < DATE_SUB(NOW(), INTERVAL 7 DAY)
                `);
                Logger.info(`🗑️  [Cron] Toast-Logs bereinigt: ${result.affectedRows || 0} Einträge gelöscht`);
            } catch (error) {
                Logger.error('[Cron] Fehler beim Toast-Logs Cleanup:', error);
            }
        });
        Logger.success('Toast-Logs Cleanup-Cronjob aktiviert (täglich 3:00 Uhr)');

        // Graceful Shutdown
        process.on('SIGINT', async () => {
            Logger.info('SIGINT empfangen - fahre Server herunter...');
            sseManager.closeAll();
            await ipmServer.stop();
            await dbService.close();
            process.exit(0);
        });

        process.on('SIGTERM', async () => {
            Logger.info('SIGTERM empfangen - fahre Server herunter...');
            sseManager.closeAll();
            await ipmServer.stop();
            await dbService.close();
            process.exit(0);
        });
        
    } catch (error) {
        Logger.error("Fehler beim Starten des Dashboards:", error);
        process.exit(1);
    }
})();