const { ServiceManager } = require('dunebot-core');
const { antwort, pruefen } = require('../../utils');

/**
 * Die Sprachverbindung neu aufbauen.
 *
 * Fuer den Fall, dass der Bot im Kanal steht und trotzdem nichts kommt. Die
 * Warteschlange bleibt erhalten, der laufende Titel faengt von vorn an - das
 * ist der Preis dafuer, dass die Leitung neu gelegt wird.
 *
 * @param {Object} mitglied Discord-GuildMember
 * @returns {Promise<Object>} Antwort
 */
module.exports = async (mitglied) => {
    const p = await pruefen(mitglied, { brauchtSteuerrecht: true, brauchtAbspieler: true });
    if (!p.ok) return antwort(p.fehler, 'warnung');

    try {
        const laeuft = await p.abspieler.neuVerbinden();

        return antwort(
            laeuft
                ? 'Leitung neu gelegt — der Titel faengt von vorn an.'
                : 'Leitung neu gelegt. In der Warteschlange stand nichts, was ich anspielen koennte.'
        );
    } catch (err) {
        ServiceManager.get('Logger').error(
            `[Musik] Neuaufbau der Verbindung in Guild ${mitglied.guild.id} fehlgeschlagen:`, err
        );
        return antwort(`Der Neuaufbau ist gescheitert.\n\`${err.message}\``, 'fehler');
    }
};
