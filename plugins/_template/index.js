const TemplateBotPlugin = require('./bot');
const TemplateDashboardPlugin = require('./dashboard');

/**
 * Template-Plugin für DuneBot
 * 
 * Dieses Plugin dient als Vorlage für die Entwicklung neuer Plugins.
 * Es zeigt die grundlegende Struktur und Best Practices.
 * 
 * VERWENDUNG:
 * 1. Kopieren Sie dieses Template-Verzeichnis
 * 2. Umbenennen nach: plugins/ihr-plugin-name/
 * 3. Ersetzen Sie 'template' durch Ihren Plugin-Namen
 * 4. Passen Sie package.json und config.json an
 * 5. Implementieren Sie Ihre Funktionalität
 * 
 * @module template
 * @author DuneBot Team
 */
module.exports = {
  bot: TemplateBotPlugin,
  dashboard: TemplateDashboardPlugin
};
