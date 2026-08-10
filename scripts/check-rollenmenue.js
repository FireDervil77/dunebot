#!/usr/bin/env node
'use strict';

/**
 * Rechnet die Rollenmenü-Entscheidung durch: vier Modi mal drei Darstellungen.
 *
 * Warum als Skript und nicht als Testlauf: Das Projekt hat kein Testgerüst, die
 * bestehende Konvention sind die `check-*.js` hier im Ordner. Wichtiger als die
 * Form ist, dass es überhaupt etwas gibt — die Hälfte dieser Fälle lässt sich
 * gegen Discord nur von Hand durchklicken, und niemand klickt zwölf Fälle nach
 * jeder Änderung durch.
 *
 *   node scripts/check-rollenmenue.js
 */

const { AKTION, fuerEinenEintrag, fuerAuswahl } =
    require('../plugins/discord/bot/rollenmenue/entscheidung');

const A = 'rolleA', B = 'rolleB', C = 'rolleC';
const ALLE = [A, B, C];
const EINTRAG = { role_id: A };

let bestanden = 0;
let gescheitert = 0;

/**
 * @param {string} name
 * @param {{hinzufuegen: string[], entfernen: string[]}} ist
 * @param {string[]} sollHinzu
 * @param {string[]} sollWeg
 */
function pruefe(name, ist, sollHinzu, sollWeg) {
    const h = JSON.stringify([...ist.hinzufuegen].sort());
    const w = JSON.stringify([...ist.entfernen].sort());
    const eh = JSON.stringify([...sollHinzu].sort());
    const ew = JSON.stringify([...sollWeg].sort());

    if (h === eh && w === ew) {
        bestanden++;
        console.log(`  \x1b[32m✔\x1b[0m ${name}`);
    } else {
        gescheitert++;
        console.log(`  \x1b[31m✘\x1b[0m ${name}`);
        console.log(`      erwartet:  +${eh} -${ew}`);
        console.log(`      bekommen:  +${h} -${w}`);
    }
}

const einer = (modus, hat, aktion) =>
    fuerEinenEintrag({ modus }, EINTRAG, ALLE, new Set(hat), aktion);
const auswahl = (modus, gewaehlt, hat) =>
    fuerAuswahl({ modus }, gewaehlt, ALLE, new Set(hat));

console.log('\nRollenmenü — Entscheidungstabelle\n');

console.log('\x1b[1mnormal\x1b[0m — an und aus');
pruefe('setzen ohne Rolle gibt sie',            einer('normal', [], AKTION.SETZEN), [A], []);
pruefe('setzen mit Rolle nimmt sie (Knopf)',    einer('normal', [A], AKTION.SETZEN), [], [A]);
pruefe('zurücknehmen mit Rolle nimmt sie',      einer('normal', [A], AKTION.ZURUECKNEHMEN), [], [A]);
pruefe('zurücknehmen ohne Rolle tut nichts',    einer('normal', [], AKTION.ZURUECKNEHMEN), [], []);

console.log('\n\x1b[1meinmalig\x1b[0m — einmal geholt, bleibt');
pruefe('setzen gibt die Rolle',                 einer('einmalig', [], AKTION.SETZEN), [A], []);
pruefe('nochmal setzen tut nichts',             einer('einmalig', [A], AKTION.SETZEN), [], []);
pruefe('zurücknehmen bleibt folgenlos',         einer('einmalig', [A], AKTION.ZURUECKNEHMEN), [], []);

console.log('\n\x1b[1meindeutig\x1b[0m — genau eine aus dem Menü');
pruefe('die anderen beiden weichen',            einer('eindeutig', [B, C], AKTION.SETZEN), [A], [B, C]);
pruefe('ohne Vorbesitz nur hinzufügen',         einer('eindeutig', [], AKTION.SETZEN), [A], []);
pruefe('bereits die einzige — nichts zu tun',   einer('eindeutig', [A], AKTION.SETZEN), [], []);
pruefe('zurücknehmen nimmt sie',                einer('eindeutig', [A], AKTION.ZURUECKNEHMEN), [], [A]);

console.log('\n\x1b[1mumgekehrt\x1b[0m — die Bedienung nimmt');
pruefe('setzen nimmt die Rolle weg',            einer('umgekehrt', [A], AKTION.SETZEN), [], [A]);
pruefe('setzen ohne Rolle tut nichts',          einer('umgekehrt', [], AKTION.SETZEN), [], []);
pruefe('zurücknehmen gibt sie zurück',          einer('umgekehrt', [], AKTION.ZURUECKNEHMEN), [A], []);
pruefe('zurücknehmen mit Rolle tut nichts',     einer('umgekehrt', [A], AKTION.ZURUECKNEHMEN), [], []);

console.log('\n\x1b[1mAuswahlliste\x1b[0m — der Endzustand gilt');
pruefe('gewählt kommt, abgewähltes geht',       auswahl('normal', [A], [B]), [A], [B]);
pruefe('leere Auswahl räumt alles ab',          auswahl('normal', [], [A, B]), [], [A, B]);
pruefe('einmalig entzieht nie',                 auswahl('einmalig', [A], [B]), [A], []);
pruefe('umgekehrt bestellt Gewähltes ab',       auswahl('umgekehrt', [A, B], [A]), [], [A]);
pruefe('umgekehrt lässt Nichtgewähltes liegen', auswahl('umgekehrt', [A], [A, B]), [], [A]);
pruefe('eindeutig ersetzt den Rest',            auswahl('eindeutig', [C], [A, B]), [C], [A, B]);

console.log('\n\x1b[1mGrenzfälle\x1b[0m');
pruefe('fremde Rollen bleiben unberührt',       auswahl('normal', [A], [A, 'fremd']), [], []);
pruefe('unbekannter Modus verhält sich normal', einer('quatsch', [], AKTION.SETZEN), [A], []);

const gesamt = bestanden + gescheitert;
console.log(
    gescheitert === 0
        ? `\n  \x1b[32m${gesamt} Prüfung(en) bestanden.\x1b[0m\n`
        : `\n  \x1b[31m${gescheitert} von ${gesamt} fehlgeschlagen.\x1b[0m\n`
);

process.exit(gescheitert === 0 ? 0 : 1);
