const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { ServiceManager } = require('dunebot-core');

class GiveawayManager {
    constructor(client) {
        this.client = client;
        this.dbService = ServiceManager.get('dbService');
        this.Logger = ServiceManager.get('Logger');
        this.timers = new Map(); // giveawayId -> timeout
        this.claimTimers = new Map(); // giveawayId -> claim timeout
    }

    // ─── Lifecycle ──────────────────────────────────────────

    async restoreTimers() {
        // Aktive Giveaways wiederherstellen
        const rows = await this.dbService.query(
            `SELECT * FROM giveaways WHERE status = 'active' AND ends_at > NOW()`
        );
        let restored = 0;
        for (const giveaway of rows) {
            const msLeft = new Date(giveaway.ends_at).getTime() - Date.now();
            if (msLeft > 0) {
                this._scheduleEnd(giveaway.id, msLeft);
                restored++;
            } else {
                await this.endGiveaway(giveaway.id);
            }
        }
        this.Logger.info(`[Giveaway] ${restored} aktive Giveaways wiederhergestellt`);

        // Abgelaufene aktive Giveaways beenden
        const expired = await this.dbService.query(
            `SELECT * FROM giveaways WHERE status = 'active' AND ends_at <= NOW()`
        );
        for (const giveaway of expired) {
            await this.endGiveaway(giveaway.id);
        }

        // Geplante Giveaways wiederherstellen
        const scheduled = await this.dbService.query(
            `SELECT * FROM giveaways WHERE status = 'scheduled' AND scheduled_start > NOW()`
        );
        for (const giveaway of scheduled) {
            const msUntilStart = new Date(giveaway.scheduled_start).getTime() - Date.now();
            if (msUntilStart > 0) {
                this._scheduleStart(giveaway.id, msUntilStart);
            } else {
                await this._activateScheduledGiveaway(giveaway.id);
            }
        }

        // Fällige geplante Giveaways aktivieren
        const dueScheduled = await this.dbService.query(
            `SELECT * FROM giveaways WHERE status = 'scheduled' AND scheduled_start <= NOW()`
        );
        for (const giveaway of dueScheduled) {
            await this._activateScheduledGiveaway(giveaway.id);
        }

        // Claim-Timer wiederherstellen
        const claimPending = await this.dbService.query(
            `SELECT g.* FROM giveaways g WHERE g.status = 'ended' AND g.claim_ends_at IS NOT NULL AND g.claim_ends_at > NOW()`
        );
        for (const giveaway of claimPending) {
            const msLeft = new Date(giveaway.claim_ends_at).getTime() - Date.now();
            if (msLeft > 0) {
                this._scheduleClaimExpiry(giveaway.id, msLeft);
            }
        }
    }

    destroy() {
        for (const [id, timer] of this.timers) {
            clearTimeout(timer);
        }
        this.timers.clear();
        for (const [id, timer] of this.claimTimers) {
            clearTimeout(timer);
        }
        this.claimTimers.clear();
    }

    // ─── Core Operations ────────────────────────────────────

    async createGiveaway(guildId, channelId, options) {
        const {
            prize,
            duration,
            winnerCount = 1,
            createdBy,
            hostedBy,
            description = null,
            title = 'Giveaway',
            embedColor = '#f59e0b',
            buttonEmoji = '🎁',
            allowedRoles = null,
            scheduledStart = null,
            claimDurationMs = null,
            requirements = [],
        } = options;

        const endsAt = new Date(Date.now() + duration);
        const isScheduled = scheduledStart && new Date(scheduledStart).getTime() > Date.now();
        const status = isScheduled ? 'scheduled' : 'active';

        const result = await this.dbService.query(
            `INSERT INTO giveaways (guild_id, channel_id, prize, title, description, winner_count,
                ends_at, scheduled_start, created_by, hosted_by, embed_color, button_emoji,
                allowed_roles, claim_duration_ms, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [guildId, channelId, prize, title, description, winnerCount,
             isScheduled ? new Date(new Date(scheduledStart).getTime() + duration) : endsAt,
             isScheduled ? new Date(scheduledStart) : null,
             createdBy || '0', hostedBy || createdBy || '0', embedColor, buttonEmoji,
             allowedRoles ? JSON.stringify(allowedRoles) : null,
             claimDurationMs || null,
             status]
        );

        const giveawayId = result.insertId;

        // Requirements speichern
        if (requirements.length > 0) {
            for (const req of requirements) {
                await this.dbService.query(
                    `INSERT INTO giveaway_requirements (giveaway_id, type, value) VALUES (?, ?, ?)`,
                    [giveawayId, req.type, String(req.value)]
                );
            }
        }

        if (isScheduled) {
            const msUntilStart = new Date(scheduledStart).getTime() - Date.now();
            this._scheduleStart(giveawayId, msUntilStart);
            return { id: giveawayId, scheduled: true };
        }

        // Discord Embed posten
        const message = await this._postEmbed(giveawayId, guildId, channelId);
        if (message) {
            await this.dbService.query(
                `UPDATE giveaways SET message_id = ? WHERE id = ?`,
                [message.id, giveawayId]
            );
        }

        // Timer setzen
        this._scheduleEnd(giveawayId, duration);

        return { id: giveawayId, messageId: message?.id };
    }

    async endGiveaway(giveawayId, force = false) {
        const rows = await this.dbService.query(
            `SELECT * FROM giveaways WHERE id = ?`, [giveawayId]
        );
        if (!rows.length) return null;
        const giveaway = rows[0];

        if (giveaway.status === 'ended' || giveaway.status === 'cancelled') {
            return { error: 'already_ended' };
        }

        // Timer löschen
        this._clearTimer(giveawayId);

        // Gewinner ziehen
        const winners = await this._drawWinners(giveawayId, giveaway.winner_count);

        // Status updaten
        await this.dbService.query(
            `UPDATE giveaways SET status = 'ended', ended_at = NOW() WHERE id = ?`,
            [giveawayId]
        );

        // Gewinner in DB speichern
        for (const userId of winners) {
            await this.dbService.query(
                `INSERT INTO giveaway_winners (giveaway_id, user_id, claim_status) VALUES (?, ?, ?)`,
                [giveawayId, userId, giveaway.claim_duration_ms ? 'pending' : 'claimed']
            );
        }

        // Claim-Timer setzen falls konfiguriert
        if (giveaway.claim_duration_ms && winners.length > 0) {
            const claimEndsAt = new Date(Date.now() + giveaway.claim_duration_ms);
            await this.dbService.query(
                `UPDATE giveaways SET claim_ends_at = ? WHERE id = ?`,
                [claimEndsAt, giveawayId]
            );
            this._scheduleClaimExpiry(giveawayId, giveaway.claim_duration_ms);

            // Embed mit Claim-Button updaten
            await this._updateEmbedEndedWithClaim(giveaway, winners);
        } else {
            // Normales Ende-Embed
            await this._updateEmbedEnded(giveaway, winners);
        }

        // Gewinner benachrichtigen
        await this._notifyWinners(giveaway, winners);

        return { winners, giveaway };
    }

    async rerollGiveaway(giveawayId, count = 1) {
        const rows = await this.dbService.query(
            `SELECT * FROM giveaways WHERE id = ?`, [giveawayId]
        );
        if (!rows.length) return { error: 'not_found' };
        const giveaway = rows[0];

        if (giveaway.status !== 'ended') {
            return { error: 'not_ended' };
        }

        // Bisherige Gewinner holen
        const prevWinners = await this.dbService.query(
            `SELECT user_id FROM giveaway_winners WHERE giveaway_id = ?`, [giveawayId]
        );
        const excludeIds = prevWinners.map(w => w.user_id);

        // Neue Gewinner aus verbleibenden Einträgen
        const newWinners = await this._drawWinners(giveawayId, count, excludeIds);
        if (!newWinners.length) return { error: 'no_entries' };

        // Neue Gewinner in DB
        for (const userId of newWinners) {
            await this.dbService.query(
                `INSERT INTO giveaway_winners (giveaway_id, user_id, claim_status) VALUES (?, ?, 'claimed')`,
                [giveawayId, userId]
            );
        }

        // Reroll-Nachricht im Channel posten
        await this._postRerollMessage(giveaway, newWinners);

        return { winners: newWinners };
    }

    async pauseGiveaway(giveawayId) {
        const rows = await this.dbService.query(
            `SELECT * FROM giveaways WHERE id = ?`, [giveawayId]
        );
        if (!rows.length) return { error: 'not_found' };
        const giveaway = rows[0];

        if (giveaway.status !== 'active') return { error: 'not_active' };

        this._clearTimer(giveawayId);

        // Verbleibende Zeit in metadata speichern
        const remainingMs = new Date(giveaway.ends_at).getTime() - Date.now();
        await this.dbService.query(
            `UPDATE giveaways SET status = 'paused', metadata = JSON_SET(COALESCE(metadata, '{}'), '$.remaining_ms', ?) WHERE id = ?`,
            [remainingMs, giveawayId]
        );

        await this._updateEmbedPaused(giveaway);
        return { success: true };
    }

    async resumeGiveaway(giveawayId) {
        const rows = await this.dbService.query(
            `SELECT * FROM giveaways WHERE id = ?`, [giveawayId]
        );
        if (!rows.length) return { error: 'not_found' };
        const giveaway = rows[0];

        if (giveaway.status !== 'paused') return { error: 'not_paused' };

        const metadata = typeof giveaway.metadata === 'string' ? JSON.parse(giveaway.metadata) : (giveaway.metadata || {});
        const remainingMs = metadata.remaining_ms || 60000;
        const newEndsAt = new Date(Date.now() + remainingMs);

        await this.dbService.query(
            `UPDATE giveaways SET status = 'active', ends_at = ?, metadata = JSON_REMOVE(COALESCE(metadata, '{}'), '$.remaining_ms') WHERE id = ?`,
            [newEndsAt, giveawayId]
        );

        this._scheduleEnd(giveawayId, remainingMs);

        // Refresh giveaway data for embed update
        giveaway.ends_at = newEndsAt;
        giveaway.status = 'active';
        await this._updateEmbedActive(giveaway);
        return { success: true };
    }

    async deleteGiveaway(giveawayId) {
        const rows = await this.dbService.query(
            `SELECT * FROM giveaways WHERE id = ?`, [giveawayId]
        );
        if (!rows.length) return { error: 'not_found' };
        const giveaway = rows[0];

        this._clearTimer(giveawayId);
        this._clearClaimTimer(giveawayId);

        // Discord-Nachricht löschen
        try {
            const guild = this.client.guilds.cache.get(giveaway.guild_id);
            if (guild) {
                const channel = guild.channels.cache.get(giveaway.channel_id);
                if (channel && giveaway.message_id) {
                    const msg = await channel.messages.fetch(giveaway.message_id).catch(() => null);
                    if (msg) await msg.delete().catch(() => {});
                }
            }
        } catch (e) { /* ignore */ }

        await this.dbService.query(
            `UPDATE giveaways SET status = 'cancelled' WHERE id = ?`, [giveawayId]
        );

        return { success: true };
    }

    async editGiveaway(giveawayId, changes) {
        const rows = await this.dbService.query(
            `SELECT * FROM giveaways WHERE id = ?`, [giveawayId]
        );
        if (!rows.length) return { error: 'not_found' };
        const giveaway = rows[0];

        if (giveaway.status === 'ended' || giveaway.status === 'cancelled') {
            return { error: 'already_ended' };
        }

        const updates = [];
        const params = [];

        if (changes.addDuration) {
            const newEndsAt = new Date(new Date(giveaway.ends_at).getTime() + changes.addDuration);
            updates.push('ends_at = ?');
            params.push(newEndsAt);

            // Timer neu setzen
            this._clearTimer(giveawayId);
            const msLeft = newEndsAt.getTime() - Date.now();
            if (msLeft > 0) this._scheduleEnd(giveawayId, msLeft);
        }
        if (changes.prize) {
            updates.push('prize = ?');
            params.push(changes.prize);
        }
        if (changes.winnerCount) {
            updates.push('winner_count = ?');
            params.push(changes.winnerCount);
        }

        if (updates.length) {
            params.push(giveawayId);
            await this.dbService.query(
                `UPDATE giveaways SET ${updates.join(', ')} WHERE id = ?`, params
            );
        }

        // Refresh und Embed updaten
        const updated = (await this.dbService.query(
            `SELECT * FROM giveaways WHERE id = ?`, [giveawayId]
        ))[0];
        const entryCount = await this.getEntryCount(giveawayId);
        await this._updateEmbedActive(updated, entryCount);

        return { success: true };
    }

    // ─── Claim System ───────────────────────────────────────

    async claimPrize(giveawayId, userId) {
        const winner = await this.dbService.query(
            `SELECT * FROM giveaway_winners WHERE giveaway_id = ? AND user_id = ?`,
            [giveawayId, userId]
        );
        if (!winner.length) return { error: 'not_winner' };
        if (winner[0].claim_status === 'claimed') return { error: 'already_claimed' };
        if (winner[0].claim_status === 'expired') return { error: 'claim_expired' };

        await this.dbService.query(
            `UPDATE giveaway_winners SET claim_status = 'claimed', claimed_at = NOW() WHERE giveaway_id = ? AND user_id = ?`,
            [giveawayId, userId]
        );

        return { success: true };
    }

    async _handleClaimExpiry(giveawayId) {
        this._clearClaimTimer(giveawayId);

        // Alle nicht-geclaimten Gewinner als expired markieren
        const unclaimed = await this.dbService.query(
            `SELECT user_id FROM giveaway_winners WHERE giveaway_id = ? AND claim_status = 'pending'`,
            [giveawayId]
        );

        if (unclaimed.length === 0) return;

        await this.dbService.query(
            `UPDATE giveaway_winners SET claim_status = 'expired' WHERE giveaway_id = ? AND claim_status = 'pending'`,
            [giveawayId]
        );

        // Auto-Reroll für nicht-geclaimte Gewinner
        const giveaway = await this.getGiveaway(giveawayId);
        if (!giveaway) return;

        const allWinners = await this.dbService.query(
            `SELECT user_id FROM giveaway_winners WHERE giveaway_id = ?`, [giveawayId]
        );
        const excludeIds = allWinners.map(w => w.user_id);

        const newWinners = await this._drawWinners(giveawayId, unclaimed.length, excludeIds);
        if (newWinners.length > 0) {
            for (const userId of newWinners) {
                await this.dbService.query(
                    `INSERT INTO giveaway_winners (giveaway_id, user_id, claim_status) VALUES (?, ?, 'claimed')`,
                    [giveawayId, userId]
                );
            }
            await this._postRerollMessage(giveaway, newWinners);
            this.Logger.info(`[Giveaway] Auto-Reroll: ${newWinners.length} neue Gewinner für Giveaway #${giveawayId}`);
        }
    }

    // ─── Scheduling ─────────────────────────────────────────

    async _activateScheduledGiveaway(giveawayId) {
        const giveaway = await this.getGiveaway(giveawayId);
        if (!giveaway || giveaway.status !== 'scheduled') return;

        // Dauer berechnen: ends_at - scheduled_start = ursprüngliche Dauer
        const duration = new Date(giveaway.ends_at).getTime() - new Date(giveaway.scheduled_start).getTime();
        const newEndsAt = new Date(Date.now() + duration);

        await this.dbService.query(
            `UPDATE giveaways SET status = 'active', ends_at = ? WHERE id = ?`,
            [newEndsAt, giveawayId]
        );

        // Embed posten
        const message = await this._postEmbed(giveawayId, giveaway.guild_id, giveaway.channel_id);
        if (message) {
            await this.dbService.query(
                `UPDATE giveaways SET message_id = ? WHERE id = ?`,
                [message.id, giveawayId]
            );
        }

        this._scheduleEnd(giveawayId, duration);
        this.Logger.info(`[Giveaway] Geplantes Giveaway #${giveawayId} wurde aktiviert`);
    }

    // ─── Requirements ───────────────────────────────────────

    async getRequirements(giveawayId) {
        return await this.dbService.query(
            `SELECT * FROM giveaway_requirements WHERE giveaway_id = ?`, [giveawayId]
        );
    }

    async checkRequirements(giveawayId, userId) {
        const requirements = await this.getRequirements(giveawayId);
        if (!requirements.length) return { passed: true };

        const giveaway = await this.getGiveaway(giveawayId);
        if (!giveaway) return { passed: false, reason: 'not_found' };

        const guild = this.client.guilds.cache.get(giveaway.guild_id);
        if (!guild) return { passed: false, reason: 'guild_not_found' };

        const member = await guild.members.fetch(userId).catch(() => null);
        if (!member) return { passed: false, reason: 'member_not_found' };

        for (const req of requirements) {
            switch (req.type) {
                case 'role': {
                    if (!member.roles.cache.has(req.value)) {
                        const roleName = guild.roles.cache.get(req.value)?.name || req.value;
                        return { passed: false, reason: 'missing_role', detail: roleName };
                    }
                    break;
                }
                case 'min_account_age': {
                    const days = parseInt(req.value);
                    const accountAge = (Date.now() - member.user.createdTimestamp) / (1000 * 60 * 60 * 24);
                    if (accountAge < days) {
                        return { passed: false, reason: 'account_too_young', detail: days };
                    }
                    break;
                }
                case 'min_server_age': {
                    const days = parseInt(req.value);
                    const serverAge = (Date.now() - member.joinedTimestamp) / (1000 * 60 * 60 * 24);
                    if (serverAge < days) {
                        return { passed: false, reason: 'server_too_young', detail: days };
                    }
                    break;
                }
            }
        }

        return { passed: true };
    }

    // ─── Blacklist ──────────────────────────────────────────

    async isBlacklisted(guildId, userId) {
        const rows = await this.dbService.query(
            `SELECT id FROM giveaway_blacklist WHERE guild_id = ? AND user_id = ?`,
            [guildId, userId]
        );
        return rows.length > 0;
    }

    async addToBlacklist(guildId, userId, reason, blockedBy) {
        try {
            await this.dbService.query(
                `INSERT INTO giveaway_blacklist (guild_id, user_id, reason, blocked_by) VALUES (?, ?, ?, ?)`,
                [guildId, userId, reason, blockedBy]
            );
            return { success: true };
        } catch (e) {
            if (e.code === 'ER_DUP_ENTRY') return { error: 'already_blacklisted' };
            throw e;
        }
    }

    async removeFromBlacklist(guildId, userId) {
        const result = await this.dbService.query(
            `DELETE FROM giveaway_blacklist WHERE guild_id = ? AND user_id = ?`,
            [guildId, userId]
        );
        return { success: result.affectedRows > 0 };
    }

    async getBlacklist(guildId) {
        return await this.dbService.query(
            `SELECT * FROM giveaway_blacklist WHERE guild_id = ? ORDER BY created_at DESC`,
            [guildId]
        );
    }

    // ─── Templates ──────────────────────────────────────────

    async createTemplate(guildId, name, config, createdBy) {
        try {
            await this.dbService.query(
                `INSERT INTO giveaway_templates (guild_id, name, config, created_by) VALUES (?, ?, ?, ?)`,
                [guildId, name, JSON.stringify(config), createdBy]
            );
            return { success: true };
        } catch (e) {
            if (e.code === 'ER_DUP_ENTRY') return { error: 'template_exists' };
            throw e;
        }
    }

    async getTemplate(guildId, name) {
        const rows = await this.dbService.query(
            `SELECT * FROM giveaway_templates WHERE guild_id = ? AND name = ?`,
            [guildId, name]
        );
        if (!rows.length) return null;
        const tpl = rows[0];
        tpl.config = typeof tpl.config === 'string' ? JSON.parse(tpl.config) : tpl.config;
        return tpl;
    }

    async getTemplates(guildId) {
        const templates = await this.dbService.query(
            `SELECT * FROM giveaway_templates WHERE guild_id = ? ORDER BY name ASC`,
            [guildId]
        );
        return templates.map(t => {
            t.config = typeof t.config === 'string' ? JSON.parse(t.config) : t.config;
            return t;
        });
    }

    async deleteTemplate(guildId, name) {
        const result = await this.dbService.query(
            `DELETE FROM giveaway_templates WHERE guild_id = ? AND name = ?`,
            [guildId, name]
        );
        return { success: result.affectedRows > 0 };
    }

    // ─── Entry Management ───────────────────────────────────

    async addEntry(giveawayId, userId) {
        const rows = await this.dbService.query(
            `SELECT * FROM giveaways WHERE id = ?`, [giveawayId]
        );
        if (!rows.length) return { error: 'not_found' };
        const giveaway = rows[0];

        if (giveaway.status !== 'active') return { error: 'not_active' };

        // Blacklist-Prüfung
        if (await this.isBlacklisted(giveaway.guild_id, userId)) {
            return { error: 'blacklisted' };
        }

        // Requirements-Prüfung (ersetzt die alte allowed_roles Prüfung)
        const reqCheck = await this.checkRequirements(giveawayId, userId);
        if (!reqCheck.passed) {
            return { error: 'requirement_failed', reason: reqCheck.reason, detail: reqCheck.detail };
        }

        // Legacy: allowed_roles auch weiterhin prüfen
        if (giveaway.allowed_roles) {
            const allowedRoles = typeof giveaway.allowed_roles === 'string'
                ? JSON.parse(giveaway.allowed_roles) : giveaway.allowed_roles;
            if (allowedRoles && allowedRoles.length > 0) {
                try {
                    const guild = this.client.guilds.cache.get(giveaway.guild_id);
                    const member = await guild.members.fetch(userId).catch(() => null);
                    if (member) {
                        const hasRole = allowedRoles.some(roleId => member.roles.cache.has(roleId));
                        if (!hasRole) return { error: 'missing_role' };
                    }
                } catch (e) { /* ignore */ }
            }
        }

        try {
            await this.dbService.query(
                `INSERT INTO giveaway_entries (giveaway_id, user_id) VALUES (?, ?)`,
                [giveawayId, userId]
            );

            // Nach Entry: Embed-Counter aktualisieren
            const entryCount = await this.getEntryCount(giveawayId);
            await this._updateEmbedActive(giveaway, entryCount);

            return { success: true, entryCount };
        } catch (e) {
            if (e.code === 'ER_DUP_ENTRY') return { error: 'already_entered' };
            throw e;
        }
    }

    async removeEntry(giveawayId, userId) {
        await this.dbService.query(
            `DELETE FROM giveaway_entries WHERE giveaway_id = ? AND user_id = ?`,
            [giveawayId, userId]
        );
        return { success: true };
    }

    async getEntryCount(giveawayId) {
        const rows = await this.dbService.query(
            `SELECT COALESCE(SUM(entry_count), 0) as total FROM giveaway_entries WHERE giveaway_id = ?`,
            [giveawayId]
        );
        return rows[0].total;
    }

    // ─── Analytics ──────────────────────────────────────────

    async getAnalytics(guildId) {
        const [totals] = await this.dbService.query(
            `SELECT 
                COUNT(*) as total_giveaways,
                SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active_count,
                SUM(CASE WHEN status = 'ended' THEN 1 ELSE 0 END) as ended_count,
                SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) as cancelled_count
             FROM giveaways WHERE guild_id = ?`,
            [guildId]
        );

        const [entryStats] = await this.dbService.query(
            `SELECT 
                COUNT(DISTINCT ge.user_id) as unique_participants,
                COUNT(ge.id) as total_entries
             FROM giveaway_entries ge
             JOIN giveaways g ON g.id = ge.giveaway_id
             WHERE g.guild_id = ?`,
            [guildId]
        );

        const [winnerStats] = await this.dbService.query(
            `SELECT COUNT(DISTINCT gw.user_id) as unique_winners
             FROM giveaway_winners gw
             JOIN giveaways g ON g.id = gw.giveaway_id
             WHERE g.guild_id = ?`,
            [guildId]
        );

        const topEntrants = await this.dbService.query(
            `SELECT ge.user_id, COUNT(*) as participations
             FROM giveaway_entries ge
             JOIN giveaways g ON g.id = ge.giveaway_id
             WHERE g.guild_id = ?
             GROUP BY ge.user_id ORDER BY participations DESC LIMIT 10`,
            [guildId]
        );

        const recentWinners = await this.dbService.query(
            `SELECT gw.user_id, g.prize, gw.won_at
             FROM giveaway_winners gw
             JOIN giveaways g ON g.id = gw.giveaway_id
             WHERE g.guild_id = ?
             ORDER BY gw.won_at DESC LIMIT 10`,
            [guildId]
        );

        return {
            ...totals,
            ...entryStats,
            ...winnerStats,
            topEntrants,
            recentWinners,
        };
    }

    // ─── Queries ────────────────────────────────────────────

    async getGiveaway(giveawayId) {
        const rows = await this.dbService.query(
            `SELECT * FROM giveaways WHERE id = ?`, [giveawayId]
        );
        return rows[0] || null;
    }

    async getGiveawayByMessage(messageId, guildId) {
        const rows = await this.dbService.query(
            `SELECT * FROM giveaways WHERE message_id = ? AND guild_id = ?`,
            [messageId, guildId]
        );
        return rows[0] || null;
    }

    async getActiveGiveaways(guildId) {
        return await this.dbService.query(
            `SELECT g.*, (SELECT COUNT(*) FROM giveaway_entries WHERE giveaway_id = g.id) as entry_count
             FROM giveaways g WHERE g.guild_id = ? AND g.status IN ('active', 'paused')
             ORDER BY g.ends_at ASC`,
            [guildId]
        );
    }

    async getScheduledGiveaways(guildId) {
        return await this.dbService.query(
            `SELECT * FROM giveaways WHERE guild_id = ? AND status = 'scheduled' ORDER BY scheduled_start ASC`,
            [guildId]
        );
    }

    async getAllGiveaways(guildId, limit = 50) {
        return await this.dbService.query(
            `SELECT g.*, 
                (SELECT COUNT(*) FROM giveaway_entries WHERE giveaway_id = g.id) as entry_count,
                (SELECT GROUP_CONCAT(user_id) FROM giveaway_winners WHERE giveaway_id = g.id) as winner_ids
             FROM giveaways g WHERE g.guild_id = ?
             ORDER BY g.created_at DESC LIMIT ?`,
            [guildId, limit]
        );
    }

    // ─── Internal: Timer ────────────────────────────────────

    _scheduleEnd(giveawayId, ms) {
        this._clearTimer(giveawayId);
        const MAX_TIMEOUT = 2147483647;
        if (ms > MAX_TIMEOUT) {
            this.timers.set(giveawayId, setTimeout(() => {
                this._scheduleEnd(giveawayId, ms - MAX_TIMEOUT);
            }, MAX_TIMEOUT));
        } else {
            this.timers.set(giveawayId, setTimeout(async () => {
                this.timers.delete(giveawayId);
                try {
                    await this.endGiveaway(giveawayId);
                } catch (e) {
                    this.Logger.error(`[Giveaway] Auto-End fehlgeschlagen für #${giveawayId}:`, e);
                }
            }, ms));
        }
    }

    _scheduleStart(giveawayId, ms) {
        const MAX_TIMEOUT = 2147483647;
        const key = `sched_${giveawayId}`;
        if (ms > MAX_TIMEOUT) {
            this.timers.set(key, setTimeout(() => {
                this._scheduleStart(giveawayId, ms - MAX_TIMEOUT);
            }, MAX_TIMEOUT));
        } else {
            this.timers.set(key, setTimeout(async () => {
                this.timers.delete(key);
                try {
                    await this._activateScheduledGiveaway(giveawayId);
                } catch (e) {
                    this.Logger.error(`[Giveaway] Scheduled-Start fehlgeschlagen für #${giveawayId}:`, e);
                }
            }, ms));
        }
    }

    _scheduleClaimExpiry(giveawayId, ms) {
        this._clearClaimTimer(giveawayId);
        const MAX_TIMEOUT = 2147483647;
        if (ms > MAX_TIMEOUT) {
            this.claimTimers.set(giveawayId, setTimeout(() => {
                this._scheduleClaimExpiry(giveawayId, ms - MAX_TIMEOUT);
            }, MAX_TIMEOUT));
        } else {
            this.claimTimers.set(giveawayId, setTimeout(async () => {
                this.claimTimers.delete(giveawayId);
                try {
                    await this._handleClaimExpiry(giveawayId);
                } catch (e) {
                    this.Logger.error(`[Giveaway] Claim-Expiry fehlgeschlagen für #${giveawayId}:`, e);
                }
            }, ms));
        }
    }

    _clearTimer(giveawayId) {
        const timer = this.timers.get(giveawayId);
        if (timer) {
            clearTimeout(timer);
            this.timers.delete(giveawayId);
        }
        // Auch scheduled timer löschen
        const schedKey = `sched_${giveawayId}`;
        const schedTimer = this.timers.get(schedKey);
        if (schedTimer) {
            clearTimeout(schedTimer);
            this.timers.delete(schedKey);
        }
    }

    _clearClaimTimer(giveawayId) {
        const timer = this.claimTimers.get(giveawayId);
        if (timer) {
            clearTimeout(timer);
            this.claimTimers.delete(giveawayId);
        }
    }

    // ─── Internal: Winner Drawing ───────────────────────────

    async _drawWinners(giveawayId, count, excludeIds = []) {
        let query = `SELECT user_id, entry_count FROM giveaway_entries WHERE giveaway_id = ?`;
        const params = [giveawayId];

        if (excludeIds.length > 0) {
            query += ` AND user_id NOT IN (${excludeIds.map(() => '?').join(',')})`;
            params.push(...excludeIds);
        }

        const entries = await this.dbService.query(query, params);
        if (!entries.length) return [];

        // Gewichtete Ziehung (entry_count berücksichtigen)
        const pool = [];
        for (const entry of entries) {
            for (let i = 0; i < entry.entry_count; i++) {
                pool.push(entry.user_id);
            }
        }

        const winners = [];
        const used = new Set();
        const maxAttempts = pool.length * 2;
        let attempts = 0;

        while (winners.length < count && winners.length < entries.length && attempts < maxAttempts) {
            const idx = Math.floor(Math.random() * pool.length);
            const userId = pool[idx];
            if (!used.has(userId)) {
                winners.push(userId);
                used.add(userId);
            }
            attempts++;
        }

        return winners;
    }

    // ─── Internal: Discord Embeds ───────────────────────────

    async _postEmbed(giveawayId, guildId, channelId) {
        try {
            const guild = this.client.guilds.cache.get(guildId);
            if (!guild) return null;
            const channel = guild.channels.cache.get(channelId);
            if (!channel) return null;

            const giveaway = await this.getGiveaway(giveawayId);
            if (!giveaway) return null;

            const host = giveaway.hosted_by
                ? await this.client.users.fetch(giveaway.hosted_by).catch(() => null)
                : null;

            const endsTimestamp = Math.floor(new Date(giveaway.ends_at).getTime() / 1000);
            const requirements = await this.getRequirements(giveawayId);

            const embed = new EmbedBuilder()
                .setTitle(`🎁 ${giveaway.prize}`)
                .setDescription(this._buildActiveDescription(giveaway, host, endsTimestamp, 0, requirements))
                .setColor(giveaway.embed_color)
                .setFooter({ text: `ID: ${giveawayId} • ${giveaway.winner_count} Gewinner` })
                .setTimestamp(new Date(giveaway.ends_at));

            if (giveaway.description) {
                embed.addFields({ name: 'Beschreibung', value: giveaway.description });
            }

            const button = new ButtonBuilder()
                .setCustomId(`giveaway_join_${giveawayId}`)
                .setLabel('Teilnehmen (0)')
                .setEmoji('🎁')
                .setStyle(ButtonStyle.Primary);

            const row = new ActionRowBuilder().addComponents(button);

            return await channel.send({
                embeds: [embed],
                components: [row]
            });
        } catch (e) {
            this.Logger.error(`[Giveaway] Embed konnte nicht gepostet werden:`, e);
            return null;
        }
    }

    _buildActiveDescription(giveaway, host, endsTimestamp, entryCount, requirements = []) {
        let desc = `Reagiere mit 🎁 um teilzunehmen!\n\n`;
        desc += `⏰ Endet: <t:${endsTimestamp}:R> (<t:${endsTimestamp}:f>)\n`;
        desc += `🏆 Gewinner: **${giveaway.winner_count}**\n`;
        desc += `👥 Teilnehmer: **${entryCount}**\n`;
        if (host) desc += `🎤 Hosted von: ${host.username}\n`;

        if (giveaway.allowed_roles) {
            const roles = typeof giveaway.allowed_roles === 'string'
                ? JSON.parse(giveaway.allowed_roles) : giveaway.allowed_roles;
            if (roles && roles.length > 0) {
                desc += `\n🔒 Nur für: ${roles.map(r => `<@&${r}>`).join(', ')}`;
            }
        }

        // Requirements anzeigen
        if (requirements.length > 0) {
            desc += `\n\n📋 **Teilnahme-Bedingungen:**\n`;
            for (const req of requirements) {
                switch (req.type) {
                    case 'role':
                        desc += `  • Rolle: <@&${req.value}>\n`;
                        break;
                    case 'min_account_age':
                        desc += `  • Mindestalter Account: ${req.value} Tage\n`;
                        break;
                    case 'min_server_age':
                        desc += `  • Mindestzeit auf Server: ${req.value} Tage\n`;
                        break;
                }
            }
        }

        if (giveaway.claim_duration_ms) {
            const claimMinutes = Math.round(giveaway.claim_duration_ms / 60000);
            desc += `\n⏳ Gewinner müssen innerhalb von **${claimMinutes} Minuten** beanspruchen!`;
        }

        return desc;
    }

    async _updateEmbedActive(giveaway, entryCount) {
        try {
            const guild = this.client.guilds.cache.get(giveaway.guild_id);
            if (!guild) return;
            const channel = guild.channels.cache.get(giveaway.channel_id);
            if (!channel || !giveaway.message_id) return;

            const msg = await channel.messages.fetch(giveaway.message_id).catch(() => null);
            if (!msg) return;

            if (entryCount === undefined) {
                entryCount = await this.getEntryCount(giveaway.id);
            }

            const host = giveaway.hosted_by
                ? await this.client.users.fetch(giveaway.hosted_by).catch(() => null)
                : null;
            const endsTimestamp = Math.floor(new Date(giveaway.ends_at).getTime() / 1000);
            const requirements = await this.getRequirements(giveaway.id);

            const embed = EmbedBuilder.from(msg.embeds[0])
                .setDescription(this._buildActiveDescription(giveaway, host, endsTimestamp, entryCount, requirements));

            const button = new ButtonBuilder()
                .setCustomId(`giveaway_join_${giveaway.id}`)
                .setLabel(`Teilnehmen (${entryCount})`)
                .setEmoji('🎁')
                .setStyle(ButtonStyle.Primary);

            const row = new ActionRowBuilder().addComponents(button);

            await msg.edit({ embeds: [embed], components: [row] });
        } catch (e) {
            this.Logger.error(`[Giveaway] Embed-Update fehlgeschlagen:`, e);
        }
    }

    async _updateEmbedPaused(giveaway) {
        try {
            const guild = this.client.guilds.cache.get(giveaway.guild_id);
            if (!guild) return;
            const channel = guild.channels.cache.get(giveaway.channel_id);
            if (!channel || !giveaway.message_id) return;

            const msg = await channel.messages.fetch(giveaway.message_id).catch(() => null);
            if (!msg) return;

            const entryCount = await this.getEntryCount(giveaway.id);

            const embed = new EmbedBuilder()
                .setTitle(`⏸️ ${giveaway.prize} (PAUSIERT)`)
                .setDescription(`Dieses Giveaway ist **pausiert**.\n\n👥 Teilnehmer: **${entryCount}**`)
                .setColor('#808080')
                .setFooter({ text: `ID: ${giveaway.id} • ${giveaway.winner_count} Gewinner` });

            const button = new ButtonBuilder()
                .setCustomId(`giveaway_join_${giveaway.id}`)
                .setLabel(`Pausiert`)
                .setEmoji('⏸️')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(true);

            const row = new ActionRowBuilder().addComponents(button);

            await msg.edit({ embeds: [embed], components: [row] });
        } catch (e) {
            this.Logger.error(`[Giveaway] Pause-Embed fehlgeschlagen:`, e);
        }
    }

    async _updateEmbedEnded(giveaway, winners) {
        try {
            const guild = this.client.guilds.cache.get(giveaway.guild_id);
            if (!guild) return;
            const channel = guild.channels.cache.get(giveaway.channel_id);
            if (!channel || !giveaway.message_id) return;

            const msg = await channel.messages.fetch(giveaway.message_id).catch(() => null);
            if (!msg) return;

            const entryCount = await this.getEntryCount(giveaway.id);
            const winnerMentions = winners.length > 0
                ? winners.map(id => `<@${id}>`).join(', ')
                : 'Keine gültigen Teilnehmer';

            const embed = new EmbedBuilder()
                .setTitle(`🎁 ${giveaway.prize}`)
                .setDescription(
                    `Dieses Giveaway ist **beendet**!\n\n` +
                    `🏆 Gewinner: ${winnerMentions}\n` +
                    `👥 Teilnehmer: **${entryCount}**`
                )
                .setColor('#2f3136')
                .setFooter({ text: `ID: ${giveaway.id} • Beendet` })
                .setTimestamp(new Date());

            const button = new ButtonBuilder()
                .setCustomId(`giveaway_join_${giveaway.id}`)
                .setLabel('Beendet')
                .setEmoji('🎁')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(true);

            const row = new ActionRowBuilder().addComponents(button);

            await msg.edit({ embeds: [embed], components: [row] });
        } catch (e) {
            this.Logger.error(`[Giveaway] End-Embed fehlgeschlagen:`, e);
        }
    }

    async _updateEmbedEndedWithClaim(giveaway, winners) {
        try {
            const guild = this.client.guilds.cache.get(giveaway.guild_id);
            if (!guild) return;
            const channel = guild.channels.cache.get(giveaway.channel_id);
            if (!channel || !giveaway.message_id) return;

            const msg = await channel.messages.fetch(giveaway.message_id).catch(() => null);
            if (!msg) return;

            const entryCount = await this.getEntryCount(giveaway.id);
            const winnerMentions = winners.map(id => `<@${id}>`).join(', ');
            const claimMinutes = Math.round(giveaway.claim_duration_ms / 60000);

            const embed = new EmbedBuilder()
                .setTitle(`🎁 ${giveaway.prize}`)
                .setDescription(
                    `Dieses Giveaway ist **beendet**!\n\n` +
                    `🏆 Gewinner: ${winnerMentions}\n` +
                    `👥 Teilnehmer: **${entryCount}**\n\n` +
                    `⏳ Gewinner müssen innerhalb von **${claimMinutes} Minuten** auf "Beanspruchen" klicken!`
                )
                .setColor('#f59e0b')
                .setFooter({ text: `ID: ${giveaway.id} • Claim läuft` })
                .setTimestamp(new Date());

            const claimButton = new ButtonBuilder()
                .setCustomId(`giveaway_claim_${giveaway.id}`)
                .setLabel('🎉 Beanspruchen')
                .setStyle(ButtonStyle.Success);

            const row = new ActionRowBuilder().addComponents(claimButton);

            await msg.edit({ embeds: [embed], components: [row] });
        } catch (e) {
            this.Logger.error(`[Giveaway] Claim-Embed fehlgeschlagen:`, e);
        }
    }

    async _postRerollMessage(giveaway, winners) {
        try {
            const guild = this.client.guilds.cache.get(giveaway.guild_id);
            if (!guild) return;
            const channel = guild.channels.cache.get(giveaway.channel_id);
            if (!channel) return;

            const winnerMentions = winners.map(id => `<@${id}>`).join(', ');

            await channel.send({
                content: `🎉 **Reroll!** Neue Gewinner für **${giveaway.prize}**: ${winnerMentions}`,
                reply: giveaway.message_id ? { messageReference: giveaway.message_id, failIfNotExists: false } : undefined
            });
        } catch (e) {
            this.Logger.error(`[Giveaway] Reroll-Nachricht fehlgeschlagen:`, e);
        }
    }

    async _notifyWinners(giveaway, winners) {
        const guild = this.client.guilds.cache.get(giveaway.guild_id);
        const guildName = guild?.name || 'Unbekannt';
        const messageLink = giveaway.message_id
            ? `https://discord.com/channels/${giveaway.guild_id}/${giveaway.channel_id}/${giveaway.message_id}`
            : null;

        const hasClaim = !!giveaway.claim_duration_ms;
        const claimMinutes = hasClaim ? Math.round(giveaway.claim_duration_ms / 60000) : 0;

        for (const userId of winners) {
            try {
                const user = await this.client.users.fetch(userId);
                let desc = `Glückwunsch! Du hast **${giveaway.prize}** im Giveaway auf **${guildName}** gewonnen!`;
                if (hasClaim) {
                    desc += `\n\n⏳ **Du musst deinen Preis innerhalb von ${claimMinutes} Minuten beanspruchen!** Klicke auf den "Beanspruchen"-Button im Giveaway-Channel.`;
                }
                if (messageLink) {
                    desc += `\n\n[Zum Giveaway](${messageLink})`;
                }
                const embed = new EmbedBuilder()
                    .setTitle('🎉 Du hast gewonnen!')
                    .setDescription(desc)
                    .setColor('#f59e0b')
                    .setTimestamp();
                await user.send({ embeds: [embed] }).catch(() => {});
            } catch (e) { /* DMs disabled */ }
        }

        // Auch im Channel posten
        if (winners.length > 0) {
            try {
                const channel = guild?.channels.cache.get(giveaway.channel_id);
                if (channel) {
                    const winnerMentions = winners.map(id => `<@${id}>`).join(', ');
                    await channel.send({
                        content: `🎉 Glückwunsch ${winnerMentions}! Ihr habt **${giveaway.prize}** gewonnen!`,
                        reply: giveaway.message_id
                            ? { messageReference: giveaway.message_id, failIfNotExists: false }
                            : undefined
                    });
                }
            } catch (e) { /* ignore */ }
        }
    }
}

module.exports = GiveawayManager;
