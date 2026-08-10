'use strict';

/**
 * Was soll passieren, wenn jemand ein Rollenmenü bedient?
 *
 * Bewusst **ohne Discord**: hier kommen ein Menü, seine Einträge und der
 * heutige Rollenbestand eines Mitglieds herein, heraus kommen zwei Listen von
 * Rollen-IDs. Kein `member.roles.add`, kein Netzwerk, kein Zustand.
 *
 * Der Grund ist nicht Reinheit, sondern Prüfbarkeit: Vier Modi mal drei
 * Darstellungen sind zwölf Fälle, und die Hälfte davon lässt sich gegen
 * Discord nur von Hand durchklicken. Als reine Rechnung sind sie in einem
 * Testlauf abzudecken.
 *
 * ## Die vier Modi
 *
 * | Modus | Gedanke |
 * |---|---|
 * | `normal` | an und aus, wie ein Schalter |
 * | `einmalig` | einmal geholt, bleibt — für Regelzustimmung, Anfängerrollen |
 * | `eindeutig` | genau eine aus dem Menü — Farben, Fraktionen, Zeitzonen |
 * | `umgekehrt` | die Bedienung **nimmt** die Rolle — für Abmeldungen („keine Pings mehr") |
 *
 * @module discord/bot/rollenmenue/entscheidung
 */

/** Was der Bedienvorgang war. */
const AKTION = {
    /** Reaktion gesetzt, Knopf gedrückt, Auswahl getroffen. */
    SETZEN: 'setzen',
    /** Reaktion wieder weggenommen. Gibt es nur bei `darstellung = 'reaktion'`. */
    ZURUECKNEHMEN: 'zuruecknehmen'
};

/**
 * @typedef {Object} Aenderung
 * @property {string[]} hinzufuegen Rollen-IDs, die das Mitglied bekommen soll
 * @property {string[]} entfernen   Rollen-IDs, die ihm genommen werden sollen
 * @property {string|null} hinweis  Schlüssel für eine Rückmeldung, wenn nichts geschieht
 */

/** Nichts zu tun. */
const NICHTS = () => ({ hinzufuegen: [], entfernen: [], hinweis: null });

/**
 * Reaktion oder Knopf: es geht um genau einen Eintrag.
 *
 * @param {Object} menu Menü mit `modus`
 * @param {Object} eintrag Der betroffene Eintrag mit `role_id`
 * @param {string[]} alleRollenDesMenues Rollen-IDs aller Einträge dieses Menüs
 * @param {Set<string>} hatRollen Rollen-IDs, die das Mitglied heute trägt
 * @param {string} aktion Eine der `AKTION`-Konstanten
 * @returns {Aenderung}
 */
function fuerEinenEintrag(menu, eintrag, alleRollenDesMenues, hatRollen, aktion) {
    const rolle = String(eintrag.role_id);
    const hat = hatRollen.has(rolle);
    const zurueck = aktion === AKTION.ZURUECKNEHMEN;

    switch (menu.modus) {
        case 'einmalig':
            // Zurücknehmen ist hier folgenlos — das ist der ganze Zweck.
            if (zurueck) return { ...NICHTS(), hinweis: 'EINMALIG_BLEIBT' };
            return hat
                ? { ...NICHTS(), hinweis: 'HAT_SCHON' }
                : { hinzufuegen: [rolle], entfernen: [], hinweis: null };

        case 'eindeutig': {
            if (zurueck) {
                return hat ? { hinzufuegen: [], entfernen: [rolle], hinweis: null } : NICHTS();
            }
            // Die anderen Rollen des Menüs weichen — aber nur die, die das
            // Mitglied überhaupt hat. Sonst stünden hier Entzüge ins Leere und
            // jeder Klick erzeugte eine Handvoll unnötiger Discord-Aufrufe.
            const weichen = alleRollenDesMenues.filter(r => r !== rolle && hatRollen.has(r));
            if (hat && weichen.length === 0) return { ...NICHTS(), hinweis: 'HAT_SCHON' };
            return { hinzufuegen: hat ? [] : [rolle], entfernen: weichen, hinweis: null };
        }

        case 'umgekehrt':
            // Gespiegelt: Setzen nimmt, Zurücknehmen gibt.
            if (zurueck) {
                return hat ? NICHTS() : { hinzufuegen: [rolle], entfernen: [], hinweis: null };
            }
            return hat
                ? { hinzufuegen: [], entfernen: [rolle], hinweis: null }
                : { ...NICHTS(), hinweis: 'HAT_NICHT' };

        case 'normal':
        default:
            if (zurueck) {
                return hat ? { hinzufuegen: [], entfernen: [rolle], hinweis: null } : NICHTS();
            }
            // Ein Knopf ist ein Schalter: derselbe Druck gibt und nimmt.
            // Eine Reaktion kann nicht zweimal gesetzt werden, dort ist der
            // Fall „hat schon" ohnehin nicht erreichbar.
            return hat
                ? { hinzufuegen: [], entfernen: [rolle], hinweis: null }
                : { hinzufuegen: [rolle], entfernen: [], hinweis: null };
    }
}

/**
 * Auswahlliste: das Ergebnis ist eine ganze Menge auf einmal.
 *
 * Der wichtige Unterschied zum Knopf: Discord meldet **den Endzustand**, nicht
 * die Änderung. Wer zwei Einträge abwählt und einen dazunimmt, schickt eine
 * Liste — was fehlt, ist genauso Aussage wie was drinsteht.
 *
 * @param {Object} menu Menü mit `modus`
 * @param {string[]} gewaehlteRollen Rollen-IDs aus der Auswahl
 * @param {string[]} alleRollenDesMenues Rollen-IDs aller Einträge dieses Menüs
 * @param {Set<string>} hatRollen Rollen-IDs, die das Mitglied heute trägt
 * @returns {Aenderung}
 */
function fuerAuswahl(menu, gewaehlteRollen, alleRollenDesMenues, hatRollen) {
    const gewaehlt = new Set(gewaehlteRollen.map(String));

    switch (menu.modus) {
        case 'einmalig':
            // Nur dazu, nie weg — auch dann nicht, wenn etwas abgewählt wurde.
            return {
                hinzufuegen: [...gewaehlt].filter(r => !hatRollen.has(r)),
                entfernen: [],
                hinweis: null
            };

        case 'umgekehrt':
            // Was ausgewählt wird, wird abbestellt. Nicht-Ausgewähltes bleibt
            // unberührt: „nicht angeklickt" heisst hier nicht „bitte geben".
            return {
                hinzufuegen: [],
                entfernen: [...gewaehlt].filter(r => hatRollen.has(r)),
                hinweis: null
            };

        case 'eindeutig':
        case 'normal':
        default:
            // Der Endzustand gilt. Bei `eindeutig` sorgt schon Discord dafür,
            // dass höchstens eine Rolle ankommt (max_values = 1) — die Rechnung
            // ist dieselbe.
            return {
                hinzufuegen: [...gewaehlt].filter(r => !hatRollen.has(r)),
                entfernen: alleRollenDesMenues.filter(r => !gewaehlt.has(r) && hatRollen.has(r)),
                hinweis: null
            };
    }
}

module.exports = { AKTION, fuerEinenEintrag, fuerAuswahl };
