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
const { DB_SCHLUESSEL } = require('../../../gameserver/dashboard/helpers/Datenbanken');

const PLATZHALTER = /\{\{[^}]*\}\}/g;
const RE_VERWEIS = /^\{\{(setting|port|content|env|db):[^}\s]+\}\}$/;

/**
 * Ein Verweis in einer Zeile, deren Quelle nicht „Text mit Verweisen" ist.
 *
 * Der Daemon setzt Verweise nur in `parts` ein; in `form` ersetzt er allein
 * `{{value}}` (pkgspec.BaueArgv). `-ServerPort={{port:game}}` mit Quelle „fest"
 * wurde gespeichert und scheiterte erst beim Probestart als „Auftrag
 * unvollständig" (Betreiber, 7 Days to Die, 2026-10-08).
 *
 * Der Rat nennt den kürzesten Weg: Trennt die Zeile mehrere Argumente
 * (`-port {{port:game}}`), wäre „Text" EIN Argument und damit falsch — dann
 * die Quelle wählen und {{Wert}} schreiben.
 */
function ratZumVerweis(form, p, quelle) {
    const [, art, name] = p.match(/^\{\{(setting|port|content|env|db):([^}\s]+)\}\}$/);
    const mitWert = form.replace(p, '{{Wert}}');
    const text = 'Wähl als Quelle „Text mit Verweisen (ein Argument)"';
    if (quelle !== 'fest') {
        return `${art}:${name}` === quelle
            ? `Die Quelle steht schon im Auswahlfeld — schreib „${mitWert}".`
            : `In dieser Zeile wird nur {{Wert}} eingesetzt. ${text} und schreib alle Verweise aus.`;
    }
    const alsQuelle = (art === 'port' || art === 'setting') && (form.match(PLATZHALTER) || []).length === 1;
    if (alsQuelle && /\s/.test(form)) {
        return `Wähl als Quelle „${art === 'port' ? 'Port' : 'Einstellung'}: ${name}" und schreib „${mitWert}".`;
    }
    return `${text}.`;
}

/**
 * Ein Platzhalter, den niemand einsetzt, ist ein Fehler beim Speichern — nicht
 * erst beim Probestart. `-Port={{game}}` mit Quelle „Port: game" lief bis zum
 * Daemon durch und kam als „Auftrag unvollständig" zurück (2026-10-05).
 */
function pruefePlatzhalter(form, quelle, nr) {
    for (const p of form.match(PLATZHALTER) || []) {
        WERT.lastIndex = 0;
        if (WERT.test(p)) continue;
        if (RE_VERWEIS.test(p)) {
            const db = /^\{\{db:([^}\s]+)\}\}$/.exec(p);
            if (db && !DB_SCHLUESSEL.includes(db[1])) {
                throw new Error(`Zeile ${nr}: Für die Datenbank gibt es nur `
                    + `${DB_SCHLUESSEL.map(k => `{{db:${k}}}`).join(', ')}.`);
            }
            if (quelle === 'text') continue;
            throw new Error(`Zeile ${nr}: ${p} würde hier nicht eingesetzt und ginge wörtlich an das Spiel. `
                + ratZumVerweis(form, p, quelle));
        }
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

// ── Proton: oben steht das Spiel, nicht Proton (2026-10-16) ───────────────────
//
// Betreiber: „der run-Programm relativ zum Game ist immer gleich". Bei jedem
// Windows-Spiel unter Proton begann der Startteil mit denselben zwei Dingen —
// Programm `/opt/fb/proton/proton`, erste Zeile `runinprefix` (nicht `run`,
// das koppelt das Spiel ab) — und erst die zweite Zeile nannte das Spiel. Im
// Feld „Programm (relativ zu game/)" stand ein absoluter Pfad, der nichts mit
// dem Spiel zu tun hat.
//
// Jetzt nennt das Feld in einer Proton-Sitzung die .exe; Proton und
// `runinprefix` setzt die Werkbank davor. Das Paketformat bleibt, wie es ist —
// umgerechnet wird nur zwischen Formular und Entwurf. Schlüssel vorhandener
// Zeilen bleiben (`vorher`): Sonst sähe der Paketvergleich eines Umzugs eine
// Änderung, wo keine ist.

const PROTON = '/opt/fb/proton/proton';
const PROTON_VERB = 'runinprefix';

/** Steht der Start schon in Proton-Form (Programm, runinprefix, feste .exe)? */
function protonForm(start) {
    const a = Array.isArray(start?.args) ? start.args : [];
    const fest = (x) => x && (x.from || 'fixed') === 'fixed' && !x.when && typeof x.form === 'string';
    return start?.program === PROTON && fest(a[0]) && a[0].form === PROTON_VERB && fest(a[1]) ? a : null;
}

/**
 * Entwurf → Formular einer Proton-Sitzung: das Spiel ins Feld, die übrigen
 * Zeilen darunter. Passt der Start nicht in die Form (alte Sitzung mit `run`,
 * leer), bleibt er, wie er ist.
 */
function protonAlsFormular(start) {
    const a = protonForm(start);
    if (!a) return null;
    return { program: a[1].form, zeilen: zeilenAusArgs(a.slice(2)) };
}

/**
 * Formular → Entwurf einer Proton-Sitzung. `spiel` ist das Feld (die .exe).
 * Steht dort noch Proton selbst (alte Schreibweise), wird nichts davorgesetzt.
 *
 * @param {string} spiel
 * @param {object[]} args      die Zeilen des Formulars, schon übersetzt
 * @param {object} [vorher]    der bisherige Start — für die Schlüssel
 */
function protonStart(spiel, args, vorher) {
    if (!spiel || spiel === PROTON) return { program: spiel, args };
    const alt = protonForm(vorher) || [];
    const vergeben = new Set((args || []).map(x => x.key));
    const verbKey = alt[0]?.key && !vergeben.has(alt[0].key) ? alt[0].key : schluessel(PROTON_VERB, vergeben);
    vergeben.add(verbKey);
    const spielKey = alt[1]?.key && alt[1].form === spiel && !vergeben.has(alt[1].key) ? alt[1].key : schluessel(spiel, vergeben);
    return {
        program: PROTON,
        args: [{ key: verbKey, form: PROTON_VERB, from: 'fixed' }, { key: spielKey, form: spiel, from: 'fixed' }, ...(args || [])],
    };
}

module.exports = { argsAusZeilen, zeilenAusArgs, zerlege, PROTON, protonAlsFormular, protonStart };

