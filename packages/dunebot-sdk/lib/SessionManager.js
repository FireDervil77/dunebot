/**
 * Session Manager Helper
 * 
 * Verwaltet Session-Cleanup und -Monitoring
 * @author FireDervil
 */

const { ServiceManager } = require('dunebot-core');

class SessionManager {
    constructor() {
        this.Logger = ServiceManager.get('Logger');
        this.dbService = ServiceManager.get('dbService');
        this.cleanupInterval = null;
    }

    /**
     * Startet automatisches Session-Cleanup
     * @param {number} intervalMinutes - Cleanup-Intervall in Minuten (default: 60)
     */
    startCleanup(intervalMinutes = 60) {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
        }

        const intervalMs = intervalMinutes * 60 * 1000;
        this.cleanupInterval = setInterval(() => {
            this.cleanupExpiredSessions();
        }, intervalMs);

        this.Logger.info(`🧹 Session-Cleanup startet - alle ${intervalMinutes} Minuten`);
        
        // Initiales Cleanup
        this.cleanupExpiredSessions();
    }

    /**
     * Bereinigt abgelaufene Sessions
     * WICHTIG: Löscht NUR abgelaufene ANONYME Sessions.
     * Authentifizierte User-Sessions werden NICHT gelöscht um Datenverlust zu vermeiden.
     */
    async cleanupExpiredSessions() {
        try {
            // Strategie: Nur anonyme Sessions löschen die abgelaufen sind
            // Authentifizierte Sessions (LENGTH(data) > 500) werden geschützt
            const result = await this.dbService.query(`
                DELETE FROM sessions 
                WHERE expires < UNIX_TIMESTAMP()
                AND LENGTH(data) < 500
            `);
            
            if (result.affectedRows > 0) {
                this.Logger.info(`🧹 ${result.affectedRows} abgelaufene anonyme Sessions bereinigt`);
            }
            
            return result.affectedRows;
        } catch (error) {
            this.Logger.error('❌ Fehler beim Session-Cleanup:', error);
            return 0;
        }
    }

    /**
     * Session-Statistiken abrufen
     */
    async getSessionStats() {
        try {
            const [totalResult] = await this.dbService.query(
                'SELECT COUNT(*) as total FROM sessions'
            );
            
            const [activeResult] = await this.dbService.query(
                'SELECT COUNT(*) as active FROM sessions WHERE expires > UNIX_TIMESTAMP()'
            );
            
            const [authenticatedResult] = await this.dbService.query(
                'SELECT COUNT(*) as authenticated FROM sessions WHERE LENGTH(data) > 500 AND expires > UNIX_TIMESTAMP()'
            );

            return {
                total: totalResult.total,
                active: activeResult.active,
                authenticated: authenticatedResult.authenticated,
                anonymous: activeResult.active - authenticatedResult.authenticated
            };
        } catch (error) {
            this.Logger.error('❌ Fehler beim Session-Stats-Abruf:', error);
            return null;
        }
    }

    /**
     * Stoppt Session-Cleanup
     */
    stopCleanup() {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
            this.Logger.info('🧹 Session-Cleanup gestoppt');
        }
    }

    /**
     * Zerstört alle Sessions eines Users (bei Logout)
     * @param {string} userId Discord User ID
     */
    async destroyUserSessions(userId) {
        try {
            // Sessions finden die den User enthalten
            const sessions = await this.dbService.query(
                "SELECT session_id, data FROM sessions WHERE data LIKE ? AND expires > UNIX_TIMESTAMP()",
                [`%"id":"${userId}"%`]
            );

            let destroyed = 0;
            for (const session of sessions) {
                try {
                    const sessionData = JSON.parse(session.data);
                    if (sessionData.user?.info?.id === userId) {
                        await this.dbService.query(
                            'DELETE FROM sessions WHERE session_id = ?',
                            [session.session_id]
                        );
                        destroyed++;
                    }
                } catch (parseError) {
                    // Ignoriere defekte Session-Daten
                }
            }

            if (destroyed > 0) {
                this.Logger.info(`🗑️ ${destroyed} Sessions für User ${userId} zerstört`);
            }

            return destroyed;
        } catch (error) {
            this.Logger.error('❌ Fehler beim Zerstören der User-Sessions:', error);
            return 0;
        }
    }

    /**
     * Zerstört alle Sessions eines Users für eine bestimmte Guild
     * WICHTIG: Wird aufgerufen wenn User aus Guild entfernt wird
     * 
     * @param {string} userId - Discord User ID
     * @param {string} guildId - Guild ID
     * @returns {Promise<number>} Anzahl zerstörter Sessions
     */
    async destroyUserGuildSessions(userId, guildId) {
        try {
            // Sessions finden die den User UND die Guild enthalten
            const sessions = await this.dbService.query(
                "SELECT session_id, data FROM sessions WHERE data LIKE ? AND expires > UNIX_TIMESTAMP()",
                [`%"id":"${userId}"%`]
            );

            let destroyed = 0;
            for (const session of sessions) {
                try {
                    const sessionData = JSON.parse(session.data);
                    
                    // Prüfe ob Session den User UND die Guild enthält
                    if (sessionData.user?.info?.id === userId) {
                        // Prüfe ob Session für diese Guild ist (currentGuildId oder guilds Array)
                        const hasGuild = sessionData.currentGuildId === guildId || 
                                       (sessionData.user?.guilds && sessionData.user.guilds.some(g => g.id === guildId));
                        
                        if (hasGuild) {
                            await this.dbService.query(
                                'DELETE FROM sessions WHERE session_id = ?',
                                [session.session_id]
                            );
                            destroyed++;
                        }
                    }
                } catch (parseError) {
                    // Ignoriere defekte Session-Daten
                }
            }

            if (destroyed > 0) {
                this.Logger.info(`🗑️ ${destroyed} Sessions für User ${userId} in Guild ${guildId} zerstört`);
            }

            return destroyed;
        } catch (error) {
            this.Logger.error(`❌ Fehler beim Zerstören der User-Guild-Sessions:`, error);
            return 0;
        }
    }
}

module.exports = SessionManager;