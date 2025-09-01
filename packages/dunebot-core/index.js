const I18nManager = require("./lib/I18nManager");
const BasePluginManager = require("./lib/BasePluginManager");
const PluginHooks = require("./lib/PluginHooks");
const ServiceManager = require("./lib/ServiceManager");
const languagesMeta = require("./languages-meta.json");

module.exports = {
    ServiceManager,
    BasePluginManager,
    I18nManager,
    PluginHooks,
    languagesMeta,
};
