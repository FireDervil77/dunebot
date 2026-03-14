/**
 * DaemonToken Model
 * 
 * Verwaltet Authentifizierungs-Tokens für Daemons
 * - Token-Generierung
 * - Token-Validierung
 * - Ablauf-Management
 * 
 * @module DaemonToken
 * @author FireBot Team
 */

const { ServiceManager } = require('dunebot-core');
const crypto = require('crypto');
const bcrypt = require('bcrypt');

class DaemonToken {
    /**
     * Neuen Token generieren
     * 
     * @param {string} guildId - Guild ID
     * @param {number} expiresInHours - Gültigkeit in Stunden (Standard: 24)
     * @param {string} description - Optionale Beschreibung
     * @param {string} createdBy - User ID des Erstellers
     * @returns {Promise<{token: string, tokenId: string}>}
     */
    static async generate(guildId, expiresInHours = 24, description = null, createdBy = null) {
        const dbService = ServiceManager.get('dbService');
        
        // Token generieren (64 Bytes = 128 Hex-Zeichen)
        const token = crypto.randomBytes(64).toString('hex');
        
        // Token hashen (bcrypt)
        const saltRounds = 12;
        const tokenHash = await bcrypt.hash(token, saltRounds);

        // Ablauf berechnen
        const expiresAt = new Date();
        expiresAt.setHours(expiresAt.getHours() + expiresInHours);

        // In DB speichern
        const result = await dbService.query(
            `INSERT INTO daemon_tokens 
             (token_hash, guild_id, created_by, description, expires_at, created_at)
             VALUES (?, ?, ?, ?, ?, NOW())`,
            [tokenHash, guildId, createdBy, description, expiresAt]
        );

        const tokenId = result.insertId;

        // WICHTIG: Token nur EINMAL zurückgeben!
        return { token, tokenId };
    }

    /**
     * Token validieren
     * 
     * @param {string} token - Klartext-Token
     * @returns {Promise<object|null>} Token-Daten oder null bei Fehler
     */
    static async validate(token) {
        const dbService = ServiceManager.get('dbService');
        
        // Alle ungenutzten, nicht-abgelaufenen Tokens laden
        const tokens = await dbService.query(
            `SELECT * FROM daemon_tokens 
             WHERE used = 0 AND expires_at > NOW()
             ORDER BY created_at DESC`
        );

        // Jeden Token prüfen (bcrypt.compare)
        for (const tokenData of tokens) {
            const isValid = await bcrypt.compare(token, tokenData.token_hash);
            
            if (isValid) {
                return tokenData;
            }
        }

        return null;
    }

    /**
     * Token als benutzt markieren
     * 
     * @param {number} tokenId - Token ID
     * @param {string} daemonId - Daemon UUID der den Token verwendet hat
     */
    static async markUsed(tokenId, daemonId) {
        const dbService = ServiceManager.get('dbService');
        
        await dbService.query(
            `UPDATE daemon_tokens 
             SET used = 1, used_at = NOW(), used_by_daemon_id = ?
             WHERE id = ?`,
            [daemonId, tokenId]
        );
    }

    /**
     * Alle Tokens für Guild abrufen
     * 
     * @param {string} guildId - Guild ID
     * @param {boolean} activeOnly - Nur aktive Tokens (Standard: true)
     * @returns {Promise<Array>}
     */
    static async getByGuild(guildId, activeOnly = true) {
        const dbService = ServiceManager.get('dbService');
        
        let query = 'SELECT * FROM daemon_tokens WHERE guild_id = ?';
        
        if (activeOnly) {
            query += ' AND expires_at > NOW() AND used = 0';
        }
        
        query += ' ORDER BY created_at DESC';

        return await dbService.query(query, [guildId]);
    }

    /**
     * Token nach ID abrufen
     * 
     * @param {number} tokenId - Token ID
     * @returns {Promise<object|null>}
     */
    static async getById(tokenId) {
        const dbService = ServiceManager.get('dbService');
        const [token] = await dbService.query(
            'SELECT * FROM daemon_tokens WHERE id = ?',
            [tokenId]
        );

        return token || null;
    }

    /**
     * Token widerrufen (abgelaufen setzen)
     * 
     * @param {number} tokenId - Token ID
     */
    static async revoke(tokenId) {
        const dbService = ServiceManager.get('dbService');
        
        await dbService.query(
            'UPDATE daemon_tokens SET expires_at = NOW() WHERE id = ?',
            [tokenId]
        );
    }

    /**
     * Abgelaufene Tokens löschen
     * 
     * @param {number} olderThanDays - Tokens älter als X Tage (Standard: 30)
     */
    static async cleanup(olderThanDays = 30) {
        const dbService = ServiceManager.get('dbService');
        
        await dbService.query(
            `DELETE FROM daemon_tokens 
             WHERE expires_at < DATE_SUB(NOW(), INTERVAL ? DAY)`,
            [olderThanDays]
        );
    }

    /**
     * Token-Statistiken für Guild
     * 
     * @param {string} guildId - Guild ID
     * @returns {Promise<object>}
     */
    static async getStats(guildId) {
        const dbService = ServiceManager.get('dbService');
        
        const [stats] = await dbService.query(
            `SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN used = 0 AND expires_at > NOW() THEN 1 ELSE 0 END) as active,
                SUM(CASE WHEN used = 0 AND expires_at > NOW() THEN 1 ELSE 0 END) as neverUsed,
                SUM(CASE WHEN expires_at <= NOW() THEN 1 ELSE 0 END) as expired
             FROM daemon_tokens
             WHERE guild_id = ?`,
            [guildId]
        );

        return stats || { total: 0, active: 0, neverUsed: 0, expired: 0 };
    }
}

module.exports = DaemonToken;
