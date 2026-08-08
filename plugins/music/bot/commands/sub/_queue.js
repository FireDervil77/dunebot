const { FARBE, antwort, pruefen, titelZeile, dauerText, spielzeitText } = require('../../utils');

/** So viele Titel passen auf eine Seite. */
const PRO_SEITE = 10;

/**
 * @param {Object} mitglied Discord-GuildMember
 * @param {number} seite Gewuenschte Seite
 */
module.exports = async (mitglied, seite = 1) => {
    const p = await pruefen(mitglied, { brauchtSprachkanal: false });
    if (!p.ok) return antwort(p.fehler, 'warnung');

    const zustand = p.manager.zustand(mitglied.guild.id);

    if (!zustand.aktuell && zustand.warteschlange.length === 0) {
        return antwort('Die Warteschlange ist leer.', 'warnung');
    }

    const seiten = Math.max(1, Math.ceil(zustand.warteschlange.length / PRO_SEITE));
    const aktuelleSeite = Math.min(Math.max(1, seite), seiten);
    const von = (aktuelleSeite - 1) * PRO_SEITE;
    const ausschnitt = zustand.warteschlange.slice(von, von + PRO_SEITE);

    const felder = [];

    if (zustand.aktuell) {
        felder.push({
            name: zustand.pausiert ? 'Angehalten' : 'Laeuft gerade',
            value: `${titelZeile(zustand.aktuell)}\n\`${dauerText(zustand.aktuell.positionSek)} / ${dauerText(zustand.aktuell.durationSec)}\``
        });
    }

    if (ausschnitt.length > 0) {
        felder.push({
            name: `Als Naechstes (Seite ${aktuelleSeite} von ${seiten})`,
            value: ausschnitt.map((t, i) => titelZeile(t, von + i + 1)).join('\n').substring(0, 1024)
        });
    }

    const fuss = [
        `${zustand.warteschlange.length} in der Warteschlange`,
        `Restspielzeit ${spielzeitText(zustand.restspielzeitSek)}`,
        `Lautstaerke ${zustand.lautstaerke}%`,
        zustand.wiederholung !== 'aus' ? `Wiederholung: ${zustand.wiederholung}` : null,
        zustand.filter !== 'aus' ? `Filter: ${zustand.filter}` : null
    ].filter(Boolean).join(' · ');

    return { embeds: [{ color: FARBE, title: 'Warteschlange', fields: felder, footer: { text: fuss } }] };
};
