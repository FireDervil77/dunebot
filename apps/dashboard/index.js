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

// ============================================================================
// FAIL-FAST: Kritische Secrets MÜSSEN gesetzt sein — sonst kein Start.
// Verhindert, dass die App mit öffentlich bekannten Fallback-Secrets
// (z. B. "change-me") aus dem Quellcode läuft.
// ============================================================================
const REQUIRED_SECRETS = ['SESSION_SECRET', 'CSRF_SECRET', 'JWT_SECRET'];
const missingSecrets = REQUIRED_SECRETS.filter(name => !process.env[name]);
if (missingSecrets.length > 0) {
    Logger.error(`❌ FATAL: Fehlende kritische ENV-Variablen: ${missingSecrets.join(', ')}`);
    Logger.error('   Dashboard startet NICHT mit unsicheren Fallback-Secrets. Bitte .env prüfen.');
    process.exit(1);
}

// ============================================================================
// CRASH-NETZ: Unbehandelte Fehler loggen statt stillschweigend zu sterben.
// - unhandledRejection: nur loggen (Prozess läuft weiter, pm2 muss nicht neu starten)
// - uncaughtException: loggen und beenden (Prozess-Zustand ist undefiniert; pm2 startet neu)
// ============================================================================
process.on('unhandledRejection', (reason, promise) => {
    Logger.error('❌ Unhandled Promise Rejection:', reason instanceof Error ? reason.stack : reason);
});

process.on('uncaughtException', (error) => {
    Logger.error('❌ Uncaught Exception — Prozess wird beendet (pm2 startet neu):', error.stack || error);
    process.exit(1);
});

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

        // Kern-Permissions für alle bekannten Guilds registrieren
        try {
            const guilds = await dbService.query('SELECT _id FROM guilds');
            if (guilds && guilds.length > 0) {
                Logger.info(`Lade Kern-Permissions für ${guilds.length} Guild(s)...`);
                for (const row of guilds) {
                    await permissionManager.loadKernelPermissions(row._id).catch(e => {
                        Logger.warn(`Kern-Permissions für Guild ${row._id} fehlgeschlagen: ${e.message}`);
                    });
                }
                Logger.success('Kern-Permissions geladen');
            }
        } catch (e) {
            Logger.warn('Kern-Permissions konnten nicht geladen werden:', e.message);
        }

        // IPC-Server initialisieren
        Logger.info("Initialisiere IPC-Server...");
        const ipcServer = new IPCServer();
        await ipcServer.initialize();
        Logger.success("IPC-Server initialisiert");
        ServiceManager.register("ipcServer", ipcServer);
        
        // IPM Server initialisieren (Daemons über den Busbahnhof)
        Logger.info("Starte IPM-Server (Dock am Busbahnhof)...");
        const ipmServer = new IPMServer();
        await ipmServer.start();
        Logger.success("IPM-Server gestartet");
        ServiceManager.register('ipmServer', ipmServer);

        // Event Router initialisieren (IPM-Message-Routing)
        Logger.info("Initialisiere Event-Router...");
        const eventRouter = require('./helpers/IPMEventRouter');
        ServiceManager.register('eventRouter', eventRouter);
        Logger.success("Event-Router initialisiert");

        // SSE Manager initialisieren (Server-Sent Events für Browser)
        Logger.info("Initialisiere SSE-Manager...");
        const sseManager = require('./helpers/SSEManager');
        ServiceManager.register('sseManager', sseManager);
        Logger.success("SSE-Manager initialisiert");

        // Console Manager wird vom Gameserver-Plugin registriert
        // (Entfernt, da Plugin-spezifisch und nicht Core-Service)

        // Dashboard-App initialisieren
        Logger.info("Initialisiere Dashboard-App...");
        Logger.debug("📦 Erstelle App-Instanz...");
        const app = new App(ipcServer, dbService);
        Logger.debug("✅ App-Instanz erstellt");
        
        // Die neue initialize()-Methode ruft loadTranslations() und loadPlugins() intern auf
        Logger.debug("🚀 Starte app.initialize()...");
        await app.initialize();
        Logger.success("Dashboard-App erfolgreich initialisiert");

        // Erst jetzt an den Bahnhof: Er stellt die Anmeldungen sofort, und dafür
        // müssen Migrationen und Plugins stehen (IPMServer.andocken).
        await ipmServer.andocken();

        // Kern-Widgets direkt beim Start registrieren (außerhalb des Plugin-Systems)
        const { registerAdminWidgets } = require('./helpers/AdminWidgets');
        registerAdminWidgets(
            app.app.pluginManager,
            app.app.themeManager
        );

        const { registerKernWidgets } = require('./helpers/KernWidgets');
        registerKernWidgets(
            ServiceManager.get('pluginManager'),
            ServiceManager.get('themeManager')
        );
        Logger.success('Kern-Widgets registriert');

        // Server starten
        const port = process.env.DASHBOARD_PORT || 3000;
        app.listen(port);

        // Toast-Logs nach 7 Tagen löschen: seit 2026-11-14 eine Frist des
        // Kerns (`plugins/core/package.json` `aufbewahrung`, G-05), nicht mehr
        // ein eigener node-cron hier.

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