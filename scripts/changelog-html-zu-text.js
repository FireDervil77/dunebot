#!/usr/bin/env node
/**
 * Wandelt Changelog-Änderungstexte von HTML zurück in das Reintext-Format.
 *
 * Hintergrund: Die Änderungsfelder tragen eine zeilenbasierte Sprache
 * (`# Gruppe`, `## Untergruppe`, `! + - *`). Der WYSIWYG-Editor hat daraus HTML
 * gemacht – `<h1># FireNetworks</h1>`, mehrere Einträge in einem `<p>` mit
 * `<br>`, Umlaute als Entities. Seit dem Umbau laufen die Felder ohne Editor;
 * dieses Skript bringt den Bestand auf dasselbe Format.
 *
 * Was es NICHT kann: die zweistufige Hierarchie wiederherstellen. Der Editor hat
 * alles auf eine Ebene gezogen, und ob ein `<h2>` als Haupt- oder Untergruppe
 * gemeint war, steht nirgends. Alle Überschriften werden deshalb zu `##`
 * (Untergruppe) außer der ersten je Changelog – die Zuordnung muss von Hand
 * nachgezogen werden. Das Skript sagt, wo.
 *
 *   node scripts/changelog-html-zu-text.js            # Trockenlauf
 *   node scripts/changelog-html-zu-text.js --apply    # schreibt
 */

'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../apps/dashboard/.env') });
const mysql = require('mysql2/promise');

const SCHREIBEN = process.argv.includes('--apply');

/**
 * Heuristik fuer Altdaten, deren Zeilenumbrueche bereits in der Datenbank
 * verloren sind (Changelog 1-4: alles in einem <p>, ohne <br>). Bricht vor
 * Markern um, die mitten im Fliesstext stehen.
 *
 * Bewusst hinter einem eigenen Schalter: Ein Bindestrich in "Client - Server"
 * wuerde faelschlich zu einem Eintrag. Bei Texten, die ohnehin als ein Klumpen
 * dastehen, ist das der bessere Kompromiss - bei intakten Texten waere es
 * Vandalismus.
 */
const HEURISTIK = process.argv.includes('--split');

/** Entities, die TinyMCE erzeugt. */
const ENTITIES = {
    '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'",
    '&uuml;': 'ü', '&ouml;': 'ö', '&auml;': 'ä', '&Uuml;': 'Ü', '&Ouml;': 'Ö',
    '&Auml;': 'Ä', '&szlig;': 'ß', '&eacute;': 'é', '&ndash;': '–', '&mdash;': '—',
};

/**
 * HTML → Reintext im erwarteten Changelog-Format.
 *
 * @param {string} html
 * @returns {string}
 */
function zuText(html) {
    if (!html) return '';
    let t = String(html);

    // Enthält gar kein HTML? Dann ist der Text schon im Zielformat.
    if (!/<[a-z][\s\S]*>/i.test(t)) return t.trim();

    t = t.replace(/<br\s*\/?>/gi, '\n');
    t = t.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    // Überschriften: doppelte Marker entfernen, sonst steht "# # Titel" da.
    const ohneMarker = (c) => String(c).replace(/^\s*#{1,3}\s*/, '').trim();
    t = t.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, (m, c) => `\n# ${ohneMarker(c)}\n`);
    t = t.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, (m, c) => `\n## ${ohneMarker(c)}\n`);
    t = t.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, (m, c) => `\n## ${ohneMarker(c)}\n`);

    t = t.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (m, c) => `\n* ${c.trim()}\n`);
    t = t.replace(/<\/p>/gi, '\n').replace(/<p[^>]*>/gi, '');

    // Restliche Auszeichnung entfernen – im Reintext-Format hat sie keine Wirkung.
    t = t.replace(/<[^>]+>/g, '');

    for (const [entity, zeichen] of Object.entries(ENTITIES)) {
        t = t.split(entity).join(zeichen);
    }

    let ergebnis = t
        .split('\n')
        .map(zeile => zeile.trim())
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();

    // Nur wenn ausdruecklich gewuenscht UND der Text ohnehin ein Klumpen ist.
    if (HEURISTIK && !ergebnis.includes('\n')) {
        ergebnis = ergebnis
            .replace(/\s+(#{1,2}\s)/g, '\n$1')
            .replace(/\s+([!+*-])\s+(?=[A-ZÄÖÜ])/g, '\n$1 ')
            .trim();
    }

    return ergebnis;
}

async function main() {
    const db = await mysql.createConnection({
        host:     process.env.MYSQL_HOST,
        port:     Number(process.env.MYSQL_PORT) || 3306,
        user:     process.env.MYSQL_USER,
        password: process.env.MYSQL_PASSWORD,
        database: process.env.MYSQL_DATABASE,
    });

    const rows = await db.query('SELECT id, version, changes_translations FROM changelogs ORDER BY id');
    const [changelogs] = Array.isArray(rows[0]) ? rows : [rows];

    console.log(SCHREIBEN ? '\nSCHREIBMODUS – Änderungen werden gespeichert\n'
                          : '\nTROCKENLAUF – es wird nichts geschrieben (--apply zum Schreiben)\n');

    let betroffen = 0;

    for (const changelog of changelogs) {
        let uebersetzungen;
        try { uebersetzungen = JSON.parse(changelog.changes_translations || '{}'); }
        catch (_) { console.log(`  Changelog ${changelog.id}: unlesbares JSON – übersprungen`); continue; }

        const neu = {};
        let geaendert = false;

        for (const [sprache, text] of Object.entries(uebersetzungen)) {
            const umgewandelt = zuText(text);
            neu[sprache] = umgewandelt;
            if (umgewandelt !== text) geaendert = true;
        }

        if (!geaendert) {
            console.log(`  Changelog ${changelog.id} (v${changelog.version}): bereits Reintext`);
            continue;
        }

        betroffen++;
        const de = neu['de-DE'] || '';
        const ueberschriften = de.split('\n').filter(z => z.startsWith('#'));

        console.log(`  Changelog ${changelog.id} (v${changelog.version}):`);
        console.log(`     ${String(uebersetzungen['de-DE'] || '').length} → ${de.length} Zeichen`);
        const zeilen = de.split('\n').length;
        console.log(`     ${zeilen} Zeile(n), ${ueberschriften.length} Überschrift(en)`);
        if (zeilen === 1) {
            console.log('     ⚠ nur eine Zeile – die Umbrüche fehlen schon in der Datenbank'
                + (HEURISTIK ? '' : ' (--split versucht eine Rekonstruktion)'));
        }
        de.split('\n').slice(0, 4).forEach(z => console.log(`       ${z.slice(0, 95)}${z.length > 95 ? ' …' : ''}`));

        if (SCHREIBEN) {
            await db.query('UPDATE changelogs SET changes_translations = ? WHERE id = ?',
                [JSON.stringify(neu), changelog.id]);
            console.log('     → gespeichert');
        }
        console.log('');
    }

    console.log(`${betroffen} Changelog(s) ${SCHREIBEN ? 'umgewandelt' : 'würden umgewandelt'}.`);
    if (betroffen && !SCHREIBEN) {
        console.log('Mit --apply ausführen, um zu schreiben.');
    }
    if (betroffen) {
        console.log('\nHinweis: Alle Überschriften stehen danach auf einer Ebene (# bzw. ##).');
        console.log('Welche davon Haupt- und welche Untergruppe sein soll, muss von Hand');
        console.log('nachgezogen werden – diese Angabe hat der Editor unwiederbringlich verloren.');
    }

    await db.end();
}

main().catch(err => {
    console.error('FEHLER:', err.message);
    process.exit(1);
});
