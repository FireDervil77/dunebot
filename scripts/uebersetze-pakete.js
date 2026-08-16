#!/usr/bin/env node
/**
 * Übersetzt Spielpakete nach FBPKG_v1 — aus der Datenbank und aus den Egg-Quellen.
 *
 * Zweck ist nicht Bewahrung, sondern zweierlei:
 *
 *   ERNTEN    Die 23 Addons in der Datenbank tragen mühsam erarbeitetes Wissen —
 *             Query-Typen, RCON-Zuordnungen, Portreparaturen. Das soll ins neue
 *             Format, der Rest darf später neu gebaut werden.
 *   PRÜFEN    Die 250 Eggs in den Pelican-Quellen sind der ehrliche Härtetest.
 *             Unsere 23 sind die Überlebenden — was an ihnen läuft, sagt wenig
 *             über den Rest. Was der Übersetzer hier nicht abbilden kann, fehlt
 *             im Schema, und das will man wissen, BEVOR Daemon und Dashboard
 *             darauf gebaut sind.
 *
 * Der Weg ist für beide Quellen derselbe:
 *
 *   rohes Egg ──EggImporter.convert()──▶ FIREBOT_v2 ──hier──▶ FBPKG_v1
 *
 * Nichts wird geraten. Was sich nicht auflösen lässt, landet in `status.open` —
 * ein geratener Wert ist schlimmer als eine gemeldete Lücke.
 *
 *   node scripts/uebersetze-pakete.js            # die 23 aus der Datenbank
 *   node scripts/uebersetze-pakete.js --eggs     # zusätzlich die 250 aus den Quellen
 *   node scripts/uebersetze-pakete.js --eggs --limit 20
 *
 * Rein lesend. Schreibt nur nach docs/spielpakete/bestand/.
 *
 * @author FireDervil
 */

'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../apps/dashboard/.env') });

const fs    = require('fs');
const path  = require('path');
const mysql = require('mysql2/promise');

const { ServiceManager } = require('dunebot-core');
if (!ServiceManager.has('Logger')) {
    const still = () => {};
    ServiceManager.register('Logger', { debug: still, info: still, warn: still, error: still });
}
const EggImporter = require(path.join(__dirname, '../plugins/gameserver/dashboard/helpers/EggImporter'));

const BESTAND   = path.join(__dirname, '../docs/spielpakete/bestand');
const MIT_EGGS  = process.argv.includes('--eggs');
const GRENZE    = (() => {
    const i = process.argv.indexOf('--limit');
    return i > -1 ? parseInt(process.argv[i + 1], 10) || 0 : 0;
})();

// ═════════════════════════════════════════════════════════════════════════════
// Hilfsmittel
// ═════════════════════════════════════════════════════════════════════════════

/** ENV_NAME → env_name, für Schlüssel im neuen Format. */
function schluessel(name) {
    return String(name || '').toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/^_+|_+$/g, '') || 'unbenannt';
}

/** "Server Name" bleibt Anzeigename; das Format will zweisprachige Texte. */
function text(de, en) {
    const t = {};
    if (de) t.de = String(de);
    if (en) t.en = String(en);
    return Object.keys(t).length ? t : undefined;
}

/**
 * Wandelt {{VAR}} in einen prüfbaren Verweis um: {{setting:x}} oder {{port:y}}.
 */
function verweis(name, portZwecke) {
    if (name === 'SERVER_PORT' && portZwecke.has('game')) return '{{port:game}}';
    const alsPort = name.match(/^([A-Z0-9]+)_PORT$/);
    if (alsPort && portZwecke.has(alsPort[1].toLowerCase())) return `{{port:${alsPort[1].toLowerCase()}}}`;
    return `{{setting:${schluessel(name)}}}`;
}

/**
 * Zerlegt EIN zusammengesetztes Argument in Teile.
 *
 * ARK und die halbe Unreal-Familie übergeben alles in einem einzigen Argument:
 *
 *   {{SERVER_MAP}}?listen?Port={{SERVER_PORT}}$( [[ -z {{MOD_ID}} ]] || printf %s "?GameModIds={{MOD_ID}}" )
 *
 * Das ist kein Schalter-Wert-Paar und lässt sich nicht in mehrere argv-Einträge
 * trennen — das Spiel will genau eine Zeichenkette. Die bedingten Stücke darin
 * werden zu `parts` mit `when`; die Shell verschwindet dabei vollständig.
 *
 * @returns {{parts, offen}|null}  null, wenn es kein zusammengesetztes Argument ist
 */
function zerlegeZusammengesetzt(wort, portZwecke) {
    if (!/\$\(/.test(wort) && !/\{\{[A-Z]/.test(wort)) return null;

    const offen = [];
    const parts = [];
    let rest = wort;

    // Bedingte Stücke: $( [[ Bedingung ]] &&|| echo|printf "Text" [ ||&& … "Text" ] )
    // Eggs benutzen `[[ … ]]` UND `[ … ]` — beide Formen, oft mit Anführungszeichen
    // um den Platzhalter. Nur eine davon zu kennen ließ ARK, Rust und die halbe
    // Unreal-Familie unaufgelöst (2026-08-15).
    // ZWEI Zweige, weil `Bedingung && printf %s "" || printf %s "-NoBattlEye"` die
    // Lieblingsform von ARK und CS2 ist: der erste Zweig ist leer, die Arbeit steckt
    // im zweiten. Wer nur einen Zweig kennt, verliert genau das Stück, um das es geht.
    const zweig = '(?:echo|printf)(?:\\s+-\\w+)?(?:\\s+%s)?\\s+';
    const muster = new RegExp(
        `\\$\\(\\s*\\[\\[?\\s*([^\\]]*?)\\s*\\]\\]?\\s*(&&|\\|\\|)\\s*${zweig}(["'])([\\s\\S]*?)\\3\\s*`
      + `(?:(&&|\\|\\|)\\s*${zweig}(["'])([\\s\\S]*?)\\6\\s*)?\\)`
    );

    let sicherung = 0;
    while (sicherung++ < 20) {
        const treffer = muster.exec(rest);
        if (!treffer) break;

        const [ganz, bedingung, verknuepfung, , inhalt, verknuepfung2, , inhalt2] = treffer;
        const davor = rest.slice(0, treffer.index);
        if (davor) parts.push({ text: davor });

        // Bedingung deuten. Mehr als diese vier Formen kommen in den Eggs nicht vor;
        // alles andere wird gemeldet statt geraten.
        // Die Verknüpfung VOR einem Zweig sagt, wann er läuft: `&&` heisst "wenn die
        // Bedingung zutrifft", `||` heisst "wenn sie NICHT zutrifft". Das gilt für den
        // zweiten Zweig genauso wie für den ersten.
        const deute = (negiert) => {
            if (/-z\s*["']?\{\{/.test(bedingung))                return negiert ? 'not_empty' : 'empty';
            if (/-n\s*["']?\{\{/.test(bedingung))                return negiert ? 'empty' : 'not_empty';
            // Auf leer prüfen, ohne -z/-n zu benutzen: Core Keeper schreibt
            // `[[ "{{GAME_ID}}" != "" ]]`. Dieselbe Frage, andere Schreibweise.
            if (/!=\s*(["'])\1/.test(bedingung))                 return negiert ? 'empty' : 'not_empty';
            if (/==\s*(["'])\1/.test(bedingung))                 return negiert ? 'not_empty' : 'empty';
            if (/-eq\s*1|==\s*["']?1["']?/.test(bedingung))      return negiert ? 'false' : 'true';
            if (/-ne\s*1|!=\s*["']?1["']?/.test(bedingung))      return negiert ? 'true' : 'false';
            // Gegen 0 zu prüfen ist dasselbe, andersherum — CS2 schreibt
            // `[ "$RCON_ENABLED" == "0" ] || printf %s ' -usercon'`.
            if (/-eq\s*0|==\s*["']?0["']?/.test(bedingung))      return negiert ? 'true' : 'false';
            if (/-ne\s*0|!=\s*["']?0["']?/.test(bedingung))      return negiert ? 'false' : 'true';
            return null;
        };

        const zweige = [[verknuepfung, inhalt]];
        if (verknuepfung2) zweige.push([verknuepfung2, inhalt2]);

        for (const [op, roher] of zweige) {
            const stueck = String(roher ?? '');
            if (!stueck.trim()) continue;   // `printf %s ""` — ein Zweig, der nichts tut
            const wann = deute(op === '||');
            if (wann) {
                // Nicht getrimmt: Die Eggs setzen ein Leerzeichen an den Anfang
                // (`' -NoBattlEye'`), um daraus ein eigenes argv-Wort zu machen. Wer
                // das wegtrimmt, klebt zwei Parameter zusammen.
                parts.push({ text: stueck, when: wann });
            } else {
                offen.push(`start: Bedingung "${bedingung.trim().slice(0, 50)}" nicht deutbar — das Stück "${stueck.trim().slice(0, 40)}" wurde WEGGELASSEN und muss von Hand nachgetragen werden.`);
            }
        }
        rest = rest.slice(treffer.index + ganz.length);
    }
    if (rest) parts.push({ text: rest });

    // Ein bedingtes Stück mit Leerzeichen am Rand war in der Shell ein eigenes
    // argv-Wort. In `parts` gibt es diese Grenze nicht — alle Teile ergeben EIN
    // Argument. Solange es nur einen Teil gibt, fängt der Aufrufer das ab; sobald
    // geklebt wird, ist es ein echter Verlust und muss gesagt werden.
    if (parts.length > 1) {
        for (const teil of parts) {
            if (teil.when && /^\s|\s$/.test(teil.text)) {
                offen.push(`start: Das bedingte Stück "${teil.text.trim().slice(0, 40)}" stand in der Shell durch ein Leerzeichen als eigenes Argument da. In parts wird alles zu EINEM Argument — die Grenze ging verloren und muss von Hand gesetzt werden.`);
            }
        }
    }

    // Platzhalter in Verweise umschreiben
    for (const teil of parts) {
        teil.text = teil.text.replace(/\{\{([A-Z][A-Z0-9_]*)\}\}/g, (_, n) => verweis(n, portZwecke));
        // Backslashes stammen aus der Shell-Maskierung und haben ohne Shell keinen Sinn.
        teil.text = teil.text.replace(/\\(?=[?&"'])/g, '');
    }

    const uebrig = parts.filter(t => t.text.length);
    if (!uebrig.length) return null;
    return { parts: uebrig, offen };
}

/**
 * Zerlegt eine Shell-Zeile in Wörter und achtet dabei auf Anführungszeichen.
 * Gibt zusätzlich zurück, ob ein Wort ursprünglich in Anführungszeichen stand —
 * das unterscheidet einen Wert von einem Schalter.
 */
function woerter(zeile) {
    const raus = [];
    let aktuell = '', zitat = null, hatteZitat = false;

    for (let i = 0; i < zeile.length; i++) {
        const z = zeile[i];
        if (zitat) {
            if (z === zitat) { zitat = null; continue; }
            aktuell += z;
        } else if (z === '"' || z === "'") {
            zitat = z; hatteZitat = true;
        } else if (/\s/.test(z)) {
            if (aktuell || hatteZitat) { raus.push({ wort: aktuell, zitiert: hatteZitat }); aktuell = ''; hatteZitat = false; }
        } else {
            aktuell += z;
        }
    }
    if (aktuell || hatteZitat) raus.push({ wort: aktuell, zitiert: hatteZitat });
    return raus;
}

// ═════════════════════════════════════════════════════════════════════════════
// Der Startbefehl — das schwierigste Stück
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Zerlegt den Startbefehl in Programm und Parameterliste.
 *
 * Die Eggs mischen drei Dinge in einer Zeile, die dort nicht hingehören:
 * Ausgabeumleitungen (`> >(sed …)`), Bedingungen als Bash-Arithmetik
 * (`$( [[ {{X}} -eq 1 ]] && echo " -flag ")`) und gewöhnliche Parameter. Alle
 * drei müssen getrennt werden, denn nach dem Umbau gibt es keine Shell mehr.
 *
 * @returns {{program, args, noise, offen}}
 */
/**
 * Entwirrt Startbefehle, die in Wahrheit ganze Shell-Programme sind.
 *
 * ARK ist der Extremfall: eine Abschaltfunktion mit RCON-Aufrufen, ein `trap`
 * darauf, ein `cd`, der eigentliche Serverstart im Hintergrund und zuletzt eine
 * Warteschleife, die auf RCON pollt. Drei unserer Felder in einer Zeile —
 * `stop.sequence`, `ready_when` und `start` —, weil Pterodactyl für die ersten
 * beiden keinen Ort hat.
 *
 * Hier werden sie getrennt. Geraten wird nichts: Was sich nicht sicher zuordnen
 * lässt, wird gemeldet.
 *
 * @returns {{befehl, workdir, stop, bereit, offen}}
 */
function entwirreShell(roh) {
    const offen = [];
    let text = String(roh || '').trim();
    let workdir = null, stop = null, bereit = null;

    const istProgramm = /\(\)\s*\{|trap\s|&\s*$|\buntil\b|\bwhile\b/.test(text);
    if (!istProgramm) return { befehl: text, workdir, stop, bereit, offen };

    // ── Abschaltroutine ernten ──────────────────────────────────────────────
    const funktion = text.match(/\w+\s*\(\)\s*\{([\s\S]*?)\}\s*;?\s*trap/);
    if (funktion) {
        const folge = [];
        for (const [, befehlText] of funktion[1].matchAll(/rcon\b[^;&|]*?\s([A-Za-z]\w*)\s*(?:$|[;&|])/g)) {
            folge.push(`rcon:${befehlText}`);
        }
        if (folge.length) {
            stop = { sequence: [...folge, 'sigterm', 'sigkill'], timeouts_sec: [60, 30, 10] };
            offen.push(`start.stop: Die Abschaltroutine stand im Startbefehl (Shell-Funktion mit trap). Übernommen als ${folge.join(' → ')} — die Reihenfolge muss am laufenden Server geprüft werden.`);
        } else {
            offen.push('start.stop: Der Startbefehl enthielt eine Abschaltroutine, aus der sich keine Befehle ableiten ließen. Sie ging verloren und muss neu erhoben werden.');
        }
    }

    // ── Bereitschaftsschleife erkennen ──────────────────────────────────────
    if (/\buntil\b[\s\S]*rcon/.test(text)) {
        bereit = { port: 'rcon' };
        offen.push('start.ready_when: Der Startbefehl wartete in einer Schleife auf RCON. Übernommen als Bereitschaft über den RCON-Port.');
    }

    // ── Den eigentlichen Aufruf herauslösen ─────────────────────────────────
    // Alles vor dem letzten `cd …&&` bzw. vor `./programm` ist Beiwerk.
    const cdTreffer = text.match(/cd\s+([^\s;&]+)\s*&&\s*(\.\/[\s\S]*)$/);
    if (cdTreffer) {
        workdir = cdTreffer[1];
        text = cdTreffer[2];
    } else {
        const start = text.search(/(^|[;&]\s*)\.\//);
        if (start > -1) text = text.slice(start).replace(/^[;&\s]+/, '');
    }

    // Hintergrundstart und alles danach abschneiden — das ist Ablaufsteuerung,
    // kein Parameter.
    const hintergrund = text.search(/\s&\s*(\w+=\$!|$|;)/);
    if (hintergrund > -1) {
        text = text.slice(0, hintergrund);
        offen.push('start: Der Server wurde im Hintergrund gestartet und der Rest der Zeile steuerte den Ablauf. Das übernimmt jetzt fb-init — die Ablaufsteuerung wurde entfernt.');
    }
    text = text.replace(/\s*;\s*until[\s\S]*$/, '');

    return { befehl: text.trim(), workdir, stop, bereit, offen };
}

function zerlegeStart(befehl, portZwecke, variablen) {
    const offen = [];
    const noise = [];

    const entwirrt = entwirreShell(befehl);
    offen.push(...entwirrt.offen);
    let rest = entwirrt.befehl;

    // Eggs mischen {{VAR}} und $VAR/${VAR} in derselben Zeile. Für uns ist beides
    // dasselbe — vereinheitlichen, sonst bleibt die Hälfte unaufgelöst.
    rest = rest.replace(/\$\{([A-Z][A-Z0-9_]*)\}/g, '{{$1}}')
               .replace(/\$([A-Z][A-Z0-9_]*)\b/g, '{{$1}}');

    // ── 1. Ausgabeumleitung abtrennen ───────────────────────────────────────
    // `> >(sed -uE "{{CONSOLE_FILTER}}")` ist ein Filter, kein Startparameter.
    const umleitung = rest.match(/>\s*>\(\s*sed[^)]*\)/);
    if (umleitung) {
        rest = rest.replace(umleitung[0], '').trim();
        const platzhalter = umleitung[0].match(/\{\{([A-Z0-9_]+)\}\}/);
        if (platzhalter) {
            const v = (variablen || []).find(x => x.env_variable === platzhalter[1]);
            for (const teil of String(v?.default_value || '').split(';')) {
                // sed-Löschmuster `/muster/d` → Rauschmuster
                const m = teil.match(/^\s*\/(.+)\/d\s*$/);
                if (!m) continue;
                const muster = m[1]
                    .replace(/\[\[:space:\]\]/g, '\\s')
                    .replace(/\[\[:digit:\]\]/g, '\\d');
                // Reine Leerzeilen entfernt fb-init ohnehin — nicht doppelt führen.
                if (/^\^\(?\\s\+?\)?\??\$$/.test(muster)) continue;
                noise.push(muster);
            }
        } else {
            offen.push('start: Ausgabeumleitung gefunden, aber ihr Muster war nicht auflösbar — console.noise prüfen.');
        }
    }
    // ── 2. Shell-Ersetzungen maskieren, damit sie beim Wörtertrennen heil bleiben ──
    // `$( [[ -z {{X}} ]] || printf %s "?A={{X}}" )` enthält Leerzeichen. Ohne
    // Maskierung zerfällt es in Bruchstücke, und genau daran ist der erste
    // Durchlauf gescheitert (ARK, Core Keeper, Rust — 38 Meldungen).
    // Klammern werden gezaehlt, statt nach dem naechsten `)` zu suchen. ARK haengt
    // direkt hinter die schliessende Klammer weiteren Text:
    //   … && printf %s "?ServerPassword={{X}}" )?ServerAdminPassword={{Y}}?Port=…
    // Ein nicht-gieriger Ausdruck endet dort nicht — er greift zu weit oder gar
    // nicht. Am 2026-08-15 blieben dadurch fast alle bedingten Stuecke
    // unaufgeloest: 7 erkannte Bedingungen statt gut zweihundert.
    const maske = [];
    {
        let raus = '', i = 0;
        while (i < rest.length) {
            if (rest[i] === '$' && rest[i + 1] === '(') {
                let tiefe = 0, j = i;
                for (; j < rest.length; j++) {
                    if (rest[j] === '(') tiefe++;
                    else if (rest[j] === ')') { tiefe--; if (tiefe === 0) { j++; break; } }
                }
                maske.push(rest.slice(i, j));
                // Klartextmarke statt Steuerzeichen: sie uebersteht das Worttrennen
                // und macht die Datei nicht zur Binaerdatei.
                raus += '@@' + (maske.length - 1) + '@@';
                i = j;
            } else {
                raus += rest[i++];
            }
        }
        rest = raus;
    }
    const entmaskieren = (w) => w.replace(/@@(\d+)@@/g, (_, i) => maske[Number(i)]);

    // ── 3. Erst JETZT nach echten Umleitungen suchen ────────────────────────
    // Diese Prüfung stand bis 2026-08-16 VOR dem Maskieren. Damit galt jedes `||`
    // innerhalb eines `$( … )` als Pipe, und `.replace(/[|><].*$/,'')` schnitt den
    // gesamten Rest der Zeile ab — bei Counter-Strike 2 verschwanden so Port, Karte,
    // Servername und acht weitere Parameter hinter einer Meldung, die von
    // "Umleitungen" sprach. Nach dem Maskieren steht dort `@@0@@`; ein `|` ist jetzt
    // wirklich eine Pipe.
    const umleitungAb = rest.replace(/\{\{[^}]*\}\}/g, '').search(/[|><]/);
    if (umleitungAb > -1) {
        const gekappt = entmaskieren(rest.slice(rest.search(/[|><]/))).trim();
        offen.push(`start: Ab "${gekappt.slice(0, 60)}" steht eine Shell-Umleitung. Dieser Rest der Zeile (${gekappt.length} Zeichen) wurde NICHT übernommen — nach dem Umbau gibt es keine Shell.`);
        rest = rest.slice(0, rest.search(/[|><]/)).trim();
    }

    // ── 4. Den Rest in Wörter zerlegen ──────────────────────────────────────
    const teile = woerter(rest).map(t => ({ ...t, wort: entmaskieren(t.wort) }));
    if (!teile.length) return { program: '', args: [], noise, offen: [...offen, 'start: kein Programm erkennbar.'] };

    // Führende NAME=wert-Zuweisungen sind Umgebung, nicht das Programm. Ohne diesen
    // Schritt hiess das Programm von Counter-Strike 2 "LD_LIBRARY_PATH=…" — falsch,
    // aber ohne eine einzige Meldung. Genau das Muster, das I7 in check-pakete.js
    // fängt und der Übersetzer bis 2026-08-16 durchwinkte.
    const vorabEnv = {};
    while (teile.length > 1 && !teile[0].zitiert && /^[A-Za-z_][A-Za-z0-9_]*=/.test(teile[0].wort)) {
        const [, name, wert] = teile.shift().wort.match(/^([A-Za-z_][A-Za-z0-9_]*)=([\s\S]*)$/);
        // Die Werte verweisen auf die Umgebung selbst (`$HOME`, `$LD_LIBRARY_PATH`).
        // Das ist keine Einstellung von uns — zurück in die Shell-Schreibweise.
        vorabEnv[name] = wert.replace(/\{\{([A-Z][A-Z0-9_]*)\}\}/g, '${$1}');
        offen.push(`env.${name}: stand als Zuweisung vor dem Programm in der Startzeile und wurde als feste Umgebung übernommen ("${vorabEnv[name].slice(0, 50)}"). Prüfen, ob das Image sie ohnehin schon setzt.`);
    }

    let program = teile.shift().wort;
    if (/[\s|&><`]|\$\(/.test(program)) {
        offen.push(`start.program: "${program.slice(0, 60)}" enthält Shell-Zeichen — nur der erste Teil wurde übernommen, der Rest muss von Hand nachgezogen werden.`);
        program = program.split(/[\s|&><`]/)[0];
    }
    const args = [];
    const benutzteSchluessel = new Set();

    /**
     * Legt einen eindeutigen Schlüssel an.
     * Das Schema verlangt einen Buchstaben am Anfang; Parameter wie `-0.0.0.0` oder
     * `7DaysToDieServer` liefern von sich aus keinen. Ohne diese Zeile entstanden
     * schemawidrige Pakete, die der Übersetzer trotzdem als erfolgreich zählte.
     */
    const eindeutig = (roh) => {
        const basis = schluessel(roh).replace(/^([^a-z])/, 'arg_$1');
        let k = basis, n = 2;
        while (benutzteSchluessel.has(k)) k = `${basis}_${n++}`;
        benutzteSchluessel.add(k);
        return k;
    };

    /** Woher stammt ein Wert wie `{{SERVER_PORT}}`? */
    const herkunft = (wort) => {
        const treffer = wort.match(/^\{\{([A-Z0-9_]+)\}\}$/);
        if (!treffer) return null;
        const name = treffer[1];
        if (name === 'SERVER_PORT' && portZwecke.has('game')) return 'port:game';
        const alsPort = name.match(/^([A-Z0-9]+)_PORT$/);
        if (alsPort && portZwecke.has(alsPort[1].toLowerCase())) return `port:${alsPort[1].toLowerCase()}`;
        return `setting:${schluessel(name)}`;
    };

    for (let i = 0; i < teile.length; i++) {
        const { wort } = teile[i];
        const naechstes = teile[i + 1];

        const einfach = (w) => /^\{\{[A-Z][A-Z0-9_]*\}\}$/.test(w) || !/\$\(|\{\{/.test(w);

        if (wort.startsWith('-')) {
            // Ein Schalter, an dem selbst noch eine Bedingung klebt: ARK schreibt
            // `-server$( [ -n "$MOD_ID" ] && printf %s ' -automanagedmods' )`. Ohne
            // diesen Fall wurde der Schalter als Ganzes für einen Namen gehalten und
            // die Bedingung ging als roher Text mit.
            if (/\$\(/.test(wort)) {
                const zerlegt = zerlegeZusammengesetzt(wort, portZwecke);
                if (zerlegt) {
                    args.push({ key: eindeutig(wort.replace(/^-+/, '').split(/[^a-zA-Z0-9_]/)[0] || 'arg'),
                                parts: zerlegt.parts });
                    offen.push(...zerlegt.offen);
                    continue;
                }
            }
            if (naechstes && !naechstes.wort.startsWith('-')) {
                if (!einfach(naechstes.wort)) {
                    // Schalter mit zusammengesetztem Wert: beide getrennt, Reihenfolge bleibt.
                    const zerlegt = zerlegeZusammengesetzt(naechstes.wort, portZwecke);
                    if (zerlegt) {
                        args.push({ key: eindeutig(wort.replace(/^-+/, '')), form: wort, from: 'fixed' });
                        args.push({ key: eindeutig(wort.replace(/^-+/, '') + '_wert'), parts: zerlegt.parts });
                        offen.push(...zerlegt.offen);
                        i++;
                        continue;
                    }
                }
                const quelle = herkunft(naechstes.wort);
                if (quelle) {
                    args.push({ key: eindeutig(wort.replace(/^-+/, '')), form: [wort, '{{value}}'], from: quelle });
                } else {
                    args.push({ key: eindeutig(wort.replace(/^-+/, '')), form: [wort, naechstes.wort], from: 'fixed' });
                }
                i++;
                continue;
            }
            args.push({ key: eindeutig(wort.replace(/^-+/, '')), form: wort, from: 'fixed' });
            continue;
        }

        // Wort ohne führenden Strich
        const quelle = herkunft(wort);
        if (quelle && einfach(wort)) {
            args.push({ key: eindeutig(quelle.split(':')[1]), form: ['{{value}}'], from: quelle });
            continue;
        }

        const zerlegt = zerlegeZusammengesetzt(wort, portZwecke);
        if (zerlegt) {
            // Sonderfall: genau ein bedingtes Stück, und es ist ein reiner Schalter
            // (`-crossplay`). Das ist kein zusammengesetztes Argument, sondern ein
            // Schalter mit Bedingung — so bleibt es lesbar.
            const nurEines = zerlegt.parts.length === 1 && zerlegt.parts[0].when;
            const inhalt   = nurEines ? zerlegt.parts[0].text.trim() : '';
            const bezug    = inhalt.match(/^(-[^\s{}]+)$/) && wort.match(/\{\{setting:([a-z0-9_]+)\}\}|\{\{([A-Z][A-Z0-9_]*)\}\}/);
            if (nurEines && bezug) {
                const ziel = bezug[1] || schluessel(bezug[2]);
                args.push({ key: eindeutig(inhalt.replace(/^-+/, '')), form: inhalt,
                            from: `setting:${ziel}`, when: zerlegt.parts[0].when });
            } else {
                args.push({ key: eindeutig('arg'), parts: zerlegt.parts });
            }
            offen.push(...zerlegt.offen);
            continue;
        }

        args.push({ key: eindeutig(wort.replace(/[^a-zA-Z0-9]/g, '') || 'arg'), form: [wort], from: 'fixed' });
    }

    // ── 5. Nachschau: ist noch Shell übrig? ─────────────────────────────────
    // Der blinde Fleck bis 2026-08-16. Gezählt wurde nur, was ein Muster GEFUNDEN,
    // aber nicht gedeutet hat. Wo das Muster gar nicht erst griff, blieb das Fragment
    // unzerlegt als roher Text stehen und der Bericht meldete "0 nicht deutbar".
    // Ein Argument, in dem noch `$(`, `&&`, `||` oder ein Backtick steht, ist nach
    // dem Umbau nicht ausführbar — es gibt keine Shell mehr, die es auflöst.
    // Dieselbe Definition wie I7 in check-pakete.js. Zwei Werkzeuge mit zwei
    // Begriffen von "noch Shell" hiessen: die Lücke wird kleiner, nicht sichtbar.
    const shellRest = /[|&><`]|\$\(/;
    const reste = [];
    if (shellRest.test(program)) {
        reste.push(`start.program "${program.slice(0, 60)}"`);
    }
    for (const a of args) {
        const texte = a.parts ? a.parts.map(t => t.text)
                    : (Array.isArray(a.form) ? a.form : [a.form]);
        for (const t of texte) {
            if (typeof t === 'string' && shellRest.test(t)) {
                reste.push(`Parameter "${a.key}": ${t.trim().slice(0, 90)}`);
            }
        }
    }
    for (const r of reste) {
        offen.push(`start: Unzerlegtes Shell-Fragment stehengeblieben — ${r}. Es wurde WÖRTLICH übernommen und läuft ohne Shell nicht; von Hand auflösen.`);
    }

    return { program, args, noise, offen, env: vorabEnv, reste: reste.length,
             workdir: entwirrt.workdir, stop: entwirrt.stop, bereit: entwirrt.bereit };
}

// ═════════════════════════════════════════════════════════════════════════════
// Ports
// ═════════════════════════════════════════════════════════════════════════════

function zerlegePorts(gd) {
    const offen = [];
    const ports = [];
    const roh = gd.ports && typeof gd.ports === 'object' ? gd.ports : {};

    for (const [name, def] of Object.entries(roh)) {
        const versatz = name.match(/^(.+)_plus_(\d+)$/);
        const zweck = versatz ? (gd.query?.port_var === name ? 'query' : schluessel(name)) : schluessel(name);
        ports.push({
            purpose: zweck,
            protocol: def?.protocol === 'both' ? 'both' : (def?.protocol === 'tcp' ? 'tcp' : 'udp'),
            assign: versatz ? `${schluessel(versatz[1])}+${versatz[2]}` : 'pool',
            required: true,
            ...(zweck === 'game' ? { variable: 'SERVER_PORT' } : {}),
        });
        if (def?.default) {
            offen.push(`ports.${zweck}: Das alte Paket nannte die feste Nummer ${def.default}. Nummern kommen jetzt aus der Vergabe (I2) — geprüft werden muss nur, ob "${versatz ? 'Beziehung' : 'Pool'}" stimmt.`);
        }
    }

    // Portvariablen, die als Einstellung getarnt waren
    for (const v of gd.variables || []) {
        const treffer = String(v.env_variable || '').match(/^([A-Z0-9]+)_PORT$/);
        if (!treffer || treffer[1] === 'SERVER') continue;
        const zweck = treffer[1].toLowerCase();
        if (ports.some(p => p.purpose === zweck)) continue;
        ports.push({
            purpose: zweck,
            protocol: zweck === 'rcon' ? 'tcp' : 'udp',
            assign: 'pool',
            required: false,
            variable: v.env_variable,
        });
        offen.push(`ports.${zweck}: war im alten Paket eine Variable mit fester Nummer, keine Portdeklaration. Protokoll ${zweck === 'rcon' ? 'tcp (aus dem Zweck abgeleitet)' : 'udp (angenommen)'} — prüfen.`);
    }

    if (!ports.length) {
        ports.push({ purpose: 'game', protocol: 'udp', assign: 'pool', required: true, variable: 'SERVER_PORT' });
        offen.push('ports: Das alte Paket deklarierte keinen einzigen Port. Ein Spielport wurde angenommen — prüfen.');
    }
    return { ports, offen };
}

// ═════════════════════════════════════════════════════════════════════════════
// Variablen → Einstellungen und feste Umgebung
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Wie schreibt dieses Spiel ein Ja/Nein?
 *
 * Die Eggs sind sich uneinig — 1/0, true/false, True/False, yes/no kommen alle
 * vor, teils im selben Paket. Der einzige verlässliche Hinweis ist der alte
 * Vorgabewert: So hat es bisher funktioniert. Lässt er keinen Schluss zu, wird
 * gemeldet statt geraten.
 */
function schreibweise(vorgabe) {
    const w = String(vorgabe ?? '').trim();
    if (w === '1' || w === '0')           return 'one_zero';
    if (w === 'true'  || w === 'false')   return 'true_false';
    if (w === 'True'  || w === 'False')   return 'True_False';
    if (w === 'TRUE'  || w === 'FALSE')   return 'TRUE_FALSE';
    if (w === 'yes'   || w === 'no')      return 'yes_no';
    if (w === 'Yes'   || w === 'No')      return 'Yes_No';
    if (w === 'on'    || w === 'off')     return 'on_off';
    return null;
}

const NUR_UMGEBUNG = new Set(['LD_LIBRARY_PATH', 'CONSOLE_FILTER', 'STARTUP', 'TZ', 'SERVER_IP']);
const RAUS         = new Set(['STEAM_USER', 'STEAM_PASS', 'STEAM_AUTH', 'SRCDS_APPID', 'SERVER_PORT']);

function zerlegeVariablen(gd, args) {
    const offen = [], settings = [], env = {};
    // Ein Argument aus `parts` hat kein `from` — seine Verweise stehen im Text.
    const imStart = new Set();
    for (const a of args) {
        if (typeof a.from === 'string' && a.from.startsWith('setting:')) imStart.add(a.from.slice(8));
        for (const t of a.parts || []) {
            for (const [, k] of String(t.text).matchAll(/\{\{setting:([a-z0-9_]+)\}\}/g)) imStart.add(k);
        }
    }

    for (const v of gd.variables || []) {
        const name = v.env_variable;
        if (!name) continue;
        if (RAUS.has(name)) {
            if (name.startsWith('STEAM_')) offen.push(`${name} entfernt — anonymer Bezug ist der Regelfall (L5a); ein Klartextfeld dafür wäre eine Einladung.`);
            continue;
        }
        if (NUR_UMGEBUNG.has(name)) { env[name] = v.default_value ?? ''; continue; }

        const k = schluessel(name);
        const art = v.field_type === 'boolean' ? 'boolean'
                  : v.field_type === 'number'  ? 'number'
                  : v.field_type === 'password' ? 'password'
                  : 'text';

        const eintrag = {
            key: k,
            name: text(v.name || name, v.name || name),
            ...(v.description ? { description: text(null, v.description) } : {}),
            type: art,
            ...(v.default_value !== undefined && v.default_value !== null && v.default_value !== ''
                ? { default: art === 'number' ? Number(v.default_value) || 0
                          : art === 'boolean' ? ['1','true','TRUE',true].includes(v.default_value)
                          : String(v.default_value) }
                : {}),
            apply: [{
                ...(imStart.has(k) ? { target: 'arg' } : { target: 'env', variable: name }),
                ...(art === 'boolean' ? { as: schreibweise(v.default_value) } : {}),
            }],
            takes_effect: 'restart',
            role: v.user_editable === false ? 'expert' : 'player',
            ...(v.user_viewable === false ? { visible: false } : {}),
        };
        if (art === 'boolean' && !schreibweise(v.default_value)) {
            offen.push(`settings.${k}: Ja/Nein-Einstellung, aber aus dem alten Vorgabewert "${v.default_value}" lässt sich die Schreibweise nicht ableiten (1/0? true/false? True/False?). Muss vor der Freigabe gesetzt werden.`);
        }
        settings.push(eintrag);
    }

    if (settings.length) {
        offen.push(`settings: "wirkt ab" und "Risiko" stehen bei allen ${settings.length} Einträgen auf der Vorgabe — das alte Format kannte beides nicht. Vor der Freigabe je Eintrag prüfen.`);
        offen.push('settings: Beschreibungen stammen aus dem Egg und sind englisch. Die deutschen Texte fehlen.');
    }
    return { settings, env, offen };
}

// ═════════════════════════════════════════════════════════════════════════════
// Konfigurationsdateien — inklusive Reparatur des Zeichensalats
// ═════════════════════════════════════════════════════════════════════════════

function zerlegeDateien(gd) {
    const offen = [];
    const roh = gd.config?.files;
    if (!roh || typeof roh !== 'object') return { patch: undefined, offen };

    const schluesselListe = Object.keys(roh);
    const nurZiffern = schluesselListe.length > 0 && schluesselListe.every(k => /^\d+$/.test(k));
    if (nurZiffern) {
        offen.push(`files.patch: Die alte Zuordnung bestand aus ${schluesselListe.length} Einträgen mit den Schlüsseln "0", "1", "2" … — eine zeichenweise zerlegte JSON-Zeichenkette. Sie wurde verworfen; die Dateizuordnung fehlt und muss neu erhoben werden.`);
        return { patch: undefined, offen };
    }

    const patch = {};
    for (const [datei, eintrag] of Object.entries(roh)) {
        if (/^\d+$/.test(datei)) continue;
        if (!eintrag || typeof eintrag !== 'object' || !eintrag.find) continue;
        patch[datei] = {
            parser: ['ini', 'json', 'yaml', 'properties', 'xml'].includes(eintrag.parser) ? eintrag.parser : 'text',
            find: eintrag.find,
        };
    }
    return { patch: Object.keys(patch).length ? patch : undefined, offen };
}

// ═════════════════════════════════════════════════════════════════════════════
// Ein Paket übersetzen
// ═════════════════════════════════════════════════════════════════════════════

function uebersetze(gd, kopf) {
    const offen = [];

    const { ports, offen: portOffen } = zerlegePorts(gd);
    offen.push(...portOffen);
    const zwecke = new Set(ports.map(p => p.purpose));

    const start = zerlegeStart(gd.startup?.command, zwecke, gd.variables);
    offen.push(...start.offen);

    const { settings, env, offen: varOffen } = zerlegeVariablen(gd, start.args);
    offen.push(...varOffen);
    // Zuweisungen aus der Startzeile zuerst, deklarierte Variablen gewinnen.
    const umgebung = { ...start.env, ...env };

    // Startparameter, die auf eine Einstellung zeigen, die es nicht gibt
    const vorhanden = new Set(settings.map(s => s.key));
    const verlangt = [];
    for (const a of start.args) {
        if (typeof a.from === 'string' && a.from.startsWith('setting:')) verlangt.push(a.from.slice(8));
        for (const t of a.parts || []) {
            for (const [, k] of String(t.text).matchAll(/\{\{setting:([a-z0-9_]+)\}\}/g)) verlangt.push(k);
        }
    }
    for (const gesucht of [...new Set(verlangt)]) {
        const a = { from: `setting:${gesucht}` };
        if (!vorhanden.has(gesucht)) {
            settings.push({
                key: a.from.slice(8),
                name: text(a.from.slice(8), a.from.slice(8)),
                type: 'text',
                apply: [{ target: 'arg' }],
                takes_effect: 'restart',
                role: 'expert',
            });
            offen.push(`settings.${a.from.slice(8)}: kam nur im Startbefehl vor, hatte aber keine Variablendeklaration. Als Textfeld angelegt.`);
        }
    }

    const { patch, offen: dateiOffen } = zerlegeDateien(gd);
    offen.push(...dateiOffen);

    const bild = gd.image || {};
    if (!bild.digest) offen.push('image: kein Digest — das Paket ist nicht auf einen festen Inhalt festgelegt.');

    const steamApp = kopf.steam_app_id
        || Number((gd.variables || []).find(v => v.env_variable === 'SRCDS_APPID')?.default_value)
        || null;

    const schritte = [];
    if (steamApp) {
        schritte.push({ type: 'steamcmd', app: Number(steamApp), login: false, validate: true });
    } else {
        schritte.push({ type: 'script', script: gd.scripts?.installation?.script || '# leer',
                        ...(gd.scripts?.installation?.container ? { image: gd.scripts.installation.container } : {}) });
        offen.push('install: Kein SteamCMD erkennbar — das Installationsskript wurde als Notausgang (script) übernommen und muss in Schritte zerlegt werden.');
    }

    const befehle = {};
    if (gd.config?.rcon) {
        offen.push('commands: Das alte Paket hatte eine RCON-Konfiguration, aber keine Befehle. Die Befehlsgruppen fehlen vollständig.');
    } else {
        offen.push('commands: keine Befehle deklariert — die Kern-Befehlsgruppen müssen erhoben werden.');
    }

    const verwaltung = {};
    if (gd.query?.gamedig_type) {
        const zweck = gd.query.port_var === 'game' ? 'game'
                    : (zwecke.has('query') ? 'query' : [...zwecke][0]);
        verwaltung.query = { protocol: gd.query.gamedig_type, port: zweck };
    } else {
        offen.push('management.query: keine Abfrage konfiguriert — Spielerzahl und Online-Status bleiben unbekannt.');
    }
    if (gd.config?.rcon && zwecke.has('rcon')) {
        verwaltung.rcon = { protocol: 'source', port: 'rcon' };
        offen.push('management.rcon: Protokoll "source" angenommen — prüfen.');
    }
    if (steamApp) verwaltung.update = { type: 'steamcmd', app: Number(steamApp) };
    offen.push('management.saves: nicht bekannt — ohne diese Angabe weiß eine Sicherung nicht, was sie mitnehmen muss.');
    offen.push('requirements: nicht gemessen.');

    const paket = {
        format: 'FBPKG_v1',
        identity: {
            slug: kopf.slug,
            name: kopf.name,
            version: '1.0.0',
            author: 'firenetworks',
            ...(kopf.category ? { category: kopf.category } : {}),
            ...(kopf.description ? { description: text(null, kopf.description) } : {}),
            origin: {
                type: 'egg-import',
                ...(kopf.source ? { source: kopf.source } : {}),
                imported_at: new Date().toISOString().slice(0, 10),
            },
        },
        image: {
            ref: bild.ref || 'unbekannt',
            ...(bild.tag ? { tag: bild.tag } : {}),
            digest: bild.digest || 'sha256:' + '0'.repeat(64),
            ...(bild.pinned_at ? { pinned_at: bild.pinned_at } : {}),
            platform: gd.platform === 'windows' ? 'windows' : 'linux',
        },
        ports,
        install: { steps: schritte, cache: { steam_depot: true } },
        start: {
            program: start.program,
            workdir: start.workdir || '.',
            args: start.args,
            ready_when: start.bereit && zwecke.has(start.bereit.port) ? start.bereit : {
                ...(zwecke.has('game') ? { port: 'game' } : {}),
                ...(gd.startup?.done ? { log_line: gd.startup.done } : {}),
            },
            stop: start.stop || {
                sequence: gd.startup?.stop === '^C' ? ['sigint', 'sigterm', 'sigkill']
                        : gd.startup?.stop ? [`command:${gd.startup.stop}`, 'sigterm', 'sigkill']
                        : ['sigterm', 'sigkill'],
                timeouts_sec: [60, 30, 10],
            },
        },
        ...(Object.keys(umgebung).length ? { env: umgebung } : {}),
        ...(settings.length ? { settings } : {}),
        ...(Object.keys(befehle).length ? { commands: befehle } : {}),
        content: { supported: false },
        ...(Object.keys(verwaltung).length ? { management: verwaltung } : {}),
        files: {
            denylist: gd.file_denylist?.length ? gd.file_denylist : ['.env', 'start.sh', 'firebot.lock'],
            ...(patch ? { patch } : {}),
        },
        ...(start.noise.length ? { console: { noise: start.noise } } : {}),
        status: { complete: false, open: offen },
    };

    if (schritte.some(s => s.type === 'script')) {
        paket.status.open.unshift('install: benutzt den Notausgang (script) — siehe unten.');
    }
    if (!gd.startup?.done) {
        paket.status.open.push('start.ready_when: keine Fertig-Erkennung im alten Paket — Bereitschaft hängt allein am Port.');
    }
    return paket;
}

// ═════════════════════════════════════════════════════════════════════════════
// Hauptlauf
// ═════════════════════════════════════════════════════════════════════════════

(async () => {
    const ergebnisse = [];
    const fehler = [];

    // ── Die 23 aus der Datenbank ────────────────────────────────────────────
    const db = await mysql.createConnection({
        host: process.env.MYSQL_HOST, port: Number(process.env.MYSQL_PORT) || 3306,
        user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD,
        database: process.env.MYSQL_DATABASE,
    });
    const [zeilen] = await db.query(
        'SELECT slug, name, description, category, steam_app_id, game_data FROM addon_marketplace ORDER BY slug'
    );

    console.log(`\nÜbersetzung nach FBPKG_v1\n`);
    console.log(`── Bestand: ${zeilen.length} Pakete aus der Datenbank ──\n`);

    for (const z of zeilen) {
        let gd;
        try { gd = typeof z.game_data === 'string' ? JSON.parse(z.game_data) : z.game_data; }
        catch (e) { fehler.push({ slug: z.slug, quelle: 'db', grund: `game_data unlesbar: ${e.message}` }); continue; }
        try {
            const paket = uebersetze(gd, {
                slug: z.slug, name: z.name, description: z.description,
                category: z.category, steam_app_id: z.steam_app_id,
            });
            ergebnisse.push({ quelle: 'db', paket });
            console.log(`  ${paket.status.open.length <= 4 ? '○' : '△'} ${z.slug.padEnd(28)} `
                + `${paket.ports.length} Ports · ${(paket.settings || []).length} Einstellungen · `
                + `${paket.status.open.length} offen`);
        } catch (e) {
            fehler.push({ slug: z.slug, quelle: 'db', grund: e.message });
            console.log(`  ✘ ${z.slug.padEnd(28)} ${e.message}`);
        }
    }
    await db.end();

    // ── Die 250 aus den Quellen ─────────────────────────────────────────────
    if (MIT_EGGS) {
        const imp = new EggImporter();
        console.log(`\n── Härtetest: Eggs aus den Pelican-Quellen ──\n`);
        for (const { id, name } of imp.getRepositories()) {
            let liste;
            try { liste = await imp.listEggs(id); }
            catch (e) { console.log(`  ${name}: Liste nicht abrufbar — ${e.message}`); continue; }
            if (GRENZE) liste = liste.slice(0, GRENZE);

            let ok = 0, schlecht = 0;
            for (const egg of liste) {
                try {
                    const roh = await imp.fetchEgg(egg.downloadUrl);
                    const gd  = imp.convert(roh);
                    const paket = uebersetze(gd, {
                        slug: egg.name.split('/').pop().toLowerCase().replace(/[^a-z0-9-]/g, '-'),
                        name: gd.meta?.name || egg.displayName,
                        description: gd.meta?.description,
                        source: egg.downloadUrl,
                    });
                    ergebnisse.push({ quelle: id, paket });
                    ok++;
                } catch (e) {
                    fehler.push({ slug: egg.name, quelle: id, grund: e.message });
                    schlecht++;
                }
            }
            console.log(`  ${name.padEnd(22)} ${String(ok).padStart(4)} übersetzt · ${schlecht} gescheitert`);
        }
    }

    // ── Bericht ─────────────────────────────────────────────────────────────
    // Was hier steht, wird aus den erzeugten Paketen gezählt, nicht mitgeschrieben —
    // damit die Zahl nicht behaupten kann, was das Ergebnis nicht hergibt.
    const zaehl = { bedingungen: {}, schreibweisen: {}, zusammengesetzt: 0,
                    resteArgs: 0, restePakete: 0, undeutbar: 0, gekappt: 0 };
    for (const { paket } of ergebnisse) {
        let hatParts = false;
        for (const a of paket.start.args || []) {
            if (a.parts) hatParts = true;
            if (a.when) zaehl.bedingungen[a.when] = (zaehl.bedingungen[a.when] || 0) + 1;
            for (const t of a.parts || []) {
                if (t.when) zaehl.bedingungen[t.when] = (zaehl.bedingungen[t.when] || 0) + 1;
            }
        }
        if (hatParts) zaehl.zusammengesetzt++;
        for (const s of paket.settings || []) for (const z of s.apply || []) {
            if (z.as) zaehl.schreibweisen[z.as] = (zaehl.schreibweisen[z.as] || 0) + 1;
        }
        const reste = paket.status.open.filter(o => o.includes('Unzerlegtes Shell-Fragment')).length;
        if (reste) { zaehl.resteArgs += reste; zaehl.restePakete++; }
        zaehl.undeutbar += paket.status.open.filter(o => o.includes('nicht deutbar')).length;
        zaehl.gekappt   += paket.status.open.filter(o => o.includes('Shell-Umleitung')).length;
    }

    const liste = (o) => Object.entries(o).sort((a, b) => b[1] - a[1])
        .map(([k, n]) => `${k} ${n}`).join(' · ') || '—';

    console.log(`\n── Was der Übersetzer herausgeholt hat ──`);
    console.log(`  Bedingungen erkannt:                ${liste(zaehl.bedingungen)}`);
    console.log(`  Ja/Nein-Schreibweisen:              ${liste(zaehl.schreibweisen)}`);
    console.log(`  Pakete mit zusammengesetzten Args:  ${zaehl.zusammengesetzt}`);
    console.log(`\n── Was er liegen lässt (das ist der ehrliche Teil) ──`);
    console.log(`  Unzerlegte Shell-Fragmente:         ${zaehl.resteArgs} in ${zaehl.restePakete} Paketen`);
    console.log(`  Bedingungen gefunden, nicht deutbar:${String(zaehl.undeutbar).padStart(4)}`);
    console.log(`  Zeilen ab einer Umleitung gekappt:  ${zaehl.gekappt}`);

    const haeufig = {};
    for (const e of ergebnisse) for (const o of e.paket.status.open) {
        const art = o.split(':')[0];
        haeufig[art] = (haeufig[art] || 0) + 1;
    }

    console.log(`\n── Woran es am häufigsten fehlt ──`);
    for (const [art, n] of Object.entries(haeufig).sort((a, b) => b[1] - a[1]).slice(0, 12)) {
        console.log(`  ${String(n).padStart(4)}× ${art}`);
    }

    if (fehler.length) {
        console.log(`\n── Nicht übersetzbar (${fehler.length}) ──`);
        const gruende = {};
        for (const f of fehler) {
            const kurz = f.grund.slice(0, 70);
            (gruende[kurz] = gruende[kurz] || []).push(f.slug);
        }
        for (const [grund, wer] of Object.entries(gruende).sort((a, b) => b[1].length - a[1].length)) {
            console.log(`  ${String(wer.length).padStart(3)}× ${grund}`);
            console.log(`        ${wer.slice(0, 5).join(', ')}${wer.length > 5 ? ' …' : ''}`);
        }
    }

    fs.mkdirSync(BESTAND, { recursive: true });
    const ziel = path.join(BESTAND, `uebersetzung-${new Date().toISOString().slice(0, 10)}.json`);
    fs.writeFileSync(ziel, JSON.stringify({
        erzeugt_am: new Date().toISOString(),
        anzahl: ergebnisse.length,
        fehler,
        pakete: ergebnisse,
    }, null, 2) + '\n');

    console.log(`\nÜbersetzt: ${ergebnisse.length} · gescheitert: ${fehler.length}`);
    console.log(`Ergebnis: docs/spielpakete/bestand/${path.basename(ziel)}`);
    process.exit(0);
})().catch(err => { console.error('\nFehlgeschlagen:', err.message); process.exit(2); });
