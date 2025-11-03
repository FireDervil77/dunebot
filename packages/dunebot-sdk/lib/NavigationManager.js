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
     * Ermittelt die nächste verfügbare sort_order-Range (1000, 2000, 3000...)
     * für Hauptnavigations-Punkte ohne parent
     * 
     * WICHTIG: Ignoriert Ranges >= 9000 (reserviert für Superadmin)
     * Neue Plugins werden immer VOR dem Superadmin-Bereich eingefügt!
     * 
     * @param {string} guildId - ID der Guild
     * @returns {Promise<number>} - Nächste freie Range (z.B. 3000)
     * @private
     */
    async _getNextMainNavRange(guildId) {
        const Logger = ServiceManager.get('Logger');
        const dbService = ServiceManager.get('dbService');
        
        try {
            // Höchste sort_order für Hauptmenü-Items (parent = NULL) finden
            // ABER: Ignoriere alles >= 9000 (Superadmin-Bereich)
            const result = await dbService.query(
                `SELECT MAX(sort_order) as max_order 
                 FROM nav_items 
                 WHERE guildId = ? 
                 AND type = 'main' 
                 AND (parent IS NULL OR parent = '')
                 AND sort_order < 9000`,
                [guildId]
            );
            
            const maxOrder = result?.[0]?.max_order || 0;
            
            // Nächste 1000er-Range berechnen
            // Beispiel: maxOrder=2300 → nextRange=3000
            let nextRange = Math.ceil((maxOrder + 1) / 1000) * 1000;
            
            // Mindestens 1000 (erste Range)
            if (nextRange < 1000) nextRange = 1000;
            
            // === SAFETY CHECK ===
            // Falls die Berechnung trotzdem >= 9000 ergibt (sollte nicht passieren)
            // → Nutze 8000 als "Notfall-Range" vor dem Superadmin
            if (nextRange >= 90000) {
                Logger.warn(`[NavigationManager] Berechnete Range ${nextRange} >= 9000 - nutze Fallback 8000`);
                nextRange = 8000;
            }
            
            Logger.debug(`[NavigationManager] Nächste freie Range (< 9000): ${nextRange}`);
            return nextRange;
            
        } catch (error) {
            Logger.error('Fehler beim Ermitteln der nächsten sort_order-Range:', error);
            return 1000; // Fallback zur ersten Range
        }
    }

    /**
     * Ermittelt die nächste verfügbare sort_order für Submenü-Punkte (10, 20, 30...)
     * @param {string} guildId - ID der Guild
     * @param {string} parentUrl - URL des übergeordneten Menüpunkts
     * @returns {Promise<number>} - Nächster freier Submenu-Offset (z.B. 30)
     * @private
     */
    async _getNextSubmenuOrder(guildId, parentUrl) {
        const Logger = ServiceManager.get('Logger');
        const dbService = ServiceManager.get('dbService');
        
        try {
            // Höchste sort_order für Submenüs dieses Parents finden
            const result = await dbService.query(
                `SELECT MAX(sort_order) as max_order 
                 FROM nav_items 
                 WHERE guildId = ? 
                 AND type = 'main' 
                 AND parent = ?`,
                [guildId, parentUrl]
            );
            
            const maxOrder = result?.[0]?.max_order || 0;
            
            // Nächste 10er-Stelle berechnen
            // Beispiel: maxOrder=25 → nextOrder=30
            //          maxOrder=0  → nextOrder=10
            const nextOrder = Math.ceil((maxOrder + 1) / 10) * 10;
            
            // Mindestens 10 (erster Submenu-Punkt)
            return nextOrder < 10 ? 10 : nextOrder;
            
        } catch (error) {
            Logger.error(`Fehler beim Ermitteln der nächsten Submenu-Order für parent ${parentUrl}:`, error);
            return 10; // Fallback zum ersten Submenu-Slot
        }
    }

    /**
     * Registriert Navigation für ein Plugin in einer bestimmten Guild
     * @param {string} pluginName - Name des Plugins
     * @param {string} guildId - ID der Guild
     * @param {Array} navItems - Array mit Navigationselementen
     * @returns {Promise<Array>} - Array mit erstellten Navigationselementen
     * @throws {Error} Wenn die Registrierung fehlschlägt
     * 
     * Sort-Order-System:
     * 
     * HAUPTNAVIGATION (parent=null):
     * - Feste Ranges: 1000, 2000, 3000...
     * - Bei order=null → automatisch nächste freie Range
     * - Bei order >= 1000 → exakte Verwendung
     * - Bei order < 1000 → als Offset in ermittelter Range (z.B. order=50 in Range 2000 → 2050)
     * 
     * RESERVIERTE RANGES:
     * - 9000-9999: Reserviert für Superadmin-Plugin (immer ganz hinten in der Navigation)
     * - Andere Plugins dürfen diese Range NICHT nutzen!
     * 
     * SUBMENÜS (parent=/some/url):
     * - Automatische Offsets: 10, 20, 30...
     * - Bei order=null → automatisch nächster freier Offset (pro parent)
     * - Bei order < 1000 → exakte Verwendung (manuelles Override)
     * - Bei order >= 1000 → exakte Verwendung (für spezielle Fälle)
     * 
     * Beispiel:
     * // Hauptnav
     * { title: 'Dashboard', order: null }           → 1000 (auto)
     * { title: 'Masterserver', order: null }        → 2000 (auto)
     * { title: 'Settings', order: 9000 }            → 9000 (nur Superadmin!)
     * 
     * // Submenüs unter '/guild/:gid/masterserver'
     * { title: 'Overview', parent: '/...', order: null }  → 10 (auto)
     * { title: 'Daemons', parent: '/...', order: null }   → 20 (auto)
     * { title: 'Settings', parent: '/...', order: null }  → 30 (auto)
     * { title: 'Important!', parent: '/...', order: 5 }   → 5 (manuell ganz vorne)
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
            
            // Alle bestehenden Navigations-Items für dieses Plugin in dieser Guild laden
            const existing = await dbService.query(
                "SELECT url, parent, type FROM nav_items WHERE plugin = ? AND guildId = ?",
                [pluginName, guildId]
            );
            
            // Set für schnelle URL-Lookups erstellen (URL + parent + type als Key)
            const existingKeys = new Set(
                existing.map(item => `${item.type}|${item.parent || 'NULL'}|${item.url}`)
            );
            
            // Nur neue Items filtern (die noch nicht existieren)
            const newItems = navItems.filter(item => {
                const key = `${item.type || this.menuTypes.MAIN}|${item.parent || 'NULL'}|${item.url || item.path}`;
                const exists = existingKeys.has(key);
                
                if (exists) {
                    Logger.debug(`[NavigationManager] Überspringe existierendes Item: ${item.title} (${item.url || item.path})`);
                }
                
                return !exists;
            });
            
            if (newItems.length === 0) {
                Logger.debug(`Alle Navigationselemente für Plugin ${pluginName} in Guild ${guildId} existieren bereits - keine neuen Items`);
                return existing;
            }

            // Neue Navigation anlegen
            Logger.debug(`Erstelle ${newItems.length} neue Navigationselemente für Plugin ${pluginName} in Guild ${guildId}`);
            
            // Nächste freie Range für Hauptnavigation ermitteln (nur einmal)
            let nextMainNavRange = null;
            
            // Cache für Submenu-Orders pro parent (nur einmal pro parent ermitteln)
            const submenuOrderCache = new Map();
            
            // Navigation-Items mit erweiterten Eigenschaften erstellen (nur für neue Items)
            const items = await Promise.all(newItems.map(async (item) => {
                let sortOrder;
                
                // Nur für Hauptnavigations-Elemente (ohne parent) Auto-Range anwenden
                const isMainNavItem = !item.parent && item.type === this.menuTypes.MAIN;
                const isSubmenuItem = item.parent && item.type === this.menuTypes.MAIN;
                
                // === RESERVED RANGE CHECK (90000-99999 für Superadmin) ===
                if (item.order !== null && item.order !== undefined && 
                    item.order >= 90000 && item.order < 100000 && 
                    pluginName !== 'superadmin') {
                    Logger.error(`[NavigationManager] Plugin '${pluginName}' versucht reservierte Range 90000-99999 zu nutzen!`);
                    Logger.error(`[NavigationManager] Diese Range ist für das Superadmin-Plugin reserviert!`);
                    throw new Error(`Reserved navigation order range 90000-99999 (Superadmin only). Plugin: ${pluginName}, Item: ${item.title}`);
                }
                
                if (item.order === null || item.order === undefined) {
                    // Kein order angegeben → automatisch ermitteln
                    if (isMainNavItem) {
                        // Für Hauptnav: Nächste freie Range ermitteln (lazy loading)
                        if (nextMainNavRange === null) {
                            nextMainNavRange = await this._getNextMainNavRange(guildId);
                            Logger.debug(`[NavigationManager] Ermittelte nächste Hauptnav-Range: ${nextMainNavRange}`);
                        }
                        sortOrder = nextMainNavRange;
                    } else if (isSubmenuItem) {
                        // Für Submenüs: Nächste freie Order ermitteln (10, 20, 30...)
                        if (!submenuOrderCache.has(item.parent)) {
                            const nextOrder = await this._getNextSubmenuOrder(guildId, item.parent);
                            submenuOrderCache.set(item.parent, nextOrder);
                            Logger.debug(`[NavigationManager] Ermittelte nächste Submenu-Order für parent '${item.parent}': ${nextOrder}`);
                        }
                        sortOrder = submenuOrderCache.get(item.parent);
                        // Für nächsten Submenu-Punkt in diesem Parent: +10
                        submenuOrderCache.set(item.parent, sortOrder + 10);
                    } else {
                        // Für andere Typen (settings, widget, metabox): Standard-Order
                        sortOrder = 50;
                    }
                } else if (item.order >= 1000) {
                    // Explizite Range angegeben (≥1000) → direkt verwenden
                    sortOrder = item.order;
                } else {
                    // Kleine Zahl (<1000) → Kontext-abhängig
                    if (isMainNavItem) {
                        // Hauptnav: Als Offset in der Range verwenden
                        if (nextMainNavRange === null) {
                            nextMainNavRange = await this._getNextMainNavRange(guildId);
                        }
                        sortOrder = nextMainNavRange + item.order;
                        Logger.debug(`[NavigationManager] Offset ${item.order} in Range ${nextMainNavRange} → ${sortOrder}`);
                    } else {
                        // Submenüs/andere: Direkt verwenden (explizite Order)
                        sortOrder = item.order;
                    }
                }
                
                return {
                    plugin: pluginName,
                    guildId: guildId,
                    title: item.title || null,
                    url: item.url || item.path || null,
                    icon: item.icon || 'fa-puzzle-piece',
                    sort_order: sortOrder,
                    parent: item.parent || null,
                    type: item.type || this.menuTypes.MAIN,
                    // ✅ requiresOwner-Items benötigen KEINE capability (Zugriff nur via ENV OWNER_IDS!)
                    capability: item.requiresOwner ? null : (item.capability || 'DASHBOARD.ACCESS'),
                    target: item.target || '_self',
                    visible: item.visible ?? true,
                    classes: item.classes || '',
                    position: item.position || 'normal',
                    requiresOwner: item.requiresOwner || false // Bot-Owner-Only Flag
                };
            }));

            // Bulk-Insert mit native MySQL
            for (const navItem of items) {
                await dbService.query(`
                    INSERT INTO nav_items (
                        plugin, guildId, title, url, icon, 
                        sort_order, parent, type, capability, 
                        target, visible, classes, position, requiresOwner
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `, [
                    navItem.plugin,
                    navItem.guildId,
                    navItem.title,
                    navItem.url,
                    navItem.icon,
                    navItem.sort_order,
                    navItem.parent,
                    navItem.type,
                    navItem.capability,
                    navItem.target,
                    navItem.visible ? 1 : 0,
                    navItem.classes,
                    navItem.position,
                    navItem.requiresOwner ? 1 : 0
                ]);
                
                Logger.debug(`[NavigationManager] Erstellt: ${navItem.title} (sort_order=${navItem.sort_order})`);
            }
            Logger.success(`${items.length} neue Navigationselemente für Plugin ${pluginName} in Guild ${guildId} erstellt`);
            
            // Alle Items zurückgeben (existing + new)
            const allItems = await dbService.query(
                "SELECT * FROM nav_items WHERE plugin = ? AND guildId = ?",
                [pluginName, guildId]
            );
            
            return allItems;
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
     * Lädt alle Navigationselemente für eine Guild (mit Permission-Filterung)
     * @param {string} guildId - ID der Guild
     * @param {string} [userId=null] - User ID für Permission-Check (null = keine Filterung)
     * @returns {Promise<Array>} - Array mit Navigationselementen
     */
    async getNavigation(guildId, userId = null) {
        const Logger = ServiceManager.get('Logger');
        const dbService = ServiceManager.get('dbService');

        try {
            const results = await dbService.query(
                "SELECT * FROM nav_items WHERE guildid = ? AND visible = true and type = 'main' ORDER BY type ASC, parent ASC, sort_order ASC, title ASC",
                [guildId]
            );
            
            // Permission-Filterung wenn userId vorhanden
            if (userId) {
                return await this._filterByPermissions(results, guildId, userId);
            }
            
            // Ergebnis zurückgeben
            return results;
        } catch (error) {
            Logger.error(`Fehler beim Laden der Navigation für Guild ${guildId}:`, error);
            return [];
        }
    }
    
    /**
     * Lädt alle Navigationselemente eines bestimmten Typs (mit Permission-Filterung)
     * @param {string} guildId - ID der Guild
     * @param {string} type - Menütyp (main, settings, widget, metabox)
     * @param {string} [parent=null] - Übergeordnetes Menü (für Untermenüs)
     * @param {string} [userId=null] - User ID für Permission-Check (null = keine Filterung)
     * @returns {Promise<Array>} - Array mit gefilterten Navigationselementen
     */
    async getNavigationByType(guildId, type, parent = null, userId = null) {
        const Logger = ServiceManager.get('Logger');
        const dbService = ServiceManager.get('dbService');
        try {
            let sql = "SELECT * FROM nav_items WHERE guildid = ? AND type = ? AND visible = true";
            const params = [guildId, type];
            if (parent !== undefined && parent !== null) {
                sql += " AND parent = ?";
                params.push(parent);
            }
            sql += " ORDER BY sort_order ASC, title ASC";
            const results = await dbService.query(sql, params);
            
            // Permission-Filterung wenn userId vorhanden
            if (userId) {
                return await this._filterByPermissions(results, guildId, userId);
            }
            
            // Ergebnis zurückgeben
            return results;
        } catch (error) {
            Logger.error(`Fehler beim Laden der Navigation vom Typ ${type} für Guild ${guildId}:`, error);
            return [];
        }
    }
    
    /**
     * Lädt das Hauptmenü mit allen Untermenüs (mit Permission-Filterung)
     * @param {string} guildId - ID der Guild
     * @param {string} [userId=null] - User ID für Permission-Check (null = keine Filterung)
     * @returns {Promise<Array>} - Array mit strukturierten Menüs
     */
    async getMainMenuWithSubmenu(guildId, userId = null) {
        const Logger = ServiceManager.get('Logger');
        try {
            const allMenuItems = await this.getNavigationByType(guildId, this.menuTypes.MAIN, null, userId);
            
            // Navigation strukturieren

            // Sicherstellen dass guildId ein String ist
            const guildIdStr = String(guildId);
            
            // Hauptmenüpunkte: parent == null und guildid matchen
            const mainMenu = allMenuItems.filter(item => {
                const isParentNull = !item.parent || item.parent === null;
                const isGuildMatch = String(item.guildId) === guildIdStr;
                
                // Nur Einträge ohne parent und mit passender guildId
                
                return isParentNull && isGuildMatch;
            });
            
            // Submenüs zuordnen (Case-Insensitive, parent-URL)
            const structuredMenu = mainMenu.map(mainItem => {
                const subItems = allMenuItems.filter(item => {
                    if (!item.parent || !mainItem.url) return false;
                    const isParentMatch = item.parent.toLowerCase() === mainItem.url.toLowerCase();
                    const isGuildMatch = String(item.guildId) === guildIdStr;
                    
                    // Untermenüs mit passender parent URL und guildId
                    
                    return isParentMatch && isGuildMatch;
                });
                return {
                    ...mainItem,
                    subItems
                };
            });
            // Fertige Menüstruktur zurückgeben
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

    /**
     * Filtert Navigations-Items basierend auf User-Permissions (mit Wildcard-Support)
     * @private
     * @param {Array} items - Array mit Navigationselementen
     * @param {string} guildId - Guild ID
     * @param {string} userId - User ID
     * @returns {Promise<Array>} - Gefilterte Navigationselemente
     */
    async _filterByPermissions(items, guildId, userId) {
        const Logger = ServiceManager.get('Logger');
        
        try {
            // PermissionManager über ServiceManager holen (Singleton!)
            const permissionManager = ServiceManager.get('permissionManager');
            
            if (!permissionManager) {
                Logger.warn('[Navigation] PermissionManager nicht verfügbar - keine Filterung');
                return items;
            }
            
            // User-Permissions laden (gibt Objekt zurück: { permissions: {...}, groups: [], is_owner: bool })
            const userPermsData = await permissionManager.getUserPermissions(userId, guildId);
            const userPermissions = userPermsData.permissions || {};
            const isOwner = userPermsData.is_owner || false;
            
            // Wildcard-Check: Wenn User wildcard hat, darf er alles sehen
            if (userPermissions.wildcard || userPermissions['*']) {
                Logger.debug(`[Navigation] User ${userId} hat Wildcard - zeige alle Items`);
                return items;
            }
            
            // Permissions-Object zu Array konvertieren (nur Keys mit truthy values)
            // WICHTIG: Keine Konvertierung! Nur UPPERCASE Permissions im System erlaubt!
            const permissionKeys = Object.keys(userPermissions).filter(key => userPermissions[key]);
            
            Logger.debug(`[Navigation] User ${userId} hat ${permissionKeys.length} Permissions`, permissionKeys);
            
            // Items filtern
            const filtered = items.filter(item => {
                // ✅ NEU: requiresOwner-Check (SuperAdmin-Plugin)
                // Wenn Item requiresOwner: true hat, muss User Bot-Owner sein
                if (item.requiresOwner === true || item.requiresOwner === 1 || item.requiresOwner === '1') {
                    // Prüfe ob User in OWNER_IDS ist
                    const ownerIds = process.env.OWNER_IDS?.split(',') || [];
                    const isBotOwner = ownerIds.includes(String(userId));
                    
                    if (!isBotOwner) {
                        Logger.debug(`[Navigation] Item "${item.title}" versteckt (requiresOwner=true, User ist kein Bot-Owner)`);
                        return false;
                    }
                    
                    // User ist Bot-Owner → Item anzeigen (capability wird ignoriert)
                    return true;
                }
                
                // Kein capability-Feld? → Verstecken (Sicherheit geht vor!)
                if (!item.capability) {
                    Logger.debug(`[Navigation] Item "${item.title}" versteckt (keine capability definiert)`);
                    return false;
                }
                
                // WICHTIG: NUR exakter UPPERCASE Match - keine Konvertierung!
                // Capabilities MÜSSEN bereits in UPPERCASE in der DB sein!
                
                // Exakter Match
                if (permissionKeys.includes(item.capability)) {
                    return true;
                }
                
                // Wildcard-Match (z.B. GAMESERVER.* erlaubt GAMESERVER.START)
                const parts = item.capability.split('.');
                for (let i = parts.length - 1; i > 0; i--) {
                    const wildcard = parts.slice(0, i).join('.') + '.*';
                    if (permissionKeys.includes(wildcard)) {
                        return true;
                    }
                }
                
                // Keine Permission → verstecken
                Logger.debug(`[Navigation] Item "${item.title}" versteckt (capability: ${item.capability})`);
                return false;
            });
            
            Logger.debug(`[Navigation] ${items.length} Items → ${filtered.length} Items nach Filterung`);
            return filtered;
            
        } catch (error) {
            Logger.error(`Fehler beim Filtern der Navigation nach Permissions:`, error);
            // Im Fehlerfall: Alle Items zurückgeben (fail-open)
            return items;
        }
    }
}

module.exports = NavigationManager;