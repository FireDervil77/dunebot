#!/usr/bin/env node
/**
 * Löst die Docker-Images aller Spielpakete auf feste Digests auf.
 *
 * Warum das nötig ist: In `game_data.docker_images` steht heute nur `image:tag`.
 * Ein Tag ist aber kein Fixpunkt — `steamcmd:debian` kann morgen auf ein anderes
 * Image zeigen, mit anderen Bibliotheken. Der Server startet dann anders als
 * gestern, ohne dass sich bei uns irgendetwas geändert hätte, und niemand kann
 * hinterher sagen, woran es lag. Ein Digest (`sha256:…`) benennt genau einen
 * Inhalt und kann sich nicht bewegen.
 *
 * Das Skript hat zwei Aufgaben, die zusammengehören:
 *
 *   1. BESTAND  — welches Image steckt in welchem Paket, ist es erreichbar,
 *                 und wie lautet sein Digest? Das Ergebnis ist zugleich die
 *                 Einkaufsliste für einen eigenen Spiegel: mehrere Pakete
 *                 teilen sich dasselbe Image, die Liste ist kürzer als der
 *                 Paketbestand.
 *   2. WANDERUNG — hat sich ein Tag seit der letzten Messung bewegt? Dafür
 *                 vergleicht der Lauf gegen die zuletzt abgelegte Bestandsdatei.
 *                 Genau dieser Fall ist der stille, den wir sehen wollen.
 *
 * Die Bildauswahl benutzt bewusst `waehleDockerImage` aus dem Start-Payload —
 * dieselbe Entscheidung wie im Betrieb. Wo Schlüssel und ermittelte Adresse
 * auseinandergehen, steht im Bestand ein Etikett statt einer Adresse (z.B.
 * "Wine Latest"), und heute rettet uns nur eine Rateheuristik. Solche Pakete
 * meldet der Lauf gesondert.
 *
 *   node scripts/images-pinnen.js              # nur messen und berichten
 *   node scripts/images-pinnen.js --schreiben  # Digests in game_data.image ablegen
 *
 * Ohne `--schreiben` fasst das Skript die Datenbank nicht an.
 *
 * @author FireDervil
 */

'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../apps/dashboard/.env') });

const fs    = require('fs');
const path  = require('path');
const https = require('https');
const mysql = require('mysql2/promise');

const { ServiceManager } = require('dunebot-core');
if (!ServiceManager.has('Logger')) {
    const still = () => {};
    ServiceManager.register('Logger', { debug: still, info: still, warn: still, error: still });
}
const { waehleDockerImage } = require(
    path.join(__dirname, '../plugins/gameserver/dashboard/helpers/StartPayload')
);

const BESTAND_ORDNER = path.join(__dirname, '../docs/spielpakete/bestand');
const SCHREIBEN      = process.argv.includes('--schreiben');
const ZEITGRENZE_MS  = 15000;

// ─────────────────────────────────────────────────────────────────────────────
// HTTP
// ─────────────────────────────────────────────────────────────────────────────

/** HTTPS-Anfrage mit Zeitgrenze. Antwortet nie mit einer Ausnahme. */
function anfrage(url, { methode = 'GET', kopfzeilen = {} } = {}) {
    return new Promise(fertig => {
        const req = https.request(url, { method: methode, headers: kopfzeilen }, res => {
            let roh = '';
            res.on('data', stueck => { roh += stueck; });
            res.on('end', () => fertig({ code: res.statusCode, kopf: res.headers, koerper: roh }));
        });
        req.setTimeout(ZEITGRENZE_MS, () => { req.destroy(); fertig({ code: 0, kopf: {}, fehler: 'Zeitgrenze' }); });
        req.on('error', err => fertig({ code: 0, kopf: {}, fehler: err.message }));
        req.end();
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// Registry
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Zerlegt eine Image-Adresse in Registry, Pfad und Tag.
 * "ghcr.io/parkervcp/games:valheim" → { host, pfad: "parkervcp/games", tag: "valheim" }
 */
function zerlege(adresse) {
    let rest = String(adresse || '').trim();
    if (!rest) return null;

    // Ein Digest in der Adresse ist bereits ein Fixpunkt.
    const digestTeilung = rest.split('@');
    const mitgebrachterDigest = digestTeilung.length > 1 ? digestTeilung[1] : null;
    rest = digestTeilung[0];

    const teile = rest.split('/');
    // Nur der erste Abschnitt mit Punkt oder Doppelpunkt ist ein Registry-Name;
    // sonst ist es Docker Hub ("parkervcp/yolks" ohne Host).
    const host = (teile.length > 1 && /[.:]/.test(teile[0])) ? teile.shift() : 'docker.io';

    const letzter = teile[teile.length - 1] || '';
    let tag = 'latest';
    if (letzter.includes(':')) {
        const [name, gefundenerTag] = letzter.split(':');
        teile[teile.length - 1] = name;
        tag = gefundenerTag || 'latest';
    }

    let pfad = teile.join('/');
    // Docker Hub führt einzelne Namen unter "library/".
    if (host === 'docker.io' && !pfad.includes('/')) pfad = `library/${pfad}`;

    return { host, pfad, tag, digest: mitgebrachterDigest };
}

/** Holt ein Lese-Token für die Registry (anonym). */
async function token(host, pfad) {
    const quellen = {
        'ghcr.io':   `https://ghcr.io/token?scope=repository:${pfad}:pull&service=ghcr.io`,
        'docker.io': `https://auth.docker.io/token?service=registry.docker.io&scope=repository:${pfad}:pull`,
    };
    const url = quellen[host];
    if (!url) return null;

    const antwort = await anfrage(url);
    if (antwort.code !== 200) return null;
    try { return JSON.parse(antwort.koerper).token || null; } catch { return null; }
}

const MANIFEST_ARTEN = [
    'application/vnd.oci.image.index.v1+json',
    'application/vnd.docker.distribution.manifest.list.v2+json',
    'application/vnd.oci.image.manifest.v1+json',
    'application/vnd.docker.distribution.manifest.v2+json',
].join(',');

/** Ermittelt den Digest zu einer Image-Adresse. */
async function ermittleDigest(adresse) {
    const teile = zerlege(adresse);
    if (!teile)          return { fehler: 'Adresse nicht lesbar' };
    if (teile.digest)    return { digest: teile.digest, hinweis: 'bereits gepinnt' };

    const registryHost = teile.host === 'docker.io' ? 'registry-1.docker.io' : teile.host;
    const zugang = await token(teile.host, teile.pfad);
    if (!zugang) return { fehler: `kein Zugang zu ${teile.host}` };

    const antwort = await anfrage(
        `https://${registryHost}/v2/${teile.pfad}/manifests/${teile.tag}`,
        { methode: 'HEAD', kopfzeilen: { Authorization: `Bearer ${zugang}`, Accept: MANIFEST_ARTEN } }
    );

    if (antwort.code === 404) return { fehler: 'Image oder Tag existiert nicht mehr' };
    if (antwort.code !== 200) return { fehler: antwort.fehler || `HTTP ${antwort.code}` };

    const digest = antwort.kopf['docker-content-digest'];
    return digest ? { digest } : { fehler: 'Registry nennt keinen Digest' };
}

// ─────────────────────────────────────────────────────────────────────────────
// Bestandsdateien
// ─────────────────────────────────────────────────────────────────────────────

/** Liest die jüngste abgelegte Bestandsdatei, um Tag-Wanderungen zu erkennen. */
function letzterBestand() {
    if (!fs.existsSync(BESTAND_ORDNER)) return null;
    const dateien = fs.readdirSync(BESTAND_ORDNER)
        .filter(n => n.startsWith('images-') && n.endsWith('.json'))
        .sort();
    if (!dateien.length) return null;
    try {
        const roh = fs.readFileSync(path.join(BESTAND_ORDNER, dateien[dateien.length - 1]), 'utf8');
        return { name: dateien[dateien.length - 1], daten: JSON.parse(roh) };
    } catch {
        return null;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Hauptlauf
// ─────────────────────────────────────────────────────────────────────────────

(async () => {
    const db = await mysql.createConnection({
        host:     process.env.MYSQL_HOST,
        port:     Number(process.env.MYSQL_PORT) || 3306,
        user:     process.env.MYSQL_USER,
        password: process.env.MYSQL_PASSWORD,
        database: process.env.MYSQL_DATABASE,
    });

    const [pakete] = await db.query(
        'SELECT id, slug, name, game_data FROM addon_marketplace ORDER BY slug'
    );
    const [belegung] = await db.query(
        'SELECT addon_marketplace_id AS id, COUNT(*) AS anzahl FROM gameservers GROUP BY addon_marketplace_id'
    );
    const serverJePaket = new Map(belegung.map(z => [z.id, Number(z.anzahl)]));

    const vorher = letzterBestand();
    const vorherDigests = new Map(
        (vorher?.daten?.pakete || []).map(p => [p.slug, p.digest])
    );

    console.log(`\nSpielpakete: Bildbestand  (${pakete.length} Pakete`
        + `${vorher ? `, Vergleich gegen ${vorher.name}` : ', erste Messung'})\n`);

    const ergebnisse = [];
    let offen = 0, gewandert = 0, etiketten = 0;

    for (const paket of pakete) {
        let daten = {};
        try {
            daten = typeof paket.game_data === 'string' ? JSON.parse(paket.game_data) : (paket.game_data || {});
        } catch { /* unlesbares game_data behandeln wir wie fehlende Bilder */ }

        const bilder   = daten.docker_images || {};
        const adresse  = waehleDockerImage(bilder);
        const schluessel = Object.keys(bilder)[0] || null;
        // Wenn der erste Schlüssel nicht die gewählte Adresse ist, steht dort ein
        // Etikett ("Wine Latest") — dann hängt der Betrieb an der Rateheuristik.
        const etikettStattAdresse = Boolean(adresse && schluessel && schluessel !== adresse);
        if (etikettStattAdresse) etiketten++;

        const auflösung = adresse ? await ermittleDigest(adresse) : { fehler: 'kein Image im Paket' };
        if (!auflösung.digest) offen++;

        const vorherigerDigest = vorherDigests.get(paket.slug) || null;
        const wanderung = Boolean(
            vorherigerDigest && auflösung.digest && vorherigerDigest !== auflösung.digest
        );
        if (wanderung) gewandert++;

        const anzahlServer = serverJePaket.get(paket.id) || 0;

        ergebnisse.push({
            id: paket.id, slug: paket.slug, adresse: adresse || null,
            digest: auflösung.digest || null, fehler: auflösung.fehler || null,
            etikett_statt_adresse: etikettStattAdresse,
            server: anzahlServer, gewandert, vorher: vorherigerDigest,
        });

        const marke = auflösung.digest ? (wanderung ? '≠' : '✔') : '✘';
        const anhang = [
            anzahlServer ? `${anzahlServer} Server` : null,
            etikettStattAdresse ? `Etikett "${schluessel}"` : null,
            wanderung ? `WAR ${vorherigerDigest.slice(0, 19)}…` : null,
        ].filter(Boolean).join(' · ');

        console.log(
            `${marke} ${paket.slug.padEnd(28)} ${(adresse || '—').padEnd(44)} `
            + `${auflösung.digest ? auflösung.digest.slice(0, 26) + '…' : auflösung.fehler}`
            + (anhang ? `   [${anhang}]` : '')
        );
    }

    // ── Einkaufsliste: verschiedene Images, nicht verschiedene Pakete ────────
    const jeDigest = new Map();
    for (const e of ergebnisse) {
        if (!e.digest) continue;
        if (!jeDigest.has(e.digest)) jeDigest.set(e.digest, { adressen: new Set(), pakete: [] });
        jeDigest.get(e.digest).adressen.add(e.adresse);
        jeDigest.get(e.digest).pakete.push(e.slug);
    }

    console.log(`\n── Einkaufsliste für einen Spiegel: ${jeDigest.size} verschiedene Images ──`);
    for (const [digest, eintrag] of jeDigest) {
        console.log(`   ${[...eintrag.adressen].join(', ').padEnd(46)} ${digest.slice(0, 19)}…  `
            + `(${eintrag.pakete.length} Paket${eintrag.pakete.length === 1 ? '' : 'e'})`);
    }

    console.log(`\nAufgelöst: ${ergebnisse.length - offen}/${ergebnisse.length}`
        + ` · nicht auflösbar: ${offen}`
        + ` · gewandert: ${gewandert}`
        + ` · Etikett statt Adresse: ${etiketten}`);

    // ── Bestand ablegen ──────────────────────────────────────────────────────
    fs.mkdirSync(BESTAND_ORDNER, { recursive: true });
    const heute = new Date().toISOString().slice(0, 10);
    const ziel  = path.join(BESTAND_ORDNER, `images-${heute}.json`);
    fs.writeFileSync(ziel, JSON.stringify({
        gemessen_am: new Date().toISOString(),
        pakete: ergebnisse,
        spiegel: [...jeDigest.entries()].map(([digest, e]) => ({
            digest, adressen: [...e.adressen], pakete: e.pakete,
        })),
    }, null, 2) + '\n');
    console.log(`\nBestand abgelegt: docs/spielpakete/bestand/images-${heute}.json`);

    // ── Schreibmodus ─────────────────────────────────────────────────────────
    if (SCHREIBEN) {
        let geschrieben = 0;
        for (const e of ergebnisse) {
            if (!e.digest || !e.adresse) continue;
            // `db.query` liefert [rows, fields] — die Zeile steckt also in rows[0].
            // Ohne das zweite Auspacken stand hier das Array selbst, `game_data`
            // war undefined und der Lauf brach beim ersten Paket ab (2026-08-15).
            const [zeilen] = await db.query('SELECT game_data FROM addon_marketplace WHERE id = ?', [e.id]);
            const zeile = zeilen[0];
            if (!zeile) continue;

            let daten;
            try {
                daten = typeof zeile.game_data === 'string' ? JSON.parse(zeile.game_data) : zeile.game_data;
            } catch { continue; }
            if (!daten || typeof daten !== 'object') continue;

            const teile = zerlege(e.adresse);
            // Der Digest wird dort abgelegt, wo er auch im künftigen Format steht
            // (`image`, englisch nach E-7), damit die Übersetzung nach FBPKG_v1
            // ihn nicht erneut ermitteln muss. Der Betrieb liest ihn heute nicht.
            daten.image = {
                ...(daten.image || {}),
                ref:    `${teile.host === 'docker.io' ? '' : teile.host + '/'}${teile.pfad}`,
                tag:    teile.tag,
                digest: e.digest,
                pinned_at: new Date().toISOString().slice(0, 10),
            };
            await db.query('UPDATE addon_marketplace SET game_data = ? WHERE id = ?',
                [JSON.stringify(daten), e.id]);
            geschrieben++;
        }
        console.log(`Geschrieben: ${geschrieben} Pakete haben jetzt game_data.image.digest`);
    } else {
        console.log('Nur gemessen — die Datenbank wurde nicht angefasst. Schreiben mit --schreiben.');
    }

    await db.end();
    // Ein nicht auflösbares oder gewandertes Image ist ein Befund, kein Normalfall.
    process.exitCode = (offen > 0 || gewandert > 0) ? 1 : 0;
})().catch(err => {
    console.error('\nFehlgeschlagen:', err.message);
    process.exit(2);
});
