const path = require("path");
const ServiceManager = require("./ServiceManager");
const defaultConfig = require("../config/guild-defaults.json");

/**
 * GuildManager – Zentraler Service für Guild-Registrierung und -Verwaltung
 *
 * Kapselt den kompletten Lebenszyklus einer Guild:
 *  - Registrierung / Re-Join
 *  - Sync beim Bot-Start
 *  - Cleanup beim Verlassen
 *  - Default-Konfiguration initialisieren
 *  - Core-Plugin-Aktivierung pro Guild
 *
 * Wird im ServiceManager als 'guildManager' registriert.
 *
 * @author FireDervil
 */
class GuildManager {
    /**
     * @param {Object} options
     * @param {Function} [options.getPluginManager] - Callback der den PluginManager zurückgibt
     *        (lazy, da PluginManager erst nach GuildManager initialisiert wird)
     */
    constructor({ getPluginManager } = {}) {
        this._getPluginManager = getPluginManager || null;
    }

    // ─────────────────────────────────────────────
    // Public API
    // ─────────────────────────────────────────────

    /**
     * Registriert oder aktualisiert eine Guild (guildCreate-Event / Re-Join)
     * @param {import('discord.js').Guild} guild
     */
    async registerGuild(guild) {
        const Logger = ServiceManager.get("Logger");
        const dbService = ServiceManager.get("dbService");

        Logger.info(`Guild beigetreten: ${guild.name} (${guild.id})`);

        // 1. Guild in DB speichern / Re-Join aktualisieren
        await dbService.query(`
            INSERT INTO guilds
                (_id, guild_name, owner_id, owner_name, joined_at, created_at, updated_at)
            VALUES
                (?, ?, ?, ?, NOW(), NOW(), NOW())
            ON DUPLICATE KEY UPDATE
                guild_name  = VALUES(guild_name),
                owner_id    = VALUES(owner_id),
                owner_name  = VALUES(owner_name),
                joined_at   = VALUES(joined_at),
                left_at     = NULL,
                updated_at  = NOW()
        `, [
            guild.id,
            guild.name,
            guild.ownerId,
            guild.owner?.user?.username || null,
        ]);

        // 2. Prüfen ob Guild bereits konfiguriert ist
        const existing = await dbService.query(
            "SELECT COUNT(*) AS count FROM guild_plugins WHERE guild_id = ?",
            [guild.id]
        );

        if (!existing || existing[0].count === 0) {
            Logger.info(`Neue Guild – initialisiere Config für ${guild.id}`);
            await this.initGuildConfigs(guild.id);
            await this.ensureGuildPlugins(guild.id, guild.client);
        } else {
            Logger.info(`Guild ${guild.id} war bereits konfiguriert (Re-Join)`);
        }

        // 3. IPC-Event an Dashboard senden
        this._notifyDashboardJoined(guild);
    }

    /**
     * Synchronisiert eine bestehende Guild beim Bot-Start (ready-Event)
     * @param {import('discord.js').Guild} guild
     */
    async syncGuild(guild) {
        const Logger = ServiceManager.get("Logger");
        const dbService = ServiceManager.get("dbService");

        const owner = guild.members.cache.get(guild.ownerId) ||
            await guild.members.fetch(guild.ownerId).catch(() => null);

        // Guild upserten
        await dbService.upsertGuild({
            _id: guild.id,
            name: guild.name,
            owner_id: guild.ownerId,
            owner_name: owner?.user?.username || null,
            joined_at: guild.joinedAt ? new Date(guild.joinedAt) : new Date(),
            left_at: null,
        });

        // Konfiguration prüfen / initial anlegen
        const existing = await dbService.query(
            "SELECT COUNT(*) AS count FROM guild_plugins WHERE guild_id = ?",
            [guild.id]
        );

        if (!existing || existing[0].count === 0) {
            Logger.info(`Initialisiere Config für Guild "${guild.name}" (${guild.id})`);
            await this.initGuildConfigs(guild.id);
            await dbService.enablePluginForGuild(guild.id, "core", null, null);
        } else {
            Logger.debug(`Guild "${guild.name}" (${guild.id}) bereits konfiguriert`);
        }
    }

    /**
     * Markiert Guild als verlassen und löscht alle Guild-Daten (guildDelete-Event)
     * @param {import('discord.js').Guild} guild
     */
    async removeGuild(guild) {
        const Logger = ServiceManager.get("Logger");
        const dbService = ServiceManager.get("dbService");

        if (!guild.available) return;

        Logger.info(`Guild verlassen: ${guild.name} (${guild.id}) – Starte Datenbereinigung...`);

        // 1. Als verlassen markieren (nicht löschen!)
        await dbService.query(
            "UPDATE guilds SET left_at = NOW(), updated_at = NOW() WHERE _id = ?",
            [guild.id]
        );

        // 2. Alle Guild-Daten dynamisch bereinigen
        const stats = await this._cleanupAllGuildData(guild.id, dbService, Logger);

        Logger.success(`Guild-Bereinigung abgeschlossen für ${guild.name} (${guild.id}):`);
        Logger.success(`  ${stats.tablesProcessed} Tabellen verarbeitet, ${stats.totalDeleted} Datensätze gelöscht`);

        if (stats.errors.length > 0) {
            stats.errors.forEach(e => Logger.warn(`  Fehler: ${e}`));
        }
    }

    /**
     * Initialisiert die Default-Konfiguration für eine neue Guild
     * @param {string} guildId
     */
    async initGuildConfigs(guildId) {
        const Logger = ServiceManager.get("Logger");
        const dbService = ServiceManager.get("dbService");

        const flatConfig = this._flattenConfig(defaultConfig);

        const stats = await dbService.ensureConfigs("core", flatConfig, "shared", guildId);

        Logger.info(`Guild-Config für ${guildId}: ${stats.created} erstellt, ${stats.existing} vorhanden`);
    }

    /**
     * Aktiviert das Core-Plugin für eine neue Guild via PluginManager
     * @param {string} guildId
     * @param {import('discord.js').Client} client
     */
    async ensureGuildPlugins(guildId, client) {
        const Logger = ServiceManager.get("Logger");
        const pluginManager = client?.pluginManager || (this._getPluginManager ? this._getPluginManager() : null);

        if (pluginManager) {
            Logger.info(`Aktiviere Core-Plugin für neue Guild ${guildId} via PluginManager...`);
            await pluginManager.enableInGuild("core", guildId);
            Logger.success(`Core-Plugin für Guild ${guildId} vollständig initialisiert`);
        } else {
            // Fallback: Nur DB-Eintrag
            const dbService = ServiceManager.get("dbService");
            await dbService.enablePluginForGuild(guildId, "core", null, null);
            Logger.warn(`Core-Plugin für Guild ${guildId} nur in DB aktiviert (PluginManager nicht verfügbar)`);
        }
    }

    // ─────────────────────────────────────────────
    // Private Helpers
    // ─────────────────────────────────────────────

    /**
     * Sendet ein IPC-Event an das Dashboard, wenn eine Guild beitritt
     * @param {import('discord.js').Guild} guild
     */
    _notifyDashboardJoined(guild) {
        try {
            const ipcClient = guild.client?.ipcClient;
            if (ipcClient) {
                ipcClient.send("dashboard:GUILD_JOINED", {
                    guildId: guild.id,
                    guildName: guild.name,
                });
            }
        } catch (err) {
            const Logger = ServiceManager.get("Logger");
            Logger.warn(`IPC GUILD_JOINED fehlgeschlagen: ${err.message}`);
        }
    }

    /**
     * Macht ein verschachteltes Config-Objekt flach (key_subKey)
     * @param {Object} obj
     * @returns {Object}
     */
    _flattenConfig(obj) {
        const result = {};
        for (const key in obj) {
            if (typeof obj[key] === "object" && !Array.isArray(obj[key])) {
                const nested = this._flattenConfig(obj[key]);
                for (const sub in nested) {
                    result[`${key}_${sub}`] = nested[sub];
                }
            } else {
                result[key] = obj[key];
            }
        }
        return result;
    }

    /**
     * Löscht dynamisch alle Guild-Daten aus allen Tabellen mit guild_id-Spalte
     * @param {string} guildId
     * @param {Object} dbService
     * @param {Object} Logger
     * @returns {Promise<{tablesProcessed: number, totalDeleted: number, errors: string[]}>}
     */
    async _cleanupAllGuildData(guildId, dbService, Logger) {
        const stats = { tablesProcessed: 0, totalDeleted: 0, errors: [] };

        const tables = await dbService.query("SHOW TABLES");
        const tableNames = (Array.isArray(tables) ? tables : []).map(r => Object.values(r)[0]);

        for (const tableName of tableNames) {
            try {
                const columns = await dbService.query(`DESCRIBE ${tableName}`);
                const colNames = (Array.isArray(columns) ? columns : []).map(c => c.Field);

                const guildCol = colNames.includes("guild_id")
                    ? "guild_id"
                    : colNames.includes("guildId")
                        ? "guildId"
                        : null;

                if (!guildCol) continue;

                // Ausnahmen: Tabellen deren Daten aus historischen Gründen erhalten bleiben
                if (tableName === "user_feedback") {
                    Logger.debug(`Überspringe ${tableName} (historisch)`);
                    continue;
                }

                const result = await dbService.query(
                    `DELETE FROM \`${tableName}\` WHERE \`${guildCol}\` = ?`,
                    [guildId]
                );

                stats.tablesProcessed++;
                stats.totalDeleted += result?.affectedRows || 0;
                Logger.debug(`Bereinigt: ${tableName} (${result?.affectedRows || 0} Zeilen)`);
            } catch (err) {
                stats.errors.push(`${tableName}: ${err.message}`);
            }
        }

        return stats;
    }
}

module.exports = GuildManager;
