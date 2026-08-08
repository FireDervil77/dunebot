/**
 * Musik - Tonspur beschaffen
 *
 * Holt zu einer Adresse den tatsaechlichen Datenstrom. Was gespielt werden
 * soll, entscheidet `quellen/index.js`; hier geht es nur noch darum, wie die
 * Bytes hereinkommen.
 *
 * Warum yt-dlp und nicht play-dl:
 *
 * `play.stream()` warf ab dem 08.08.2026 nur noch `Invalid URL`. Der Grund
 * liegt nicht bei uns: YouTube liefert die Ton-Formate inzwischen ueber SABR
 * aus, also ganz ohne Adresse im Datensatz. play-dl greift auf `format.url`
 * zu, findet `undefined`, und `new URL(undefined)` platzt. Das einzige Format
 * mit Adresse (itag 18) antwortet mit `403`. play-dl ist seit September 2023
 * nicht mehr angefasst worden und kann das nicht mehr aufholen.
 *
 * Nachgemessen am 08.08.2026: alle zehn InnerTube-Clients, die `youtubei.js`
 * kennt, liefern nur noch SABR - auch YouTube Music. yt-dlp kommt durch, weil
 * es den Client `ANDROID_VR` benutzt, den `youtubei.js` gar nicht anbietet.
 *
 * Fuer Suche und Titeldaten bleibt play-dl im Einsatz, das funktioniert
 * weiterhin. yt-dlp macht ausschliesslich den letzten Schritt.
 *
 * @module music/bot/quellen/strom
 */

const { spawn } = require('child_process');
const { existsSync } = require('fs');
const { join } = require('path');
const { homedir } = require('os');
const { PassThrough, Readable } = require('stream');
const { ServiceManager } = require('dunebot-core');

/** Wie lange yt-dlp fuer eine Adresse brauchen darf. */
const FRIST_MS = 20000;

/**
 * Formatwahl je Tonqualitaet.
 *
 * Opus wird bevorzugt, weil Discord selbst Opus spricht: dann faellt das
 * Umrechnen weg und der Ton geht verlustfrei durch. Gibt es kein Opus, tut
 * es auch etwas anderes - dann rechnet ffmpeg eben um.
 */
const FORMATWAHL = {
    0: 'worstaudio/bestaudio/best',
    1: 'bestaudio[abr<=128][acodec=opus]/bestaudio[abr<=128]/bestaudio/best',
    2: 'bestaudio[acodec=opus]/bestaudio/best'
};

/** Einmal gefundener Pfad zu yt-dlp; `null` heisst "noch nicht gesucht". */
let ytdlpPfad = null;

/**
 * Protokollieren, ohne dabei etwas kaputtmachen zu koennen.
 *
 * `ServiceManager.get('Logger')` wirft, wenn der Dienst nicht registriert
 * ist - etwa in einem Pruefskript ausserhalb des Bots. Steht so ein Aufruf
 * mitten im Tonweg, reisst er den Datenstrom mit. Genau das ist am
 * 08.08.2026 passiert.
 *
 * @param {string} stufe Logger-Methode
 * @param {string} text Meldung
 * @private
 */
function protokoll(stufe, text) {
    try {
        ServiceManager.get('Logger')[stufe](text);
    } catch {
        /* Ohne Logger laeuft der Ton trotzdem weiter - darauf kommt es an */
    }
}

/**
 * yt-dlp finden.
 *
 * Reihenfolge: ausdrueckliche Angabe, eigenes Verzeichnis des Benutzers,
 * dann der Systempfad. Das Ergebnis wird gemerkt - die Suche lohnt sich
 * nicht bei jedem Titel.
 *
 * @returns {string|null} Pfad oder null, wenn nichts gefunden wurde
 */
function ytdlpFinden() {
    if (ytdlpPfad !== null) return ytdlpPfad || null;

    const kandidaten = [
        process.env.YTDLP_PATH,
        join(homedir(), '.local', 'bin', 'yt-dlp'),
        '/usr/local/bin/yt-dlp',
        '/usr/bin/yt-dlp'
    ].filter(Boolean);

    for (const pfad of kandidaten) {
        if (existsSync(pfad)) {
            ytdlpPfad = pfad;
            return pfad;
        }
    }

    // Nichts an den bekannten Stellen - vielleicht liegt es im Systempfad
    ytdlpPfad = 'yt-dlp';
    return ytdlpPfad;
}

/**
 * yt-dlp aufrufen und die Ausgabe einsammeln.
 *
 * @param {Array<string>} argumente Aufrufargumente
 * @returns {Promise<string>} Standardausgabe
 * @private
 */
function ytdlpAufrufen(argumente) {
    return new Promise((erfuellen, ablehnen) => {
        const pfad = ytdlpFinden();
        const vorgang = spawn(pfad, argumente, { stdio: ['ignore', 'pipe', 'pipe'] });

        let ausgabe = '';
        let fehler = '';
        let abgebrochen = false;

        const zeitgeber = setTimeout(() => {
            abgebrochen = true;
            try { vorgang.kill('SIGKILL'); } catch { /* schon vorbei */ }
            ablehnen(new Error(`yt-dlp antwortete nicht innerhalb von ${FRIST_MS / 1000} Sekunden`));
        }, FRIST_MS);

        vorgang.stdout.on('data', d => { ausgabe += d; });
        vorgang.stderr.on('data', d => { fehler += d; });

        vorgang.on('error', (err) => {
            clearTimeout(zeitgeber);
            if (abgebrochen) return;
            // Der haeufigste Fall: das Programm liegt gar nicht da
            if (err.code === 'ENOENT') {
                ablehnen(new Error(
                    `yt-dlp wurde nicht gefunden (gesucht als "${pfad}"). ` +
                    'Ohne yt-dlp gibt es keinen Ton - siehe docs zur Einrichtung.'
                ));
                return;
            }
            ablehnen(err);
        });

        vorgang.on('close', (code) => {
            clearTimeout(zeitgeber);
            if (abgebrochen) return;

            if (code !== 0) {
                const grund = fehler.trim().split('\n').filter(Boolean).pop() || `Abbruchcode ${code}`;
                ablehnen(new Error(grund));
                return;
            }
            erfuellen(ausgabe);
        });
    });
}

/**
 * Die Tonspur einer Seite als Datenstrom - yt-dlp laedt selbst.
 *
 * Warum yt-dlp die Bytes holt und nicht wir:
 *
 * Nachgemessen am 08.08.2026 an derselben Adresse: ein schlichtes `fetch`
 * bekommt **10,1 KB/s**, yt-dlp **272 KB/s** - Faktor 27. Gebraucht werden
 * rund 16 KB/s, sonst verhungert der Abspieler. Google drosselt einfache
 * Einzelabrufe; yt-dlp umgeht das mit stueckweisen Abrufen.
 *
 * Vorher stand hier ein eigener Abrufer mit Wiederholungen. Der war nicht
 * kaputt, nur zu langsam - und weil `maxMissedFrames` bei 5 liegt, gibt
 * @discordjs/voice schon nach 100 ms ohne Nachschub auf. Ergebnis war eine
 * Sekunde Ton und dann Stille.
 *
 * @param {string} adresse Seitenadresse (YouTube, SoundCloud, ...)
 * @param {number} [qualitaet=2] 0 niedrig, 1 mittel, 2 hoch
 * @returns {Object} Lesbarer Datenstrom mit der Tonspur
 */
function tonstromVonSeite(adresse, qualitaet = 2) {
    const format = FORMATWAHL[qualitaet] ?? FORMATWAHL[2];
    const pfad = ytdlpFinden();

    const vorgang = spawn(pfad, [
        '-f', format,
        '--no-warnings',
        '--no-playlist',
        // Wiedergabelisten wuerden sonst am Stueck durchlaufen
        '--playlist-items', '1',
        // Fortschrittsbalken gehen auf stderr und interessieren hier nicht
        '--quiet',
        '-o', '-',
        adresse
    ], { stdio: ['ignore', 'pipe', 'pipe'] });

    let fehlertext = '';
    vorgang.stderr.on('data', (d) => { fehlertext += d; });

    vorgang.on('error', (err) => {
        const grund = err.code === 'ENOENT'
            ? `yt-dlp wurde nicht gefunden (gesucht als "${pfad}")`
            : err.message;
        protokoll('error', `[Musik] yt-dlp liess sich nicht starten: ${grund}`);
        try { vorgang.stdout.destroy(new Error(grund)); } catch { /* schon zu */ }
    });

    vorgang.on('close', (code, signal) => {
        // Beim Ueberspringen beenden wir selbst - das ist kein Fehler
        if (signal || code === 0 || code === null) return;
        const grund = fehlertext.trim().split('\n').filter(Boolean).pop() || `Abbruchcode ${code}`;
        protokoll('warn', `[Musik] yt-dlp brach ab: ${grund}`);
    });

    // Wird der Titel uebersprungen oder gestoppt, muss auch yt-dlp weg -
    // sonst laedt es munter weiter und niemand liest mit.
    vorgang.stdout.on('close', () => {
        try { vorgang.kill('SIGKILL'); } catch { /* schon vorbei */ }
    });

    return vorgang.stdout;
}

/**
 * Eine direkte Tonspur als Datenstrom oeffnen.
 *
 * Fuer Internetradio und direkte Dateien - da gibt es keine Drosselung, und
 * yt-dlp waere nur ein Umweg.
 *
 * Warum ueberhaupt node und nicht ffmpeg: Das mitgelieferte `ffmpeg-static`
 * ist statisch gegen glibc gebaut. Solche Programme stuerzen bei
 * `getaddrinfo` mit SIGSEGV ab, weil die Namensaufloesung Bibliotheken
 * nachladen will, die im statischen Programm nicht vorhanden sind.
 * Nachgemessen am 08.08.2026: `ffmpeg -i https://...` und `-i http://...`
 * sterben beide sofort mit Signal 11, waehrend `-i http://127.0.0.1:.../`
 * 384000 Bytes sauber durchreicht. Es liegt allein am Namen.
 *
 * Deshalb bekommt ffmpeg nie eine Adresse. Genau das war auch der Grund,
 * warum Internetradio nie lief.
 *
 * Reisst die Leitung mitten im Stueck ab, wird ab der zuletzt gelesenen
 * Stelle neu angefragt statt den Titel abzubrechen.
 *
 * @param {string} adresse Adresse der Tonspur
 * @param {Object} [optionen] { versuche: number }
 * @returns {Object} Lesbarer Datenstrom
 */
function tonstromVonAdresse(adresse, optionen = {}) {
    const maxVersuche = optionen.versuche ?? 3;
    const ziel = new PassThrough();
    const abbruch = new AbortController();

    let gelesen = 0;
    let gesamt = null;
    let versuche = 0;

    // Beendet der Abspieler den Titel, muss auch die Leitung zu
    ziel.on('close', () => { try { abbruch.abort(); } catch { /* schon zu */ } });

    /** Einen Abschnitt holen; liefert true, wenn alles da ist. */
    const abschnittHolen = async () => {
        const kopfzeilen = gelesen > 0 ? { range: `bytes=${gelesen}-` } : {};
        const antwort = await fetch(adresse, { headers: kopfzeilen, signal: abbruch.signal });

        if (!antwort.ok) throw new Error(`HTTP ${antwort.status}`);
        if (!antwort.body) throw new Error('Antwort ohne Inhalt');

        // Nur die erste Antwort kennt die volle Laenge; Radio hat gar keine
        if (gesamt === null && gelesen === 0) {
            const laenge = antwort.headers.get('content-length');
            gesamt = laenge ? Number(laenge) : null;
        }

        const quelle = Readable.fromWeb(antwort.body);
        quelle.on('data', (stueck) => { gelesen += stueck.length; });
        quelle.pipe(ziel, { end: false });

        await new Promise((fertig, fehler) => {
            quelle.once('end', fertig);
            quelle.once('error', fehler);
        });

        // Ohne bekannte Laenge gilt das Ende als das Ende
        return gesamt === null || gelesen >= gesamt;
    };

    let letzterFehler = null;

    const lauf = async () => {
        while (!ziel.destroyed) {
            try {
                letzterFehler = null;
                if (await abschnittHolen()) { ziel.end(); return; }
                // Vorzeitig zu Ende - das zaehlt als Fehlversuch
                letzterFehler = 'Leitung endete vorzeitig';
            } catch (err) {
                if (abbruch.signal.aborted) return;
                letzterFehler = err.message;
                if (versuche >= maxVersuche) { ziel.destroy(err); return; }
            }

            if (versuche >= maxVersuche) { ziel.end(); return; }
            versuche++;
            protokoll('warn',
                `[Musik] Tonstrom bei Byte ${gelesen} von ${gesamt ?? '?'} abgerissen` +
                `${letzterFehler ? ` (${letzterFehler})` : ''}, Versuch ${versuche} von ${maxVersuche}`
            );
        }
    };

    lauf().catch(err => { try { ziel.destroy(err); } catch { /* schon zu */ } });

    return ziel;
}

/**
 * Ob yt-dlp erreichbar ist.
 *
 * Gedacht fuer den Start: lieber einmal deutlich im Log sagen, dass Ton
 * nicht gehen wird, als es bei jedem Titel einzeln herauszufinden.
 *
 * @returns {Promise<{da: boolean, version: string|null, pfad: string}>}
 */
/**
 * Tonstrom aus einer Datei auf der Platte.
 *
 * Der einfachste Fall im ganzen Modul - und der zuverlaessigste: kein yt-dlp,
 * kein Netz, keine Drosselung, kein Abriss. ffmpeg bekommt hier ohnehin einen
 * Node-Strom und keine Adresse, also passt eine Datei ohne Umbau in denselben
 * Weg wie alles andere.
 *
 * @param {string} pfad Absoluter Pfad zur Datei
 * @returns {import('stream').Readable} Datenstrom
 */
function tonstromVonDatei(pfad) {
    const { createReadStream } = require('fs');

    const strom = createReadStream(pfad);

    // Ohne diesen Zuhoerer beendet ein Lesefehler den ganzen Vorgang: ein
    // `error` ohne Empfaenger ist in Node ein unbehandelter Ausnahmefall.
    strom.on('error', (fehler) => {
        protokoll('warn', `[Musik] Datei nicht lesbar (${pfad}): ${fehler.message}`);
    });

    return strom;
}

async function verfuegbar() {
    const pfad = ytdlpFinden();
    try {
        const ausgabe = await ytdlpAufrufen(['--version']);
        return { da: true, version: ausgabe.trim(), pfad };
    } catch (err) {
        protokoll('warn', `[Musik] yt-dlp nicht einsatzbereit: ${err.message}`);
        return { da: false, version: null, pfad };
    }
}

module.exports = { tonstromVonSeite, tonstromVonAdresse, tonstromVonDatei, verfuegbar, ytdlpFinden, FORMATWAHL };
