'use strict';

/**
 * Ein Zip-Archiv lesen, ohne es zu laden (K226, Pack-Befund Stufe 2).
 *
 * ── Warum ───────────────────────────────────────────────────────────────────
 *
 * Ein Modpack-Archiv ist groß (20 meistgeladene Server-Packs, gemessen
 * 2026-10-14: Median 90 MB, bis 423 MB), seine Mods zusammen ein Vielfaches.
 * Gebraucht werden daraus nur das Inhaltsverzeichnis und einzelne kleine
 * Dateien (`modrinth.index.json`, `META-INF/mods.toml`). Ein Zip führt sein
 * Verzeichnis am ENDE, und jeder Eintrag nennt, wo seine Daten liegen — mit
 * HTTP-Range sind das zwei, drei kleine Abrufe statt hunderter Megabyte.
 *
 * ── Zwei Quellen, ein Leser ─────────────────────────────────────────────────
 *
 * `fernQuelle` liest über das Netz, `pufferQuelle` aus dem Speicher: Ein Jar,
 * das in einem Jar steckt (Jar-in-Jar), wird als Eintrag geholt und dann mit
 * demselben Leser geöffnet.
 *
 * ── Was er nicht kann, sagt er ──────────────────────────────────────────────
 *
 * Verschlüsselte Einträge und andere Verfahren als „gespeichert" und
 * „deflate" werden abgewiesen, nicht geraten. Jede Grenze unten wirft mit
 * einem Satz, der die Zahl nennt.
 */

const zlib = require('zlib');

const SIG_ENDE = 0x06054b50;
const SIG_ZENTRAL = 0x02014b50;
const SIG_LOKAL = 0x04034b50;
const SIG_ZIP64_ORT = 0x07064b50;
const SIG_ZIP64_ENDE = 0x06064b50;

/** Das Ende eines Zips: 22 Byte, davor höchstens 65535 Byte Kommentar. */
const ENDE_HOECHSTENS = 22 + 65535;
/** So viel vom Ende kommt mit dem ersten Abruf — meist liegt das Verzeichnis schon darin. */
const SCHWANZ = 256 * 1024;
/** Ein Verzeichnis darüber ist kein Modpack und kein Mod. */
const VERZEICHNIS_GRENZE = 32 * 1024 * 1024;
/** Antwortet ein Host ohne Range mit der ganzen Datei, dann höchstens so viel. */
const GANZ_GRENZE = 64 * 1024 * 1024;
const FRIST_MS = 30000;

/** @returns {{groesse: number, lies: (von: number, laenge: number) => Promise<Buffer>, zaehler: Object}} */
function pufferQuelle(puffer) {
    return {
        groesse: puffer.length,
        zaehler: { abrufe: 0, bytes: 0 },
        async lies(von, laenge) {
            if (von < 0 || von + laenge > puffer.length) throw new Error('Zip: Bereich liegt außerhalb der Datei');
            return puffer.subarray(von, von + laenge);
        },
    };
}

/**
 * Eine Datei auf einem Host, der Range kann.
 *
 * Der erste Abruf holt das Ende (dort liegt das Verzeichnis) und erfährt dabei
 * die Größe. Was später gelesen wird und in diesem Stück liegt, kostet keinen
 * weiteren Abruf.
 *
 * @param {string} adresse
 * @param {{abruf?: Function, kopf?: Object, zaehler?: Object, groesse?: number, schwanz?: number}} optionen
 *        `zaehler` wird fortgeschrieben (`abrufe`, `bytes`) — mehrere Quellen
 *        können denselben teilen.
 */
async function fernQuelle(adresse, optionen = {}) {
    const abruf = optionen.abruf || fetch;
    const kopf = optionen.kopf || {};
    const zaehler = optionen.zaehler || { abrufe: 0, bytes: 0 };

    const hole = async (bereich) => {
        const antwort = await abruf(adresse, {
            headers: { ...kopf, Range: `bytes=${bereich}` },
            signal: AbortSignal.timeout(FRIST_MS),
        });
        zaehler.abrufe++;
        if (antwort.status !== 206 && antwort.status !== 200) {
            // `netz`: Das liegt am Abruf, nicht an der Datei — wer liest, versucht es später wieder.
            throw Object.assign(new Error(`Zip: ${new URL(adresse).hostname} antwortete ${antwort.status}`), { netz: true, status: antwort.status });
        }
        if (antwort.status === 200) {
            const laenge = Number(antwort.headers.get('content-length')) || 0;
            if (laenge > GANZ_GRENZE) {
                throw new Error(`Zip: ${new URL(adresse).hostname} liefert keine Teilstücke, und die Datei hat ${laenge} Byte`);
            }
        }
        const puffer = Buffer.from(await antwort.arrayBuffer());
        zaehler.bytes += puffer.length;
        return { antwort, puffer };
    };

    const lageAus = (antwort) => {
        const lage = /bytes (\d+)-(\d+)\/(\d+)/.exec(antwort.headers.get('content-range') || '');
        if (!lage) throw new Error('Zip: Antwort ohne Content-Range');
        return { von: Number(lage[1]), gesamt: Number(lage[3]) };
    };

    // ── Die Größe muss vorher bekannt sein ──────────────────────────────────
    //
    // „Die letzten N Byte" (`bytes=-N`) beantwortet cdn.modrinth.com mit 501
    // (gemessen 2026-11-12), „von–bis" mit 206. Wer die Größe kennt (Modrinth
    // nennt sie an jeder Datei), spart den Abruf, der nur nach ihr fragt.
    //
    // Die angekündigte Größe ist aber nur ein Hinweis: Im Verzeichnis von
    // BMC4 v59 weicht `fileSize` bei 14 von 309 Dateien von der Datei ab (meist
    // um ein Byte). Gilt, was der Host in `Content-Range` nennt.
    const schwanzLaenge = Number(optionen.schwanz) || SCHWANZ;
    const holeSchwanz = (g) => hole(`${Math.max(0, g - schwanzLaenge)}-${g - 1}`);

    let groesse = Number(optionen.groesse) || 0;
    let erste = null;
    if (groesse) {
        // Liegt der Hinweis über dem Ende, antwortet der Host mit 416 — dann wird gefragt.
        erste = await holeSchwanz(groesse).catch((fehler) => { if (fehler.status === 416) return null; throw fehler; });
        if (erste && erste.antwort.status === 206 && lageAus(erste.antwort).gesamt !== groesse) {
            groesse = lageAus(erste.antwort).gesamt;
            erste = await holeSchwanz(groesse);
        }
    }
    if (!erste) {
        const frage = await hole('0-0');
        // Ohne Range kam die ganze Datei: dann ist sie eben im Speicher.
        if (frage.antwort.status === 200) return { ...pufferQuelle(frage.puffer), zaehler };
        groesse = lageAus(frage.antwort).gesamt;
        erste = await holeSchwanz(groesse);
    }
    if (erste.antwort.status === 200) return { ...pufferQuelle(erste.puffer), zaehler };
    const lage = lageAus(erste.antwort);
    if (lage.gesamt !== groesse) {
        throw new Error(`Zip: Die Datei hat ${lage.gesamt} Byte, erwartet waren ${groesse}`);
    }
    const schwanzVon = lage.von;
    const schwanz = erste.puffer;

    return {
        groesse,
        zaehler,
        async lies(von, laenge) {
            if (von < 0 || von + laenge > groesse) throw new Error('Zip: Bereich liegt außerhalb der Datei');
            if (laenge === 0) return Buffer.alloc(0);
            if (von >= schwanzVon) return schwanz.subarray(von - schwanzVon, von - schwanzVon + laenge);
            const { antwort, puffer } = await hole(`${von}-${von + laenge - 1}`);
            if (antwort.status !== 206 || puffer.length !== laenge) {
                throw new Error(`Zip: Teilstück ${von}+${laenge} kam nicht wie verlangt (${antwort.status}, ${puffer.length} Byte)`);
            }
            return puffer;
        },
    };
}

/** 64-Bit-Zahl als Number — Archive über 2^53 Byte gibt es hier nicht. */
function lese64(puffer, stelle) {
    const wert = puffer.readBigUInt64LE(stelle);
    if (wert > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Zip: Zahl zu groß');
    return Number(wert);
}

/**
 * Das Inhaltsverzeichnis.
 *
 * @returns {Promise<Array<{name: string, verfahren: number, komprimiert: number,
 *           unkomprimiert: number, versatz: number, verschluesselt: boolean, ordner: boolean}>>}
 */
async function verzeichnis(quelle) {
    // Das Ende steht fast immer in den letzten 22 Byte (kein Kommentar). Erst
    // wenn es dort nicht ist, wird so weit zurückgelesen, wie ein Kommentar
    // reichen darf — sonst kostete jede Datei 64 KB nur für die Suche.
    const sucheEnde = async (laenge) => {
        const von = quelle.groesse - laenge;
        const puffer = await quelle.lies(von, laenge);
        for (let i = puffer.length - 22; i >= 0; i--) {
            if (puffer.readUInt32LE(i) === SIG_ENDE) return { puffer, stelle: i };
        }
        return null;
    };
    const kurz = Math.min(quelle.groesse, 22 + 20 + 1024);
    const fund = (quelle.groesse >= 22 ? await sucheEnde(kurz) : null)
        || (kurz < Math.min(quelle.groesse, ENDE_HOECHSTENS) ? await sucheEnde(Math.min(quelle.groesse, ENDE_HOECHSTENS)) : null);
    if (!fund) throw new Error('Zip: kein Verzeichnisende gefunden — keine Zip-Datei');
    const { puffer: ende, stelle } = fund;

    let anzahl = ende.readUInt16LE(stelle + 10);
    let laenge = ende.readUInt32LE(stelle + 12);
    let versatz = ende.readUInt32LE(stelle + 16);

    if (anzahl === 0xFFFF || laenge === 0xFFFFFFFF || versatz === 0xFFFFFFFF) {
        // Zip64: Vor dem Ende steht ein Wegweiser auf das große Ende.
        const ortStelle = stelle - 20;
        if (ortStelle < 0 || ende.readUInt32LE(ortStelle) !== SIG_ZIP64_ORT) {
            throw new Error('Zip: Zip64 ohne Wegweiser');
        }
        const grossesEnde = await quelle.lies(lese64(ende, ortStelle + 8), 56);
        if (grossesEnde.readUInt32LE(0) !== SIG_ZIP64_ENDE) throw new Error('Zip: Zip64-Ende nicht gefunden');
        anzahl = lese64(grossesEnde, 32);
        laenge = lese64(grossesEnde, 40);
        versatz = lese64(grossesEnde, 48);
    }
    if (laenge > VERZEICHNIS_GRENZE) throw new Error(`Zip: Verzeichnis hat ${laenge} Byte`);

    const roh = await quelle.lies(versatz, laenge);
    const eintraege = [];
    let p = 0;
    for (let i = 0; i < anzahl; i++) {
        if (p + 46 > roh.length || roh.readUInt32LE(p) !== SIG_ZENTRAL) {
            throw new Error(`Zip: Verzeichnis bricht bei Eintrag ${i} von ${anzahl} ab`);
        }
        const merkmale = roh.readUInt16LE(p + 8);
        const nameLaenge = roh.readUInt16LE(p + 28);
        const zusatzLaenge = roh.readUInt16LE(p + 30);
        const kommentarLaenge = roh.readUInt16LE(p + 32);
        const eintrag = {
            name: roh.toString('utf8', p + 46, p + 46 + nameLaenge),
            verfahren: roh.readUInt16LE(p + 10),
            komprimiert: roh.readUInt32LE(p + 20),
            unkomprimiert: roh.readUInt32LE(p + 24),
            versatz: roh.readUInt32LE(p + 42),
            verschluesselt: (merkmale & 1) === 1,
        };
        // Zip64-Zusatz: nur die Felder, die oben am Anschlag stehen, in fester Folge.
        let z = p + 46 + nameLaenge;
        const zEnde = z + zusatzLaenge;
        while (z + 4 <= zEnde) {
            const kennung = roh.readUInt16LE(z);
            const groesse = roh.readUInt16LE(z + 2);
            if (kennung === 0x0001) {
                let f = z + 4;
                if (eintrag.unkomprimiert === 0xFFFFFFFF) { eintrag.unkomprimiert = lese64(roh, f); f += 8; }
                if (eintrag.komprimiert === 0xFFFFFFFF) { eintrag.komprimiert = lese64(roh, f); f += 8; }
                if (eintrag.versatz === 0xFFFFFFFF) { eintrag.versatz = lese64(roh, f); }
            }
            z += 4 + groesse;
        }
        eintrag.ordner = eintrag.name.endsWith('/');
        eintraege.push(eintrag);
        p += 46 + nameLaenge + zusatzLaenge + kommentarLaenge;
    }
    return eintraege;
}

/**
 * Den Inhalt eines Eintrags.
 *
 * @param {number} grenze  so groß darf er entpackt höchstens sein
 */
async function liesEintrag(quelle, eintrag, grenze) {
    if (eintrag.verschluesselt) throw new Error(`Zip: ${eintrag.name} ist verschlüsselt`);
    if (eintrag.verfahren !== 0 && eintrag.verfahren !== 8) {
        throw new Error(`Zip: ${eintrag.name} nutzt Verfahren ${eintrag.verfahren}`);
    }
    if (eintrag.unkomprimiert > grenze || eintrag.komprimiert > grenze) {
        throw new Error(`Zip: ${eintrag.name} hat ${eintrag.unkomprimiert} Byte, erlaubt sind ${grenze}`);
    }

    // Der lokale Kopf wiederholt den Namen und darf einen ANDEREN Zusatz
    // tragen als das Verzeichnis — seine Länge steht erst in ihm selbst.
    // Mit etwas Zugabe gelesen, reicht fast immer ein Abruf.
    const ZUGABE = 30 + Buffer.byteLength(eintrag.name) + 512;
    const vermutet = Math.min(ZUGABE + eintrag.komprimiert, quelle.groesse - eintrag.versatz);
    let stueck = await quelle.lies(eintrag.versatz, vermutet);
    if (stueck.length < 30 || stueck.readUInt32LE(0) !== SIG_LOKAL) {
        throw new Error(`Zip: ${eintrag.name} hat keinen lokalen Kopf`);
    }
    const anfang = 30 + stueck.readUInt16LE(26) + stueck.readUInt16LE(28);
    if (stueck.length < anfang + eintrag.komprimiert) {
        stueck = await quelle.lies(eintrag.versatz, anfang + eintrag.komprimiert);
    }
    const daten = stueck.subarray(anfang, anfang + eintrag.komprimiert);
    if (eintrag.verfahren === 0) return Buffer.from(daten);
    return zlib.inflateRawSync(daten, { maxOutputLength: grenze });
}

module.exports = { fernQuelle, pufferQuelle, verzeichnis, liesEintrag };
