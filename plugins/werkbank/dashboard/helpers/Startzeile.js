'use strict';

/**
 * Startzeilen-Baukasten (Startparameter S1, 2026-09-30) — Übersetzung zwischen
 * den Zeilen der Werkbank und `start.args` im Paket.
 *
 * Betreiber: Startparameter wie `-Xmx{{Wert}}M` oder bei Valheim
 * `-name "MeinServer" -port 2456 -password "Geheim123"` selbst setzen und
 * ergänzen können. Das FORMAT konnte das längst (`form` + `from` + `when`,
 * Valheim benutzt 24 Einträge davon); die Werkbank bot nur „eine Zeile = ein
 * argv-Eintrag" ohne Quelle und Bedingung. `factorio-werkbank` 1.0.2 trug
 * deshalb `--port` und `{{port:game}}` als zwei lose Zeilen.
 *
 * Eine Zeile hat drei Felder:
 *
 *   form       wie der Betreiber es schreibt: `-name {{Wert}}`. Leerzeichen
 *              trennen argv-Einträge; "…" hält einen Eintrag mit Leerzeichen
 *              zusammen (`"saves/meine welt.zip"`). {{Wert}} ist der Wert der
 *              Quelle.
 *   quelle     fest | setting:<key> | port:<zweck> | text
 *              `text` ist EIN argv-Eintrag mit eingebetteten Verweisen
 *              (`-QueryPort={{port:query}}`, die Unreal-Familie) — im Paket
 *              `parts`; Leerzeichen trennen dort nichts.
 *   bedingung  '' (immer) | true | false | not_empty | empty | =a,b | !=a,b
 *              — genau die Formen, die der Daemon kennt (pkgspec.gilt).
 *
 * Was sich so nicht ausdrücken lässt (ein Eintrag mit `free`/`content:` oder
 * mehrere `parts` mit eigener Bedingung), kommt als Zeile `roh` zurück und wird
 * UNVERÄNDERT wieder abgelegt — nie still umgebaut oder verworfen.
 *
 * Die Vorschau der fertigen Zeile rechnet NICHT dieser Helfer, sondern der
 * Daemon (`werkbank.startzeile`, dieselbe Funktion wie beim Start).
 */

const WERT = /\{\{\s*(?:Wert|wert|WERT|value)\s*\}\}/g;
const RE_KEY = /^[a-z][a-z0-9_]*$/;
const RE_QUELLE = /^(fest|text|setting:[a-z][a-z0-9_]*|port:[a-z][a-z0-9_]*)$/;
const BEDINGUNGEN = ['', 'true', 'false', 'not_empty', 'empty'];

// Alles, was wie ein Platzhalter aussieht — und die Formen, die der Daemon
// einsetzt (pkgspec.ArtenHinweis). Was dazwischen liegt, ginge wörtlich an das
// Spiel; der Daemon weist es erst beim Start ab.
const PLATZHALTER = /\{\{[^}]*\}\}/g;
const RE_VERWEIS = /^\{\{(setting|port|content|env):[^}\s]+\}\}$/;

/**
 * Ein Platzhalter, den niemand einsetzt, ist ein Fehler beim Speichern — nicht
 * erst beim Probestart. `-Port={{game}}` mit Quelle „Port: game" lief bis zum
 * Daemon durch und kam als „Auftrag unvollständig" zurück (2026-10-05).
 */
function pruefePlatzhalter(form, quelle, nr) {
    for (const p of form.match(PLATZHALTER) || []) {
        WERT.lastIndex = 0;
        if (WERT.test(p) || RE_VERWEIS.test(p)) continue;
        const name = p.slice(2, -2).trim();
        const rat = quelle === 'text' || quelle === 'fest'
            ? `Schreib {{port:${name || 'zweck'}}} oder {{setting:${name || 'schlüssel'}}}`
              + (quelle === 'fest' ? ' und wähl als Quelle „Text mit Verweisen".' : '.')
            : `Die Quelle steht schon im Auswahlfeld — in die Zeile gehört {{Wert}}, also „${form.replace(p, '{{Wert}}')}".`;
        throw new Error(`Zeile ${nr}: Den Platzhalter ${p} gibt es nicht. ${rat}`);
    }
    WERT.lastIndex = 0;
}

/** Die Bedingung, wie der Daemon sie versteht — sonst ein Fehler mit Grund. */
function pruefeBedingung(b, nr) {
    if (BEDINGUNGEN.includes(b)) return b;
    if (/^!?=.+$/.test(b)) return b;
    throw new Error(`Zeile ${nr}: Bedingung „${b}" gibt es nicht.`);
}

/**
 * „wenn an" und „wenn aus" prüfen einen Schalter. Der Daemon liest dafür nur
 * `1/true/yes/on` als „an" (pkgspec.wahr) — an einem Text oder einer Zahl ist
 * „wenn an" also nie erfüllt, und die Zeile fehlt still. So kam der Servername
 * von StarRupture nie in der Startzeile an (`-ServerName={{Wert}}`, „wenn an",
 * 2026-10-05); der Prüfdurchlauf blieb grün.
 *
 * Geprüft wird, was hier bekannt ist: der Typ der Einstellung aus dem Entwurf.
 * Eine Einstellung, die es noch nicht gibt, geht durch — das meldet der
 * Auftragsbau als Lücke.
 */
function pruefeSchalterBedingung(bedingung, quelle, nr, einstellungen) {
    if (bedingung !== 'true' && bedingung !== 'false') return;
    const wort = bedingung === 'true' ? '„wenn an"' : '„wenn aus"';
    const rat = bedingung === 'true'
        ? 'Nimm „immer" oder „wenn gesetzt".'
        : 'Nimm „wenn leer" oder „ungleich …".';
    if (quelle.startsWith('port:')) {
        throw new Error(`Zeile ${nr}: ${wort} gilt nur für einen Schalter — ein Port ist eine Nummer. ${rat}`);
    }
    if (!quelle.startsWith('setting:') || !Array.isArray(einstellungen)) return;
    const key = quelle.slice('setting:'.length);
    const e = einstellungen.find(x => x && x.key === key);
    if (!e || !e.type || e.type === 'boolean') return;
    throw new Error(`Zeile ${nr}: ${wort} gilt nur für einen Schalter — „${key}" ist vom Typ ${e.type}. `
        + (bedingung === 'true'
            ? 'Die Zeile wäre nur dabei, wenn der Wert wörtlich 1, true, yes oder on lautet. '
            : 'Die Zeile wäre immer dabei, außer der Wert lautet wörtlich 1, true, yes oder on. ')
        + rat);
}

/**
 * Zerlegt eine Form in argv-Einträge: Leerzeichen trennen, "…" hält zusammen.
 * Keine Shell: Es gibt weder Maskierung noch Variablen, nur diese zwei Regeln.
 */
function zerlege(form, nr) {
    const teile = [];
    const re = /"([^"]*)"|(\S+)/g;
    let m;
    while ((m = re.exec(form))) teile.push(m[1] !== undefined ? m[1] : m[2]);
    if ((form.match(/"/g) || []).length % 2) {
        throw new Error(`Zeile ${nr}: Ein Anführungszeichen ist nicht geschlossen.`);
    }
    return teile;
}

/**
 * Schlüssel des Eintrags. Eine Zeile, die schon einen hatte, behält ihn — sonst
 * änderte jedes Speichern die Schlüssel eines übernommenen Pakets. Neu: aus dem
 * Schalter (`-QueryPort=…` → queryport), eindeutig gemacht.
 */
function schluessel(form, vergeben, bisher) {
    if (bisher && RE_KEY.test(bisher) && !vergeben.has(bisher)) {
        vergeben.add(bisher);
        return bisher;
    }
    // Bis zum ersten Leerzeichen, `=` oder Platzhalter: `-Xmx{{Wert}}M` → xmx.
    const erstes = String(form).trim().split(/[\s=]|\{\{/)[0] || '';
    let k = erstes.replace(/^-+/, '')
        .toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
    if (!/^[a-z]/.test(k)) k = 'arg' + (k ? '_' + k : '');
    let kandidat = k, n = 2;
    while (vergeben.has(kandidat)) kandidat = `${k}_${n++}`;
    vergeben.add(kandidat);
    return kandidat;
}

/**
 * Zeilen der Werkbank → `start.args`.
 * @param {Array<{form?: string, quelle?: string, bedingung?: string, roh?: string}>} zeilen
 * @param {Array<{key: string, type?: string}>} [einstellungen]  die Einstellungen
 *        des Entwurfs — an ihrem Typ hängt, ob „wenn an"/„wenn aus" Sinn hat
 * @returns {object[]}
 */
function argsAusZeilen(zeilen, einstellungen) {
    if (!Array.isArray(zeilen)) return [];
    const vergeben = new Set();
    const args = [];

    // Unverändert Übernommenes behält seinen Schlüssel — zuerst reservieren,
    // sonst bekäme eine neue Zeile ihn und die alte würde umbenannt.
    for (const z of zeilen) {
        if (z?.roh) {
            let a;
            try { a = JSON.parse(z.roh); } catch { a = null; }
            if (!a || !RE_KEY.test(a.key || '')) throw new Error('Eine übernommene Zeile ist beschädigt.');
            vergeben.add(a.key);
        }
    }

    zeilen.forEach((z, i) => {
        const nr = i + 1;
        if (z?.roh) { args.push(JSON.parse(z.roh)); return; }

        const form = String(z?.form ?? '').trim();
        if (!form) return; // leere Zeile: gibt es nicht, wird nicht gespeichert
        const quelle = String(z?.quelle || 'fest');
        if (!RE_QUELLE.test(quelle)) throw new Error(`Zeile ${nr}: Quelle „${quelle}" gibt es nicht.`);
        const bedingung = pruefeBedingung(String(z?.bedingung ?? '').trim(), nr);
        pruefePlatzhalter(form, quelle, nr);
        pruefeSchalterBedingung(bedingung, quelle, nr, einstellungen);
        const hatWert = WERT.test(form);
        WERT.lastIndex = 0;
        const key = schluessel(form, vergeben, z?.key);

        if (quelle === 'text') {
            if (hatWert) {
                throw new Error(`Zeile ${nr}: Bei „Text mit Verweisen" gibt es kein {{Wert}} — `
                    + 'schreib {{setting:schlüssel}} oder {{port:zweck}} direkt hinein.');
            }
            const teil = { text: form };
            if (bedingung) teil.when = bedingung;
            args.push({ key, parts: [teil] });
            return;
        }

        const stuecke = zerlege(form, nr).map(s => s.replace(WERT, '{{value}}'));
        if (quelle === 'fest') {
            if (hatWert) throw new Error(`Zeile ${nr}: {{Wert}} braucht eine Quelle (Einstellung oder Port) — bei „fest" gibt es keinen.`);
            if (bedingung) throw new Error(`Zeile ${nr}: Eine feste Zeile hat keinen Wert, an dem eine Bedingung hängen könnte.`);
        } else if (!hatWert && !bedingung) {
            throw new Error(`Zeile ${nr}: Ohne {{Wert}} und ohne Bedingung wäre die Zeile immer dabei — `
                + 'dann Quelle „fest", oder eine Bedingung wie „wenn an".');
        }
        const a = {
            key,
            form: stuecke.length === 1 ? stuecke[0] : stuecke,
            from: quelle === 'fest' ? 'fixed' : quelle,
        };
        if (bedingung) a.when = bedingung;
        args.push(a);
    });
    return args;
}

/** Ein argv-Stück so zeigen, dass zerlege() es wieder zu genau einem macht. */
function zeige(stueck) {
    const s = String(stueck).replace(/\{\{value\}\}/g, '{{Wert}}');
    return s === '' || /\s/.test(s) ? `"${s}"` : s;
}

/**
 * `start.args` → Zeilen der Werkbank (Vorbelegung des Formulars).
 * @param {object[]} args
 */
function zeilenAusArgs(args) {
    return (Array.isArray(args) ? args : []).map((a) => {
        const roh = { roh: JSON.stringify(a) };
        if (Array.isArray(a.parts) && a.parts.length) {
            // Mehrere Stücke mit eigener Bedingung: das kann eine Zeile nicht.
            if (a.parts.length > 1 && a.parts.some(t => t.when)) return roh;
            return { key: a.key, form: a.parts.map(t => t.text).join(''), quelle: 'text', bedingung: a.parts[0].when || '' };
        }
        const from = a.from || 'fixed';
        if (from !== 'fixed' && !/^(setting|port):/.test(from)) return roh; // free, content:
        if (from === 'fixed' && a.when) return roh; // fest mit Bedingung: kann die Zeile nicht
        const form = [].concat(a.form || []);
        if (!form.length || form.some(s => s.includes('"'))) return roh;
        return {
            key: a.key,
            form: form.map(zeige).join(' '),
            quelle: from === 'fixed' ? 'fest' : from,
            bedingung: a.when || '',
        };
    });
}

module.exports = { argsAusZeilen, zeilenAusArgs, zerlege };
