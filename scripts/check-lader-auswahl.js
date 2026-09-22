#!/usr/bin/env node
'use strict';

/**
 * Wächter: der Lader entscheidet über Start UND Inhalt (Minecraft, Stufe 3).
 *
 * ── Woher er kommt ───────────────────────────────────────────────────────────
 *
 * Betreiber am 2026-09-22: „dennoch fehlt der mod bereich beim anlegen des
 * minecraft servers … habe ich vergessen ein anderer modloader rein". Richtig —
 * das Paket sagte `content: { supported: false }`, weil Minecraft anders gebaut
 * ist als Valheim: **Der Lader ist kein Mod, den man nachlegt, sondern ein
 * anderes Server-Jar.** Und er entscheidet dreierlei gleichzeitig:
 *
 *   was installiert wird   Mojang / Paper / Fabric / NeoForge
 *   wie gestartet wird     `-jar server.jar` — bei NeoForge `@neoforge_args.txt`
 *   was an Inhalt geht     plugins/ mit Raum `paper`, mods/ mit `fabric`…
 *
 * ── Was dieser Wächter hält ──────────────────────────────────────────────────
 *
 * Nicht „gibt es die Felder", sondern die drei Stellen, an denen die Auswahl
 * auseinanderlaufen kann:
 *
 *  1. **Eine Auswahl, eine Liste.** Jeder Wert der Einstellung braucht einen
 *     Zweig im Installationsskript und eine Variante im Inhaltsvertrag — sonst
 *     bekommt ein Lader stillschweigend keinen Ablageort oder bricht erst bei
 *     der Installation ab.
 *  2. **Die Startzeile deckt jeden Wert genau einmal ab.** Zwei Argumente, die
 *     beide gelten, gäben `-jar server.jar @neoforge_args.txt`; keines, das
 *     gilt, gäbe ein `java` ohne Programm.
 *  3. **Der Inhalt wird EINMAL aufgelöst.** Zwölf Leser sehen `content`; wer
 *     dort `variants` sieht, sieht einen Vertrag ohne Ablageort — und das sieht
 *     aus wie „keine Mods".
 *
 * Aufruf:  node scripts/check-lader-auswahl.js
 * Rückgabe: 0 = die Auswahl trägt durch Installation, Start und Inhalt.
 */

const fs = require('fs');
const path = require('path');
const { ohneKommentare } = require('./lib/quelltext');

const WURZEL = path.join(__dirname, '..');
const DAEMON = '/home/firedervil/firebot_daemon';

let geprueft = 0, fehler = 0;
const pruefe = (ok, was, zusatz = '') => {
    geprueft++;
    if (!ok) fehler++;
    console.log(`  ${ok ? '✅' : '❌'} ${was}${!ok && zusatz ? '\n       ' + zusatz : ''}`);
};
const roh = (datei) => fs.existsSync(datei) ? fs.readFileSync(datei, 'utf8') : null;

console.log('\n▸ Der Lader trägt durch Installation, Start und Inhalt\n');

// ════════════════════════════════════════════════════════════════════════════
console.log('Das Paket — eine Auswahl, drei Folgen');
// ════════════════════════════════════════════════════════════════════════════
const ordner = path.join(WURZEL, 'packages/fbpkg/beispiele');
const pakete = fs.existsSync(ordner)
    ? fs.readdirSync(ordner).filter(d => d.endsWith('.json'))
        .map(d => ({ name: d, inhalt: JSON.parse(fs.readFileSync(path.join(ordner, d), 'utf8')) }))
    : [];
pruefe(pakete.length > 0, `${pakete.length} Handpaket(e) gelesen`);

const mitVarianten = pakete.filter(p => p.inhalt?.content?.variants);
pruefe(mitVarianten.length > 0, `${mitVarianten.length} Paket(e) mit Lader-Auswahl`,
    'Erwartet war mindestens eines (Minecraft) — sonst prüft dieser Abschnitt nichts.');

for (const { name, inhalt: paket } of mitVarianten) {
    const inhalt = paket.content;
    const schluessel = inhalt.by_setting;
    pruefe(Boolean(schluessel), `${name}: \`content.by_setting\` ist gesetzt`,
        'Varianten ohne die Angabe, WAS sie auswählt, sind unbenutzbar.');
    if (!schluessel) continue;

    const einstellung = (paket.settings || []).find(e => e.key === schluessel);
    pruefe(Boolean(einstellung), `${name}: die Einstellung \`${schluessel}\` gibt es`,
        'Der Inhaltsvertrag zeigt auf eine Einstellung, die es nicht gibt — dann greift nie eine Variante.');
    if (!einstellung) continue;

    const werte = (einstellung.choices || []).map(c => String(c.value));
    pruefe(werte.length > 1, `${name}: sie ist eine Auswahl (${werte.length} Werte)`);

    // 1. Jeder Wert hat eine Variante — auch der, der keine Inhalte nimmt.
    for (const w of werte) {
        pruefe(Object.prototype.hasOwnProperty.call(inhalt.variants, w),
            `${name}: „${w}" hat einen Inhaltsvertrag`,
            'Ohne Eintrag bekommt dieser Lader keine Inhalte — und das sieht in der Oberfläche '
          + 'genauso aus wie „dieses Spiel nimmt keine Mods".');
    }
    // Und keine Variante ohne Wert (ein Tippfehler im Namen bliebe sonst still).
    for (const v of Object.keys(inhalt.variants)) {
        pruefe(werte.includes(v), `${name}: die Variante „${v}" ist ein wählbarer Wert`,
            `Die Einstellung kennt nur: ${werte.join(', ')}. Eine Variante, die niemand wählen kann, `
          + 'ist ein Tippfehler mit stiller Wirkung.');
    }
    // Jede Variante, die Inhalte nimmt, braucht Ablageort UND Raum.
    for (const [v, vertrag] of Object.entries(inhalt.variants)) {
        if (!vertrag.supported) continue;
        pruefe(Boolean(vertrag.path), `${name}/${v}: hat einen Ablageort`,
            'Ohne `path` lädt der Daemon die Datei nirgendwohin.');
        const raeume = Object.keys(vertrag.source_ids || {});
        pruefe(raeume.length > 0, `${name}/${v}: nennt einen Katalograum`,
            'Ohne `source_ids` weiß die Suche nicht, wonach sie bei diesem Anbieter fragen soll.');
    }

    // 2. Der Vorgabewert muss ein Wert der Auswahl sein — sonst bekommt jeder
    //    Bestandsserver (der die Vorgabe geerbt bekommt) einen Lader, den das
    //    Skript nicht kennt.
    pruefe(werte.includes(String(einstellung.default)),
        `${name}: die Vorgabe „${einstellung.default}" ist wählbar`,
        'Bestandsserver ohne eigenen Wert erben die Vorgabe. Eine, die es nicht gibt, bricht die '
      + 'Installation ab — bei jedem alten Server auf einmal.');

    // 3. Das Installationsskript kennt jeden Wert.
    const skript = (paket.install?.steps || []).map(s => s.script || '').join('\n');
    for (const w of werte) {
        pruefe(new RegExp(`^${w}\\)`, 'm').test(skript),
            `${name}: das Skript hat einen Zweig für „${w}"`,
            'Sonst fällt der Lader in den Zweig „unbekannt" und die Installation bricht ab.');
    }
    pruefe(/\*\)/.test(skript) && /Unbekannter Lader/.test(skript),
        `${name}: und einen Ausgang für alles andere`,
        'Ein unbekannter Wert muss abbrechen, nicht stillschweigend Vanilla installieren.');

    // 4. Die Startzeile deckt jeden Wert GENAU EINMAL ab.
    //
    // Gerechnet wird mit derselben Regel, die der Daemon anwendet
    // (`gilt` in internal/pkgspec/argv.go): `=wert` / `!=wert`.
    const args = (paket.start?.args || []).filter(a => a.from === `setting:${schluessel}`);
    pruefe(args.length > 0, `${name}: die Startzeile hängt am Lader`);
    for (const w of werte) {
        const treffer = args.filter(a => {
            if (!a.when) return true;
            if (a.when.startsWith('!=')) return w !== a.when.slice(2);
            if (a.when.startsWith('=')) return w === a.when.slice(1);
            return false;
        });
        pruefe(treffer.length === 1,
            `${name}: „${w}" bekommt genau ein Startargument (${treffer.length})`,
            treffer.length === 0
                ? 'Keines gilt — der Start wäre ein `java` ohne Programm.'
                : `Mehrere gelten: ${treffer.map(t => t.key).join(' + ')} — beide landen in der Zeile.`);
    }
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\nDer Daemon kennt die Bedingung');
// ════════════════════════════════════════════════════════════════════════════
const argv = ohneKommentare(roh(path.join(DAEMON, 'internal/pkgspec/argv.go')) || '');
pruefe(/CutPrefix\(bedingung, "!="\)/.test(argv) && /CutPrefix\(bedingung, "="\)/.test(argv),
    '`gilt` versteht `=wert` und `!=wert`',
    'Ohne diese Formen fällt das Argument weg — eine unbekannte Bedingung gilt als nicht erfüllt, '
  + 'und der Server startet ohne Programm.');
pruefe(argv.indexOf('"!="') < argv.indexOf('CutPrefix(bedingung, "=")'),
    'und prüft `!=` VOR `=`',
    'Sonst liest `=` das `!` als Teil des Wertes, und `!=neoforge` wäre immer falsch.');

// ════════════════════════════════════════════════════════════════════════════
console.log('\nDas Dashboard löst EINMAL auf');
// ════════════════════════════════════════════════════════════════════════════
const loeser = ohneKommentare(roh(path.join(WURZEL,
    'plugins/gameserver/dashboard/helpers/InhaltJeLader.js')) || '');
pruefe(/function loeseInhaltAuf\(/.test(loeser), 'es gibt einen Auflöser');
pruefe(/supported: false/.test(loeser),
    'ein unbekannter Lader bekommt KEINE Inhalte',
    'Auf die erste Variante zurückzufallen legte Mods dorthin, wo das Spiel sie nie sieht.');

// Jede Stelle, die ein Paket aus der Datenbank holt, muss auflösen. Gemessen je
// Datei: Eine Datei, in der EINE Stelle auflöst, sagt nichts über die andere.
for (const [datei, mindestens] of [
    ['plugins/gameserver/dashboard/routes/inhalte.js', 2],
    ['plugins/gameserver/dashboard/index.js', 1],
    ['plugins/gameserver/dashboard/helpers/StartPayload.js', 2],
]) {
    const quelle = ohneKommentare(roh(path.join(WURZEL, datei)) || '');
    const n = (quelle.match(/loeseInhaltAuf\(/g) || []).length;
    pruefe(n >= mindestens, `${datei.split('/').pop()}: löst auf (${n} von ${mindestens})`,
        'Ein Leser, der das rohe Paket nimmt, sieht `variants` statt eines Vertrags — und das sieht '
      + 'aus wie „keine Mods".');
}

console.log(`\n${fehler === 0 ? '✅' : '❌'} ${geprueft - fehler} von ${geprueft} Prüfungen bestanden`);
console.log(fehler === 0 ? '   Der Lader trägt: Installation, Start und Inhalt meinen denselben.\n' : '');
process.exit(fehler === 0 ? 0 : 1);
