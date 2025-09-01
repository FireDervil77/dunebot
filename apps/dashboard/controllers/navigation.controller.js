const { ServiceManager } = require("dunebot-core");

/**
 * REST-API für Navigation-Items
 * @author FireDervil
 */
/**
 * Hilfsfunktion zum Holen der NavItems
 * @returns {Promise<Array>} Array mit Navigation-Items
 * @author FireDervil
 */
async function getNavItems() {
    const dbService = ServiceManager.get("dbService");
    try {
        const items = await dbService.query(
            "SELECT * FROM nav_items ORDER BY order_num ASC"
        );
        return items;
    } catch (error) {
        const Logger = ServiceManager.get('Logger');
        Logger.error("Fehler beim Abrufen der Navigation-Items:", error);
        throw error;
    }
}

/**
 * Liste aller Navigation-Items abrufen
 * @param {import('express').Request} req - Express Request Objekt
 * @param {import('express').Response} res - Express Response Objekt
 * @returns {Promise<void>}
 */
exports.list = async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    
    try {
        const items = agetNavItems();
        res.json(items);
    } catch (error) {
        Logger.error("Fehler beim Abrufen der Navigation-Items:", error);
        res.status(500).json({ 
            error: "Datenbankfehler beim Laden der Navigation" 
        });
    }
};

/**
 * Neues Navigation-Item erstellen
 * @param {import('express').Request} req - Express Request Objekt
 * @param {import('express').Response} res - Express Response Objekt
 * @returns {Promise<void>}
 */
exports.create = async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    const themeManager = ServiceManager.get('themeManager');
    
    try {
        const { guildId, plugin, title, url, icon, order_num } = req.body;

        // SQL-Insert ausführen
        const result = await dbService.query(`
            INSERT INTO nav_items 
                (guildId, plugin, title, url, icon, order_num)
            VALUES 
                (?, ?, ?, ?, ?, ?)
        `, [
            guildId,
            plugin,
            title,
            url,
            icon || null,
            order_num || 0
        ]);

        // Neu erstelltes Item abrufen
        const [newItem] = await dbService.query(
            "SELECT * FROM nav_items WHERE id = ?",
            [result.insertId]
        );

        // Navigation neu laden
        await themeManager.loadNavigation();

        res.json(newItem);
    } catch (error) {
        Logger.error("Fehler beim Erstellen des Navigation-Items:", error);
        res.status(500).json({ 
            error: "Datenbankfehler beim Erstellen" 
        });
    }
};

/**
 * Navigation-Item aktualisieren
 * @param {import('express').Request} req - Express Request Objekt
 * @param {import('express').Response} res - Express Response Objekt
 * @returns {Promise<void>}
 */
exports.update = async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    const themeManager = ServiceManager.get('themeManager');
    
    try {
        const id = req.params.id;
        const { guildId, plugin, title, url, icon, order_num } = req.body;

        // Prüfen ob Item existiert
        const [existingItem] = await dbService.query(
            "SELECT * FROM nav_items WHERE id = ?",
            [id]
        );

        if (!existingItem) {
            return res.status(404).json({ 
                error: "Navigation-Item nicht gefunden" 
            });
        }

        // Update durchführen
        await dbService.query(`
            UPDATE nav_items 
            SET 
                guildId = ?,
                plugin = ?,
                title = ?,
                url = ?,
                icon = ?,
                order_num = ?
            WHERE id = ?
        `, [
            guildId,
            plugin,
            title,
            url,
            icon || null,
            order_num || 0,
            id
        ]);

        // Aktualisiertes Item abrufen
        const [updatedItem] = await dbService.query(
            "SELECT * FROM nav_items WHERE id = ?",
            [id]
        );

        // Navigation neu laden
        await themeManager.loadNavigation();

        res.json(updatedItem);
    } catch (error) {
        Logger.error("Fehler beim Aktualisieren des Navigation-Items:", error);
        res.status(500).json({ 
            error: "Datenbankfehler beim Aktualisieren" 
        });
    }
};

/**
 * Navigation-Item löschen
 * @param {import('express').Request} req - Express Request Objekt
 * @param {import('express').Response} res - Express Response Objekt
 * @returns {Promise<void>}
 */
exports.delete = async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    const themeManager = ServiceManager.get('themeManager');
    
    try {
        const id = req.params.id;

        // Prüfen ob Item existiert
        const [existingItem] = await dbService.query(
            "SELECT * FROM nav_items WHERE id = ?",
            [id]
        );

        if (!existingItem) {
            return res.status(404).json({ 
                error: "Navigation-Item nicht gefunden" 
            });
        }

        // Item löschen
        await dbService.query(
            "DELETE FROM nav_items WHERE id = ?",
            [id]
        );

        // Navigation neu laden
        await themeManager.loadNavigation();

        res.json({ success: true });
    } catch (error) {
        Logger.error("Fehler beim Löschen des Navigation-Items:", error);
        res.status(500).json({ 
            error: "Datenbankfehler beim Löschen" 
        });
    }
};