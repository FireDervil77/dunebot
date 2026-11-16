'use strict';

/**
 * Logging: Kategorien und Arten (LG-1a/LG-1b, K382, 2026-11-16).
 *
 * Eine Kategorie ist die Einheit, die eine Guild an- und abschaltet (Konzept
 * „Kategorien und Unterkategorien einzeln“). Eine Art ist ihre Unterkategorie
 * und lässt sich einzeln abschalten. Die Nummern verweisen auf das Konzept
 * (3.3 Mitglieder usw.).
 *
 * Hier stehen nur Kategorien, deren Erfasser gebaut ist. Eine Kategorie ohne
 * Erfasser in der Liste wäre ein Schalter, der nichts tut. Teil 2 von LG-1b
 * trägt Sprache, Emojis, Threads, Foren, Discord-Ereignisse und Nachrichten
 * (Metadaten) nach.
 *
 * `vorgabe` gilt, solange die Guild für die Kategorie keine Zeile in
 * `log_regeln` hat. Neue Kategorien späterer Stufen brauchen so keine
 * Nachtrag-Migration.
 *
 * `recht` ist das Recht, das zum Lesen nötig ist (Idee §5.4). Ohne Angabe
 * genügt `LOGGING.VIEW`.
 *
 * @module logging/shared/katalog
 */

const KATEGORIEN = {
    mitglieder: {
        nummer: '3.3', icon: 'fa-solid fa-users', vorgabe: true,
        arten: ['mitglied.beigetreten', 'mitglied.verlassen', 'mitglied.spitzname', 'mitglied.avatar',
            'mitglied.rollen', 'mitglied.timeout', 'mitglied.timeout_ende', 'mitglied.boost',
            'mitglied.gebannt', 'mitglied.entbannt'],
    },
    server: {
        nummer: '3.4', icon: 'fa-solid fa-server', vorgabe: true,
        arten: ['kanal.angelegt', 'kanal.geloescht', 'kanal.geaendert', 'kanal.rechte',
            'rolle.angelegt', 'rolle.geloescht', 'rolle.geaendert', 'rolle.rechte',
            'server.geaendert', 'webhooks.geaendert'],
    },
    einladungen: {
        nummer: '3.6', icon: 'fa-solid fa-envelope-open-text', vorgabe: true,
        arten: ['einladung.angelegt', 'einladung.geloescht'],
    },
    bots: {
        nummer: '3.7', icon: 'fa-solid fa-robot', vorgabe: true,
        arten: ['bot.beigetreten', 'bot.verlassen', 'bot.rollen', 'bot.spitzname'],
    },
};

/** Schweren aus der Ereignisliste des Kerns (G-01), gleiche Bedeutung. */
const SCHWEREN = ['info', 'warnung', 'kritisch'];

/** Art → Kategorie, einmal ausgerechnet. */
const KATEGORIE_VON = Object.fromEntries(
    Object.entries(KATEGORIEN).flatMap(([k, v]) => v.arten.map((a) => [a, k])));

/**
 * Rechte, die eine Rolle oder eine Überschreibung gefährlich machen. Wer eins
 * davon an @everyone gibt oder Administrator an irgendwen, erzeugt ein
 * kritisches Ereignis (Idee §6 „Rechte-Anomalien“; die Erkennung als Alarm
 * kommt mit Stufe 3, die Schwere schon jetzt).
 */
const GEFAEHRLICHE_RECHTE = ['Administrator', 'ManageGuild', 'ManageRoles', 'ManageChannels', 'ManageWebhooks',
    'BanMembers', 'KickMembers', 'ModerateMembers', 'MentionEveryone', 'ManageMessages'];

function kategorieVon(art) {
    return KATEGORIE_VON[art] || null;
}

module.exports = { KATEGORIEN, SCHWEREN, GEFAEHRLICHE_RECHTE, kategorieVon };
