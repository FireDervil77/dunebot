/**
 * Quest-Datenbank API Routes
 * 
 * Phase 2: Backend API für Quest-Verwaltung
 * Implementiert gem. docs/dune_awakening_quest_database_schema.md
 * 
 * @author FireBot Team
 * @version 1.0.0
 */

const express = require('express');
const router = express.Router();
const { ServiceManager } = require('dunebot-core');
const { requirePermission } = require('../../../../apps/dashboard/middlewares/permissions.middleware');

/**
 * GET /search
 * Suche nach Quests mit Filtern
 * 
 * Query-Parameter:
 * - type: Quest-Typ (main_story, journey, trial, etc.)
 * - faction: Faction (neutral, atreides, harkonnen, etc.)
 * - npc: NPC-Name oder ID
 * - location: Quest-Location/Region
 * - difficulty: Schwierigkeitsgrad (1-5)
 * - search: Freitextsuche in Namen/Beschreibungen
 * - limit: Anzahl Ergebnisse (default: 50)
 * - offset: Pagination-Offset (default: 0)
 */
router.get('/search', requirePermission('DUNEMAP.VIEW'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    const guildId = res.locals.guildId;
    
    // Filter aus Query-Params extrahieren
    const {
        type,
        faction,
        npc,
        location,
        difficulty,
        search,
        limit = 50,
        offset = 0
    } = req.query;
    
    try {
        // Base Query mit JOIN auf NPCs für NPC-Namen
        let query = `
            SELECT 
                q.*,
                qc.chain_name_en,
                qc.chain_name_de,
                qc.total_quests,
                qc.total_xp as chain_total_xp,
                n.npc_name,
                n.faction as npc_faction,
                n.primary_location,
                n.primary_region,
                n.location_detail_en,
                n.location_detail_de
            FROM dune_quests q
            LEFT JOIN dune_quest_chains qc ON q.quest_chain_id = qc.id
            LEFT JOIN dune_npcs n ON q.quest_giver_npc = n.npc_slug
            WHERE 1=1
        `;
        
        const params = [];
        
        // Filter anwenden
        if (type) {
            query += ' AND q.quest_type = ?';
            params.push(type);
        }
        
        if (faction) {
            query += ' AND q.faction = ?';
            params.push(faction);
        }
        
        if (npc) {
            // Suche nach NPC-Slug oder NPC-Name
            query += ' AND (q.quest_giver_npc = ? OR n.npc_name LIKE ?)';
            params.push(npc, `%${npc}%`);
        }
        
        if (location) {
            // Suche in quest_location oder quest_region
            query += ' AND (q.quest_location LIKE ? OR q.quest_region LIKE ?)';
            params.push(`%${location}%`, `%${location}%`);
        }
        
        if (difficulty) {
            query += ' AND q.difficulty = ?';
            params.push(parseInt(difficulty));
        }
        
        if (search) {
            // Freitextsuche in Namen und Beschreibungen
            query += ` AND (
                q.quest_name_en LIKE ? OR 
                q.quest_name_de LIKE ? OR 
                q.quest_description_en LIKE ? OR 
                q.quest_description_de LIKE ?
            )`;
            const searchPattern = `%${search}%`;
            params.push(searchPattern, searchPattern, searchPattern, searchPattern);
        }
        
        // Sortierung: Story-Quests zuerst, dann nach XP
        query += ' ORDER BY q.quest_type = "main_story" DESC, q.reward_xp DESC';
        
        // Pagination
        query += ' LIMIT ? OFFSET ?';
        params.push(parseInt(limit), parseInt(offset));
        
        Logger.debug('[Quest API] Search Query:', { query, params });
        
        // Query ausführen
        const quests = await dbService.query(query, params);
        
        // Tags für alle gefundenen Quests laden
        const questIds = quests.map(q => q.id);
        let tags = [];
        
        if (questIds.length > 0) {
            const placeholders = questIds.map(() => '?').join(',');
            tags = await dbService.query(`
                SELECT qt.quest_id, qt.tag
                FROM dune_quest_tags qt
                WHERE qt.quest_id IN (${placeholders})
                ORDER BY qt.quest_id, qt.tag
            `, questIds);
        }
        
        // Tags zu Quests gruppieren
        const questsWithTags = quests.map(quest => {
            const questTags = tags.filter(t => t.quest_id === quest.id);
            return {
                ...quest,
                tags: questTags,
                // Rewards als JSON parsen
                reward_items: quest.reward_items ? JSON.parse(quest.reward_items) : [],
                reward_skills: quest.reward_skills ? JSON.parse(quest.reward_skills) : []
            };
        });
        
        // Total Count für Pagination
        let countQuery = `
            SELECT COUNT(*) as total
            FROM dune_quests q
            LEFT JOIN dune_npcs n ON q.quest_giver_npc = n.npc_slug
            WHERE 1=1
        `;
        
        // Gleiche Filter für Count
        const countParams = params.slice(0, -2); // Ohne LIMIT/OFFSET
        let countIndex = 0;
        
        if (type) countQuery += ' AND q.quest_type = ?';
        if (faction) countQuery += ' AND q.faction = ?';
        if (npc) countQuery += ' AND (q.quest_giver_npc = ? OR n.npc_name LIKE ?)';
        if (location) countQuery += ' AND (q.quest_location LIKE ? OR q.quest_region LIKE ?)';
        if (difficulty) countQuery += ' AND q.difficulty = ?';
        if (search) countQuery += ' AND (q.quest_name_en LIKE ? OR q.quest_name_de LIKE ? OR q.quest_description_en LIKE ? OR q.quest_description_de LIKE ?)';
        
        const [countResult] = await dbService.query(countQuery, countParams);
        
        Logger.info(`[Quest API] Search: ${questsWithTags.length} Quests gefunden (total: ${countResult.total})`);
        
        res.json({
            success: true,
            quests: questsWithTags,
            total: countResult.total,
            limit: parseInt(limit),
            offset: parseInt(offset),
            hasMore: (parseInt(offset) + questsWithTags.length) < countResult.total
        });
        
    } catch (error) {
        Logger.error('[Quest API] Fehler bei /search:', error);
        res.status(500).json({
            success: false,
            message: 'Fehler bei der Quest-Suche',
            error: error.message
        });
    }
});

/**
 * GET /:slug
 * Einzelne Quest mit vollständigen Details
 */
router.get('/:slug', requirePermission('DUNEMAP.VIEW'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    const { slug } = req.params;
    
    try {
        // Quest mit allen Beziehungen laden
        const [quest] = await dbService.query(`
            SELECT 
                q.*,
                qc.chain_name_en,
                qc.chain_name_de,
                qc.chain_slug,
                qc.total_quests,
                qc.total_xp as chain_total_xp,
                qc.final_rewards as chain_final_rewards,
                n.npc_name,
                n.faction as npc_faction,
                n.primary_location,
                n.primary_region,
                n.location_detail_en,
                n.location_detail_de,
                n.npc_type,
                n.trainer_class
            FROM dune_quests q
            LEFT JOIN dune_quest_chains qc ON q.quest_chain_id = qc.id
            LEFT JOIN dune_npcs n ON q.quest_giver_npc = n.npc_slug
            WHERE q.quest_slug = ?
        `, [slug]);
        
        if (!quest) {
            return res.status(404).json({
                success: false,
                message: `Quest "${slug}" nicht gefunden`
            });
        }
        
        // Tags laden
        const tags = await dbService.query(`
            SELECT tag
            FROM dune_quest_tags
            WHERE quest_id = ?
            ORDER BY tag
        `, [quest.id]);
        
        // Vorherige/Nächste Quest laden (falls vorhanden)
        let previousQuest = null;
        let nextQuest = null;
        
        if (quest.previous_quest_id) {
            [previousQuest] = await dbService.query(`
                SELECT id, quest_slug, quest_name_en, quest_name_de
                FROM dune_quests
                WHERE id = ?
            `, [quest.previous_quest_id]);
        }
        
        if (quest.next_quest_id) {
            [nextQuest] = await dbService.query(`
                SELECT id, quest_slug, quest_name_en, quest_name_de
                FROM dune_quests
                WHERE id = ?
            `, [quest.next_quest_id]);
        }
        
        // Alle Quests in der Chain laden (falls Teil einer Chain)
        let chainQuests = [];
        if (quest.quest_chain_id) {
            chainQuests = await dbService.query(`
                SELECT id, quest_slug, quest_name_en, quest_name_de, 
                       quest_chain_position, reward_xp
                FROM dune_quests
                WHERE quest_chain_id = ?
                ORDER BY quest_chain_position ASC
            `, [quest.quest_chain_id]);
        }
        
        // JSON-Felder parsen
        const questDetails = {
            ...quest,
            reward_items: quest.reward_items ? JSON.parse(quest.reward_items) : [],
            reward_skills: quest.reward_skills ? JSON.parse(quest.reward_skills) : [],
            quest_objectives: quest.quest_objectives ? JSON.parse(quest.quest_objectives) : [],
            quest_dialog: quest.quest_dialog ? JSON.parse(quest.quest_dialog) : null,
            chain_final_rewards: quest.chain_final_rewards ? JSON.parse(quest.chain_final_rewards) : null,
            tags: tags,
            previousQuest,
            nextQuest,
            chainQuests
        };
        
        Logger.info(`[Quest API] Quest Details: ${quest.quest_name_en} (${slug})`);
        
        res.json({
            success: true,
            quest: questDetails
        });
        
    } catch (error) {
        Logger.error(`[Quest API] Fehler bei /:slug (${slug}):`, error);
        res.status(500).json({
            success: false,
            message: 'Fehler beim Laden der Quest-Details',
            error: error.message
        });
    }
});

/**
 * GET /npc/:npcName
 * Alle Quests von einem bestimmten NPC
 */
router.get('/npc/:npcName', requirePermission('DUNEMAP.VIEW'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    const { npcName } = req.params;
    
    try {
        // NPC finden
        const [npc] = await dbService.query(`
            SELECT * FROM dune_npcs
            WHERE npc_name LIKE ?
            LIMIT 1
        `, [`%${npcName}%`]);
        
        if (!npc) {
            return res.status(404).json({
                success: false,
                message: `NPC "${npcName}" nicht gefunden`
            });
        }
        
        // Alle Quests dieses NPCs laden
        const quests = await dbService.query(`
            SELECT 
                q.*,
                qc.chain_name_en,
                qc.chain_name_de
            FROM dune_quests q
            LEFT JOIN dune_quest_chains qc ON q.quest_chain_id = qc.id
            WHERE q.quest_giver_npc = ?
            ORDER BY q.quest_type, q.quest_chain_position, q.reward_xp DESC
        `, [npc.npc_slug]);
        
        // Tags für alle Quests laden
        const questIds = quests.map(q => q.id);
        let tags = [];
        
        if (questIds.length > 0) {
            const placeholders = questIds.map(() => '?').join(',');
            tags = await dbService.query(`
                SELECT quest_id, tag
                FROM dune_quest_tags
                WHERE quest_id IN (${placeholders})
            `, questIds);
        }
        
        const questsWithTags = quests.map(quest => ({
            ...quest,
            tags: tags.filter(t => t.quest_id === quest.id),
            reward_items: quest.reward_items ? JSON.parse(quest.reward_items) : [],
            reward_skills: quest.reward_skills ? JSON.parse(quest.reward_skills) : []
        }));
        
        Logger.info(`[Quest API] NPC Quests: ${npc.npc_name} (${questsWithTags.length} Quests)`);
        
        res.json({
            success: true,
            npc: npc,
            quests: questsWithTags,
            total: questsWithTags.length
        });
        
    } catch (error) {
        Logger.error(`[Quest API] Fehler bei /npc/:npcName (${npcName}):`, error);
        res.status(500).json({
            success: false,
            message: 'Fehler beim Laden der NPC-Quests',
            error: error.message
        });
    }
});

/**
 * GET /chain/:chainSlug
 * Alle Quests einer Quest-Chain
 */
router.get('/chain/:chainSlug', requirePermission('DUNEMAP.VIEW'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    const { chainSlug } = req.params;
    
    try {
        // Quest-Chain laden
        const [chain] = await dbService.query(`
            SELECT * FROM dune_quest_chains
            WHERE chain_slug = ?
        `, [chainSlug]);
        
        if (!chain) {
            return res.status(404).json({
                success: false,
                message: `Quest-Chain "${chainSlug}" nicht gefunden`
            });
        }
        
        // Alle Quests der Chain laden
        const quests = await dbService.query(`
            SELECT 
                q.*,
                n.npc_name,
                n.primary_location,
                n.primary_region,
                n.location_detail_en,
                n.location_detail_de
            FROM dune_quests q
            LEFT JOIN dune_npcs n ON q.quest_giver_npc = n.npc_slug
            WHERE q.quest_chain_id = ?
            ORDER BY q.quest_chain_position ASC
        `, [chain.id]);
        
        // Tags für alle Quests laden
        const questIds = quests.map(q => q.id);
        let tags = [];
        
        if (questIds.length > 0) {
            const placeholders = questIds.map(() => '?').join(',');
            tags = await dbService.query(`
                SELECT quest_id, tag
                FROM dune_quest_tags
                WHERE quest_id IN (${placeholders})
            `, questIds);
        }
        
        const questsWithTags = quests.map(quest => ({
            ...quest,
            tags: tags.filter(t => t.quest_id === quest.id),
            reward_items: quest.reward_items ? JSON.parse(quest.reward_items) : [],
            reward_skills: quest.reward_skills ? JSON.parse(quest.reward_skills) : []
        }));
        
        // Chain-Details mit Quests
        const chainDetails = {
            ...chain,
            final_rewards: chain.final_rewards ? JSON.parse(chain.final_rewards) : [],
            quests: questsWithTags
        };
        
        Logger.info(`[Quest API] Quest-Chain: ${chain.chain_name_en} (${questsWithTags.length} Quests)`);
        
        res.json({
            success: true,
            chain: chainDetails
        });
        
    } catch (error) {
        Logger.error(`[Quest API] Fehler bei /chain/:chainSlug (${chainSlug}):`, error);
        res.status(500).json({
            success: false,
            message: 'Fehler beim Laden der Quest-Chain',
            error: error.message
        });
    }
});

/**
 * GET /stats
 * Statistiken über Quest-Datenbank
 */
router.get('/stats', requirePermission('DUNEMAP.VIEW'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    
    try {
        // Gesamt-Statistiken
        const [totalQuests] = await dbService.query('SELECT COUNT(*) as count FROM dune_quests');
        const [totalChains] = await dbService.query('SELECT COUNT(*) as count FROM dune_quest_chains');
        const [totalNpcs] = await dbService.query('SELECT COUNT(*) as count FROM dune_npcs');
        
        // Quests nach Typ
        const questsByType = await dbService.query(`
            SELECT quest_type, COUNT(*) as count
            FROM dune_quests
            GROUP BY quest_type
            ORDER BY count DESC
        `);
        
        // Quests nach Faction
        const questsByFaction = await dbService.query(`
            SELECT faction, COUNT(*) as count
            FROM dune_quests
            GROUP BY faction
            ORDER BY count DESC
        `);
        
        // Top NPCs (nach Anzahl Quests)
        const topNpcs = await dbService.query(`
            SELECT n.npc_name, n.primary_location, n.primary_region, COUNT(q.id) as quest_count
            FROM dune_npcs n
            LEFT JOIN dune_quests q ON n.npc_slug = q.quest_giver_npc
            GROUP BY n.id
            HAVING quest_count > 0
            ORDER BY quest_count DESC
            LIMIT 10
        `);
        
        // Längste Quest-Chains
        const longestChains = await dbService.query(`
            SELECT chain_name_en, chain_name_de, total_quests, total_xp
            FROM dune_quest_chains
            ORDER BY total_quests DESC
            LIMIT 10
        `);
        
        Logger.info('[Quest API] Statistiken abgerufen');
        
        res.json({
            success: true,
            stats: {
                total: {
                    quests: totalQuests.count,
                    chains: totalChains.count,
                    npcs: totalNpcs.count
                },
                byType: questsByType,
                byFaction: questsByFaction,
                topNpcs: topNpcs,
                longestChains: longestChains
            }
        });
        
    } catch (error) {
        Logger.error('[Quest API] Fehler bei /stats:', error);
        res.status(500).json({
            success: false,
            message: 'Fehler beim Laden der Statistiken',
            error: error.message
        });
    }
});

module.exports = router;
