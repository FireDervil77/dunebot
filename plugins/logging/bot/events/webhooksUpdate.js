'use strict';

const S = require('../struktur');

/**
 * Logging: Webhooks eines Kanals geändert (3.4, Intent GuildWebhooks seit G-13). Discord sagt nur „hat sich geändert“; was, kommt mit LG-1c aus dem Audit-Log.
 * (LG-1b, K382, 2026-11-16)
 */
module.exports = (kanal) => S.melde(kanal.guild?.id, S.webhooksGeaendert(kanal), { kanaele: S.kette(kanal) });
