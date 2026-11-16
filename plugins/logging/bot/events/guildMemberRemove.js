'use strict';

const M = require('../mitglieder');

/**
 * Logging: Mitglied oder Bot gegangen (3.3, 3.7). Auch als Partial (G-13): dann ohne Beitrittszeit und Rollen. Ob es ein Kick war, sagt erst das Audit-Log (LG-1c).
 * (LG-1b, K382, 2026-11-16)
 */
module.exports = (member) => M.melde(member.guild?.id, M.verlassen(member), member);
