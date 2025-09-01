const { ServiceManager } = require("dunebot-core");

/**
 * Verwaltet die Navigation im Dashboard ähnlich wie bei WordPress
 * @author Dunebot-Team
 */
class NavigationManager {
    constructor() {
        this.menuTypes = {
            MAIN: 'main',           // Hauptmenü (links)
            SETTINGS: 'settings',    // Einstellungsmenü
            PLUGIN: 'plugin',        // Plugin-spezifisches Menü
            WIDGET: 'widget',        // Dashboard-Widgets
            METABOX: 'metabox'       // Metaboxen auf Seiten
        };
    }

    /**
     * Registriert Navigation für ein Plugin in einer bestimmten Guild
     * @param {string} pluginName - Name des Plugins
     * @param {string} guildId - ID der Guild
     * @param {Array} navItems - Array mit Navigationselementen
     * @returns {Promise<Array>} - Array mit erstellten Navigationselementen
     * @throws {Error} Wenn die Registrierung fehlschlägt
     */
    async registerNavigation(pluginName, guildId, navItems = []) {
        const Logger = ServiceManager.get('Logger');
        const dbService = ServiceManager.get('dbService');

        Logger.debug(`Versuche Navigation für ${pluginName} in Guild ${guildId} zu registrieren`);
        
        if (!dbService || !guildId) {
            Logger.error('NavigationManager: Fehlender dbService oder guildId');
            return [];
        }
        
        try {
            if (!pluginName || !guildId) {
                Logger.warn('NavigationManager: Fehlender pluginName oder guildId');
                return [];
            }
            
            // Prüfen, ob Navigation bereits existiert
            const existing = await dbService.query(
                "SELECT * FROM nav_items WHERE plugin = ? AND guildId = ?",
                [pluginName, guildId]
            );
            
            if (existing && existing.length > 0) {
                Logger.debug(`Navigation für Plugin ${pluginName} in Guild ${guildId} existiert bereits`);
                return existing;
            }

            // Neue Navigation anlegen
            Logger.debug(`Erstelle Navigation für Plugin ${pluginName} in Guild ${guildId}`);
            
            // Navigation-Items mit erweiterten Eigenschaften erstellen
            const items = navItems.map(item => ({
                plugin: pluginName,
                guildId,
                title: item.title,
                url: item.url || item.path,
                icon: item.icon || 'fa-puzzle-piece',
                order: item.order || 50,
                parent: item.parent || null,
                type: item.type || this.menuTypes.MAIN,
                capability: item.capability || 'manage_guild',
                target: item.target || '_self',
                visible: item.visible !== false,
                classes: item.classes || '',
                position: item.position || 'normal'
            }));

            // Bulk-Insert mit native MySQL
            for (const navItem of items) {
                await dbService.query(`
                    INSERT INTO nav_items 
                        (plugin, guildId, title, url, icon, \`order\`, parent, type, capability, target, visible, classes, position)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `, [
                    navItem.plugin,
                    navItem.guildId,
                    navItem.title,
                    navItem.url,
                    navItem.icon,
                    navItem.order,
                    navItem.parent,
                    navItem.type,
                    navItem.capability,
                    navItem.target,
                    navItem.visible,
                    navItem.classes,
                    navItem.position
                ]);
            }
            Logger.success(`${items.length} Navigationselemente für Plugin ${pluginName} in Guild ${guildId} erstellt`);
            return items;
        } catch (error) {
            Logger.error(`Fehler beim Erstellen der Navigation für Plugin ${pluginName}:`, error);
            throw error;
        }
    }

    /**
     * Registriert eine Hauptmenü-Seite im Dashboard
     * @param {string} pluginName - Name des Plugins
     * @param {string} guildId - ID der Guild
     * @param {Object} menuItem - Eigenschaften des Menüpunkts
     * @returns {Promise<Object>} - Das erstellte Menü-Item
     */
    async addMainMenu(pluginName, guildId, menuItem) {
        return (await this.registerNavigation(pluginName, guildId, [
            {
                ...menuItem,
                type: this.menuTypes.MAIN,
                parent: null
            }
        ]))[0];
    }

    /**
     * Registriert ein Untermenü zu einem bestehenden Menüpunkt
     * @param {string} pluginName - Name des Plugins
     * @param {string} guildId - ID der Guild
     * @param {string} parentSlug - Slug des übergeordneten Menüs
     * @param {Object} menuItem - Eigenschaften des Untermenüs
     * @returns {Promise<Object>} - Das erstellte Untermenü-Item
     */
    async addSubmenu(pluginName, guildId, parentSlug, menuItem) {
        return (await this.registerNavigation(pluginName, guildId, [
            {
                ...menuItem,
                type: this.menuTypes.MAIN,
                parent: parentSlug
            }
        ]))[0];
    }

    /**
     * Fügt eine Einstellungsseite zum Einstellungsmenü hinzu
     * @param {string} pluginName - Name des Plugins
     * @param {string} guildId - ID der Guild
     * @param {Object} menuItem - Eigenschaften der Einstellungsseite
     * @returns {Promise<Object>} - Das erstellte Menü-Item
     */
    async addSettingsPage(pluginName, guildId, menuItem) {
        return (await this.registerNavigation(pluginName, guildId, [
            {
                ...menuItem,
                type: this.menuTypes.SETTINGS,
                parent: 'settings'
            }
        ]))[0];
    }

    /**
     * Fügt ein Widget zum Dashboard hinzu
     * @param {string} pluginName - Name des Plugins
     * @param {string} guildId - ID der Guild
     * @param {Object} widget - Eigenschaften des Widgets
     * @returns {Promise<Object>} - Das erstellte Widget-Item
     */
    async addDashboardWidget(pluginName, guildId, widget) {
        return (await this.registerNavigation(pluginName, guildId, [
            {
                ...widget,
                type: this.menuTypes.WIDGET
            }
        ]))[0];
    }

    /**
     * Fügt eine Metabox zu einer bestehenden Seite hinzu
     * @param {string} pluginName - Name des Plugins
     * @param {string} guildId - ID der Guild
     * @param {string} screenId - ID der Seite, zu der die Metabox hinzugefügt werden soll
     * @param {Object} metabox - Eigenschaften der Metabox
     * @returns {Promise<Object>} - Das erstellte Metabox-Item
     */
    async addMetabox(pluginName, guildId, screenId, metabox) {
        return (await this.registerNavigation(pluginName, guildId, [
            {
                ...metabox,
                type: this.menuTypes.METABOX,
                parent: screenId,
                position: metabox.position || 'normal'
            }
        ]))[0];
    }

    /**
     * Lädt alle Navigationselemente für eine Guild
     * @param {string} guildId - ID der Guild
     * @returns {Promise<Array>} - Array mit Navigationselementen
     */
    async getNavigation(guildId) {
        const Logger = ServiceManager.get('Logger');
        const dbService = ServiceManager.get('dbService');

        try {
            return await dbService.query(
                "SELECT * FROM nav_items WHERE guildId = ? AND visible = true ORDER BY type ASC, parent ASC, `order` ASC, title ASC",
                [guildId]
            );
        } catch (error) {
            Logger.error(`Fehler beim Laden der Navigation für Guild ${guildId}:`, error);
            return [];
        }
    }
    
    /**
     * Lädt alle Navigationselemente eines bestimmten Typs
     * @param {string} guildId - ID der Guild
     * @param {string} type - Menütyp (main, settings, widget, metabox)
     * @param {string} [parent=null] - Übergeordnetes Menü (für Untermenüs)
     * @returns {Promise<Array>} - Array mit gefilterten Navigationselementen
     */
    async getNavigationByType(guildId, type, parent = null) {
        const Logger = ServiceManager.get('Logger');
        const dbService = ServiceManager.get('dbService');
        try {
            let sql = "SELECT * FROM nav_items WHERE guildId = ? AND type = ? AND visible = true";
            const params = [guildId, type];
            if (parent !== undefined && parent !== null) {
                sql += " AND parent = ?";
                params.push(parent);
            }
            sql += " ORDER BY `order` ASC, title ASC";
            return await dbService.query(sql, params);
        } catch (error) {
            Logger.error(`Fehler beim Laden der Navigation vom Typ ${type} für Guild ${guildId}:`, error);
            return [];
        }
    }
    
    /**
     * Lädt das Hauptmenü mit allen Untermenüs
     * @param {string} guildId - ID der Guild
     * @returns {Promise<Array>} - Array mit strukturierten Menüs
     */
    async getMainMenuWithSubmenu(guildId) {
        const Logger = ServiceManager.get('Logger');

        try {
            const allMenuItems = await this.getNavigationByType(guildId, this.menuTypes.MAIN);
            
            // Hauptmenüpunkte (ohne Elternmenü)
            const mainMenu = allMenuItems.filter(item => !item.parent);
            
            // Untermenüs den Hauptmenüs zuordnen
            const structuredMenu = mainMenu.map(mainItem => {
                const subItems = allMenuItems.filter(item => item.parent === mainItem.url);
                return {
                    ...mainItem.toJSON(),
                    subItems
                };
            });
            
            return structuredMenu;
        } catch (error) {
            Logger.error(`Fehler beim Laden des Hauptmenüs für Guild ${guildId}:`, error);
            return [];
        }
    }
    
    /**
     * Löscht die Navigation eines Plugins in einer Guild
     * @param {string} pluginName - Name des Plugins
     * @param {string} guildId - ID der Guild
     * @returns {Promise<number>} - Anzahl der gelöschten Elemente
     */
    async removeNavigation(pluginName, guildId) {
        const Logger = ServiceManager.get('Logger');
        const dbService = ServiceManager.get('dbService');

        try {
            const result = await dbService.query(
                "DELETE FROM nav_items WHERE plugin = ? AND guildId = ?",
                [pluginName, guildId]
            );
            Logger.debug(`Navigationselemente für Plugin ${pluginName} in Guild ${guildId} entfernt`);
            // result.affectedRows kann genutzt werden, falls dein DB-Client das unterstützt
            return result.affectedRows || 0;
        } catch (error) {
            Logger.error(`Fehler beim Entfernen der Navigation:`, error);
            return 0;
        }
    }
}

module.exports = NavigationManager;