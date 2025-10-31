const { ServiceManager } = require("dunebot-core");

module.exports = (message) => {
    const Logger = ServiceManager.get("Logger");
    
    Logger.warn(`Client Warning: ${message}`);
};
