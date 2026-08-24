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
    vergleichen([], ['A']), { geben: ['A'], nehmen: [] });
pruefe('einer hat sie, keiner soll -> nehmen',
    vergleichen(['A'], []), { geben: [], nehmen: ['A'] });
pruefe('deckt sich -> nichts',
    vergleichen(['A', 'B'], ['B', 'A']), { geben: [], nehmen: [] });
pruefe('beides leer -> nichts',
    vergleichen([], []), { geben: [], nehmen: [] });

console.log('\nDer Fall nach einem Neustart');
// Zwei waren live, das "Nehmen" fiel aus, einer ist noch live.
pruefe('zwei tragen sie, einer sendet noch',
    vergleichen(['A', 'B'], ['A']), { geben: [], nehmen: ['B'] });
pruefe('einer tragt sie, ein anderer sendet',
    vergleichen(['A'], ['B']), { geben: ['B'], nehmen: ['A'] });

console.log('\nFallen');
// Discord liefert Zeichenketten. Kaeme eine Zahl aus der Datenbank, wuerde ein
// naiver Vergleich JEDEN als fehlend sehen - die Rolle ginge im Kreis.
pruefe('Zahl und Zeichenkette gelten als gleich',
    vergleichen(['123'], [123]), { geben: [], nehmen: [] });
pruefe('umgekehrt genauso',
    vergleichen([123], ['123']), { geben: [], nehmen: [] });
pruefe('null statt Liste stuerzt nicht ab',
    vergleichen(null, null), { geben: [], nehmen: [] });
pruefe('doppelte Eintraege bleiben ohne Wirkung',
    vergleichen(['A', 'A'], ['A']), { geben: [], nehmen: [] });
pruefe('doppelt auf der Soll-Seite auch',
    vergleichen([], ['A', 'A']), { geben: ['A'], nehmen: [] });

console.log('\nMenge');
const viele = Array.from({ length: 50 }, (_, i) => `M${i}`);
pruefe('50 sollen, keiner hat -> 50 geben',
    vergleichen([], viele).geben.length, 50);
pruefe('50 haben, keiner soll -> 50 nehmen',
    vergleichen(viele, []).nehmen.length, 50);
pruefe('50 gegen dieselben 50 -> nichts',
    vergleichen(viele, [...viele].reverse()), { geben: [], nehmen: [] });

console.log(abweichungen === 0
    ? `\nErgebnis: ${faelle} Faelle, 0 Abweichungen.\n`
    : `\nErgebnis: ${faelle} Faelle, ${abweichungen} Abweichung(en).\n`);
process.exit(abweichungen === 0 ? 0 : 1);
