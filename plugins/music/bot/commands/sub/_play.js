const { ServiceManager } = require('dunebot-core');
const { aufloesen } = require('../../quellen');
const { antwort, pruefen, titelZeile, spielzeitText, hinweisText } = require('../../utils');
const { MusicSettings } = require('../../../shared/models');

/**
 * Eingabe aufloesen, einreihen und notfalls starten.
 *
 * @param {Object} mitglied Discord-GuildMember
 * @param {string} eingabe Adresse oder Suchbegriff
 * @param {boolean} zuerst Vorne einreihen
 * @param {string} textKanalId Wohin Ansagen gehen
 * @returns {Promise<Object>} Antwort
 */
module.exports = async (mitglied, eingabe, zuerst, textKanalId) => {
    const p = await pruefen(mitglied, { brauchtSprachkanal: true });
    if (!p.ok) return antwort(p.fehler, 'warnung');

    const sprachKanal = mitglied.voice.channel;

    if (!(await p.manager.kanalErlaubt(mitglied.guild.id, sprachKanal.id))) {
        return antwort('In diesem Sprachkanal ist Musik nicht freigegeben.', 'warnung');
    }

    const einstellungen = await MusicSettings.getSettings(mitglied.guild.id);
    const ergebnis = await aufloesen(eingabe, { angefordertVon: mitglied.id, einstellungen });

    if (ergebnis.titel.length === 0) return antwort(hinweisText(ergebnis.hinweis), 'warnung');

    const abspieler = p.manager.holen(mitglied.guild.id);

    try {
        await abspieler.beitreten(sprachKanal, textKanalId);
    } catch (err) {
        // Den Grund nennen, nicht verschlucken. Ein blankes "Ich komme nicht
        // hinein" hat am 2026-08-08 eine Stunde Suche gekostet, weil im
        // Protokoll nichts stand, woran man haette ansetzen koennen.
        ServiceManager.get('Logger').error(
            `[Musik] Beitritt zu ${sprachKanal.id} in Guild ${mitglied.guild.id} fehlgeschlagen: ${err.message}`
        );

        return antwort(
            `Ich komme in den Sprachkanal nicht hinein.\n\`${err.message}\``,
            'fehler'
        );
    }

    const { aufgenommen, abgewiesen } = await abspieler.hinzufuegen(ergebnis.titel, { anfang: zuerst });

    if (aufgenommen === 0) {
        return antwort('Nichts aufgenommen — die Warteschlange ist voll oder die Titel sind zu lang.', 'warnung');
    }

    const liefSchon = Boolean(abspieler.aktuell);
    await abspieler.starten();

    // Bei Spotify gleich sagen, woher der Ton wirklich kommt
    const spotifyHinweis = ergebnis.quelle === 'spotify'
        ? '\n\n*Spotify liefert keinen Ton. Ich suche die Titel auf YouTube.*'
        : '';

    if (aufgenommen === 1) {
        return antwort(
            (liefSchon ? '**In die Warteschlange:**\n' : '**Wird abgespielt:**\n') +
            titelZeile(ergebnis.titel[0]) + spotifyHinweis
        );
    }

    const spielzeit = ergebnis.titel.reduce((s, t) => s + (t.durationSec || 0), 0);
    const abgewiesenText = abgewiesen > 0 ? `\n${abgewiesen} Titel wurden abgewiesen.` : '';

    return antwort(`**${aufgenommen} Titel** aufgenommen (${spielzeitText(spielzeit)}).${abgewiesenText}${spotifyHinweis}`);
};
