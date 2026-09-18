#!/usr/bin/env node
/**
 * Bleibt die Seitenleiste auf jeder Seite offen?
 *
 * ── Der Befund, der dazu fuehrte (2026-09-08) ───────────────────────────────
 *
 * Der Betreiber: „Wenn ich die dashboard route aufrufe schliesst sich die
 * navigation wieder. bei allen anderen plugins bleibt sie offen."
 *
 * `sidebar.ejs` vergleicht Zeichen fuer Zeichen:
 *
 *     _aktiv === eintrag.url || kinder.some(k => _aktiv === k.url)
 *
 * Kein Treffer heisst: kein Abschnitt offen, und die Karte bekommt kein `show`.
 *
 * **Ein Tippfehler faellt hier nie auf**, weil nichts kaputtgeht: Die Seite
 * laedt, nur die Leiste klappt zu. Genau dafuer ist dieses Skript da.
 *
 * ── Was die erste Fassung falsch gemessen hat (2026-09-18) ──────────────────
 *
 * Sie fragte: „Setzt diese Datei ein `activeMenu`, und trifft es?" Plugins ohne
 * ein einziges `activeMenu` standen als „nicht geprueft" darunter — woraus
 * gelesen wurde, dort klappe die Leiste zu. **Das stimmt nicht.**
 *
 * `base.middleware.js` setzt `res.locals.activeMenu = req.originalUrl`, und
 * `ThemeRenderer.renderView` legt `res.locals` unter die View-Daten. Eine Seite
 * OHNE eigenes `activeMenu` bekommt also ihre eigene Adresse — und trifft
 * damit genau dann, wenn diese Adresse selbst ein Menuepunkt ist. Das ist bei
 * den allermeisten Seiten so. Nachgemessen am 2026-09-18: von 71 Seiten traf
 * **eine** nicht.
 *
 * Gefragt wird deshalb jetzt pro SEITE, nicht pro Datei: Welche Adresse steht
 * am Ende in `activeMenu` — die gesetzte oder die der Route —, und steht die
 * in der Seitenleiste?
 *
 * Betroffen sind damit fast nur Seiten mit einem Platzhalter in der Adresse
 * (`/:menuId/bearbeiten`): Sie koennen nie einen Punkt treffen und brauchen
 * eine gesetzte Angabe.
 *
 * ── Warum die Punkte aus der DATENBANK kommen ───────────────────────────────
 *
 * Die erste Fassung las die angemeldeten Punkte aus dem Quelltext (`url:`).
 * `streaming` meldet seine Punkte ueber eine Hilfsfunktion an — `eintrag(titel,
 * url, ...)`, die Adresse steht als Argument, nie hinter `url:`. Der Quelltext
 * gab dort **null** Punkte her, ohne dass es auffiel: Ein Plugin ohne erkannte
 * Punkte sah aus wie ein Plugin ohne Navigation.
 *
 * `guild_nav_items` ist das, was die Seitenleiste wirklich rendert.
 *
 * ── Was es NICHT kann ───────────────────────────────────────────────────────
 *
 * Es liest Quelltext, keinen laufenden Router. Einhaengungen und Routen, die
 * sich zur Laufzeit ergeben, stehen mit Datei und Zeile als „nicht pruefbar" in
 * der Liste und zaehlen als Abweichung. Ein Waechter, der Unverstandenes still
 * ueberspringt, meldet gruen.
 *
 *   node scripts/check-navigation-treffer.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const WURZEL = path.join(__dirname, '..');
const PLUGINS = path.join(WURZEL, 'plugins');

require(path.join(WURZEL, 'node_modules/dotenv')).config({
    path: path.join(WURZEL, 'apps/dashboard/.env'),
    quiet: true
});
const mysql = require(path.join(WURZEL, 'node_modules/mysql2/promise'));

/**
 * Kommentare weg — sonst zaehlt eine Begruendung als Anmeldung.
 *
 * **Die Zeilenzahl bleibt gleich.** Ein Blockkommentar wird durch ebenso viele
 * Zeilenumbrueche ersetzt, nicht geloescht: Sonst zeigt jede gemeldete Zeile
 * hinter dem ersten `/* *\/` auf die falsche Stelle, und wer nachsieht, findet
 * dort etwas voellig anderes.
 */
function ohneKommentare(text) {
    return text
        .replace(/\/\*[\s\S]*?\*\//g, (treffer) => treffer.replace(/[^\n]/g, ''))
        .split('\n').map(z => z.replace(/(^|[^:])\/\/.*$/, '$1')).join('\n');
}

/** Die Zeichenketten-Konstanten einer Datei: `const x = '...'`. */
function konstantenLesen(quelle) {
    const karte = {};
    for (const t of quelle.matchAll(/\bconst\s+(\w+)\s*=\s*`([^`]*)`/g)) karte[t[1]] = t[2];
    for (const t of quelle.matchAll(/\bconst\s+(\w+)\s*=\s*'([^']*)'/g)) karte[t[1]] = t[2];
    return karte;
}

/**
 * Die Guild-Kennung ist beliebig: aus `/guild/${guildId}/plugins/x` wird
 * `/guild/<stern>/plugins/x`.
 *
 * **Erst die Konstanten einsetzen, dann vereinheitlichen.** Das discord-Plugin
 * schreibt `${basis}/roles` mit `const basis = ...` darueber. Wer das nicht
 * aufloest, macht daraus `<stern>/roles` und meldet einen Fehler, den es nicht
 * gibt — genau der falsche Alarm, den dieses Skript verhindern soll.
 */
function vereinheitlichen(adresse, konstanten = {}) {
    let text = String(adresse);
    // Drei Durchgaenge reichen: `${a}` in `a`, das selbst `${b}` enthaelt.
    for (let i = 0; i < 3; i++) {
        const vorher = text;
        text = text.replace(/\$\{(\w+)\}/g, (ganz, name) =>
            Object.prototype.hasOwnProperty.call(konstanten, name) ? konstanten[name] : ganz);
        if (text === vorher) break;
    }
    return text.replace(/\$\{[^}]+\}/g, '*').replace(/\/+$/, '');
}

/** `/guild/123/plugins/x` → `/guild/<stern>/plugins/x` */
function ohneGuild(url) {
    return String(url).replace(/^\/guild\/\d+\//, '/guild/*/').replace(/\/+$/, '');
}

/**
 * Welche Router-Datei haengt unter welchem Praefix?
 *
 * Zwei Schreibweisen kommen vor: `use('/x', require('./routes/y'))` direkt und
 * `const y = require('./routes/y')` mit `use('/x', y)` weiter unten.
 */
function einhaengungen(dashboardVerzeichnis, quelle) {
    const mounts = [];
    const ungeloest = [];

    const nachName = {};
    for (const t of quelle.matchAll(/\bconst\s+(\w+)\s*=\s*require\(\s*['"`]\.\/([^'"`]+)['"`]\s*\)/g)) {
        nachName[t[1]] = t[2];
    }

    for (const t of quelle.matchAll(
        /guildRouter\.use\(\s*['"`]([^'"`]+)['"`]\s*,\s*(?:require\(\s*['"`]\.\/([^'"`]+)['"`]\s*\)|([A-Za-z_$][\w$]*))/g)) {
        const relativ = t[2] || nachName[t[3]];
        if (!relativ) {
            ungeloest.push({ praefix: t[1], grund: `Router "${t[3] || '?'}" ist keine Datei, die hier steht` });
            continue;
        }
        const datei = path.join(dashboardVerzeichnis, relativ.endsWith('.js') ? relativ : relativ + '.js');
        if (!fs.existsSync(datei)) {
            ungeloest.push({ praefix: t[1], grund: `Datei fehlt: ${path.relative(WURZEL, datei)}` });
            continue;
        }
        mounts.push({ praefix: t[1], datei });
    }

    return { mounts, ungeloest };
}

/**
 * Namen der Funktionen einer Datei, die selbst eine Ansicht rendern.
 *
 * **Ohne das ist `greeting` unsichtbar.** Dort steht keine Route mit eigenem
 * Rumpf, sondern eine Fabrik: `router.get('/rollen', …, seite('greeting-roles',
 * …))`. Wer nur nach `renderView` IM Rumpf sucht, findet dort null Seiten — und
 * ein Plugin ohne gefundene Seiten sieht aus wie eines ohne Guild-Bereich.
 * Sieben Seiten waeren stumm durchgerutscht.
 */
function seitenFabriken(quelle) {
    const zeilen = quelle.split('\n');
    const namen = new Set();
    const anfang = /^\s*(?:async\s+)?function\s+(\w+)\s*\(|^\s*const\s+(\w+)\s*=\s*(?:async\s*)?(?:\(|function)/;

    for (let i = 0; i < zeilen.length; i++) {
        const t = anfang.exec(zeilen[i]);
        if (!t) continue;
        let ende = zeilen.length;
        for (let j = i + 1; j < zeilen.length; j++) {
            if (anfang.test(zeilen[j]) || /^\s*(?:this\.)?(?:guildR|r)outer\./.test(zeilen[j])) { ende = j; break; }
        }
        if (/renderView\s*\(|res\.render\s*\(/.test(zeilen.slice(i, ende).join('\n'))) {
            namen.add(t[1] || t[2]);
        }
    }
    return namen;
}

/**
 * Die Seiten einer Router-Datei: jedes `get`, das eine Ansicht ausliefert —
 * selbst oder ueber eine Fabrik derselben Datei.
 *
 * Ein `get`, das JSON liefert, hat keine Seitenleiste und ist hier kein Thema.
 */
function seitenAus(datei, praefix, basis, quelle) {
    const zeilen = quelle.split('\n');
    const konstanten = konstantenLesen(quelle);
    const fabriken = seitenFabriken(quelle);
    const gefunden = [];
    const ungeloest = [];
    const anfang = /^\s*(?:this\.)?(?:guildR|r)outer\.get\(/;
    const mitAdresse = /^\s*(?:this\.)?(?:guildR|r)outer\.get\(\s*['"`]([^'"`]+)['"`]/;
    const naechste = /^\s*(?:this\.)?(?:guildR|r)outer\.(?:get|post|put|patch|delete|use)\(/;

    for (let i = 0; i < zeilen.length; i++) {
        if (!anfang.test(zeilen[i])) continue;

        let ende = zeilen.length;
        for (let j = i + 1; j < zeilen.length; j++) {
            if (naechste.test(zeilen[j])) { ende = j; break; }
        }
        const rumpf = zeilen.slice(i, ende).join('\n');
        const rendertSelbst = /renderView\s*\(|res\.render\s*\(/.test(rumpf);
        const ueberFabrik = [...fabriken].some(n => new RegExp(`\\b${n}\\s*\\(`).test(rumpf));
        if (!rendertSelbst && !ueberFabrik) continue;

        const adresse = mitAdresse.exec(zeilen[i]);
        if (!adresse) {
            // Eine Route, deren Pfad aus einer Variablen kommt. Ihre Adresse
            // steht hier nicht — also wird sie auch nicht gutgeschrieben.
            ungeloest.push({
                datei: path.relative(WURZEL, datei), zeile: i + 1,
                grund: `Routenpfad steht nicht als Zeichenkette: ${zeilen[i].trim().slice(0, 60)}`
            });
            continue;
        }

        if (adresse[1].includes('${')) {
            // **Der Pfad wird zur Laufzeit gebaut** (`/${name}` aus einer
            // Liste). Welche Adressen dabei herauskommen, weiss nur der
            // laufende Vorgang — dieses Skript raet sie nicht.
            ungeloest.push({
                datei: path.relative(WURZEL, datei), zeile: i + 1,
                grund: `Routenpfad wird zur Laufzeit gebaut: ${adresse[1]}`
            });
            continue;
        }

        const gesetzt = /activeMenu:\s*[`'"]([^`'"]+)[`'"]/.exec(rumpf);
        const eigene = (basis
            + (praefix === '/' ? '' : praefix)
            + (adresse[1] === '/' ? '' : adresse[1])).replace(/\/+$/, '');

        gefunden.push({
            datei: path.relative(WURZEL, datei),
            zeile: i + 1,
            eigene,
            aktiv: gesetzt ? vereinheitlichen(gesetzt[1], konstanten) : eigene,
            gesetzt: !!gesetzt
        });
    }

    return { gefunden, ungeloest };
}

(async () => {
    // ── Die angemeldeten Punkte, wie die Seitenleiste sie sieht ─────────────
    let verbindung;
    let zeilen;
    try {
        verbindung = await mysql.createConnection({
            host: process.env.MYSQL_HOST,
            user: process.env.MYSQL_USER,
            password: process.env.MYSQL_PASSWORD,
            database: process.env.MYSQL_DATABASE,
            port: process.env.MYSQL_PORT || 3306
        });
        [zeilen] = await verbindung.query('SELECT DISTINCT plugin, url FROM guild_nav_items');
    } catch (fehler) {
        // **Kein gruenes Ergebnis ohne Messung.** Ohne die Punkte laesst sich
        // die Frage nicht beantworten, und „keine Abweichung gefunden" waere
        // dann eine falsche Auskunft.
        console.error(`\n❌ Die angemeldeten Punkte sind nicht zu lesen: ${fehler.message}\n`);
        process.exit(1);
    } finally {
        if (verbindung) await verbindung.end().catch(() => {});
    }

    const angemeldet = {};
    for (const z of zeilen) (angemeldet[z.plugin] ||= new Set()).add(ohneGuild(z.url));

    console.log('\n▸ Trifft jede Seite einen Punkt der Seitenleiste?\n');

    let abweichungen = 0;
    let seitenGesamt = 0;
    const ohneSeiten = [];
    const nichtPruefbar = [];

    for (const plugin of fs.readdirSync(PLUGINS).sort()) {
        const dashboardVerzeichnis = path.join(PLUGINS, plugin, 'dashboard');
        const indexDatei = path.join(dashboardVerzeichnis, 'index.js');
        if (!fs.existsSync(indexDatei)) continue;

        const indexQuelle = ohneKommentare(fs.readFileSync(indexDatei, 'utf8'));
        const basis = `/guild/*/plugins/${plugin}`;
        const { mounts, ungeloest } = einhaengungen(dashboardVerzeichnis, indexQuelle);

        // Seiten koennen direkt in der index.js haengen (dunemap, gameserver)
        // oder in einer eingehaengten Router-Datei.
        const seiten = [];
        const offeneFragen = ungeloest.map(u => `Einhaengung ${u.praefix}: ${u.grund}`);

        const ausIndex = seitenAus(indexDatei, '/', basis, indexQuelle);
        seiten.push(...ausIndex.gefunden);
        offeneFragen.push(...ausIndex.ungeloest.map(u => `${u.datei}:${u.zeile} — ${u.grund}`));

        for (const m of mounts) {
            const quelle = ohneKommentare(fs.readFileSync(m.datei, 'utf8'));
            const ergebnis = seitenAus(m.datei, m.praefix, basis, quelle);
            seiten.push(...ergebnis.gefunden);
            offeneFragen.push(...ergebnis.ungeloest.map(u => `${u.datei}:${u.zeile} — ${u.grund}`));
        }

        if (!seiten.length && !offeneFragen.length) {
            // **Kein stilles Weiter.** Ein Plugin ohne Seiten ist entweder in
            // Ordnung (es hat keinen Guild-Bereich) oder dieses Skript findet
            // seine Routen nicht — der Unterschied gehoert in die Liste.
            ohneSeiten.push(plugin);
            continue;
        }

        const punkte = angemeldet[plugin];
        seitenGesamt += seiten.length;

        if (!punkte) {
            // Ein Plugin, das in keiner Guild eingeschaltet ist, hat keine
            // Zeilen in `guild_nav_items`. Das ist keine Abweichung, aber auch
            // keine Pruefung — und es steht als solches da.
            console.log(`  ⚠ ${plugin.padEnd(14)} ${seiten.length} Seite(n), aber in keiner Guild eingeschaltet — nicht geprueft`);
            continue;
        }

        const daneben = seiten.filter(s => !punkte.has(s.aktiv));
        abweichungen += daneben.length;
        for (const frage of offeneFragen) nichtPruefbar.push(`${plugin}: ${frage}`);

        const gesetzt = seiten.filter(s => s.gesetzt).length;
        const anhang = offeneFragen.length ? `, ${offeneFragen.length} nicht pruefbar` : '';

        if (!daneben.length) {
            console.log(`  ${offeneFragen.length ? '⚠' : '✅'} ${plugin.padEnd(14)} `
                + `${seiten.length} Seite(n) treffen `
                + `(${gesetzt} gesetzt, ${seiten.length - gesetzt} ueber die Vorgabe)${anhang}`);
            continue;
        }

        console.log(`  ❌ ${plugin.padEnd(14)} ${daneben.length} von ${seiten.length} Seite(n) treffen nicht${anhang}:`);
        for (const s of daneben) {
            console.log(`       ${s.aktiv}   ${s.gesetzt ? '(gesetzt)' : '(Vorgabe: die Adresse der Seite)'}`);
            console.log(`         ${s.datei}:${s.zeile}`);
        }
    }

    if (ohneSeiten.length) {
        console.log(`\n▸ Ohne eigene Seiten im Guild-Bereich: ${ohneSeiten.join(', ')}`);
    }

    if (nichtPruefbar.length) {
        // **Eine Liste, kein stilles Weiter.** Diese Stellen zaehlen nicht als
        // Fehler — sonst stuende das Skript dauerhaft rot und wuerde
        // abgeschaltet. Unsichtbar werden duerfen sie deswegen trotzdem nicht.
        console.log(`\n▸ Nicht pruefbar (${nichtPruefbar.length}) — hier steht die Adresse nicht im Quelltext`);
        for (const n of nichtPruefbar) console.log(`  · ${n}`);
    }

    console.log(`\n▸ ${seitenGesamt} Seiten gemessen.`);
    console.log(abweichungen === 0
        ? '\n✅ Jede gemessene Seite trifft einen Punkt — die Leiste bleibt offen\n'
        : `\n❌ ${abweichungen} Abweichung(en) — dort klappt die Seitenleiste zu\n`);
    process.exit(abweichungen === 0 ? 0 : 1);
})().catch(fehler => {
    console.error('\n❌ Abbruch:', fehler);
    process.exit(1);
});
