const { ServiceManager } = require("dunebot-core");

module.exports = (error) => {
    const Logger = ServiceManager.get("Logger");
    Logger.error("Client Error", error);
};
