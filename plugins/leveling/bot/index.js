'use strict';

/**
 * Leveling - Bot-Plugin (LV-1a, LV-1c, K382, 2026-11-15).
 *
 * Stufe 1 bisher: Chat-XP über den Kern (G-20), Storno beim Löschen, Zähler
 * je Mitglied. Sprach-XP (LV-1d), Belohnungen (LV-1e), Level-up-Ausgabe
 * (LV-1f) und die Befehle (LV-1g, LV-1h) folgen.
 */

const { BotPlugin, VersionHelper } = require('dunebot-sdk');
const { ServiceManager } = require('dunebot-core');
const chatxp = require('./chatxp');

const TAKT_MS = 60_000;

class LevelingBotPlugin extends BotPlugin {
    constructor() {
        super({
            name: 'leveling',
            displayName: 'Leveling',
            description: 'Community-Level, XP und Ranglisten je Guild',
            version: VersionHelper.getVersionFromContext(__dirname),
            author: 'FireBot Team',
            icon: 'fa-solid fa-ranking-star',
            baseDir: __dirname,
            ownerOnly: false
        });
        this.uhr = null;
    }

    async onEnable() {
        // Prozessweit, wie jeder Takt eines Plugins (K366): Zähler schreiben,
        // Drossel aufräumen. Läuft auch, wenn Leveling in keiner Guild mehr an
        // ist; dann gibt es nichts zu schreiben.
        if (!this.uhr) {
            this.uhr = setInterval(() => {
                chatxp.takt().catch((err) => ServiceManager.get('Logger').error('[Leveling] Takt gescheitert:', err));
            }, TAKT_MS);
            this.uhr.unref?.();
        }
        ServiceManager.get('Logger').success('[Leveling] Plugin aktiviert');
    }
}

module.exports = new LevelingBotPlugin();
