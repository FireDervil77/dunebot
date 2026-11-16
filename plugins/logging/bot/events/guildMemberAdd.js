'use strict';

const M = require('../mitglieder');

/**
 * Logging: Mitglied oder Bot beigetreten (3.3, 3.7). Den Einlader kennt der Kern (G-16); er kommt mit LG-1e über `kern.mitglied.beigetreten`.
 * (LG-1b, K382, 2026-11-16)
 */
module.exports = (member) => M.melde(member.guild?.id, M.beigetreten(member), member);
