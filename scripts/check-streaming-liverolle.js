#!/usr/bin/env node
/**
 * Spielt den Rollenabgleich durch - ohne Discord, ohne Datenbank.
 *
 * Die Live-Rolle ist sichtbar: Sie steht in der Mitgliederliste. Ein Fehler
 * hier ist keiner, den man uebersieht — er ist einer, den alle sehen und
 * niemand erklaeren kann.
 *
 * Der teuerste Fall ist der Neustart mitten im Stream: Das „Nehmen" faellt
 * aus, und jemand traegt „ist live", bis es auffaellt. Genau dagegen ist
 * dieser Abgleich gebaut.
 *
 *   node scripts/check-streaming-liverolle.js
 *
 * Exitcode 1 bei jeder Abweichung.
 */
'use strict';

const { vergleichen } = require('../plugins/streaming/dashboard/kern/liverolle');

let faelle = 0;
let abweichungen = 0;

/**
 * @param {string} was Beschreibung
 * @param {*} ist Ergebnis
 * @param {*} soll Erwartung
 * @returns {void}
 */
function pruefe(was, ist, soll) {
    faelle++;
    if (JSON.stringify(ist) === JSON.stringify(soll)) {
        console.log(`  ✓ ${was}`);
    } else {
        abweichungen++;
        console.log(`  ✗ ${was}\n      erwartet: ${JSON.stringify(soll)}\n      bekommen: ${JSON.stringify(ist)}`);
    }
}

console.log('\nDer Regelfall');
pruefe('niemand hat sie, einer soll -> geben',
    vergleichen([], ['A'], []), { geben: ['A'], nehmen: [] });
pruefe('einer hat sie, keiner soll -> nehmen',
    vergleichen(['A'], [], ['A']), { geben: [], nehmen: ['A'] });
pruefe('deckt sich -> nichts',
    vergleichen(['A', 'B'], ['B', 'A'], ['A', 'B']), { geben: [], nehmen: [] });
pruefe('beides leer -> nichts',
    vergleichen([], [], []), { geben: [], nehmen: [] });

console.log('\nDer Fall nach einem Neustart');
// Zwei waren live, das "Nehmen" fiel aus, einer ist noch live.
pruefe('zwei tragen sie, einer sendet noch',
    vergleichen(['A', 'B'], ['A'], ['A', 'B']), { geben: [], nehmen: ['B'] });
pruefe('einer tragt sie, ein anderer sendet',
    vergleichen(['A'], ['B'], ['A']), { geben: ['B'], nehmen: ['A'] });

console.log('\nFallen');
// Discord liefert Zeichenketten. Kaeme eine Zahl aus der Datenbank, wuerde ein
// naiver Vergleich JEDEN als fehlend sehen - die Rolle ginge im Kreis.
pruefe('Zahl und Zeichenkette gelten als gleich',
    vergleichen(['123'], [123], ['123']), { geben: [], nehmen: [] });
pruefe('umgekehrt genauso',
    vergleichen([123], ['123'], [123]), { geben: [], nehmen: [] });
pruefe('null statt Liste stuerzt nicht ab',
    vergleichen(null, null, null), { geben: [], nehmen: [] });
pruefe('doppelte Eintraege bleiben ohne Wirkung',
    vergleichen(['A', 'A'], ['A'], ['A']), { geben: [], nehmen: [] });
pruefe('doppelt auf der Soll-Seite auch',
    vergleichen([], ['A', 'A'], []), { geben: ['A'], nehmen: [] });

console.log('\nMenge');
const viele = Array.from({ length: 50 }, (_, i) => `M${i}`);
pruefe('50 sollen, keiner hat -> 50 geben',
    vergleichen([], viele, []).geben.length, 50);
pruefe('50 haben, keiner soll -> 50 nehmen',
    vergleichen(viele, [], viele).nehmen.length, 50);
pruefe('50 gegen dieselben 50 -> nichts',
    vergleichen(viele, [...viele].reverse(), viele), { geben: [], nehmen: [] });

console.log('\nDer Vorfall vom 2026-08-25: fremde Traeger');
// Die eingetragene Rolle war zugleich das Zugangsrecht zum privaten
// Streaming-Bereich. Vier Mitglieder trugen sie, niemand sendete — und der
// Abgleich nahm sie allen vieren weg. Ein Bot nimmt nur zurueck, was er
// selbst gegeben hat.
pruefe('vier fremde Traeger, keiner sendet, nichts von uns -> NICHTS anfassen',
    vergleichen(['A', 'B', 'C', 'D'], [], []), { geben: [], nehmen: [] });
pruefe('einer davon hat sie von uns -> nur den',
    vergleichen(['A', 'B', 'C', 'D'], [], ['C']), { geben: [], nehmen: ['C'] });
pruefe('fremder Traeger sendet sogar -> trotzdem nichts tun',
    vergleichen(['A'], ['A'], []), { geben: [], nehmen: [] });
pruefe('unser Traeger sendet weiter -> bleibt',
    vergleichen(['A'], ['A'], ['A']), { geben: [], nehmen: [] });
// Gegenprobe zur Gegenprobe: Ein Eintrag im Buch fuer jemanden, der die Rolle
// gar nicht (mehr) traegt, darf nichts ausloesen - kein Auftrag ins Leere.
pruefe('im Buch, aber traegt sie nicht -> nichts',
    vergleichen([], [], ['A']), { geben: [], nehmen: [] });
pruefe('im Buch, traegt sie nicht, sendet -> geben',
    vergleichen([], ['A'], ['A']), { geben: ['A'], nehmen: [] });

// -------------------------------------------------------------------
// Die Auskunft selbst: Wer traegt die Rolle?
// -------------------------------------------------------------------
// `vergleichen` oben rechnet richtig — mit dem, was hereinkommt. Am
// 2026-08-26 um 20:02:38 kam eine **halbe** Liste herein, und niemand konnte
// das sehen: `guild.members.fetch()` lief in seine Vorgabefrist von 120 s
// (discord.js `_fetchMany`, `time = 120e3`), der Fehlschlag wurde von einem
// `.catch(() => {})` verschluckt, und die bis dahin angekommenen Bruchstuecke
// sahen aus wie das Ergebnis.
//
// Fuer `vergleichen` ist das der schlimmste Fall: Wer in der Liste fehlt, gilt
// als "traegt die Rolle nicht" und bekommt sie erneut gegeben.

const roleHolders = require('../plugins/streaming/bot/events/ipc/roleHolders');

/**
 * Ein Client, der sich so verhaelt wie gewuenscht.
 *
 * @param {Object} opt { fetchFehler, traeger, merker }
 * @returns {Object} Attrappe
 */
function attrappe({ fetchFehler = null, traeger = ['A', 'B'], merker = {} } = {}) {
    const rolle = { members: { map: (fn) => traeger.map(id => fn({ id })) } };
    return {
        guilds: {
            cache: {
                get: () => ({
                    roles: { cache: { get: () => rolle } },
                    members: {
                        fetch: async (opt) => {
                            merker.optionen = opt;
                            if (fetchFehler) throw fetchFehler;
                            return null;
                        }
                    }
                })
            }
        }
    };
}

(async () => {
    console.log('\nDie Auskunft "wer traegt die Rolle"');

    const merker = {};
    const gut = await roleHolders({ guildId: '1', roleId: '2' }, attrappe({ merker }));
    pruefe('geht der Abruf durch, kommt die Liste', gut, { success: true, traeger: ['A', 'B'] });

    pruefe('und der Abruf bekommt eine Frist unter 30 s',
        Boolean(merker.optionen?.time) && merker.optionen.time < 30000, true);

    const zeitablauf = Object.assign(new Error('Members didn\'t arrive in time.'),
        { code: 'GuildMembersTimeout' });
    const schlecht = await roleHolders({ guildId: '1', roleId: '2' },
        attrappe({ fetchFehler: zeitablauf }));

    pruefe('laeuft er in die Frist, ist es KEIN Erfolg', schlecht.success, false);
    pruefe('und es kommt gar keine Liste mit',
        Object.prototype.hasOwnProperty.call(schlecht, 'traeger'), false);
    pruefe('der Grund steht in der Antwort',
        /unvollstaendig/.test(String(schlecht.error)), true);

    // Ohne Guild ebenfalls kein Erfolg — sonst saehe "Bot kennt die Guild
    // nicht" aus wie "niemand traegt die Rolle".
    const ohneGuild = await roleHolders({ guildId: '1', roleId: '2' },
        { guilds: { cache: { get: () => null } } });
    pruefe('eine unbekannte Guild ist auch kein Erfolg', ohneGuild.success, false);

    console.log(abweichungen === 0
        ? `\nErgebnis: ${faelle} Faelle, 0 Abweichungen.\n`
        : `\nErgebnis: ${faelle} Faelle, ${abweichungen} Abweichung(en).\n`);
    process.exit(abweichungen === 0 ? 0 : 1);
})();
