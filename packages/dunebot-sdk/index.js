const BotPlugin = require("./lib/BotPlugin");
const Config = require("./lib/Config");
const DashboardPlugin = require("./lib/DashboardPlugin");
const NavigationManager = require("./lib/NavigationManager");
const { PluginHooks } = require("dunebot-core"); // PluginHooks aus dunebot-core importieren

// HookSystem als Alias für PluginHooks für Rückwärtskompatibilität
// und bessere Namenskonvention
const HookSystem = PluginHooks;

module.exports = {
    BotPlugin,
    Config,
    DashboardPlugin,
    NavigationManager,
    HookSystem, // Exportieren als HookSystem (neuer Name)
    PluginHooks // Auch unter dem alten Namen exportieren für Abwärtskompatibilität
};
