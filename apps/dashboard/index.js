const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });
const { Logger } = require("dunebot-sdk/utils");
const ServiceManager = require("dunebot-core/lib/ServiceManager");
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

        // Dashboard-App initialisieren
        Logger.info("Initialisiere Dashboard-App...");
        const app = new App(ipcServer, dbService);
        
        // Die neue initialize()-Methode ruft loadTranslations() und loadPlugins() intern auf
        await app.initialize();
        Logger.success("Dashboard-App erfolgreich initialisiert");

        // Server starten
        const port = process.env.DASHBOARD_PORT || 3000;
        app.listen(port);

        // Graceful Shutdown
        process.on('SIGINT', async () => {
            Logger.info('SIGINT empfangen - fahre Server herunter...');
            await ipmServer.stop();
            await dbService.close();
            process.exit(0);
        });

        process.on('SIGTERM', async () => {
            Logger.info('SIGTERM empfangen - fahre Server herunter...');
            await ipmServer.stop();
            await dbService.close();
            process.exit(0);
        });
        
    } catch (error) {
        Logger.error("Fehler beim Starten des Dashboards:", error);
        process.exit(1);
    }
})();