#!/usr/bin/env node
'use strict';

/**
 * Wächter: der Transport verstümmelt nichts — und die Anzeige escapet (B148).
 *
 * ── Woher er kommt ───────────────────────────────────────────────────────────
 *
 * Gemessen am 2026-09-22 beim Nachmessen eines Rollouts, nicht gesucht. In
 * `gameservers.disk_quota_note` stand für Server 186:
 *
 *   Das Dateisystem ist ohne Projekt-Quota eingehaengt. `tune2fs -O
 *   project,quota ` und in /etc/fstab bei / die Option `prjquota` ergaenzen.
 *
 * Im Daemon steht dort `tune2fs -O project,quota <geraet>`. Das `<geraet>` war
 * auf dem Weg verschwunden, und übrig blieb ein Befehl, den der Betreiber
 * abschreiben kann und der dann fehlschlägt. Ursache:
 * `MessageValidator._sanitizeObject` ersetzte in JEDER Zeichenkette der
 * Nutzlast `/<[^>]*>/g` durch nichts, und `IPMEventRouter.route()` gab den
 * Handlern diese Fassung.
 *
 * **Minecraft schreibt Chat als `<Name> Text`.** In der Konsole fiel damit der
 * Absender jeder Chatzeile weg — bei einem Spiel, dessen Paket seit dem
 * 2026-09-20 ausgeliefert ist.
 *
 * ── Was dieser Wächter festhält ──────────────────────────────────────────────
 *
 * Zwei Hälften, und nur zusammen ergeben sie einen Grund:
 *
 *  1. **Der Transport lässt den Text in Ruhe.** Geprüft am VERHALTEN: eine
 *     echte Nachricht geht durch `validate()` und muss zeichengleich
 *     herauskommen. Nicht „steht der `replace` noch da" — das wäre wieder eine
 *     Anwesenheitsprüfung.
 *  2. **Die Anzeigestellen escapen.** Das ist die Bedingung, unter der Hälfte 1
 *     harmlos ist. Wer morgen `el.innerHTML = text` schreibt, macht aus dem
 *     Verzicht auf das Wegschneiden eine Lücke — und genau dann muss hier etwas
 *     rot werden.
 *
 * Aufruf:  node scripts/check-nutzlast-unverstuemmelt.js
 * Rückgabe: 0 = der Text kommt heil an und wird sicher angezeigt.
 */

const fs = require('fs');
const path = require('path');
const { ohneKommentare, ohneKommentareEjs } = require('./lib/quelltext');

const WURZEL = path.join(__dirname, '..');

let geprueft = 0, fehler = 0;
const pruefe = (ok, was, zusatz = '') => {
    geprueft++;
    if (!ok) fehler++;
    console.log(`  ${ok ? '✅' : '❌'} ${was}${!ok && zusatz ? '\n       ' + zusatz : ''}`);
};
const roh = (datei) => fs.existsSync(datei) ? fs.readFileSync(datei, 'utf8') : null;

console.log('\n▸ Der Transport verstümmelt nicht, die Anzeige escapet\n');

// ════════════════════════════════════════════════════════════════════════════
console.log('Transport — gemessen am Verhalten');
// ════════════════════════════════════════════════════════════════════════════
let MessageValidator = null;
try {
    MessageValidator = require(path.join(WURZEL, 'packages/dunebot-sdk')).MessageValidator;
} catch (e) {
    pruefe(false, 'das SDK lässt sich laden', e.message.split('\n')[0]);
}

if (MessageValidator) {
    // Die Nutzlast trägt den Text an drei Stellen, weil `_sanitizeObject` drei
    // Zweige hatte — und einer davon (Zeichenkette IM ARRAY) blieb schon vorher
    // unberührt. Das war der Beweis, dass die „Bereinigung" nicht einmal in sich
    // schlüssig war: Die Konsolen-Vorgeschichte kommt als `lines: [...]`, dort
    // stand `<Fire>` noch, während dieselbe Zeile live gekürzt ankam.
    const CHAT = '[12:03:44] [Server thread/INFO]: <Fire> hallo zusammen';
    const HINWEIS = '`tune2fs -O project,quota <geraet>` und in /etc/fstab ergaenzen.';
    const nachricht = {
        version: '1.0', type: 'event', namespace: 'console', action: 'output',
        id: 'waechter', timestamp: Date.now(),
        payload: { server_id: '190', line: CHAT, lines: [CHAT], tief: { grund: HINWEIS } },
    };
    const ergebnis = MessageValidator.validate(JSON.parse(JSON.stringify(nachricht)));

    pruefe(ergebnis.valid === true, 'eine gewöhnliche Daemon-Nachricht gilt als gültig',
        `sie wurde abgewiesen: ${(ergebnis.errors || []).join(', ')}`);

    if (ergebnis.message) {
        const p = ergebnis.message.payload;
        pruefe(p.line === CHAT,
            'die Chatzeile kommt zeichengleich heraus',
            `Minecraft schreibt Chat als <Name> Text. Angekommen ist: "${p.line}"`);
        pruefe(Array.isArray(p.lines) && p.lines[0] === CHAT,
            'auch in einem Array (die Konsolen-Vorgeschichte)');
        pruefe(p.tief && p.tief.grund === HINWEIS,
            'und in einem verschachtelten Objekt',
            'Der Platzgrund reist tiefer als eine Ebene — genau dort verschwand `<geraet>`.');
    } else {
        pruefe(false, 'die Nachricht kommt überhaupt zurück', 'validate() gab null');
    }
}

// Und die Absicht im Quelltext: kein Wegschneiden mehr, an keiner Stelle.
const validator = ohneKommentare(roh(path.join(WURZEL,
    'packages/dunebot-sdk/lib/ipm/MessageValidator.js')) || '');
pruefe(!/replace\(\/<\[\^>\]\*>\/g/.test(validator),
    'im Validator steht kein Tag-Wegschneiden',
    'Beim Anzeigen escapen, nicht beim Transport verstümmeln: Escapen ist umkehrbar, '
  + 'Wegschneiden nicht — und es trifft jeden Leser, auch die ohne HTML.');
pruefe(!/_sanitizeObject\s*\(/.test(validator),
    'und die Methode ist weg, nicht nur unbenutzt',
    'Eine ungenutzte Bereinigung ist eine Falle: Der Nächste verdrahtet sie wieder.');

// Der Grabstein muss bleiben — sonst baut der Nächste sie „aus Sicherheit" neu.
const validatorRoh = roh(path.join(WURZEL, 'packages/dunebot-sdk/lib/ipm/MessageValidator.js')) || '';
pruefe(/Hier standen `_sanitize` und `_sanitizeObject`/.test(validatorRoh),
    'und der Grund steht an ihrer Stelle',
    'Ohne Begründung ist die Entfernung eine Meinung, und die nächste Meinung dreht sie zurück.');

// ════════════════════════════════════════════════════════════════════════════
console.log('\nAnzeige — hier gehört das Escapen hin');
// ════════════════════════════════════════════════════════════════════════════

// Jede `innerHTML`-Zuweisung muss entweder fester Text sein oder in einem Block
// stehen, der selbst escapet. Geprüft wird JEDE einzelne, in JEDER der beiden
// Dateien: Eine Datei, in der eine Stelle escapet, sagt nichts über die anderen.
//
// ── Zwei Fassungen, die nicht bissen ────────────────────────────────────────
//
// 1. Der Escape wurde in den 220 Zeichen NACH `innerHTML =` gesucht. Dreimal
//    rot, dreimal zu Unrecht: zwei feste Zeichenketten, die in sich ein `"`
//    tragen, und eine Stelle, deren Escape im Helfer drei Zeilen DARÜBER steht.
//    Ein Fenster hinter der Zuweisung ist die falsche Einheit — die richtige ist
//    der `case`, der sie umschließt.
// 2. Für die Konsole stand hier ein eigenes Muster
//    (`innerHTML = [^'"`]*(line|text|zeile)`). Die Gegenprobe
//    `innerHTML = formatted + ' zeile'` blieb GRÜN: Die Zeichenklasse kommt
//    nicht über das Anführungszeichen. Ein zweites, schwächeres Muster für
//    dieselbe Frage ist ein Loch — also dieselbe Prüfung für beide Dateien.
const escapeImBlock = (block) =>
    /replace\(\/\[&<>"\]\/g/.test(block) || /escapeHtml/.test(block);

function pruefeHtmlStellen(quelle, name, mindestens) {
    // Geschnitten wird NACH dem `=`: Steht `innerHTML` noch im Ausschnitt, hält
    // die Prüfung „fester Text" den Feldnamen selbst für einen Wert vom Server.
    const stellen = [...quelle.matchAll(/innerHTML\s*\+?=/g)].map(m => m.index + m[0].length);
    pruefe(stellen.length >= mindestens,
        `${name}: die ${stellen.length} Stelle(n) mit \`innerHTML\` sind auffindbar`,
        `Erwartet waren mindestens ${mindestens}. Weniger heißt: Die Suche greift nicht mehr, `
      + 'und dann prüft dieser Abschnitt nichts.');

    for (const [i, pos] of stellen.entries()) {
        const ausdruck = quelle.slice(pos, quelle.indexOf(';', pos) + 1);
        // Fester Text: Nimmt man alle Zeichenketten heraus, bleibt kein Name übrig.
        const ohneZeichenketten = ausdruck
            .replace(/'(?:[^'\\]|\\.)*'/g, '')
            .replace(/"(?:[^"\\]|\\.)*"/g, '')
            .replace(/`(?:[^`\\]|\\.)*`/g, '');
        const festerText = !/[A-Za-z_$]/.test(ohneZeichenketten);

        // Sonst muss der umschließende Block escapen. Von `case '…'` oder dem
        // Funktionsanfang davor bis zum nächsten `break;`/`}` danach — die
        // Einheit, in der ein Helfer wie `zeile()` lebt.
        const blockAnf = Math.max(quelle.lastIndexOf("case '", pos), quelle.lastIndexOf('function ', pos));
        const blockEnde = quelle.indexOf('break;', pos);
        const block = (blockAnf > -1 && blockEnde > -1) ? quelle.slice(blockAnf, blockEnde) : ausdruck;

        const ok = festerText || escapeImBlock(block);
        pruefe(ok, `${name}, Stelle ${i + 1}: ${festerText ? 'fester Text' : 'escapt im Block'}`,
            'Sie setzt Servertext als HTML ein, ohne zu escapen:\n       '
          + ausdruck.split('\n')[0].trim().slice(0, 120));
    }
}

// 1. Konsole: xterm.js schreibt Text in Zellen, es ist kein HTML-Parser.
const konsole = ohneKommentare(roh(path.join(WURZEL,
    'plugins/gameserver/dashboard/assets/js/console-client.js')) || '');
pruefe(/this\.terminal\.write\(/.test(konsole),
    'die Konsole schreibt in xterm.js (kein HTML-Parser)');
pruefeHtmlStellen(konsole, 'console-client', 0);

// 2. Live-Anzeige: Text kommt fertig vom Server, gezeichnet wird mit textContent.
const live = ohneKommentare(roh(path.join(WURZEL,
    'plugins/gameserver/dashboard/assets/js/gameserver-live.js')) || '');
pruefeHtmlStellen(live, 'gameserver-live', 3);

// 3. Vorlagen: die Felder, die Daemon-Text tragen, stehen in `<%= %>`.
for (const [datei, feld] of [
    ['plugins/gameserver/dashboard/views/guild/gameserver-edit.ejs', 'server.disk_quota_note'],
    ['plugins/masterserver/dashboard/views/guild/masterserver-logs.ejs', 'log.message'],
    ['plugins/gameserver/dashboard/views/guild/server-detail.ejs', 'mw.grund'],
]) {
    const text = ohneKommentareEjs(roh(path.join(WURZEL, datei)) || '');
    const kurz = datei.split('/').pop();
    const mitEscape = new RegExp('<%=[^%]*' + feld.replace(/\./g, '\\.'));
    const ohneEscape = new RegExp('<%-[^%]*' + feld.replace(/\./g, '\\.'));
    pruefe(mitEscape.test(text) && !ohneEscape.test(text),
        `${kurz}: \`${feld}\` steht in <%= %> (escapt)`,
        ohneEscape.test(text)
            ? 'Es steht in `<%- %>` — dort landet Daemon-Text unescapet im HTML.'
            : 'Das Feld wurde nicht gefunden; der Name hat sich verschoben und die Prüfung misst nichts.');
}

console.log(`\n${fehler === 0 ? '✅' : '❌'} ${geprueft - fehler} von ${geprueft} Prüfungen bestanden`);
console.log(fehler === 0
    ? '   Der Text kommt heil an — und wird dort entschärft, wo er angezeigt wird.\n'
    : '');
process.exit(fehler === 0 ? 0 : 1);
