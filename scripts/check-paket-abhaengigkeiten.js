#!/usr/bin/env node
'use strict';

/**
 * Bringt das angeheftete Image mit, was das Paket verlangt?
 *
 * ## Warum es dieses Skript gibt
 *
 * Ein Paket erklaert seine Systempakete seit jeher ordentlich:
 *
 *     "requirements": { "os_packages": ["libpulse-dev", "libatomic1", "libc6"] }
 *
 * **Und niemand las das Feld.** Nachgesehen am 2026-09-06 im ganzen Dashboard
 * und im Daemon: kein einziger Aufrufer. Was der Daemon unter `Requirements`
 * fuehrt, ist etwas anderes (`min_ram_gb`, `arch`, `glibc`, fuer Addons). Die
 * Erklaerung war also ein Wunsch, kein Auftrag - und beim ersten Valheim-Server
 * fehlte prompt `libpulse` im Image.
 *
 * Es gibt zwei Wege, so etwas zu heilen. Der eine waere, die Pakete im
 * laufenden Container nachzuinstallieren; das braucht root, Netz und Zeit bei
 * JEDEM Start - und der Container laeuft bewusst als 1000. Der andere ist
 * dieser: **Das Image bringt sie mit, und hier wird nachgezaehlt.** Eine
 * erklaerte Abhaengigkeit kann damit nicht mehr bloss dastehen.
 *
 * ## Warum am angehefteten Digest gemessen wird und nicht am Tag
 *
 * Der Tag wandert, der Digest nicht - und `StartPayload.imageAusPaket()` gibt
 * dem Daemon genau den Digest. Ein Skript, das den Tag prueft, misst also unter
 * Umstaenden ein anderes Image als das, in dem der Server startet.
 *
 * ## Nicht erreichbar ist NICHT in Ordnung
 *
 * Fehlt das Image lokal, endet dieses Skript mit 2 und dem Wort „ausgefallen".
 * Ein stiller Rueckfall auf „keine Abweichung" waere die schlimmste Auskunft:
 * gruen, ohne gemessen zu haben.
 *
 *     node scripts/check-paket-abhaengigkeiten.js
 *     node scripts/check-paket-abhaengigkeiten.js packages/fbpkg/beispiele/valheim.json
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const WURZEL = path.resolve(__dirname, '..');
const ORDNER = path.join(WURZEL, 'packages/fbpkg/beispiele');

let faelle = 0, abweichungen = 0;
function pruefe(gut, text, zusatz = '') {
    faelle++;
    if (!gut) abweichungen++;
    console.log(`  ${gut ? '✓' : '✗'} ${text}${zusatz ? '  — ' + zusatz : ''}`);
}

/**
 * Die Adresse, unter der der Daemon das Image wirklich zieht.
 *
 * Dieselbe Reihenfolge wie `StartPayload.imageAusPaket()` - Digest vor Tag.
 * Zwei Fassungen derselben Regel waeren zwei Wahrheiten; hier steht sie ein
 * zweites Mal, weil dieses Skript ohne Datenbank laufen koennen soll. Der
 * Vergleich unten prueft deshalb, dass beide dasselbe sagen.
 *
 * @param {Object} paket FBPKG
 * @returns {string|null} Bildadresse
 */
function bildAdresse(paket) {
    const img = paket?.image;
    if (!img?.ref) return null;
    if (img.digest) return `${img.ref}@${img.digest}`;
    if (img.tag) return `${img.ref}:${img.tag}`;
    return img.ref;
}

/**
 * Welche Debian-Pakete sind im Image installiert?
 *
 * `dpkg-query` statt `ldconfig`: Das Paket erklaert PAKETNAMEN, und danach wird
 * gefragt. Eine Bibliothek koennte auch aus einer anderen Quelle im Image
 * liegen - dann stimmt die Erklaerung des Pakets trotzdem nicht mehr, und
 * genau das soll auffallen.
 *
 * @param {string} adresse Bildadresse
 * @param {Array<string>} namen Gesuchte Paketnamen
 * @returns {{da: Array<string>, fehlt: Array<string>}} Ergebnis
 */
function imBild(adresse, namen) {
    const roh = execFileSync('docker', [
        'run', '--rm', '--entrypoint', '/bin/sh', adresse, '-c',
        `dpkg-query -W -f='\${Package} \${Status}\\n' ${namen.map(n => `'${n}'`).join(' ')} 2>/dev/null || true`
    ], { encoding: 'utf8', timeout: 60000 });

    const da = new Set();
    for (const zeile of roh.split('\n')) {
        // "libatomic1 install ok installed" — nur das zaehlt.
        const teile = zeile.trim().split(/\s+/);
        if (teile.length >= 4 && teile[teile.length - 1] === 'installed') da.add(teile[0]);
    }
    return {
        da: namen.filter(n => da.has(n)),
        fehlt: namen.filter(n => !da.has(n))
    };
}

/**
 * Liegt das Image auf dieser Maschine?
 *
 * @param {string} adresse Bildadresse
 * @returns {boolean} true, wenn vorhanden
 */
function bildDa(adresse) {
    try {
        execFileSync('docker', ['image', 'inspect', adresse],
            { stdio: 'ignore', timeout: 30000 });
        return true;
    } catch { return false; }
}

const dateien = process.argv.slice(2).filter(a => !a.startsWith('--'));
const pfade = dateien.length ? dateien.map(d => path.resolve(d))
    : fs.readdirSync(ORDNER).filter(n => n.endsWith('.json')).map(n => path.join(ORDNER, n));

let ausgefallen = false;
let ohneErklaerung = 0;

for (const pfad of pfade) {
    const paket = JSON.parse(fs.readFileSync(pfad, 'utf8'));
    const slug = paket.slug || paket.identity?.slug || path.basename(pfad, '.json');
    const gefordert = paket.requirements?.os_packages || [];

    console.log(`\n${slug}`);

    const adresse = bildAdresse(paket);
    if (!adresse) {
        pruefe(false, 'das Paket nennt ein Image', 'ohne image.ref laeuft der Server im alten Image');
        continue;
    }

    if (!bildDa(adresse)) {
        console.log(`  ! ausgefallen: ${adresse} liegt nicht auf dieser Maschine`);
        console.log('    (docker pull ausfuehren oder auf der Maschine laufen lassen, die es hat)');
        ausgefallen = true;
        continue;
    }

    // **Zeigen Digest und Tag auf dasselbe Image?**
    //
    // Ein Paket nennt beides. Der Daemon nimmt den Digest; der Tag ist nur ein
    // Zeiger und kann wandern - `bauen.sh` benutzt Kalenderfassungen
    // (`2026.09`), und die wird innerhalb eines Monats mehr als einmal gebaut.
    // Danach zeigt der Tag auf das neue Image und der Digest im Paket auf das
    // alte. Beide sind fuer sich gueltig, der Server startet, und die
    // Verbesserung, wegen der gebaut wurde, ist nicht drin.
    //
    // Das faellt sonst nirgends auf: Das alte Image liegt ja noch da.
    if (paket.image.digest && paket.image.tag) {
        const perTag = `${paket.image.ref}:${paket.image.tag}`;
        let gleich = null;
        try {
            const roh = execFileSync('docker', ['image', 'inspect', perTag,
                '--format', '{{range .RepoDigests}}{{.}} {{end}}'],
                { encoding: 'utf8', timeout: 30000 });
            gleich = roh.includes(paket.image.digest);
        } catch { /* Tag lokal unbekannt - dazu sagt diese Pruefung nichts */ }

        if (gleich !== null) {
            pruefe(gleich,
                `Digest und Tag \`${paket.image.tag}\` zeigen auf dasselbe Image`,
                gleich ? '' : 'der Tag ist weitergewandert — das Paket haengt am alten Stand '
                            + 'und muss neu angeheftet werden');
        }
    }

    if (!gefordert.length) {
        // **Kein stilles Ueberspringen.** Ein Paket ohne Erklaerung ist nicht
        // geprueft, und das gehoert gezaehlt statt verschwiegen.
        //
        // Die Frische oben gilt trotzdem — sie haengt nicht an den
        // Abhaengigkeiten. Genau daran ist diese Pruefung beim ersten Anlauf
        // vorbeigelaufen: Sie stand HINTER dieser Schranke, und
        // `astro-colony-proton` (das keine os_packages nennt) zeigte
        // unbemerkt auf ein Image, dessen Tag laengst weitergewandert war.
        ohneErklaerung++;
        console.log('  · nennt keine os_packages — dazu ist nichts zu pruefen '
                  + 'und nichts zugesichert');
        continue;
    }

    const { da, fehlt } = imBild(adresse, gefordert);
    pruefe(fehlt.length === 0,
        `das Image bringt alle ${gefordert.length} geforderten Pakete mit`,
        fehlt.length ? `fehlt: ${fehlt.join(', ')} (vorhanden: ${da.join(', ') || 'keins'})` : da.join(', '));

    // **Ein `-dev`-Paket in einem Laufzeit-Image ist fast immer ein Versehen.**
    // Die Anleitungen im Netz sind fuer Entwicklungsmaschinen geschrieben; im
    // Container laeuft nur das fertige Spiel. Gebraucht wird die Bibliothek,
    // nicht ihre Kopfdateien.
    const entwickler = gefordert.filter(n => /-dev$/.test(n));
    pruefe(entwickler.length === 0,
        'keine -dev-Pakete gefordert',
        entwickler.length ? `${entwickler.join(', ')} — im Laufzeit-Image genuegt die Bibliothek` : '');
}

if (ohneErklaerung) {
    console.log(`\nHinweis: ${ohneErklaerung} Paket(e) nennen keine os_packages.`);
}

if (ausgefallen) {
    console.log('\nErgebnis: AUSGEFALLEN — mindestens ein Image war nicht messbar.\n');
    process.exit(2);
}
console.log(abweichungen === 0
    ? `\nErgebnis: ${faelle} Pruefungen, 0 Abweichungen.\n`
    : `\nErgebnis: ${faelle} Pruefungen, ${abweichungen} Abweichung(en).\n`);
process.exit(abweichungen === 0 ? 0 : 1);
