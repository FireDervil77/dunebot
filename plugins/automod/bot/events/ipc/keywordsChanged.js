'use strict';

const { clearKeywordCache } = require('../../keywordLoader');

/**
 * IPC-Ereignis: `automod:keywordsChanged`
 *
 * Das Dashboard schickt es, sobald jemand eine Stichwortliste, einen Eintrag
 * oder eine Ausnahme geändert hat.
 *
 * **Dies ist die Stelle, an der das ganze Paket wirkt oder still nichts tut.**
 * Der Bot hält die Listen im Speicher; ohne dieses Ereignis würde eine Änderung
 * im Dashboard erst nach einem Neustart greifen. Genau das war der Zustand bis
 * zum 2026-08-09 — `clearKeywordCache` gab es, aufgerufen hat es niemand.
 *
 * @param {{guildId?: string}} payload
 * @returns {{cleared: string}}
 */
module.exports = async (payload) => {
    const guildId = payload?.guildId || null;

    clearKeywordCache(guildId);

    return { cleared: guildId || 'alle' };
};
