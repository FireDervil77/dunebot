const BotPlugin = require("./lib/BotPlugin");
const Config = require("./lib/Config");
const DashboardPlugin = require("./lib/DashboardPlugin");
const NavigationManager = require("./lib/NavigationManager");
const ThemeManager = require("./lib/ThemeManager");
const NotificationManager = require("./lib/NotificationManager");
const VersionHelper = require("./lib/VersionHelper");
const { PluginHooks } = require("dunebot-core"); // PluginHooks aus dunebot-core importieren
const RouterManager = require("./lib/RouterManager");
const AssetManager = require("./lib/AssetManager");
const BotHealthMonitor = require("./lib/BotHealthMonitor");
const SessionManager = require("./lib/SessionManager");
const HookSystem = PluginHooks;

// IPM (Inter-Process Messaging) - Event-Bus Architecture
const MessageTypes = require("./lib/ipm/MessageTypes");
const MessageBuilder = require("./lib/ipm/MessageBuilder");
const MessageValidator = require("./lib/ipm/MessageValidator");
const permissionManager = require("./lib/PermissionManager");
const WidgetManager = require("./lib/WidgetManager");

module.exports = {
    BotPlugin,
    Config,
    DashboardPlugin,
    NavigationManager,
    ThemeManager,
    NotificationManager,
    VersionHelper,
    RouterManager,
    AssetManager,
    BotHealthMonitor,
    SessionManager,
    HookSystem, // Exportieren als HookSystem (neuer Name)
    PluginHooks, // Auch unter dem alten Namen exportieren für Abwärtskompatibilität
    permissionManager,
    WidgetManager,
    // IPM (Inter-Process Messaging) - Event-Bus Architecture
    MessageTypes,
    MessageBuilder,
    MessageValidator
};
