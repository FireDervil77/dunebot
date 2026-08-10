'use strict';

const { GRUND } = require('./anwenden');

/**
 * Aus einem Ergebnis einen Satz machen, den ein Mitglied versteht.
 *
 * **Das ist der Teil, an dem Rollenmenüs sonst scheitern.** Wer auf einen Knopf
 * drückt und nichts passiert, hält den Bot für kaputt — auch wenn alles
 * richtig läuft und nur die Rollenhierarchie im Weg steht. Ein Menü, das
 * schweigt, erzeugt Supportanfragen; eines, das den Grund nennt, erzeugt
 * höchstens eine Nachfrage an die Serverleitung.
 *
 * Der Text spricht **das Mitglied** an, nicht die Serverleitung: „Ich darf
 * diese Rolle nicht vergeben" statt „ROLE_HIERARCHY_ERROR". Was zu tun ist,
 * steht als Nebensatz dabei, denn ändern kann es nur jemand anderes.
 *
 * @module discord/bot/rollenmenue/rueckmeldung
 */

/** Warum eine Rolle nicht gesetzt werden konnte — für das Mitglied formuliert. */
const GRUND_TEXT = {
    [GRUND.KEIN_RECHT]: 'mir fehlt das Recht, Rollen zu verwalten',
    [GRUND.ZU_HOCH]: 'die Rolle steht über meiner eigenen — die Serverleitung muss meine Rolle höher schieben',
    [GRUND.VERWALTET]: 'diese Rolle verwaltet Discord selbst und lässt sich nicht vergeben',
    [GRUND.WEG]: 'diese Rolle gibt es nicht mehr'
};

/** Wenn nichts geschehen ist, aber aus einem guten Grund. */
const HINWEIS_TEXT = {
    HAT_SCHON: 'Die Rolle hast du bereits.',
    HAT_NICHT: 'Die Rolle hattest du gar nicht.',
    EINMALIG_BLEIBT: 'Diese Rolle bleibt — sie lässt sich nicht wieder abgeben.'
};

/**
 * Rollen als Erwähnung auflisten.
 *
 * `<@&id>` statt des Namens: Discord färbt die Erwähnung ein und macht sie
 * damit auf einen Blick erkennbar. Eine Rollenerwähnung löst keine
 * Benachrichtigung aus, solange sie nicht in `allowed_mentions` steht.
 *
 * @param {string[]} rollen
 * @returns {string}
 */
function alsListe(rollen) {
    return rollen.map(r => `<@&${r}>`).join(', ');
}

/**
 * @param {{vergeben: string[], entzogen: string[], blockiert: Array}} ergebnis
 * @param {string|null} [hinweis] Schlüssel aus `HINWEIS_TEXT`
 * @returns {string}
 */
function baueText(ergebnis, hinweis = null) {
    const teile = [];

    if (ergebnis.vergeben.length > 0) {
        teile.push(`✅ Bekommen: ${alsListe(ergebnis.vergeben)}`);
    }
    if (ergebnis.entzogen.length > 0) {
        teile.push(`➖ Abgegeben: ${alsListe(ergebnis.entzogen)}`);
    }

    // Blockiertes nach Grund bündeln — bei einem Menü mit zehn zu hohen Rollen
    // wäre eine Zeile je Rolle unlesbar, und der Grund ist immer derselbe.
    if (ergebnis.blockiert.length > 0) {
        const jeGrund = new Map();
        for (const { rolle, grund } of ergebnis.blockiert) {
            if (!jeGrund.has(grund)) jeGrund.set(grund, []);
            jeGrund.get(grund).push(rolle);
        }

        for (const [grund, rollen] of jeGrund) {
            const erklaerung = GRUND_TEXT[grund] || 'das hat nicht geklappt';
            teile.push(`⚠️ ${alsListe(rollen)}: ${erklaerung}.`);
        }
    }

    if (teile.length === 0) {
        return HINWEIS_TEXT[hinweis] || 'Es hat sich nichts geändert.';
    }

    return teile.join('\n');
}

module.exports = { baueText, GRUND_TEXT, HINWEIS_TEXT };
