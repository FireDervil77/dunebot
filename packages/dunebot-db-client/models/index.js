/**
 * Sammlung aller Tabellendefinitionen für den nativen MySQL-Client
 * @author firedervil
 */

const Guild = require("./Guild");
const User = require("./User");
const Configs = require("./Config");
const News = require("./News");
const Locale = require("./Locale");
const State = require("./State");
const NavItem = require("./NavItem");
const Changelog = require("./Changelog");
const Notifications = require("./Notifications");

/**
 * Liefert alle SQL-CREATE-Statements für die Datenbank
 * @returns {Object} Tabellendefinitionen
 */
module.exports = {
    tableDefinitions: {
        Guild: Guild(),
        User: User(),
        Config: Configs(),
        News: News(),
        Locale: Locale(),
        State: State(),
        NavItem: NavItem(),
        Changelog: Changelog(),
        Notifications: Notifications()
    },
    
    /**
     * Erstellt alle Tabellen in der Datenbank
     * @param {Object} dbClient - Instanz des DBClient
     * @returns {Promise<void>}
     */
    async createTables(dbClient) {
        const Logger = require("dunebot-core/lib/ServiceManager").get("Logger");
        try {
            for (const [name, definition] of Object.entries(this.tableDefinitions)) {
                Logger.debug(`Erstelle Tabelle: ${name}`);
                Logger.debug(`SQL: ${definition}`);
                try {
                    await dbClient.query(definition);
                    Logger.debug(`Tabelle ${name} erfolgreich erstellt oder existiert bereits`);
                } catch (error) {
                    Logger.error(`Fehler beim Erstellen der Tabelle ${name}:`, error);
                }
            }
            Logger.success("Alle Tabellen wurden erfolgreich initialisiert");
        } catch (error) {
            Logger.error("Fehler bei der Tabellenerstellung:", error);
            throw error;
        }
    }
};