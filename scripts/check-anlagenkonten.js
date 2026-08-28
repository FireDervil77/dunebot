#!/usr/bin/env node
/**
 * Prueft die **Konten der Anlage** (Stufe 13a).
 *
 * Der Chatbot braucht ein eigenes Twitch-Konto, das unserer Anwendung einmal
 * zustimmt. Das ist der erste Vorgang im Haus, bei dem eine Zustimmung
 * **keinem Menschen** gehoert — und daran haengen vier stille Fallen:
 *
 *   1. **Die Zusage darf nie in einem Benutzerprofil auftauchen.** Dort waere
 *      sie ein Knopf, der das eigene Twitch-Konto zum Chatbot machen wuerde —
 *      und `uniq_benutzer_plattform` wiese ihn ohnehin ab. Ein Knopf, der nur
 *      scheitern kann, gehoert nicht auf die Seite.
 *   2. **Der Betreiber muss sie trotzdem erreichen koennen.** Genau daran ist
 *      12b am 2026-08-26 gescheitert: 35 Pruefungen gruen, und der Betreiber
 *      fand keinen Knopf. Deshalb wird hier der ganze Weg geprueft —
 *      Navigation, Seite, Knopfadresse.
 *   3. **Der Betreiber-Zweig darf nicht ueber den `state` erschleichbar sein.**
 *      Ein `state` laesst sich aus einem Protokoll abschreiben; das Ziel muss
 *      im Zweifel auf `benutzer` fallen, nie auf `anlage`.
 *   4. **Die stuendliche Pflichtpruefung muss beide Arten erreichen.** Twitchs
 *      Auflage gilt fuer jeden Nutzer-Token, auch fuer den des Bot-Kontos. Eine
 *      vergessene Schleife faellt erst bei einem Audit auf.
 *
 * Nebenwirkungsfrei: Attrappen und Quelltext, kein Twitch, keine Datenbank.
 *
 *   node scripts/check-anlagenkonten.js
 *
 * Exitcode 1 bei jeder Abweichung.
 */
'use strict';

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../apps/dashboard/.env'), quiet: true });

const { ServiceManager } = require('dunebot-core');

let faelle = 0;
let abweichungen = 0;

/**
 * @param {boolean} gut Bedingung
 * @param {string} text Beschreibung
 * @param {string} [zusatz] Ergaenzung
 * @returns {void}
 */
function pruefe(gut, text, zusatz = '') {
    faelle++;
    if (!gut) abweichungen++;
    console.log(`  ${gut ? '✓' : '✗'} ${text}${zusatz ? '  — ' + zusatz : ''}`);
}

const wurzel = path.join(__dirname, '..');

/**
 * Quelltext ohne Kommentare — sonst schlaegt eine Regel auf ihre eigene
 * Erklaerung an. Im Haus schon dreimal passiert.
 *
 * @param {string} rel Pfad ab der Wurzel
 * @returns {string} Code
 */
function code(rel) {
    return fs.readFileSync(path.join(wurzel, rel), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n').filter(z => !z.trim().startsWith('//')).join('\n');
}

ServiceManager.register('Logger', { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, success: () => {} });
ServiceManager.register('dbService', { async query() { return []; } });

const { VerbindungsRegistry } = require('dunebot-sdk');

(async () => {

console.log('\nDie Zusage ist angemeldet und als Anlagen-Sache erkennbar');
{
    VerbindungsRegistry.register('pruefanbieter', {
        label: 'Pruefanbieter',
        autorisierUrl: async () => 'https://example.invalid',
        identitaet: async () => ({}),
        tauschen: async () => ({}), erneuern: async () => ({}), pruefen: async () => ({}),
        zusagen: {
            fuermenschen: { label: 'Fuer Menschen', scopes: ['a'] },
            fuerdieanlage: { label: 'Fuer die Anlage', scopes: ['b'], nurAnlage: true }
        }
    });

    const a = VerbindungsRegistry.get('pruefanbieter');
    pruefe(a.zusagen.fuerdieanlage.nurAnlage === true,
        'die Registry merkt sich `nurAnlage`');
    pruefe(a.zusagen.fuermenschen.nurAnlage === false,
        'und setzt es sonst ausdruecklich auf false — nicht undefined',
        'sonst muesste jede Auswertung raten');
    pruefe(String(VerbindungsRegistry.scopesVon('pruefanbieter', 'fuerdieanlage')) === 'b',
        'die Scopes bleiben abrufbar — der Betreiber-Weg braucht sie');
}

console.log('\nKein Benutzerprofil bietet sie an');
{
    const { konten } = require('../apps/dashboard/routes/guild/profile.router');
    const liste = await konten('4711');
    const p = liste.find(x => x.name === 'pruefanbieter');

    pruefe(Boolean(p), 'der Anbieter steht im Profil');
    const namen = (p?.zusagen || []).map(z => z.name);
    pruefe(!namen.includes('fuerdieanlage'),
        'die Anlagen-Zusage taucht NICHT im Profil auf', namen.join(', ') || '(keine)');
    pruefe(namen.includes('fuermenschen'),
        'die gewoehnliche schon — es wird gefiltert, nicht abgeschaltet');
}

console.log('\nDer Betreiber erreicht sie — der ganze Weg');
{
    // **Der Fall vom 2026-08-26.** Jedes Glied einzeln geprueft: Ohne eines
    // davon ist alles andere gebaut und unbenutzbar.
    const sidebar = code('apps/dashboard/themes/default/partials/guild/sidebar.ejs');
    pruefe(sidebar.includes("/admin/anlagenkonten"),
        'die Seite steht in der Admin-Navigation',
        'sonst ist sie gebaut und niemand findet sie');

    const adminRouter = code('apps/dashboard/routes/admin.router.js');
    pruefe(/router\.use\(\s*'\/anlagenkonten'/.test(adminRouter),
        'der Router ist unter /admin eingehaengt');

    const seite = path.join(wurzel, 'apps/dashboard/themes/default/views/admin/anlagenkonten.ejs');
    pruefe(fs.existsSync(seite), 'die Ansicht existiert',
        'eine Route auf eine fehlende Ansicht ist ein 500er, kein leerer Bereich');

    const ansicht = fs.readFileSync(seite, 'utf8');
    pruefe(/ziel=anlage/.test(ansicht),
        'der Knopf fuehrt in den Anlagen-Zweig (`ziel=anlage`)',
        'ohne das legte die Zustimmung ein Benutzerkonto an');
    pruefe(/zusage=<%=\s*k\.zweck\s*%>/.test(ansicht),
        'und nennt den Zweck, statt ihn zu raten');

    // Die Ansicht muss den Teil aussprechen, den wir NICHT erledigen.
    pruefe(/\/mod/.test(ansicht),
        'die Seite sagt, dass der Kanalinhaber den Bot noch zum Moderator machen muss',
        'Twitch: "either channel:bot scope from broadcaster or moderator status"');
}

console.log('\nDer Anlagen-Zweig ist nicht erschleichbar');
{
    const { stateZerlegen } = require('../apps/dashboard/routes/verbindungen.router');

    pruefe(stateZerlegen('abc.chatbot.anlage').ziel === 'anlage',
        'der gewollte Fall wird erkannt');
    pruefe(stateZerlegen('abc.chatbot').ziel === 'benutzer',
        'ohne Angabe gilt "benutzer"');
    pruefe(stateZerlegen('abc').ziel === 'benutzer',
        'ein alter `state` ohne Punkte ebenso');
    pruefe(stateZerlegen('abc.chatbot.Anlage').ziel === 'benutzer',
        'Grossschreibung zaehlt nicht als Treffer');
    pruefe(stateZerlegen('abc.chatbot.betreiber').ziel === 'benutzer',
        'und ein erfundenes Ziel faellt auf "benutzer" zurueck',
        'im Zweifel der Zweig mit den wenigeren Rechten');
    pruefe(stateZerlegen(null).ziel === 'benutzer', 'auch ohne `state`');

    // **Beide Routen einzeln, nicht gezaehlt.** Die erste Fassung dieser Regel
    // zaehlte `istAdmin(req)` im ganzen Quelltext und verlangte mindestens
    // zwei — die Funktionsdefinition zaehlte mit, und das Entfernen der
    // Pruefung im Rueckruf blieb gruen.
    const router = code('apps/dashboard/routes/verbindungen.router.js');

    const startBeginn = router.indexOf("const fuerAnlage = String(req.query.ziel");
    const startEnde = router.indexOf('let scopes = []', startBeginn);
    const startBlock = startBeginn > 0 ? router.slice(startBeginn, startEnde) : '';
    pruefe(/await istAdmin\(req\)/.test(startBlock),
        'die Startroute prueft SYSTEM.ACCESS, bevor sie den Anlagen-Weg oeffnet');

    const rueckBeginn = router.indexOf("if (ziel === 'anlage')");
    const rueckEnde = router.indexOf('INSERT INTO user_connections', rueckBeginn);
    const rueckBlock = rueckBeginn > 0 ? router.slice(rueckBeginn, rueckEnde) : '';
    pruefe(/await istAdmin\(req\)/.test(rueckBlock),
        'und der Rueckruf prueft es NOCH EINMAL',
        'er ist eine eigene Anfrage, und ein `state` laesst sich abschreiben');

    pruefe(/hasSystemPermission/.test(router),
        'und zwar ueber `hasSystemPermission`, nicht ueber eine eigene Liste');
}

console.log('\nDie stuendliche Pflichtpruefung erreicht beide Arten');
{
    const speicher = code('apps/dashboard/helpers/Verbindungsspeicher.js');

    // **Nur der Rumpf von `pruefen()`.** Die erste Fassung suchte im ganzen
    // Quelltext — und `betreiberZusageLesen` enthaelt dasselbe `FROM`, also
    // blieb die Regel gruen, auch wenn die Pflichtpruefung gar nicht mehr
    // hinsah.
    const pBeginn = speicher.indexOf('async function pruefen()');
    const pEnde = speicher.indexOf('function starten()', pBeginn);
    const pruefRumpf = pBeginn > 0 ? speicher.slice(pBeginn, pEnde) : '';

    pruefe(pruefRumpf.length > 0, 'der Rumpf von `pruefen()` ist auffindbar');
    pruefe(/FROM betreiber_zusagen/.test(pruefRumpf),
        '`pruefen()` liest auch die Zusagen der Anlage',
        'Twitchs Auflage gilt fuer jeden Nutzer-Token');
    pruefe(/'betreiber_zusagen' AS tabelle/.test(pruefRumpf),
        'und merkt sich, wohin ein Vermerk gehoert');
    pruefe(/FROM user_connection_grants/.test(pruefRumpf),
        'die Benutzer-Zusagen bleiben dabei drin',
        'sonst haette der Umbau die eine Pflicht gegen die andere getauscht');

    const v = require('../apps/dashboard/helpers/Verbindungsspeicher');
    for (const name of ['betreiberZusageLesen', 'betreiberZusageSpeichern',
                        'mitBetreiberZugang', 'betreiberWiderrufen']) {
        pruefe(typeof v[name] === 'function', `\`${name}\` ist ausgefuehrt`);
    }

    // **Kein zweiter Weg an den Schluessel.** Dieselbe Zusage wie bei den
    // Benutzer-Token: Es gibt genau eine Tuer, und die heisst `mitBetreiberZugang`.
    pruefe(!/betreiberZugangHolen|anlagenZugang\s*=/.test(speicher),
        'es gibt keine Abkuerzung am `mitBetreiberZugang` vorbei');
}

console.log('\nDas Bot-Konto landet nicht in `user_connections`');
{
    const router = code('apps/dashboard/routes/verbindungen.router.js');
    const beginn = router.indexOf("if (ziel === 'anlage')");
    const benutzerZweig = router.indexOf('INSERT INTO user_connections');

    pruefe(beginn > 0 && benutzerZweig > 0, 'beide Zweige sind im Quelltext auffindbar');

    // **Die Abgrenzung ist der Benutzer-Zweig selbst**, nicht das erste
    // `return`. Davon gibt es im Anlagen-Zweig mehrere (fehlendes Recht,
    // fehlender Schluessel) — die erste Fassung dieser Regel schnitt genau
    // dort ab und meldete faelschlich, es werde nichts gespeichert.
    const anlageZweig = router.slice(beginn, benutzerZweig);

    pruefe(!/INSERT INTO user_connections/.test(anlageZweig),
        'der Anlagen-Zweig schreibt keinen Benutzer-Nachweis',
        'er waere unwahr — und `uniq_benutzer_plattform` wiese ihn ab');
    pruefe(/betreiberZusageSpeichern/.test(anlageZweig),
        'sondern legt eine Zusage der Anlage an');
    pruefe(beginn < benutzerZweig,
        'und zwar BEVOR der Benutzer-Zweig ueberhaupt erreicht wird',
        'sonst liefe die Anmeldung erst durch die falsche Tabelle');
    pruefe(/return res\.redirect/.test(anlageZweig),
        'und der Zweig endet mit einem eigenen `return`',
        'ohne das fiele er in den Benutzer-Zweig durch');
}

console.log(abweichungen === 0
    ? `\nErgebnis: ${faelle} Pruefungen, 0 Abweichungen.\n`
    : `\nErgebnis: ${faelle} Pruefungen, ${abweichungen} Abweichung(en).\n`);

process.exit(abweichungen === 0 ? 0 : 1);

})().catch(err => { console.error('\nAbbruch:', err.message, '\n', err.stack); process.exit(1); });
