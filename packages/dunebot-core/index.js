const I18nManager = require("./lib/I18nManager");
const BasePluginManager = require("./lib/BasePluginManager");
const PluginHooks = require("./lib/PluginHooks");
const ServiceManager = require("./lib/ServiceManager");
const BaseService = require("./lib/BaseService");
const GuildManager = require("./lib/GuildManager");
const SiteConfig = require("./lib/SiteConfig");
const MigrationRunner = require("./lib/MigrationRunner");
const { parsePlaceholders, buildEmbed } = require("./lib/PlaceholderParser");
const languagesMeta = require("./languages-meta.json");

module.exports = {
    ServiceManager,
    BasePluginManager,
    BaseService,
    I18nManager,
    PluginHooks,
    GuildManager,
    SiteConfig,
    MigrationRunner,
    parsePlaceholders,
    buildEmbed,
    languagesMeta,
};
