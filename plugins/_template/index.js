const TemplateBotPlugin = require('./bot');
const TemplateDashboardPlugin = require('./dashboard');

/**
 * Template Plugin für DuneBot
 * 
 * Dieses Plugin dient als Vorlage für neue Plugins.
 * 
 * SETUP-ANLEITUNG:
 * 1. Kopiere diesen gesamten _template Ordner
 * 2. Benenne ihn um (z.B. 'economy', 'moderation', etc.)
 * 3. Suche & Ersetze folgende Begriffe in ALLEN Dateien:
 *    - 'template' → 'deinpluginname' (lowercase)
 *    - 'Template' → 'DeinPluginName' (PascalCase)
 *    - 'TEMPLATE' → 'DEINPLUGINNAME' (UPPERCASE)
 * 4. Passe die Metadaten in bot/index.js und dashboard/index.js an
 * 5. Lösche die Beispiel-Commands und erstelle deine eigenen
 * 6. Passe die Übersetzungen an
 * 7. Registriere das Plugin in plugins/registry.json
 * 
 * @author DuneBot Team
 * @version 1.0.0
 */
module.exports = {
    bot: TemplateBotPlugin,
    dashboard: TemplateDashboardPlugin
};
