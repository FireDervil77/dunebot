require("dotenv").config();
const { ShardingManager } = require("discord.js");
const { Logger } = require("dunebot-sdk/utils");
const path = require("path");

/**
 * DuneBot Sharding-Manager
 * Verwaltet mehrere Bot-Instanzen für große Discord-Bots
 * 
 * @author DuneBot Team
 */

// Initialize the logger
const logsDir = path.join(__dirname, "..", "..", "logs");
const today = new Date();
const logsFile = `shard-${today.getFullYear()}.${today.getMonth() + 1}.${today.getDate()}.log`;
Logger.init(path.join(logsDir, logsFile), { 
    level: process.env.LOG_LEVEL || 'debug'
});


Logger.info("=== DuneBot Shard-Manager startet ===");
Logger.info(`Version: ${process.env.BOT_VERSION || '1.0.0'}`);
Logger.info(`Umgebung: ${process.env.NODE_ENV || 'development'}`);
Logger.info(`Log-Level: ${process.env.LOG_LEVEL || 'info'}`);

// Konfiguration für den ShardingManager
const shardOptions = {
    token: process.env.BOT_TOKEN,
    // Anzahl der Shards (Umgebungsvariable 'auto' oder numerischer Wert)
    totalShards: process.env.SHARDS === "auto" ? "auto" : parseInt(process.env.SHARDS || "1"),
    // Automatisches Neustarten von abgestürzten Shards (konfiguriebar)
    respawn: process.env.AUTO_RESPAWN !== "false",
    // Zeitabstand zwischen dem Spawnen neuer Shards (in ms)
    spawnTimeout: parseInt(process.env.SPAWN_TIMEOUT || "30000"),
    // Sharding-Modus: 'process' (default) oder 'worker'
    mode: process.env.SHARD_MODE || 'process'
};

// Flag für Graceful Shutdown
let shuttingDown = process.env.SHUTDOWN_GRACEFUL || 'false';

// ShardingManager erstellen
const manager = new ShardingManager(path.join(__dirname, "bot.js"), shardOptions);

// Event-Handling für alle Shards
manager.on("shardCreate", (shard) => {
    Logger.info(`Shard ${shard.id} wird gestartet...`);

    // Fehlerbehandlung für jeden Shard
    shard.on('error', (error) => {
        Logger.error(`Fehler in Shard ${shard.id}:`, error);
    });
    
    // Disconnect-Handling
    shard.on('disconnect', () => {
        if (shuttingDown) {
            Logger.info(`Shard ${shard.id} hat die Verbindung im Rahmen des Shutdowns beendet`);
        } else {
            Logger.warn(`Shard ${shard.id} hat die Verbindung verloren`);
        }
    });
    
    // Reconnect-Handling
    shard.on('reconnecting', () => {
        Logger.info(`Shard ${shard.id} verbindet sich erneut...`);
    });
    
    // Death-Handling
    shard.on('death', (childProcess) => {
        const { exitCode, signalCode, pid } = childProcess;
        const dueToSignal = signalCode === 'SIGTERM' || signalCode === 'SIGINT';
        if (shuttingDown || dueToSignal) {
            Logger.info(`Shard ${shard.id} wurde beendet (signal=${signalCode}, exitCode=${exitCode})`);
            if (process.env.LOG_SHARD_DEATH_DETAILS === 'true') {
                Logger.debug(`Shard ${shard.id} Details:`, { pid, exitCode, signalCode });
            }
        } else {
            Logger.error(`Shard ${shard.id} ist abgestürzt (exitCode=${exitCode}, signal=${signalCode})`);
            if (process.env.LOG_SHARD_DEATH_DETAILS === 'true') {
                Logger.debug(`Shard ${shard.id} Details:`, { pid, exitCode, signalCode });
            }
        }
    });
});

// Shards spawnen
(async () => {
    try {
        Logger.info(`Starte ${shardOptions.totalShards === 'auto' ? 'automatisch ermittelte Anzahl an' : shardOptions.totalShards} Shards...`);
        const shards = await manager.spawn();
        Logger.success(`Erfolgreich ${shards.size} Shards gestartet`);
    } catch (err) {
        Logger.error("Fehler beim Spawnen der Shards:", err);
        process.exit(1);
    }
})();

// Graceful Shutdown
process.on('SIGINT', async () => {
    Logger.info('SIGINT empfangen, fahre alle Shards herunter...');
    shuttingDown = true;
    try {
        const shardCollection = manager.shards;
        const shardCount = shardCollection.size;
        
        if (shardCount === 0) {
            Logger.warn('Keine aktiven Shards gefunden');
            process.exit(0);
            return;
        }
        
        Logger.info(`Fahre ${shardCount} Shards herunter...`);
        
        // Shards einzeln herunterfahren
        for (const [id, shard] of shardCollection.entries()) {
            try {
                Logger.info(`Fahre Shard ${id} herunter...`);
                await shard.kill(); // sendet SIGTERM -> exitCode=null ist erwartbar
                Logger.info(`Shard ${id} erfolgreich beendet`);
            } catch (err) {
                Logger.error(`Fehler beim Herunterfahren von Shard ${id}:`, err);
            }
        }
        
        Logger.success('Alle Shards erfolgreich heruntergefahren');
    } catch (err) {
        Logger.error('Fehler beim Herunterfahren der Shards:', err);
    } finally {
        Logger.info('Shard-Manager wird beendet');
        process.exit(0);
    }
});

// Optional: auch SIGTERM abfangen (Container/PM2)
process.on('SIGTERM', async () => {
    Logger.info('SIGTERM empfangen, fahre alle Shards herunter...');
    shuttingDown = true;
    try {
        const shardCollection = manager.shards;
        for (const [id, shard] of shardCollection.entries()) {
            try {
                Logger.info(`Fahre Shard ${id} herunter...`);
                await shard.kill();
                Logger.info(`Shard ${id} erfolgreich beendet`);
            } catch (err) {
                Logger.error(`Fehler beim Herunterfahren von Shard ${id}:`, err);
            }
        }
        Logger.success('Alle Shards erfolgreich heruntergefahren');
    } catch (err) {
        Logger.error('Fehler beim Herunterfahren der Shards:', err);
    } finally {
        Logger.info('Shard-Manager wird beendet');
        process.exit(0);
    }
});



// Globale Fehlerbehandlung
process.on("unhandledRejection", (err) => {
    Logger.error("Unbehandelte Zusage (Promise) im Shard-Manager abgelehnt:", err);
});

process.on("uncaughtException", (err) => {
    Logger.error("Unbehandelte Ausnahme im Shard-Manager:", err);
});