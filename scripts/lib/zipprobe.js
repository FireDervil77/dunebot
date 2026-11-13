'use strict';

/**
 * Zip-Archive für Wächter bauen und wie ein Host mit Range ausliefern.
 *
 * Herausgelöst aus `check-pack-befund.js` (K226), seit `check-mod-pflichten.js`
 * (K379) dasselbe braucht — eine Nachbildung, nicht zwei, die auseinanderlaufen.
 */

const zlib = require('zlib');

// ── Ein Zip bauen ───────────────────────────────────────────────────────────
function baueZip(dateien, { packen = true, kommentar = '' } = {}) {
    const teile = [];
    const zentral = [];
    let versatz = 0;
    for (const [name, inhaltRoh] of Object.entries(dateien)) {
        const inhalt = Buffer.isBuffer(inhaltRoh) ? inhaltRoh : Buffer.from(String(inhaltRoh));
        const daten = packen ? zlib.deflateRawSync(inhalt) : inhalt;
        const nameB = Buffer.from(name);
        const lokal = Buffer.alloc(30);
        lokal.writeUInt32LE(0x04034b50, 0);
        lokal.writeUInt16LE(20, 4);
        lokal.writeUInt16LE(packen ? 8 : 0, 8);
        lokal.writeUInt32LE(zlib.crc32(inhalt), 14);
        lokal.writeUInt32LE(daten.length, 18);
        lokal.writeUInt32LE(inhalt.length, 22);
        lokal.writeUInt16LE(nameB.length, 26);
        // Der lokale Kopf trägt einen Zusatz, den das Verzeichnis nicht nennt —
        // genau der Fall, für den der Leser den lokalen Kopf auswerten muss.
        const zusatz = Buffer.from([0xfe, 0xca, 0x00, 0x00]);
        lokal.writeUInt16LE(zusatz.length, 28);
        teile.push(lokal, nameB, zusatz, daten);

        const z = Buffer.alloc(46);
        z.writeUInt32LE(0x02014b50, 0);
        z.writeUInt16LE(packen ? 8 : 0, 10);
        z.writeUInt32LE(zlib.crc32(inhalt), 16);
        z.writeUInt32LE(daten.length, 20);
        z.writeUInt32LE(inhalt.length, 24);
        z.writeUInt16LE(nameB.length, 28);
        z.writeUInt32LE(versatz, 42);
        zentral.push(z, nameB);
        versatz += 30 + nameB.length + zusatz.length + daten.length;
    }
    const zentralPuffer = Buffer.concat(zentral);
    const ende = Buffer.alloc(22);
    ende.writeUInt32LE(0x06054b50, 0);
    ende.writeUInt16LE(Object.keys(dateien).length, 8);
    ende.writeUInt16LE(Object.keys(dateien).length, 10);
    ende.writeUInt32LE(zentralPuffer.length, 12);
    ende.writeUInt32LE(versatz, 16);
    ende.writeUInt16LE(Buffer.byteLength(kommentar), 20);
    return Buffer.concat([...teile, zentralPuffer, ende, Buffer.from(kommentar)]);
}

/** Ein Host, der sich verhält wie cdn.modrinth.com am 2026-11-12. */
function baueHost(dateien) {
    const stand = { abrufe: [], bytes: 0 };
    const abruf = async (adresse, { headers } = {}) => {
        const puffer = dateien.get(String(adresse));
        const bereich = String(headers?.Range || '');
        stand.abrufe.push(`${adresse} ${bereich}`);
        const kopf = (werte) => ({ get: (n) => werte[n.toLowerCase()] ?? null });
        if (!puffer) return { status: 404, headers: kopf({}), arrayBuffer: async () => new ArrayBuffer(0) };
        if (puffer === 'netz') throw new TypeError('fetch failed');
        const m = /^bytes=(\d+)-(\d+)$/.exec(bereich);
        // „Die letzten N Byte" kann der Host nicht.
        if (!m) return { status: 501, headers: kopf({}), arrayBuffer: async () => new ArrayBuffer(0) };
        const von = Number(m[1]);
        if (von >= puffer.length) return { status: 416, headers: kopf({}), arrayBuffer: async () => new ArrayBuffer(0) };
        const bis = Math.min(Number(m[2]), puffer.length - 1);
        const stueck = puffer.subarray(von, bis + 1);
        stand.bytes += stueck.length;
        return {
            status: 206,
            headers: kopf({ 'content-range': `bytes ${von}-${bis}/${puffer.length}` }),
            arrayBuffer: async () => stueck.buffer.slice(stueck.byteOffset, stueck.byteOffset + stueck.length),
        };
    };
    return { abruf, stand };
}

module.exports = { baueZip, baueHost };
