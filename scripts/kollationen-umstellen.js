#!/usr/bin/env node
/**
 * Stellt die Guild-Spalten auf die Kollation von `guilds._id` um.
 *
 * ## Der Befund (Baustelle 88, gemessen 2026-08-29)
 *
 * `guilds._id` ist `utf8mb4_unicode_ci`, elf Spalten in vier Bereichen sind
 * `utf8mb4_general_ci`. Beide tragen dieselbe Discord-Kennung aus Ziffern —
 * MySQL vergleicht sie trotzdem nicht, sondern WIRFT:
 *
 *     Illegal mix of collations … for operation '='
 *
 * Das ist der einzige gute Teil daran: Es antwortet nicht still falsch.
 *
 * ## Warum alle auf einmal
 *
 * Eine halbe Umstellung erzeugt NEUE Mischungen: `streaming_targets.guild_id`
 * wird nicht nur mit `guilds._id` verglichen, sondern auch mit
 * `streaming_outbox.guild_id`. Also alle oder keine. Entschieden am 2026-08-31.
 *
 * ## Aufruf
 *
 *   node scripts/kollationen-umstellen.js              Probelauf (aendert NICHTS)
 *   node scripts/kollationen-umstellen.js --tun        fuehrt aus
 *   node scripts/kollationen-umstellen.js --zurueck    nimmt zurueck
 *
 * Der Probelauf ist die Vorgabe. Wer nichts angibt, aendert nichts.
 *
 * ## Was vor dem `--tun` zu tun ist
 *
 * **Eine Sicherung der Datenbank.** `ALTER TABLE … MODIFY` schreibt die Tabelle
 * neu; es gibt kein Zurueck ausser dem umgekehrten ALTER, und der stellt die
 * Kollation wieder her, nicht verlorene Daten. `--zurueck` genuegt fuer den
 * Fall „es passt uns nicht", nicht fuer den Fall „es ist etwas kaputtgegangen".
 *
 * ## Was das Skript NICHT tut
 *
 * Es fasst keine Spalte an, die es nicht gemessen hat. Die Liste entsteht bei
 * JEDEM Lauf aus `information_schema` — eine abgeschriebene Liste waere ab dem
 * ersten Schema-Zusatz eine zweite Wahrheit.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const WURZEL = path.join(__dirname, '..');
require(path.join(WURZEL, 'node_modules/dotenv')).config({
    path: path.join(WURZEL, 'apps/dashboard/.env')
});
const mysql = require(path.join(WURZEL, 'node_modules/mysql2/promise'));

const TUN     = process.argv.includes('--tun');
const ZURUECK = process.argv.includes('--zurueck');
const NOTIZ   = path.join(WURZEL, 'docs/audit/kollationen-vorher.json');

if (TUN && ZURUECK) {
    console.error('--tun und --zurueck zugleich ergibt keinen Sinn.');
    process.exit(2);
}

/**
 * Baut die MODIFY-Klausel aus dem GEMESSENEN Bestand der Spalte.
 *
 * ── Die Falle, gegen die das hier so ausfuehrlich ist ────────────────────────
 *
 * `ALTER TABLE t MODIFY spalte VARCHAR(32) COLLATE utf8mb4_unicode_ci` ist eine
 * VOLLSTAENDIGE Neudefinition. Was man weglaesst, ist danach weg: NOT NULL, der
 * Vorgabewert, der Kommentar, AUTO_INCREMENT. Nichts davon meldet einen Fehler
 * — die Spalte ist danach einfach anders, und es faellt beim ersten INSERT auf,
 * der die Vorgabe gebraucht haette.
 *
 * Deshalb wird jede Eigenschaft aus information_schema uebernommen und nicht
 * angenommen.
 */
function modifyKlausel(s, kollation) {
    const teile = [`\`${s.COLUMN_NAME}\``, s.COLUMN_TYPE];

    // Zeichensatz nennen, nicht nur die Kollation: Eine Kollation ohne
    // passenden Zeichensatz weist MySQL ab.
    teile.push(`CHARACTER SET ${s.CHARACTER_SET_NAME} COLLATE ${kollation}`);

    teile.push(s.IS_NULLABLE === 'YES' ? 'NULL' : 'NOT NULL');

    if (s.COLUMN_DEFAULT !== null && s.COLUMN_DEFAULT !== undefined) {
        // CURRENT_TIMESTAMP und Konsorten stehen ohne Anfuehrungszeichen da;
        // ein Text-Vorgabewert braucht sie. information_schema liefert beides
        // als Zeichenkette, unterscheidbar nur an der Form.
        const roh = String(s.COLUMN_DEFAULT);
        const funktion = /^(CURRENT_TIMESTAMP|NULL|\(.*\))$/i.test(roh);
        teile.push(`DEFAULT ${funktion ? roh : `'${roh.replace(/'/g, "''")}'`}`);
    } else if (s.IS_NULLABLE === 'YES') {
        teile.push('DEFAULT NULL');
    }

    if (s.EXTRA && !/DEFAULT_GENERATED/i.test(s.EXTRA)) teile.push(s.EXTRA);
    if (s.COLUMN_COMMENT) teile.push(`COMMENT '${s.COLUMN_COMMENT.replace(/'/g, "''")}'`);

    return `ALTER TABLE \`${s.TABLE_NAME}\` MODIFY ${teile.join(' ')}`;
}

(async () => {
    let db;
    try {
        db = await mysql.createConnection({
            host: process.env.MYSQL_HOST,
            user: process.env.MYSQL_USER,
            password: process.env.MYSQL_PASSWORD,
            database: process.env.MYSQL_DATABASE,
            port: process.env.MYSQL_PORT || 3306,
        });
    } catch (err) {
        // Kein stiller Rueckfall: Wer nicht messen konnte, weiss nichts.
        console.error(`\nDie Datenbank ist nicht erreichbar: ${err.message}\n`);
        process.exit(2);
    }

    const [[massgeblich]] = await db.query(`
        SELECT COLLATION_NAME FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'guilds' AND COLUMN_NAME = '_id'`);
    const soll = massgeblich?.COLLATION_NAME;
    if (!soll) {
        console.error('\n`guilds._id` gibt es nicht — dann ist hier nichts umzustellen.\n');
        process.exit(2);
    }

    const [alle] = await db.query(`
        SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, CHARACTER_SET_NAME, COLLATION_NAME,
               IS_NULLABLE, COLUMN_DEFAULT, EXTRA, COLUMN_COMMENT
          FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND COLLATION_NAME IS NOT NULL
           AND COLUMN_NAME LIKE '%guild_id'
         ORDER BY TABLE_NAME, COLUMN_NAME`);

    // ── Rueckwaerts: der gemessene Zustand VOR dem Eingriff ──────────────────
    let vorher = null;
    if (ZURUECK) {
        if (!fs.existsSync(NOTIZ)) {
            console.error(`\nEs gibt keine Notiz unter ${path.relative(WURZEL, NOTIZ)} —`);
            console.error('dann wurde hier nie etwas umgestellt, und es gibt nichts zurueckzunehmen.\n');
            process.exit(2);
        }
        vorher = JSON.parse(fs.readFileSync(NOTIZ, 'utf8'));
    }

    const betroffen = ZURUECK
        ? alle.filter(s => vorher.spalten[`${s.TABLE_NAME}.${s.COLUMN_NAME}`])
        : alle.filter(s => s.COLLATION_NAME !== soll);

    console.log(`\nMassgeblich ist \`guilds._id\` (${soll}).`);
    console.log(`${alle.length} Spalten tragen eine Guild-Kennung, ${betroffen.length} sind ${ZURUECK ? 'zurueckzunehmen' : 'umzustellen'}.\n`);

    if (!betroffen.length) {
        console.log('Nichts zu tun.\n');
        await db.end();
        return;
    }

    // ── Fremdschluessel ─────────────────────────────────────────────────────
    //
    // MySQL weist ein MODIFY der Kollation ab, solange ein Fremdschluessel auf
    // der Spalte haengt: „Cannot change column … used in a foreign key
    // constraint". Er muss also fallen und danach wieder entstehen.
    //
    // Beim Probelauf am 2026-08-31 war es genau einer — und BEIDE Seiten
    // (music_queue.guild_id und music_sessions.guild_id) stehen ohnehin auf der
    // Umstellungsliste. Das ist der einfache Fall; deshalb wird er auch nur
    // dafuer gebaut: Beruehrt ein Fremdschluessel eine Spalte, die NICHT
    // umgestellt wird, bricht das Skript ab, statt zu raten.
    const betroffeneSpalten = new Set(betroffen.map(s => `${s.TABLE_NAME}.${s.COLUMN_NAME}`));
    const [fkSpalten] = await db.query(`
        SELECT k.CONSTRAINT_NAME, k.TABLE_NAME, k.COLUMN_NAME, k.ORDINAL_POSITION,
               k.REFERENCED_TABLE_NAME, k.REFERENCED_COLUMN_NAME,
               r.UPDATE_RULE, r.DELETE_RULE
          FROM information_schema.KEY_COLUMN_USAGE k
          JOIN information_schema.REFERENTIAL_CONSTRAINTS r
            ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA
           AND r.CONSTRAINT_NAME   = k.CONSTRAINT_NAME
         WHERE k.TABLE_SCHEMA = DATABASE()
           AND k.REFERENCED_TABLE_NAME IS NOT NULL
         ORDER BY k.CONSTRAINT_NAME, k.ORDINAL_POSITION`);

    // Nach Fremdschluessel buendeln — er kann ueber mehrere Spalten gehen.
    const fks = new Map();
    for (const z of fkSpalten) {
        if (!fks.has(z.CONSTRAINT_NAME)) {
            fks.set(z.CONSTRAINT_NAME, {
                name: z.CONSTRAINT_NAME, tabelle: z.TABLE_NAME, ziel: z.REFERENCED_TABLE_NAME,
                spalten: [], zielSpalten: [], update: z.UPDATE_RULE, delete: z.DELETE_RULE,
            });
        }
        const f = fks.get(z.CONSTRAINT_NAME);
        f.spalten.push(z.COLUMN_NAME);
        f.zielSpalten.push(z.REFERENCED_COLUMN_NAME);
    }

    const beruehrt = [...fks.values()].filter(f =>
        f.spalten.some((c, i) =>
            betroffeneSpalten.has(`${f.tabelle}.${c}`)
            || betroffeneSpalten.has(`${f.ziel}.${f.zielSpalten[i]}`)));

    const halbe = beruehrt.filter(f =>
        f.spalten.some((c, i) =>
            betroffeneSpalten.has(`${f.tabelle}.${c}`)
            !== betroffeneSpalten.has(`${f.ziel}.${f.zielSpalten[i]}`)));

    const fkWeg = (f) => `ALTER TABLE \`${f.tabelle}\` DROP FOREIGN KEY \`${f.name}\``;
    const fkHer = (f) =>
        `ALTER TABLE \`${f.tabelle}\` ADD CONSTRAINT \`${f.name}\` FOREIGN KEY `
        + `(${f.spalten.map(c => `\`${c}\``).join(', ')}) REFERENCES \`${f.ziel}\` `
        + `(${f.zielSpalten.map(c => `\`${c}\``).join(', ')}) `
        + `ON DELETE ${f.delete} ON UPDATE ${f.update}`;

    if (beruehrt.length) {
        console.log(`${beruehrt.length} Fremdschluessel haengen an diesen Spalten und werden mitgefuehrt:`);
        beruehrt.forEach(f => console.log(`  · ${f.name}: ${f.tabelle}.${f.spalten.join(',')} → ${f.ziel}.${f.zielSpalten.join(',')} (ON DELETE ${f.delete}, ON UPDATE ${f.update})`));
        console.log('');
    }

    if (halbe.length) {
        // Eine Seite umstellen und die andere stehen lassen ergaebe einen
        // Fremdschluessel zwischen zwei Kollationen — MySQL nimmt ihn nicht
        // wieder an, und der Bestand bliebe ohne ihn zurueck.
        console.error('Diese Fremdschluessel verbinden eine umgestellte mit einer NICHT umgestellten Spalte:');
        halbe.forEach(f => console.error(`  ✘ ${f.name}: ${f.tabelle}.${f.spalten.join(',')} → ${f.ziel}.${f.zielSpalten.join(',')}`));
        console.error('Das laesst sich nicht zusammensetzen. Erst entscheiden, was mit der anderen Seite geschieht.\n');
        await db.end();
        process.exit(1);
    }

    const zielKollation = (s) => ZURUECK ? vorher.spalten[`${s.TABLE_NAME}.${s.COLUMN_NAME}`] : soll;

    // ── Was es kostet ───────────────────────────────────────────────────────
    console.log('Zeilen je Tabelle (geschaetzt aus information_schema, nicht gezaehlt):');
    const tabellen = [...new Set(betroffen.map(s => s.TABLE_NAME))];
    const [groessen] = await db.query(`
        SELECT TABLE_NAME, TABLE_ROWS, DATA_LENGTH + INDEX_LENGTH AS BYTES
          FROM information_schema.TABLES
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (${tabellen.map(t => `'${t}'`).join(',')})`);
    for (const g of groessen) {
        console.log(`  · ${g.TABLE_NAME.padEnd(30)} ~${String(g.TABLE_ROWS).padStart(8)} Zeilen  ${(Number(g.BYTES) / 1024).toFixed(0)} KiB`);
    }

    // Die Reihenfolge ist die Sache: erst loesen, dann umstellen, dann wieder
    // festmachen. Andersherum weist MySQL den ersten Schritt ab.
    const befehle = [
        ...beruehrt.map(fkWeg),
        ...betroffen.map(s => modifyKlausel(s, zielKollation(s))),
        ...beruehrt.map(fkHer),
    ];

    console.log(`Die Anweisungen (${befehle.length}):\n`);
    befehle.forEach(b => console.log(`  ${b};`));

    if (!TUN && !ZURUECK) {
        console.log(`\nProbelauf — es wurde NICHTS geaendert.`);
        console.log(`Ausfuehren mit  node scripts/kollationen-umstellen.js --tun`);
        console.log(`(Vorher eine Sicherung der Datenbank ziehen.)\n`);
        await db.end();
        return;
    }

    // ── Der Eingriff ────────────────────────────────────────────────────────
    if (TUN) {
        // Den Zustand VOR dem Eingriff festhalten, sonst weiss --zurueck nicht,
        // wohin. Aus dem Gedaechtnis zuruecknehmen, nicht aus dem Ist-Zustand.
        fs.mkdirSync(path.dirname(NOTIZ), { recursive: true });
        fs.writeFileSync(NOTIZ, JSON.stringify({
            wann: new Date().toISOString(),
            soll,
            spalten: Object.fromEntries(betroffen.map(s => [`${s.TABLE_NAME}.${s.COLUMN_NAME}`, s.COLLATION_NAME])),
            fremdschluessel: beruehrt.map(f => f.name),
        }, null, 2));
        console.log(`\nZustand vorher notiert: ${path.relative(WURZEL, NOTIZ)}`);
    }

    console.log('');
    let getan = 0;
    for (const befehl of befehle) {
        const kurz = befehl.replace(/\s+/g, ' ').slice(0, 96);
        const start = Date.now();
        try {
            await db.query(befehl);
            getan++;
            console.log(`  ✓ ${kurz} (${Date.now() - start} ms)`);
        } catch (err) {
            // Weitermachen waere hier falsch: Wer mittendrin steht, hat genau die
            // halbe Umstellung, vor der die Entscheidung gewarnt hat. Und wenn es
            // beim Wiederanlegen der Fremdschluessel scheitert, steht der Bestand
            // OHNE sie da — das muss man erfahren, nicht suchen.
            console.error(`\n  ✘ ${kurz}`);
            console.error(`     ${err.message}`);
            console.error(`\nAbbruch nach ${getan} von ${befehle.length}. Der Bestand ist jetzt GEMISCHT.`);
            if (getan > beruehrt.length) {
                console.error(`Die Fremdschluessel (${beruehrt.map(f => f.name).join(', ')}) sind geloest und noch nicht wieder gesetzt.`);
            }
            console.error(`Zuruecknehmen mit  node scripts/kollationen-umstellen.js --zurueck\n`);
            await db.end();
            process.exit(1);
        }
    }

    console.log(`\n${betroffen.length} Spalten umgestellt, ${beruehrt.length} Fremdschluessel wieder gesetzt.`);
    console.log(`Gegenprobe:  node scripts/check-kollationen.js`);
    console.log(`Danach gehoert die BEKANNT-Liste in check-kollationen.js geleert.\n`);
    await db.end();
})().catch(err => {
    console.error('\nAbbruch:', err.message, '\n');
    process.exit(2);
});
