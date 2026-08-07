/**
 * IPC: Wiedergabe vom Dashboard aus steuern.
 *
 * Ein Handler fuer alle Vorgaenge - jeder einzeln waere derselbe Rahmen
 * neunmal.
 */
module.exports = async (payload, client) => {
    const { guildId, vorgang, wert } = payload;

    if (!client.musicManager) return { success: false, error: 'Das Musik-System laeuft nicht' };
    if (!guildId) return { success: false, error: 'guildId fehlt' };

    const abspieler = client.musicManager.vorhanden(guildId);
    if (!abspieler) return { success: false, error: 'Es laeuft gerade nichts' };

    try {
        switch (vorgang) {
            case 'pause':
                return { success: true, geaendert: abspieler.pausieren() };

            case 'fortsetzen':
                return { success: true, geaendert: abspieler.fortsetzen() };

            case 'ueberspringen':
                abspieler.ueberspringen(Math.max(1, parseInt(wert, 10) || 1));
                return { success: true };

            case 'stoppen':
                abspieler.stoppen();
                return { success: true };

            case 'trennen':
                client.musicManager.beenden(guildId);
                return { success: true };

            case 'lautstaerke':
                return { success: true, lautstaerke: abspieler.lautstaerkeSetzen(wert) };

            case 'wiederholung':
                if (!abspieler.wiederholungSetzen(wert)) {
                    return { success: false, error: 'Unbekannter Wiederholmodus' };
                }
                return { success: true };

            case 'filter':
                if (!abspieler.filterSetzen(wert)) {
                    return { success: false, error: 'Unbekannter Filter' };
                }
                return { success: true };

            case 'dauerbetrieb':
                return { success: true, an: abspieler.dauerbetriebSetzen(wert) };

            case 'autoplay':
                return { success: true, an: abspieler.autoplaySetzen(wert) };

            case 'mischen':
                return { success: true, anzahl: abspieler.mischen() };

            case 'entfernen': {
                const entfernt = abspieler.entfernen(parseInt(wert, 10));
                if (!entfernt) return { success: false, error: 'An dieser Stelle steht nichts' };
                return { success: true, titel: entfernt };
            }

            case 'verschieben':
                if (!abspieler.verschieben(parseInt(wert?.von, 10), parseInt(wert?.nach, 10))) {
                    return { success: false, error: 'Verschieben nicht moeglich' };
                }
                return { success: true };

            default:
                return { success: false, error: `Unbekannter Vorgang: ${vorgang}` };
        }
    } catch (error) {
        return { success: false, error: error.message };
    }
};
