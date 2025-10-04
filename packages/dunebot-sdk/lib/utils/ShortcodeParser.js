const { ServiceManager } = require('dunebot-core');

class ShortcodeParser {
    constructor() {
        this.shortcodes = {};
    }
    
    register(pluginName, tag, callback) {
        const Logger = ServiceManager.get('Logger');  // Logger aus ServiceManager holen

        if (!this.shortcodes[tag]) {
            this.shortcodes[tag] = {
                plugin: pluginName,
                callback
            };
            Logger.debug(`Registered shortcode [${tag}] from plugin ${pluginName}`);
            return true;
        } else {
            Logger.warn(`Shortcode [${tag}] already registered by plugin ${this.shortcodes[tag].plugin}`);
            return false;
        }
    }
    
    parse(text, context = {}) {
        const Logger = ServiceManager.get('Logger');  // Logger aus ServiceManager holen
        
        // Implementation as outlined in your TODO document
        const regex = /\[(\w+)(?:\s+([^\]]+))?\](?:([^\[]+)\[\/\1\])?/g;
        
        return text.replace(regex, (match, tag, attrs, content) => {
            if (!this.shortcodes[tag]) return match;
            
            // Parse attributes
            const attributes = {};
            if (attrs) {
                const attrRegex = /(\w+)="([^"]+)"/g;
                let attrMatch;
                while ((attrMatch = attrRegex.exec(attrs)) !== null) {
                    attributes[attrMatch[1]] = attrMatch[2];
                }
            }
            
            // Execute shortcode
            try {
                return this.shortcodes[tag].callback(attributes, content, context);
            } catch (error) {
                Logger.error(`Error executing shortcode [${tag}]:`, error);
                return `[Error in shortcode ${tag}]`;
            }
        });
    }
}

module.exports = ShortcodeParser;