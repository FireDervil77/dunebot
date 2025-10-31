const mysql = require('mysql2/promise');
const { ServiceManager } = require("dunebot-core");
require("dotenv").config();

/**
 * Nativer MySQL-Client für DuneBot
 * Stellt grundlegende Datenbankfunktionen bereit
 * 
 * @author firedervil
 */
class DBClient {
    static #instance = null;

    /**
     * Erstellt eine neue Verbindung zur MySQL-Datenbank
     * @param {Object} options Verbindungsoptionen
     */
    constructor(options = {}) {
        this.pool = mysql.createPool({
            host: options.host || process.env.MYSQL_HOST || "localhost",
            port: options.port || process.env.MYSQL_PORT || 3306,
            user: options.username || process.env.MYSQL_USER,
            password: options.password || process.env.MYSQL_PASSWORD,
            database: options.database || process.env.MYSQL_DATABASE,
            waitForConnections: true,
            connectionLimit: 10,
            queueLimit: 0,
            namedPlaceholders: true // Unterstützung für benannte Parameter
        });
    }

    /**
     * Singleton-Methode
     * @param {Object} options Verbindungsoptionen
     * @returns {DBClient} DBClient-Instanz
     */
    static getInstance(options = {}) {
        if (!DBClient.#instance) {
            DBClient.#instance = new DBClient(options);
        }
        return DBClient.#instance;
    }

    /**
     * Überprüft die Verbindung zur Datenbank
     * @returns {Promise<void>}
     */
    async connect() {
        const Logger = ServiceManager.get('Logger');
        try {
            // Testabfrage, um die Verbindung zu prüfen
            await this.query('SELECT 1');
            Logger.info("MySQL-Verbindung erfolgreich hergestellt");
            return this;
        } catch (error) {
            Logger.error("Fehler beim Verbinden mit der MySQL-Datenbank:", error);
            throw error;
        }
    }

    /**
     * Führt eine SQL-Abfrage aus
     * @param {string} sql SQL-Query
     * @param {Array|Object} params Parameter für die Query (Array oder Objekt bei benannten Parametern)
     * @returns {Promise<any>} Ergebnis der Abfrage
     */
    async query(sql, params = []) {
        const [rows] = await this.pool.execute(sql, params);
        return rows;
    }

    /**
     * Führt mehrere Abfragen innerhalb einer Transaktion aus
     * @param {Function} callback Funktion, die Queries ausführt
     * @returns {Promise<any>} Ergebnis der Transaktion
     */
    async transaction(callback) {
        const connection = await this.pool.getConnection();
        await connection.beginTransaction();
        
        try {
            const result = await callback(connection);
            await connection.commit();
            return result;
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }

    /**
     * Prüft ob eine Tabelle existiert
     * @param {string} tableName Name der Tabelle
     * @returns {Promise<boolean>} true wenn Tabelle existiert
     */
    async tableExists(tableName) {
        try {
            const rows = await this.query(
                'SELECT COUNT(*) as count FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?',
                [tableName]
            );
            return rows[0].count > 0;
        } catch (error) {
            const Logger = ServiceManager.get('Logger');
            Logger.error(`[DBClient] Fehler beim Prüfen der Tabelle ${tableName}:`, error);
            return false;
        }
    }

    /**
     * Schließt den Connection-Pool
     */
    async close() {
        await this.pool.end();
        DBClient.#instance = null;
    }
}

module.exports = DBClient;