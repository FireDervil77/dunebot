#!/usr/bin/env node
/**
 * Prueft die Migrationen auf einen Fehler, der lautlos in beide Richtungen geht.
 *
 * ## Der Befund vom 2026-08-27
 *
 * `up(db)` bekommt den **DBService**, nicht eine rohe mysql2-Verbindung.
 * `db.query()` liefert die **Zeilen direkt**, gemessen:
 *
 *     Rueckgabe ist Array? true | Laenge: 2
 *     const [x] = r  = {"COLUMN_NAME":"name_translation_key", …} | Array? false
 *
 * Trotzdem steht in fuenfzehn Migrationen `const [vorhanden] = await db.query(…)`
 * — das greift die **erste Zeile** statt der Liste. Danach ist jede Pruefung
 * daran falsch, und zwar je nach Schreibweise in eine andere Richtung:
 *
 *     if (!vorhanden.length)          → undefined, falsy  → legt an  (harmlos)
 *     if (vorhanden.length === 0)     → undefined !== 0   → tut NICHTS (schlimm)
 *     Number(vorhanden || 0)          → NaN, falsy        → legt an  (harmlos)
 *
 * Deshalb ist es nie aufgefallen: Der Irrtum schlug fast immer in Richtung
 * "anlegen" aus, und das Ergebnis stimmte zufaellig. Am 2026-08-27 schlug er
 * bei `20260827_170000_rechtetexte_breiter.js` in die andere Richtung aus —
 * die Migration meldete Erfolg und aenderte nichts.
 *
 * **Und es gibt einen zweiten Fall.** Liefert die Abfrage gar keine Zeile, ist
 * `vorhanden` schlicht `undefined`, und `vorhanden.length` wirft. Auf einer
 * frischen Datenbank — also genau beim Aufsetzen eines zweiten Systems —
 * stuerzt so eine Migration ab.
 *
 * Nebenwirkungsfrei: liest nur Dateien.
 *
 *   node scripts/check-migrationen.js
 *
 * Exitcode 1 bei jeder Abweichung.
 */
'use strict';

const fs = require('fs');
const path = require('path');

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
 * Der eingefrorene Altbestand — **bewusst nicht repariert**.
 *
 * Diese Migrationen sind ausgefuehrt. Sie jetzt umzuschreiben wuerde ihre
 * Pruefsumme aendern, und der Runner meldete bei jedem Lauf
 * *"bereits ausgefuehrte Migration wurde nachtraeglich veraendert"* — 22-mal.
 * Eine Warnung, die immer erscheint, wird weggeklickt; sie ist dann genau dann
 * wertlos, wenn eine Datenbank wirklich auseinanderdriftet (Baustelle 80).
 *
 * Der Irrtum schlaegt in diesen Dateien ausserdem in Richtung "anlegen" aus —
 * ihr Ergebnis stimmt, nur die Begruendung nicht. Fasst jemand eine davon
 * ohnehin an, gehoert sie aus dieser Liste heraus und richtiggestellt.
 *
 * **Neue Migrationen fallen nicht darunter.** Genau dafuer gibt es die Liste:
 * Der Bestand bleibt stehen, der Fehler kommt nicht zurueck.
 *
 * Stand: 2026-08-27. Aufraeumen steht als Baustelle 81 in `docs/Baustellen.md`.
 */
const ALTBESTAND_ZERLEGUNG = new Set([
    '20260101_000001_verification_invite_tracking.js',
    '20260326_134947_add_addons_frontpage_section.js',
    '20260327_111415_upgrade_notifications_multilang_delivery.js',
    '20260730_154500_gameserver_panel_push_seq.js',
    '20260730_173000_gameserver_panel_show_refresh.js',
    '20260731_130000_flatten_group_permissions.js',
    '20260731_150000_public_status_token.js',
    '20260731_180000_feedback_guild_only.js',
    '20260801_120000_drop_rootserver_status.js',
    '20260802_101500_ressourcen_eine_wahrheit.js',
    '20260802_141500_daemon_instances_entfernen.js',
    '20260803_190000_widget_breite.js',
    '20260804_221500_sftp_fingerabdruck.js',
    '20260805_113000_sftp_passwort_hash.js',
    '20260805_140000_sftp_port_je_rootserver.js',
    '20260809_230000_kanalausnahmen_zusammenlegen.js',
    '20260810_100000_rollenmenues.js',
    '20260816_120000_paket_tabellen.js',
    '20260816_121000_sicherungen_paketkennung.js',
    '20260816_122000_server_kennzahlen.js',
    '20260818_140000_pakete_ohne_sichtbarkeit.js',
    '20260826_200000_abonnenten.js'
]);

/** Dieselbe Begruendung, fuer die fehlende `description`. */
const ALTBESTAND_OHNE_TEXT = new Set([
    '20260405_120000_create_blog_posts_table.js',
    '20260411_120000_reaction_roles_and_improvements.js',
    '20260810_210000_cronjob_uebersprungen_und_backup_aufbewahrung.js',
    '20260810_223000_speichergrenze_erzwungen.js',
    '20260810_233000_aufbewahrung_in_die_einstellungen.js',
    '20260810_235000_sftp_passwort_gesehen.js',
    '20260811_120000_ark_leere_modliste.js',
    '20260811_180000_grundlautheit.js',
    '20260819_170000_serverseite_zustand.js',
    '20260819_190000_navigation_zusammenlegen.js'
]);

/**
 * Alle Migrationsdateien im Haus.
 *
 * Drei Orte, und `migrations/kern` ist **aktiv**, nicht Legacy.
 *
 * @returns {Array<string>} Pfade
 */
function migrationenSammeln() {
    const orte = [path.join(wurzel, 'migrations')];
    const pluginVerz = path.join(wurzel, 'plugins');
    if (fs.existsSync(pluginVerz)) {
        for (const e of fs.readdirSync(pluginVerz, { withFileTypes: true })) {
            if (!e.isDirectory()) continue;
            const m = path.join(pluginVerz, e.name, 'migrations');
            if (fs.existsSync(m)) orte.push(m);
        }
    }

    const dateien = [];
    const sammle = (verz) => {
        for (const e of fs.readdirSync(verz, { withFileTypes: true })) {
            const voll = path.join(verz, e.name);
            if (e.isDirectory()) sammle(voll);
            else if (e.name.endsWith('.js')) dateien.push(voll);
        }
    };
    for (const o of orte) if (fs.existsSync(o)) sammle(o);
    return dateien;
}

/**
 * Kommentare entfernen — sonst schlaegt die Regel auf ihre eigene Erklaerung an.
 *
 * Dieser Fehler ist im Haus schon zweimal passiert (Schichtenwaechter und
 * Stromwaechter, beide am 2026-08-25).
 *
 * @param {string} roh Dateiinhalt
 * @returns {string} Code ohne Kommentare
 */
function ohneKommentare(roh) {
    return roh.replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n').filter(z => !z.trim().startsWith('//')).join('\n');
}

const dateien = migrationenSammeln();

console.log(`\nGefunden: ${dateien.length} Migrationen`);

console.log('\nNiemand zerlegt die Antwort von `db.query` wie eine mysql2-Antwort');
{
    const treffer = [];
    for (const datei of dateien) {
        const code = ohneKommentare(fs.readFileSync(datei, 'utf8'));
        // `const [x] = await db.query(...)` — die Form, die die erste Zeile
        // greift statt der Liste.
        if (ALTBESTAND_ZERLEGUNG.has(path.basename(datei))) continue;
        for (const m of code.matchAll(/const\s*\[\s*[\w$]+\s*\]\s*=\s*await\s+db\s*\.\s*query\s*\(/g)) {
            const zeile = code.slice(0, m.index).split('\n').length;
            treffer.push(`${path.relative(wurzel, datei)}:${zeile}`);
        }
    }

    pruefe(treffer.length === 0,
        '`db.query` liefert die Zeilen direkt — keine Zerlegung als [rows, fields]',
        treffer.length ? `${treffer.length} Stelle(n): ${treffer.slice(0, 4).join(', ')}${treffer.length > 4 ? ' …' : ''}`
                       : `${dateien.length - ALTBESTAND_ZERLEGUNG.size} neue Dateien durchgesehen, `
                       + `${ALTBESTAND_ZERLEGUNG.size} Altbestand eingefroren`);
}

console.log('\nJede Migration hat up und beschreibt sich');
{
    const ohneUp = [];
    const ohneText = [];
    for (const datei of dateien) {
        let m;
        try {
            delete require.cache[require.resolve(datei)];
            m = require(datei);
        } catch (err) {
            ohneUp.push(`${path.basename(datei)} (laedt nicht: ${err.message})`);
            continue;
        }
        if (typeof m.up !== 'function') ohneUp.push(path.basename(datei));
        if (!m.description && !ALTBESTAND_OHNE_TEXT.has(path.basename(datei))) ohneText.push(path.basename(datei));
    }

    pruefe(ohneUp.length === 0, 'jede Migration laedt und hat ein `up`',
        ohneUp.length ? ohneUp.join(', ') : `${dateien.length} geprueft`);
    pruefe(ohneText.length === 0, 'jede Migration hat eine `description`',
        ohneText.length ? ohneText.slice(0, 5).join(', ') : 'alle');
}

console.log('\nDer eingefrorene Altbestand ist noch da');
{
    // Eine Freistellungsliste, die auf geloeschte Dateien zeigt, waechst still
    // zu und stellt irgendwann etwas frei, das es gar nicht mehr gibt.
    const namen = new Set(dateien.map(d => path.basename(d)));
    const verwaist = [...ALTBESTAND_ZERLEGUNG, ...ALTBESTAND_OHNE_TEXT].filter(n => !namen.has(n));
    pruefe(verwaist.length === 0,
        'jeder Eintrag der Freistellungsliste zeigt auf eine vorhandene Datei',
        verwaist.length ? verwaist.join(', ') : `${ALTBESTAND_ZERLEGUNG.size + ALTBESTAND_OHNE_TEXT.size} Eintraege`);

    // Und: Wer eine Altdatei repariert, soll sie aus der Liste nehmen duerfen —
    // aber es soll auffallen, wenn sie noch drinsteht, obwohl sie sauber ist.
    const unnoetig = [...ALTBESTAND_ZERLEGUNG].filter(n => {
        const d = dateien.find(x => path.basename(x) === n);
        if (!d) return false;
        return !/const\s*\[\s*[\w$]+\s*\]\s*=\s*await\s+db\s*\.\s*query\s*\(/
            .test(ohneKommentare(fs.readFileSync(d, 'utf8')));
    });
    pruefe(unnoetig.length === 0,
        'keine reparierte Datei steht noch auf der Freistellungsliste',
        unnoetig.length ? `raus damit: ${unnoetig.join(', ')}` : 'alle noch noetig');
}

console.log('\nKeine zwei Migrationen tragen denselben Namen');
{
    // Der Runner merkt sich `filename` je scope/source. Zwei gleiche Namen in
    // verschiedenen Plugins sind erlaubt; zwei im selben Ordner waeren ein
    // Versehen, das der Dateibaum schon verhindert. Geprueft wird deshalb der
    // Zeitstempel: Zwei Migrationen mit derselben Sekunde laufen in nicht
    // festgelegter Reihenfolge.
    const nachOrt = new Map();
    for (const datei of dateien) {
        const ort = path.dirname(datei);
        const stempel = path.basename(datei).slice(0, 15);
        const schluessel = `${ort}|${stempel}`;
        nachOrt.set(schluessel, (nachOrt.get(schluessel) || 0) + 1);
    }
    const doppelt = [...nachOrt.entries()].filter(([, n]) => n > 1)
        .map(([k]) => k.split('|')[1]);

    pruefe(doppelt.length === 0, 'kein Zeitstempel kommt zweimal im selben Ordner vor',
        doppelt.length ? doppelt.join(', ') : 'alle eindeutig');
}

console.log(abweichungen === 0
    ? `\nErgebnis: ${faelle} Pruefungen, 0 Abweichungen.\n`
    : `\nErgebnis: ${faelle} Pruefungen, ${abweichungen} Abweichung(en).\n`);

process.exit(abweichungen === 0 ? 0 : 1);
