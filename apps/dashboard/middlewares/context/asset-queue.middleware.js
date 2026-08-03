'use strict';

const { ServiceManager } = require('dunebot-core');

/**
 * Gibt jeder Anfrage ihre eigene Asset-Warteschlange.
 *
 * Vorher lag die Liste der eingereihten Assets auf der einen AssetManager-
 * Instanz und wurde pro Anfrage geleert. Bei gleichzeitigen Anfragen löschte
 * die eine also die Liste der anderen mitten im Rendern — oder deren Assets
 * landeten auf der falschen Seite. Registrierte Assets bleiben global, nur
 * **was eingereiht ist** gehört ab hier zur einzelnen Anfrage.
 *
 * Muss vor allem laufen, was Assets einreiht — also ganz vorn in der Kette.
 * Alles, was aus `next()` heraus folgt, erbt die Warteschlange automatisch.
 */
module.exports = (req, res, next) => {
    const assetManager = ServiceManager.get('assetManager');

    if (!assetManager || typeof assetManager.inAnfrage !== 'function') {
        return next();
    }

    assetManager.inAnfrage(() => next());
};
