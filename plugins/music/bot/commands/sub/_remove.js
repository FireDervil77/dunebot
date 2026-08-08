const { antwort, pruefen, titelZeile } = require('../../utils');

/**
 * Etwas aus der Warteschlange nehmen.
 *
 * Drei Wege, weil es drei Fragen sind: eine bestimmte Nummer, alle Doppelten,
 * oder alles von Leuten, die den Kanal verlassen haben. Andere Bots machen
 * daraus drei Befehle (`remove`, `removedupes`, `leavecleanup`) - bei
 * hoechstens 25 Unterbefehlen je Schraegstrich-Befehl ist das Verschwendung,
 * und zusammen gelesen ergeben sie ohnehin einen Satz.
 *
 * @param {Object} mitglied Discord-GuildMember
 * @param {Object} o { nummer, doppelte, abwesende }
 * @returns {Promise<Object>} Antwort
 */
module.exports = async (mitglied, o = {}) => {
    const p = await pruefen(mitglied, { brauchtSteuerrecht: true, brauchtAbspieler: true });
    if (!p.ok) return antwort(p.fehler, 'warnung');

    if (o.doppelte) {
        const weg = p.abspieler.doppelteEntfernen();
        return weg > 0
            ? antwort(`**${weg} doppelte Titel** entfernt.`)
            : antwort('Es stand nichts doppelt in der Warteschlange.', 'warnung');
    }

    if (o.abwesende) {
        const weg = p.abspieler.abwesendeEntfernen();
        return weg > 0
            ? antwort(`**${weg} Titel** entfernt — die Leute dahinter sind nicht mehr im Kanal.`)
            : antwort('Alle Titel stammen von Leuten, die noch da sind.', 'warnung');
    }

    const nummer = o.nummer;
    if (!nummer || nummer < 1) {
        return antwort(
            'Gib die Nummer aus `/music queue` an — oder setze `doppelte` ' +
            'beziehungsweise `abwesende`.',
            'warnung'
        );
    }

    // Angezeigt wird ab 1, gespeichert ab 0
    const entfernt = p.abspieler.entfernen(nummer - 1);
    if (!entfernt) return antwort('An dieser Stelle steht nichts.', 'warnung');

    return antwort(`Entfernt: ${titelZeile(entfernt)}`);
};
