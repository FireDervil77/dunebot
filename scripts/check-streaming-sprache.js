#!/usr/bin/env node
/**
 * Die Seiten von „Mein Kanal" bis „Musik" sind zweisprachig (2026-10-30).
 *
 * Betreiber: Die Punkte hätten keine vollständige Übersetzung. Das Menü war
 * übersetzt, die sechs Seiten dahinter enthielten keinen einzigen `tr()`.
 *
 *   Schlüssel   jeder genannte steht in de-DE und en-GB
 *   Reste       nach Abzug von Kommentaren und EJS bleibt kein deutscher Text
 *   Kommentare  kein `tr()` in einem Kommentar (die Umstellung hat das einmal
 *               angerichtet und damit fünf Vorlagen zerlegt)
 *   Skripte     Texte in onsubmit-Rückfragen über JSON.stringify, sonst bricht
 *               ein Apostroph den Aufruf
 *
 *   node scripts/check-streaming-sprache.js
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');
const { ohneKommentare, ohneKommentareEjs } = require('./lib/quelltext');

const WURZEL = path.join(__dirname, '..');
const P = path.join(WURZEL, 'plugins/streaming/dashboard');
const SEITEN = ['chatbot', 'ansagen', 'statistik', 'befehle', 'mitmachen', 'musik'];
const lies = (rel) => fs.readFileSync(path.join(P, rel), 'utf8');
const de = JSON.parse(lies('locales/de-DE.json'));
const en = JSON.parse(lies('locales/en-GB.json'));
const hole = (o, k) => k.split('.').reduce((a, t) => (a == null ? a : a[t]), o);

let fehler = 0;
function pruefe(was, tun) {
    try { tun(); console.log(`  ✓ ${was}`); }
    catch (e) { fehler++; console.log(`  ✗ ${was}\n      ${String(e.message).split('\n').slice(0, 6).join('\n      ')}`); }
}

/** Der sichtbare Rest: EJS-Blöcke, Stile, Skripte und Tags sind weg. */
const sichtbar = (q) => ohneKommentareEjs(q)
    .replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/<%[\s\S]*?%>/g, ' ').replace(/<[^>]+>/g, ' ');

console.log('\nStreaming-Seiten in zwei Sprachen');

pruefe('jeder genannte Schlüssel steht in beiden Sprachen', () => {
    const fehlt = [];
    const dateien = SEITEN.map(s => `views/guild/streaming-${s}.ejs`).concat('routes/musik.router.js', 'routes/_shared.js');
    for (const d of dateien) {
        const q = d.endsWith('.ejs') ? ohneKommentareEjs(lies(d)) : ohneKommentare(lies(d));
        for (const m of q.matchAll(/streaming:([A-Z][A-Z_0-9]*(?:\.[A-Za-z_0-9]+)+)/g)) {
            // `'streaming:BEFEHLE.FERTIG.' + wort`: Das Ende bestimmt erst die Laufzeit.
            if (q[m.index + m[0].length] === '.') continue;
            if (typeof hole(de, m[1]) !== 'string') fehlt.push(`de ${m[1]} (${d})`);
            if (typeof hole(en, m[1]) !== 'string') fehlt.push(`en ${m[1]} (${d})`);
        }
    }
    assert.deepStrictEqual(fehlt, []);
});

pruefe('die Sprachdateien tragen dieselben Schlüssel, Platzhalter inklusive', () => {
    const flach = (o, p = '', r = {}) => {
        for (const [k, v] of Object.entries(o)) {
            if (v && typeof v === 'object') flach(v, p ? `${p}.${k}` : k, r); else r[p ? `${p}.${k}` : k] = v;
        }
        return r;
    };
    const d = flach(de), e = flach(en);
    assert.deepStrictEqual(Object.keys(d).filter(k => !(k in e)), []);
    assert.deepStrictEqual(Object.keys(e).filter(k => !(k in d)), []);
    const felder = (t) => [...String(t).matchAll(/\{\{(\w+)\}\}/g)].map(m => m[1]).sort().join();
    const anders = Object.keys(d).filter(k => felder(d[k]) !== felder(e[k]));
    assert.deepStrictEqual(anders, [], 'die Fassungen füllen verschiedene Felder');
});

pruefe('kein deutscher Text mehr sichtbar', () => {
    const rest = [];
    for (const s of SEITEN) {
        for (const z of sichtbar(lies(`views/guild/streaming-${s}.ejs`)).split('\n')) {
            if (/[äöüÄÖÜß]/.test(z)) rest.push(`${s}: ${z.trim().slice(0, 70)}`);
        }
    }
    assert.deepStrictEqual(rest, []);
});

pruefe('kein tr() in einem Kommentar, alle Vorlagen kompilieren', () => {
    for (const s of SEITEN) {
        const q = ohneKommentareEjs(lies(`views/guild/streaming-${s}.ejs`));
        ejs.compile(q, { filename: path.join(P, `views/guild/streaming-${s}.ejs`) });
        for (const k of q.match(/<%#[\s\S]*?%>|\/\*[\s\S]*?\*\//g) || []) {
            assert.ok(!/tr\('streaming:/.test(k), `${s}: ${k.slice(0, 60)}`);
        }
    }
});

pruefe('jede Seite rendert auf Englisch, ohne rohen Schlüssel und ohne deutschen Rest', () => {
    const tr = (k, o = {}) => {
        const t = hole(en, k.replace('streaming:', ''));
        if (typeof t !== 'string') return o.defaultValue ?? k;
        return t.replace(/\{\{(\w+)\}\}/g, (_, f) => o[f]);
    };
    const jetzt = new Date();
    const ZUSTAND = { OK: 'ok', ABGELEHNT: 'abgelehnt', FEHLER: 'fehler', KEIN_KANAL: 'kein_kanal' };
    const STAND = { JA: 'ja', NEIN: 'nein', UNBEKANNT: 'unbekannt' };
    const gemeinsam = { tr, guildId: '1', csrfToken: 'c', meldung: null, fehler: null,
        vorWieLange: () => '1 h ago', hasPermission: () => true };
    const zusage = { zustand: STAND.UNBEKANNT, grund: 'x' };
    const daten = {
        chatbot: { kanaele: [{ id: 1, login: 'x', anschluss: { zustand: 'ja', text: 't', tat: 't' },
            abo: { zustand: 'bestaetigt' }, empfangen: { anzahl: 2 }, chat_ansage_an: 1,
            darf_schreiben: { zustand: 'nein', grund: '' }, letzte_ansage: { zustand: 'aufgegeben', faellig_ab: jetzt } }],
            bericht: { gelaufen_am: jetzt, gewuenscht: 1, vorhanden: 1, bestellt: ['a'], abbestellt: ['b'], fehler: ['x'] },
            leitung: { verbunden: true }, chatMax: 500, vorgabeAnsage: 'v', platzhalter: [{ name: '{x}' }] },
        ansagen: { ansagen: [{ id: 1, intervall_min: 25, gesendet_anzahl: 3, zuletzt_am: jetzt, text: 'x', mindest_zeilen: 0, aktiv: 1 }],
            kanaele: [], bausteine: [], GRENZEN: { intervallMin: 5, intervallMax: 120, zeilenMax: 100 },
            PLATZHALTER: [{ name: '{streamer}', bedeutung: 'b' }] },
        statistik: { ZUSTAND, bericht: { geholt_am: jetzt,
            letzterStream: { ist_live: 1, begonnen_am: jetzt, zuschauer: 1 },
            folger: { zustand: 'ok', gesamt: 1, liste: [{ name: 'a', seit: jetzt }] },
            abos: { zustand: 'ok', gesamt: 1, liste: [{ kontoName: 'a', stufe: '1000', geschenkt: 1 }] },
            bits: { zustand: 'ok', plaetze: [{ platz: 1, name: 'a', punkte: 1000 }] } } },
        befehle: { eigene: [{ id: 1, wort: 'x', antwort: 'y', wer: 'alle', abkuehlung_s: 5, aktiv: 1, benutzt_anzahl: 2, benutzt_am: jetzt, zaehler_name: 'z' }],
            fertigZeilen: [{ wort: 'clip', aktiv: 1, benutzt_anzahl: 2, wer: 'alle' }], FERTIG: { clip: { beschreibung: 'b', zusage: 1, wer: 'alle' } },
            PRAEFIX: '!', kanaele: [], verfuegbar: { clip: { ok: false, grund: 'g', braucht: {} } },
            bausteine: [{ id: 1, name: 'z', art: 'zaehler', zahl: 1, wert: '' }, { id: 2, name: 'd', art: 'text', wert: 'w' }],
            PLATZHALTER: [{ name: '{uptime}', bedeutung: 'b', nurLive: true }] },
        mitmachen: { ZUSTAND, STAND, bericht: { geholt_am: jetzt, kanalArt: 'normal', zusagen: { clip: zusage, umfragen: { zustand: STAND.JA } },
            befehle: { clip: { aktiv: 1, wer: 'alle', abkuehlung_s: 5 }, umfrage: null, los: { aktiv: 0 } },
            umfragen: { zustand: 'ok', laufend: { id: 1, frage: 'f', gesamt: 2, punkteAbstimmung: 1, punkteProStimme: 1, antworten: [{ titel: 'a', stimmen: 1 }] },
                frueher: [{ frage: 'f', beendet_am: jetzt, antworten: [{ titel: 'a', stimmen: 1 }] }] },
            verlosung: { moeglich: true, lose: 1, offen: { preis: 'p', bedingungen: [1] } } } },
        musik: { hatAblage: true, freigegeben: 0, adresse: 'a', player: { verbunden: false, sekunden: 30 }, laeuft: { titel: 't', gewuenscht_von: 'g' },
            aktiv: true, endlos: true, streamende: { an: true, nachlaufMin: 5 }, nachlaufGrenzen: { min: 1, max: 60 }, streamendeZuletzt: 'z',
            offen: [{ titel: 't', gewuenscht_von: 'g' }], noetigeStimmen: 3 },
    };
    for (const s of SEITEN) {
        const f = path.join(P, `views/guild/streaming-${s}.ejs`);
        // Roh mit Absicht: gerendert wird die echte Vorlage, geprüft die Ausgabe (EJS-Kommentare fallen dabei weg).
        const html = ejs.render(fs.readFileSync(f, 'utf8'), { ...gemeinsam, ...daten[s] },
            { filename: f, includer: () => ({ template: ' ' }) });
        assert.ok(!/streaming:[A-Z]/.test(html), `${s}: roher Schlüssel in der Ausgabe`);
        assert.ok(!/undefined/.test(html), `${s}: undefined in der Ausgabe`);
        const rest = sichtbar(html).split('\n').filter(z => /[äöüÄÖÜß]/.test(z)).map(z => z.trim().slice(0, 70));
        assert.deepStrictEqual(rest, [], s);
    }
});

pruefe('Rückfragen im Attribut laufen über JSON.stringify', () => {
    for (const s of SEITEN) {
        for (const m of ohneKommentareEjs(lies(`views/guild/streaming-${s}.ejs`)).matchAll(/onsubmit="[^"]*"/g)) {
            assert.match(m[0], /JSON\.stringify\(tr\(/, `${s}: ${m[0].slice(0, 70)}`);
        }
    }
});

pruefe('Chat-Schutz: eine englische Fassung, die Route wählt nach Sprache', () => {
    const { seite } = require(path.join(P, 'entwuerfe.js'));
    const s = seite('schutz');
    assert.strictEqual(s.en.titel, 'Chat protection');
    for (const feld of ['merkmale', 'vorhanden', 'fehlt']) assert.strictEqual(s.en[feld].length, s[feld].length, feld);
    assert.match(lies('routes/guild.router.js'), /startsWith\('en'\) \? daten\.en : null/);
});

pruefe('Zeitangaben folgen der Sprache, ohne tr bleibt es deutsch', () => {
    const { vorWieLange } = require(path.join(P, 'routes/_shared.js'));
    const tr = (k, o) => hole(en, k.replace('streaming:', '')).replace('{{n}}', o.n);
    const vor = new Date(Date.now() - 3 * 3600 * 1000);
    assert.strictEqual(vorWieLange(vor, tr), '3 h ago');
    assert.strictEqual(vorWieLange(vor), 'vor 3 h');
});

console.log(fehler ? `\n✗ ${fehler} Prüfung(en) rot` : '\n✅ Streaming-Seiten: zwei Sprachen, keine Reste, Kommentare sauber');
process.exit(fehler ? 1 : 0);
