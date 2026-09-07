'use strict';

/**
 * Was andere Plugins ueber offene Verlosungen erfahren duerfen.
 *
 * # Warum das eine eigene Datei ist
 *
 * Ohne sie muesste das Streaming-Plugin `giveaways` selbst abfragen - eine
 * fremde Tabelle, deren Aufbau ihm nicht gehoert und deren Kollation nicht zu
 * seiner passen muss. Und ohne das Verlosungs-Plugin gaebe es sie ueberhaupt
 * nicht; die Abfrage wuerde dann werfen statt "gibt es hier nicht" zu sagen.
 *
 * Hier steht deshalb genau eine Auskunft, in den Worten des Fragenden: Welche
 * Verlosung nimmt gerade Lose aus dem Stream entgegen? Alles andere - Regeln,
 * Bedingungen, Ziehung - bleibt drinnen.
 *
 * @module giveaway/dashboard/verlosungsdienst
 */

const { ServiceManager } = require('dunebot-core');

/**
 * Die offene Verlosung einer Guild, die den Stream-Weg zulaesst.
 *
 * **Die neueste gewinnt, wenn mehrere laufen.** Das ist die Verlosung, die der
 * Streamer gerade angesagt hat - und "die neueste" ist die einzige Regel, die
 * ein Zuschauer im Chat auch nachvollziehen kann. Eine Auswahl per Nummer
 * waere im Chat unbedienbar.
 *
 * Prueft **selbst**, ob das Plugin fuer diese Guild eingeschaltet ist. Der
 * Fragende soll das nicht wissen muessen, und er koennte es auch nicht
 * zuverlaessig: Ein Plugin kann geladen und trotzdem fuer eine Guild aus sein.
 *
 * @param {string} guildId Guild
 * @returns {Promise<{id: number, preis: string, endet_am: Date, nurAbonnenten: boolean}|null>} Verlosung oder null
 */
async function offeneVerlosung(guildId) {
    const pluginManager = ServiceManager.get('pluginManager');
    if (pluginManager && !await pluginManager.isPluginEnabledForGuild('giveaway', guildId)) {
        return null;
    }

    const db = ServiceManager.get('dbService');
    const zeilen = await db.query(`
        SELECT id, prize, ends_at, stream_nur_abonnenten
          FROM giveaways
         WHERE guild_id = ?
           AND status = 'active'
           AND teilnahme IN ('stream', 'beide')
           AND ends_at > NOW()
         ORDER BY starts_at DESC
         LIMIT 1
    `, [guildId]);

    if (!zeilen.length) return null;
    return {
        id: zeilen[0].id,
        preis: zeilen[0].prize,
        endet_am: zeilen[0].ends_at,
        // Die Bedingung kommt **mit**, statt dass der Fragende sie nachholt:
        // Sonst braeuchte er eine zweite Abfrage auf eine fremde Tabelle, und
        // genau die soll es hier nicht geben.
        nurAbonnenten: Boolean(zeilen[0].stream_nur_abonnenten)
    };
}

module.exports = { offeneVerlosung };
