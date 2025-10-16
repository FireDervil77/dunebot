const BotPlugin = require("./lib/BotPlugin");
const Config = require("./lib/Config");
const DashboardPlugin = require("./lib/DashboardPlugin");
const NavigationManager = require("./lib/NavigationManager");
const ThemeManager = require("./lib/ThemeManager");
const NotificationManager = require("./lib/NotificationManager");
const UpdatesManager = require("./lib/UpdatesManager");
const VersionHelper = require("./lib/VersionHelper");
const { PluginHooks } = require("dunebot-core"); // PluginHooks aus dunebot-core importieren
const RouterManager = require("./lib/RouterManager");
const AssetManager = require("./lib/AssetManager");
const BotHealthMonitor = require("./lib/BotHealthMonitor");
const SessionManager = require("./lib/SessionManager");
const HookSystem = PluginHooks;

module.exports = {
    BotPlugin,
    Config,
    DashboardPlugin,
    NavigationManager,
    ThemeManager,
    NotificationManager,
    UpdatesManager,
    VersionHelper,
    RouterManager,
    AssetManager,
    BotHealthMonitor,
    SessionManager,
    HookSystem, // Exportieren als HookSystem (neuer Name)
    PluginHooks // Auch unter dem alten Namen exportieren für Abwärtskompatibilität
};
