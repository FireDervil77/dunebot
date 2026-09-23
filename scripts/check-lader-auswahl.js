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
console.log('\nWas nur per Neuinstallation geht, wird beim ANLEGEN gefragt');
// ════════════════════════════════════════════════════════════════════════════
//
// Der Betreiber am 2026-09-22, mit Bildschirmfoto: Auf Schritt 3 stand kein
// Lader. Grund war `role: owner` — gefragt wurde nur `role: player`, alles
// andere blieb auf der Vorgabe. Damit legte das Panel still fest, was sich
// danach nur noch mit Datenverlust zuruecknehmen laesst.
//
// Geprueft wird am ERGEBNIS und gegen jedes Handpaket: Jede Einstellung mit
// `takes_effect: reinstall` muss in den Feldern des Werteschritts auftauchen.
{
    const { baueWerteSchritt } = require(path.join(WURZEL,
        'plugins/gameserver/dashboard/helpers/Serverseite.js'));
    for (const { name, inhalt: paket } of pakete) {
        const muessen = (paket.settings || []).filter(e => e.takes_effect === 'reinstall');
        if (!muessen.length) continue;
        let felder = [];
        try { felder = baueWerteSchritt(paket, null, false).felder || []; }
        catch (e) { pruefe(false, `${name}: Werteschritt baut`, e.message); continue; }
        const gefragt = new Set(felder.map(f => f.schluessel).filter(Boolean));
        for (const e of muessen) {
            pruefe(gefragt.has(e.key), `${name}: „${e.key}" wird beim Anlegen gefragt`,
                'Sie laesst sich spaeter nur mit einer Neuinstallation aendern — wer sie nicht fragt, '
              + 'legt sie still fest.');
        }
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

// ════════════════════════════════════════════════════════════════════════════
console.log('\nModpacks: was hereinkommt, ist fremder Text');
// ════════════════════════════════════════════════════════════════════════════
//
// Betreiber am 2026-09-22: „es waere schon ein geiles feature fuer minecraft
// oder?" — ja. Gemessen an einem echten Paket („MAX FPS", 15 KB):
//
//   modrinth.index.json
//     dependencies: { minecraft: "26.3", fabric-loader: "0.19.5" }
//     files[]: { path, hashes{sha1}, downloads[], fileSize, env{client,server} }
//   overrides/
//
// Drei Dinge daran sind gefaehrlich, und alle drei stehen hier:
//
//  1. **`path` kommt von Fremden.** `../../../etc/cron.d/x` schriebe ausserhalb
//     des Servers. Das ganze Paket wird abgewiesen, nicht nur die Zeile.
//  2. **`env.server`.** Im gemessenen Paket standen NEUN von zwoelf Dateien auf
//     `unsupported` — reine Client-Mods. Wer alles laedt, baut einen Server,
//     der nicht startet.
//  3. **Der Lader steht im Paket, nicht in der Kategorie.** „MAX FPS" steht bei
//     Modrinth unter `categories:neoforge` und verlangt `fabric-loader`.
{
    // ── Der Modpack-Weg ist am 2026-09-23 in den Daemon gewandert ──────────
    //
    // Bis dahin standen diese Pruefungen am Installationsskript
    // (`MC_MODPACK`, `jq … env.server`, `chmod -R u+rwX`, `sha1sum -c`). Der
    // Betreiber wollte Modpacks auch im Mods-Tab eines laufenden Servers
    // waehlen — und statt denselben Ablauf ein zweites Mal zu bauen, hat das
    // Skript seinen Zweig verloren.
    //
    // Die Pruefungen sind deshalb NICHT gestrichen, sondern umgezogen: Was sie
    // halten, gilt unveraendert — nur am neuen Ort. Zwei von ihnen entfallen
    // dabei nicht, sondern werden zu ihrem Gegenteil:
    //
    //   `chmod -R u+rwX`   Der Daemon packt nichts auf die Platte aus, sondern
    //                      liest aus dem Archiv und schreibt mit eigenen
    //                      Rechten. Der Modus-000-Fall kann gar nicht mehr
    //                      auftreten — geprueft wird jetzt, dass es so bleibt.
    //   Reihenfolge        Das Skript pruefte den Pfad beim Schreiben, also
    //                      nach 154 geladenen Dateien. Der Daemon prueft ALLE
    //                      Pfade, bevor die erste Datei geladen wird.
    const paket = pakete.find(x => x.name === 'minecraft.json');
    const skript = paket ? (paket.inhalt.install?.steps || []).map(s2 => s2.script || '').join('\n') : '';

    // Zuerst die Gegenprobe zum Umzug: Es darf NICHT beides geben.
    const imSkript = skript.split('\n').filter(z => !z.trim().startsWith('#')).join('\n');
    pruefe(!/MC_MODPACK/.test(imSkript),
        'das Installationsskript installiert KEIN Modpack mehr',
        'Sonst gaebe es den Ablauf zweimal — einmal in Shell, einmal in Go. Beim naechsten Fund '
      + 'wuerde einer berichtigt und der andere nicht.');

    const DAEMON = '/home/firedervil/firebot_daemon';
    const MODPACK_GO = 'internal/gameserver/modpack.go';
    const goPfad = path.join(DAEMON, MODPACK_GO);

    if (!fs.existsSync(goPfad)) {
        // Dieselbe Haltung wie in check-herkunftsliste.js: Eine Pruefung, die
        // nicht laufen kann, ist eine Luecke und kein bestandener Test.
        console.log(`  · Daemon-Quelltext nicht gefunden (${goPfad}) — die Pruefung entfaellt.`);
        console.log('    Das ist kein gruenes Ergebnis, sondern eine Luecke.');
        fehler++;
        geprueft++;
    } else {
        // Go-Kommentare heraus, ueber dieselbe Funktion wie beim JavaScript:
        // Go schreibt `//` und `/* */` genauso. Der Kopf von modpack.go
        // beschreibt den Modus-000-Fall und `env.server` ausfuehrlich in Prosa —
        // ein grep ueber den rohen Text faende jede Pruefung in der
        // Beschreibung wieder und meldete gruen, auch wenn der Code fehlte.
        const goCode = ohneKommentare(roh(goPfad) || '');

        pruefe(/func \(m \*Manager\) InstalliereModpack\(/.test(goCode),
            'der Daemon hat einen Weg, ein Modpack zu installieren',
            `${MODPACK_GO}: InstalliereModpack fehlt`);

        pruefe(/d\.Env\.Server != "unsupported"/.test(goCode),
            'es laedt NUR, was auf einem Server laeuft',
            'Bei „create_plus" stehen 49 von 155 Dateien auf `server: "unsupported"` — reine '
          + 'Client-Mods. Alle zu laden gibt einen Server, der nicht startet, und die Ursache steht '
          + 'in einem Absturzprotokoll statt im Panel.');
        pruefe(/d\.Env == nil \|\|/.test(goCode),
            'und eine Datei OHNE env-Angabe gilt als noetig',
            'Das Feld ist im Format optional. Wer „unbekannt" als „weglassen" liest, installiert bei '
          + 'einem aelteren Paket NULL Dateien — eine Installation, die gelingt und nichts tut.');
        const clientGo = ohneKommentare(roh(path.join(DAEMON, 'internal/websocket/client.go')) || '');
        pruefe(/Ausgelassen\s+int/.test(goCode) && /"ausgelassen":/.test(clientGo),
            'und sagt, wie viele es weglaesst',
            'Still weglassen heisst: Jemand wundert sich, warum sein Paket fast nichts tut.');

        pruefe(/func pruefeModpackPfad\(/.test(goCode)
            && /teil == "\.\."/.test(goCode)
            && /strings\.HasPrefix\(p, "\/"\)/.test(goCode),
            'ein Pfad mit `..` oder fuehrendem `/` bricht ab',
            'Der Pfad steht im Archiv eines Dritten. Ohne diese Pruefung schreibt ein Modpack '
          + 'dorthin, wohin es will.');
        pruefe(/ausserhalb des servers/i.test(goCode),
            'und der Satz dazu nennt den Grund');
        pruefe(/ReplaceAll\(p, "\\\\", "\/"\)/.test(goCode),
            'auch ein Windows-Pfad (`..\\..\\x`) wird erkannt',
            'Ein Vergleich, der nur "/" kennt, sieht den Ausbruch aus einem Archiv aus '
          + 'Windows-Hand nicht.');

        // ── Die Pfadpruefung laeuft VOR dem ersten Abruf ────────────────────
        //
        // Das ist der Gewinn des Umzugs, und er ist messbar: Im Quelltext muss
        // die Pruefschleife vor der Ladeschleife stehen. Sonst haette ein
        // Paket, dessen letzte von 155 Dateien ausbricht, 154 Dateien
        // geschrieben — ein halb bespielter Server, den niemand mehr zuordnet.
        const iPruef = goCode.indexOf('pruefeModpackPfad(d.Path)');
        const iLade  = goCode.indexOf('lade(d.Downloads[0], maxInhaltBytes)');
        pruefe(iPruef > -1 && iLade > -1 && iPruef < iLade,
            'und zwar BEVOR die erste Datei geladen wird',
            'Sonst bricht ein Paket mit 155 Dateien nach der 154. ab und laesst den Server halb '
          + 'bespielt zurueck.');

        pruefe(/func pruefeSHA1\(/.test(goCode)
            && /pruefeSHA1\(tmp, sha1Erwartet\)/.test(goCode)
            && /pruefeSHA1\(datei, sha\)/.test(goCode),
            'Archiv UND jede einzelne Datei werden gegen ihre Pruefsumme gehalten',
            'Modrinth liefert sha1 zu beidem — es nicht zu pruefen waere Fahrlaessigkeit mit Ansage.');

        // Der Modus-000-Fall, umgedreht: Er kann nicht mehr auftreten, weil
        // nichts mehr ausgepackt wird. Geprueft wird, dass es so bleibt.
        pruefe(!/os\.Chmod|exec\.Command\("unzip"/.test(goCode),
            'die Rechte aus dem Archiv erreichen die Platte gar nicht erst',
            'Das Skript brauchte `chmod -R u+rwX`, weil `unzip` den Modus 000 aus „Horror +" treu '
          + 'uebertrug. Der Daemon schreibt aus dem Archiv heraus mit eigenen Rechten — faende sich '
          + 'hier ein Auspacken auf die Platte, waere die Falle zurueck.');

        pruefe(/erlaubteHerkunft|pruefeHerkunft/.test(goCode),
            'und jede Adresse des Pakets geht durch die Herkunftsliste',
            'Ein Modpack nennt bis zu 155 fremde Adressen. Ohne die Liste waere es ein Weg, den '
          + 'Daemon beliebige Ziele abrufen zu lassen — auch im internen Netz.');
    }

    // Die Auswahl darf nicht auf einen fremden Lader umbiegen.
    const modrinth = ohneKommentare(roh(path.join(WURZEL,
        'plugins/gameserver/dashboard/helpers/Modrinth.js')) || '');
    pruefe(/const LADER_BEI_UNS = \{ fabric: 'fabric', neoforge: 'neoforge' \}/.test(modrinth),
        'nur Fabric und NeoForge gelten als unsere Lader',
        'Forge und Quilt sind mit NeoForge NICHT vertraeglich. Ein stillschweigender Tausch gaebe '
      + 'einen Server, der startet und die Haelfte der Mods nicht laedt.');

    // Und der Server glaubt dem Browser nicht.
    const routen2 = ohneKommentare(roh(path.join(WURZEL,
        'plugins/gameserver/dashboard/routes/servers.js')) || '');
    const iMp = routen2.indexOf('if (eingaben.modpack)');
    const block = iMp > -1 ? routen2.slice(iMp, iMp + 900) : '';
    pruefe(Boolean(block), 'die Anlegeroute loest das Modpack selbst auf');
    pruefe(/eingaben\.loader = mp\.lader/.test(block),
        'und ueberschreibt den Lader mit dem des Pakets',
        'Was im Formular steht, hat den Weg durch einen fremden Rechner genommen.');
    pruefe(/eingaben\.version = mp\.spielfassung/.test(block),
        'und die Ausgabe ebenso');
}

console.log(`\n${fehler === 0 ? '✅' : '❌'} ${geprueft - fehler} von ${geprueft} Prüfungen bestanden`);
console.log(fehler === 0 ? '   Der Lader trägt: Installation, Start und Inhalt meinen denselben.\n' : '');
process.exit(fehler === 0 ? 0 : 1);
