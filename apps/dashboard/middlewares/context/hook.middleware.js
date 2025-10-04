const { ServiceManager } = require("dunebot-core");

module.exports = function hooksMiddleware(req, res, next) {
    const Logger = ServiceManager.get('Logger');
    const pluginManager = ServiceManager.get('pluginManager');

    // Hooks für Templates verfügbar machen
    if (pluginManager && pluginManager.hooks) {
        res.locals.hooks = pluginManager.hooks;
    }
    
    // Shortcode-Parser verfügbar machen
    res.locals.parseShortcodes = (text) => {
        if (!req.app.shortcodeParser) return text;
        
        try {
            return req.app.shortcodeParser.parse(text, { 
                req, 
                res, 
                user: req.session?.user,
                guildId: req.params?.guildId
            });
        } catch (error) {
            Logger.error('Fehler beim Parsen von Shortcodes:', error);
            return text;
        }
    };
    
    // Hook vor dem Rendern einer Route ausführen
    if (pluginManager?.hooks) {
        pluginManager.hooks.doAction('before_route_render', req, res);
    }
    
    next();
};