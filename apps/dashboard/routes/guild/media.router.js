/**
 * Guild Media-Router — WordPress-Style Medien-Manager
 * 
 * GET  /media               → Medien-Bibliothek (Galerie)
 * GET  /media/api/list      → JSON API: Medien laden (mit Filter)
 * GET  /media/api/:id       → JSON API: Einzelne Datei-Details
 * POST /media/api/upload    → Datei(en) hochladen
 * PUT  /media/api/:id       → Metadaten updaten (alt_text, title, folder)
 * POST /media/api/verschieben         → mehrere Dateien in einen Ordner
 * POST /media/api/loeschen            → mehrere Dateien löschen
 * POST /media/api/ordner/umbenennen   → Ordner umbenennen oder zusammenführen
 * POST /media/api/ordner/loeschen     → Ordner auflösen (Dateien bleiben)
 * DELETE /media/api/:id     → Datei löschen
 */

'use strict';

const express = require('express');
const router = express.Router({ mergeParams: true });
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { ServiceManager } = require('dunebot-core');
const { richtigstellen } = require('../../helpers/Dateiname');

// ── Erlaubte MIME-Types, und die Endung, unter der wir speichern ──
// SVG ist bewusst nicht dabei: Eine SVG ist ausfuehrbares XML, und `/uploads/media`
// liegt hinter express.static — sie liefe im Browser unter unserer Domain. Fuer
// eine Medienbibliothek reichen die Rasterformate.
//
// Die Endung kommt aus dieser Zuordnung und NICHT aus dem Originalnamen:
// `file.mimetype` bestimmt der hochladende Browser, die Endung bestimmte bisher
// der Dateiname — express.static setzt den Content-Type aber nach der Endung.
// Eine `boese.svg`, als `image/png` deklariert, waere also durch den Filter
// gekommen und danach als `image/svg+xml` ausgeliefert worden. Was hier nicht
// steht, entsteht jetzt gar nicht erst auf der Platte.
const ERLAUBTE_TYPEN = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'image/x-icon': '.ico',
    'image/vnd.microsoft.icon': '.ico'
};
const ALLOWED_MIME_TYPES = Object.keys(ERLAUBTE_TYPEN);
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB

/** Der Ordner, in dem alles landet, was keinen eigenen hat. */
const VORGABE_ORDNER = 'general';

/**
 * Prueft einen Ordnernamen und sagt im Fehlerfall, was erlaubt ist.
 *
 * Die Regel stand vorher dreimal als blosses `/^[a-z0-9-]{1,50}$/` im Code, und
 * die Meldung lautete jedes Mal nur „Ungueltiger Ordnername" — ohne zu sagen,
 * woran es lag. Hier steht sie einmal, mit Begruendung.
 *
 * @param {*} name
 * @returns {{ok: true, name: string} | {ok: false, fehler: string}}
 */
function ordnernamePruefen(name) {
    const wert = String(name ?? '').trim();
    if (!wert) return { ok: false, fehler: 'Bitte einen Ordnernamen angeben.' };
    if (wert.length > 50) return { ok: false, fehler: 'Der Ordnername ist zu lang (höchstens 50 Zeichen).' };
    if (!/^[a-z0-9-]+$/.test(wert)) {
        return {
            ok: false,
            fehler: 'Erlaubt sind nur Kleinbuchstaben, Ziffern und Bindestriche — ' +
                    'also z. B. "icons" oder "banner-gross".'
        };
    }
    return { ok: true, name: wert };
}
// 30 statt 10 seit dem 2026-09-16: Ein Satz Marken-Bilder (rund/card/social/
// section/hero in mehreren Groessen) sind gut dreissig Dateien. Bei 10 brach
// der Upload mitten drin ab. Die Groesse je Datei bleibt bei 5 MB — sie ist
// die Grenze, die wirklich schuetzt.
const MAX_FILES_PER_UPLOAD = 30;

// ── Multer Storage: Guild-basierte Ordner ──
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const guildId = req.params.guildId;
        const uploadDir = path.join(__dirname, '../../uploads/media', guildId);
        fs.mkdirSync(uploadDir, { recursive: true });
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const ext = ERLAUBTE_TYPEN[file.mimetype];
        // fileFilter laeuft vorher, hier duerfte nichts Unbekanntes ankommen —
        // aber eine Datei ohne Endung waere schlimmer als eine abgelehnte.
        if (!ext) return cb(new Error(`Dateityp '${file.mimetype}' ist nicht erlaubt`));
        cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: MAX_FILE_SIZE, files: MAX_FILES_PER_UPLOAD },
    fileFilter: (req, file, cb) => {
        if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error(`Dateityp '${file.mimetype}' ist nicht erlaubt`));
        }
    }
});

// ── Permission-Middleware ──
function requirePermission(permissionKey) {
    return async (req, res, next) => {
        const permissionManager = ServiceManager.get('permissionManager');
        const guildId = res.locals.guildId;
        const userId = res.locals.user?.id;
        if (!userId) return res.status(401).json({ success: false, message: 'Nicht eingeloggt' });
        const hasPermission = await permissionManager.hasPermission(userId, guildId, permissionKey);
        if (!hasPermission) return res.status(403).json({ success: false, message: 'Keine Berechtigung' });
        next();
    };
}

// =====================================================
// GET /guild/:guildId/media — Medien-Bibliothek (View)
// =====================================================
router.get('/', requirePermission('CORE.MEDIA.VIEW'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const themeManager = ServiceManager.get('themeManager');
    const guildId = res.locals.guildId;

    try {
        return themeManager.renderView(res, 'guild/media/index', {
            title: 'Medien',
            activeMenu: `/guild/${guildId}/media`,
            guildId,
            maxFileSize: MAX_FILE_SIZE,
            // Dieselbe Begruendung wie bei den Endungen eine Zeile tiefer, nur
            // wurde sie fuer die ANZAHL vergessen: Die Seite schickte beliebig
            // viele Dateien los, der Server nahm 30. Am 2026-09-16 im
            // Apache-Log aufgefallen — sechs 400er beim Hochladen eines
            // Bildersatzes.
            maxDateien: MAX_FILES_PER_UPLOAD,
            allowedTypes: ALLOWED_MIME_TYPES,
            // Damit die Seite nicht anbietet, was der Server ablehnt — beide
            // kommen aus ERLAUBTE_TYPEN, es gibt also nur eine Wahrheit.
            erlaubteEndungen: [...new Set(Object.values(ERLAUBTE_TYPEN))]
        });
    } catch (error) {
        Logger.error('[Media] Fehler beim Laden:', error);
        res.status(500).send('Fehler beim Laden der Medienbibliothek');
    }
});

// =====================================================
// GET /guild/:guildId/media/api/list — JSON: Medien auflisten
// =====================================================
router.get('/api/list', requirePermission('CORE.MEDIA.VIEW'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    const guildId = res.locals.guildId;

    try {
        const { folder, search, page = 1, limit = 24 } = req.query;
        const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);
        const params = [guildId];
        let where = 'WHERE guild_id = ?';

        if (folder && folder !== 'all') {
            where += ' AND folder = ?';
            params.push(folder);
        }
        if (search) {
            where += ' AND (filename LIKE ? OR title LIKE ? OR alt_text LIKE ?)';
            const term = `%${search}%`;
            params.push(term, term, term);
        }

        const countResult = await dbService.query(`SELECT COUNT(*) as total FROM guild_media ${where}`, params);
        const total = countResult[0]?.total || 0;

        const media = await dbService.query(
            `SELECT * FROM guild_media ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
            [...params, parseInt(limit), offset]
        );

        // Ordner-Statistik
        const folders = await dbService.query(
            'SELECT folder, COUNT(*) as count FROM guild_media WHERE guild_id = ? GROUP BY folder ORDER BY folder',
            [guildId]
        );

        return res.json({
            success: true,
            data: media.map(m => ({
                ...m,
                url: `/uploads/media/${guildId}/${m.stored_name}`
            })),
            folders,
            pagination: {
                total,
                page: parseInt(page),
                limit: parseInt(limit),
                pages: Math.ceil(total / parseInt(limit))
            }
        });
    } catch (error) {
        Logger.error('[Media] Fehler beim Laden der Medien:', error);
        res.status(500).json({ success: false, message: 'Fehler beim Laden' });
    }
});

// =====================================================
// GET /guild/:guildId/media/api/:id — JSON: Einzelne Datei
// =====================================================
router.get('/api/:id', requirePermission('CORE.MEDIA.VIEW'), async (req, res) => {
    const dbService = ServiceManager.get('dbService');
    const guildId = res.locals.guildId;

    const [media] = await dbService.query(
        'SELECT * FROM guild_media WHERE id = ? AND guild_id = ?',
        [req.params.id, guildId]
    );
    if (!media) return res.status(404).json({ success: false, message: 'Datei nicht gefunden' });

    return res.json({
        success: true,
        data: { ...media, url: `/uploads/media/${guildId}/${media.stored_name}` }
    });
});

// =====================================================
// POST /guild/:guildId/media/api/upload — Dateien hochladen
// =====================================================
/**
 * Bereits auf die Platte geschriebene Dateien dieser Anfrage wegraeumen.
 *
 * **Multer schreibt, bevor es abbricht.** Wer 40 Dateien schickt, hat 30 auf
 * der Platte, wenn die 31. den Fehler ausloest — und ohne diesen Aufruf bleiben
 * sie dort. Am 2026-09-16 nachgemessen: 33 verwaiste Dateien, 8,1 MB, die zu
 * keiner Zeile in `guild_media` gehoeren. Aufgeraeumt wurde bis dahin nur im
 * 500er-Zweig, nicht auf den 400ern.
 *
 * @param {Object} req
 */
function hochgeladenesWegraeumen(req) {
    for (const datei of req.files || []) {
        try { fs.unlinkSync(datei.path); } catch { /* schon weg */ }
    }
}

router.post('/api/upload', requirePermission('CORE.MEDIA.UPLOAD'), (req, res, next) => {
    upload.array('files', MAX_FILES_PER_UPLOAD)(req, res, (err) => {
        const abbruch = (nachricht) => {
            hochgeladenesWegraeumen(req);
            return res.status(400).json({ success: false, message: nachricht });
        };
        if (err instanceof multer.MulterError) {
            if (err.code === 'LIMIT_FILE_SIZE') {
                return abbruch(`Datei zu groß (max. ${MAX_FILE_SIZE / 1024 / 1024} MB)`);
            }
            // „Unexpected field" ist die Meldung, die multer beim Ueberschreiten
            // der Dateianzahl ausgibt. Sie sagt niemandem etwas — deshalb hier
            // im Klartext, was wirklich los ist.
            if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') {
                return abbruch(`Zu viele Dateien auf einmal (max. ${MAX_FILES_PER_UPLOAD})`);
            }
            return abbruch(err.message);
        }
        if (err) return abbruch(err.message);
        next();
    });
}, async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    const guildId = res.locals.guildId;
    const userId = res.locals.user.id;
    const folder = req.body.folder || 'general';

    // Ordner-Name validieren
    const ordner = ordnernamePruefen(folder);
    if (!ordner.ok) {
        hochgeladenesWegraeumen(req);
        return res.status(400).json({ success: false, message: ordner.fehler });
    }

    if (!req.files || req.files.length === 0) {
        return res.status(400).json({ success: false, message: 'Keine Dateien hochgeladen' });
    }

    try {
        const results = [];

        for (const file of req.files) {
            let width = null, height = null;

            // Bildgröße ermitteln (für Raster-Bilder)
            if (['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(file.mimetype)) {
                try {
                    // Einfache Header-basierte Größenerkennung
                    const dimensions = getImageDimensions(file.path, file.mimetype);
                    if (dimensions) {
                        width = dimensions.width;
                        height = dimensions.height;
                    }
                } catch { /* Dimension optional */ }
            }

            const result = await dbService.query(
                `INSERT INTO guild_media (guild_id, uploaded_by, filename, stored_name, mime_type, file_size, width, height, folder)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                // Wie im Musik-Upload: multer liest latin1, Browser senden UTF-8.
                [guildId, userId, richtigstellen(file.originalname), file.filename,
                 file.mimetype, file.size, width, height, folder]
            );

            results.push({
                id: result.insertId,
                filename: richtigstellen(file.originalname),
                stored_name: file.filename,
                mime_type: file.mimetype,
                file_size: file.size,
                width, height, folder: ordner.name,
                url: `/uploads/media/${guildId}/${file.filename}`
            });
        }

        Logger.info(`[Media] ${results.length} Datei(en) hochgeladen für Guild ${guildId} von User ${userId}`);
        return res.json({ success: true, data: results });
    } catch (error) {
        Logger.error('[Media] Upload-Fehler:', error);
        hochgeladenesWegraeumen(req);
        res.status(500).json({ success: false, message: 'Upload fehlgeschlagen' });
    }
});

// =====================================================
// PUT /guild/:guildId/media/api/:id — Metadaten updaten
// =====================================================
router.put('/api/:id', requirePermission('CORE.MEDIA.UPLOAD'), async (req, res) => {
    const dbService = ServiceManager.get('dbService');
    const guildId = res.locals.guildId;
    const { alt_text, title, folder } = req.body;

    // Prüfe ob Datei existiert und zu dieser Guild gehört
    const [media] = await dbService.query(
        'SELECT id FROM guild_media WHERE id = ? AND guild_id = ?',
        [req.params.id, guildId]
    );
    if (!media) return res.status(404).json({ success: false, message: 'Datei nicht gefunden' });

    const updates = [];
    const params = [];
    if (alt_text !== undefined) { updates.push('alt_text = ?'); params.push(alt_text.substring(0, 255)); }
    if (title !== undefined) { updates.push('title = ?'); params.push(title.substring(0, 255)); }
    if (folder !== undefined) {
        const ordner = ordnernamePruefen(folder);
        if (!ordner.ok) return res.status(400).json({ success: false, message: ordner.fehler });
        updates.push('folder = ?'); params.push(ordner.name);
    }

    if (updates.length === 0) return res.json({ success: true, message: 'Nichts zu aktualisieren' });

    params.push(req.params.id, guildId);
    await dbService.query(`UPDATE guild_media SET ${updates.join(', ')} WHERE id = ? AND guild_id = ?`, params);

    return res.json({ success: true, message: 'Metadaten aktualisiert' });
});

// =====================================================
// DELETE /guild/:guildId/media/api/:id — Datei löschen
// =====================================================
router.delete('/api/:id', requirePermission('CORE.MEDIA.DELETE'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    const guildId = res.locals.guildId;

    const [media] = await dbService.query(
        'SELECT * FROM guild_media WHERE id = ? AND guild_id = ?',
        [req.params.id, guildId]
    );
    if (!media) return res.status(404).json({ success: false, message: 'Datei nicht gefunden' });

    // Datei vom Dateisystem löschen
    const filePath = path.join(__dirname, '../../uploads/media', guildId, media.stored_name);
    try { fs.unlinkSync(filePath); } catch { /* Datei evtl. schon weg */ }

    // DB-Eintrag löschen
    await dbService.query('DELETE FROM guild_media WHERE id = ? AND guild_id = ?', [req.params.id, guildId]);

    Logger.info(`[Media] Datei ${media.filename} gelöscht (Guild ${guildId})`);
    return res.json({ success: true, message: 'Datei gelöscht' });
});

// =====================================================
// Ordnerverwaltung
// =====================================================
//
// Ein „Ordner" ist keine eigene Zeile irgendwo, sondern die Spalte `folder`
// je Datei. Er entsteht, sobald ihn eine Datei traegt, und verschwindet, wenn
// die letzte ihn verlaesst. Das ist Absicht: Es gibt keine leeren Ordner, die
// jemand pflegen muesste.
//
// Genau daraus kam aber das Aergernis: Wer sich vertippte, legte still einen
// neuen an. Am 2026-09-16 lagen deshalb „icons" (18 Dateien) und „newicons"
// (65) nebeneinander — derselbe Ordner, zweimal. Die drei Wege hier sind das
// Werkzeug dagegen.

/**
 * Holt die Kennungen aus dem Rumpf und prueft, dass sie zu dieser Guild
 * gehoeren. Ohne diese Pruefung koennte jemand mit Kennungen einer fremden
 * Guild schreiben — die Kennungen sind fortlaufend und leicht zu raten.
 *
 * @param {*} ids
 * @param {string} guildId
 * @returns {Promise<{ok: true, ids: number[]} | {ok: false, fehler: string}>}
 */
async function eigeneKennungen(ids, guildId) {
    const dbService = ServiceManager.get('dbService');

    if (!Array.isArray(ids) || ids.length === 0) {
        return { ok: false, fehler: 'Keine Dateien ausgewählt.' };
    }
    if (ids.length > 500) {
        return { ok: false, fehler: 'Zu viele Dateien auf einmal (höchstens 500).' };
    }

    const zahlen = ids.map(Number).filter(Number.isInteger);
    if (zahlen.length !== ids.length) {
        return { ok: false, fehler: 'Ungültige Auswahl.' };
    }

    const platzhalter = zahlen.map(() => '?').join(',');
    const zeilen = await dbService.query(
        `SELECT id FROM guild_media WHERE guild_id = ? AND id IN (${platzhalter})`,
        [guildId, ...zahlen]
    );

    if (zeilen.length !== zahlen.length) {
        return { ok: false, fehler: 'Einige Dateien gehören nicht zu diesem Server.' };
    }
    return { ok: true, ids: zahlen };
}

// POST /api/verschieben — mehrere Dateien in einen Ordner
router.post('/api/verschieben', requirePermission('CORE.MEDIA.UPLOAD'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    const guildId = res.locals.guildId;

    const ordner = ordnernamePruefen(req.body?.ordner);
    if (!ordner.ok) return res.status(400).json({ success: false, message: ordner.fehler });

    const auswahl = await eigeneKennungen(req.body?.ids, guildId);
    if (!auswahl.ok) return res.status(400).json({ success: false, message: auswahl.fehler });

    const platzhalter = auswahl.ids.map(() => '?').join(',');
    await dbService.query(
        `UPDATE guild_media SET folder = ? WHERE guild_id = ? AND id IN (${platzhalter})`,
        [ordner.name, guildId, ...auswahl.ids]
    );

    Logger.info(`[Media] ${auswahl.ids.length} Datei(en) nach "${ordner.name}" verschoben (Guild ${guildId})`);
    return res.json({
        success: true,
        message: `${auswahl.ids.length} Datei(en) nach „${ordner.name}" verschoben`,
        anzahl: auswahl.ids.length
    });
});

// POST /api/loeschen — mehrere Dateien löschen
router.post('/api/loeschen', requirePermission('CORE.MEDIA.DELETE'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    const guildId = res.locals.guildId;

    const auswahl = await eigeneKennungen(req.body?.ids, guildId);
    if (!auswahl.ok) return res.status(400).json({ success: false, message: auswahl.fehler });

    const platzhalter = auswahl.ids.map(() => '?').join(',');
    const zeilen = await dbService.query(
        `SELECT id, stored_name, filename FROM guild_media WHERE guild_id = ? AND id IN (${platzhalter})`,
        [guildId, ...auswahl.ids]
    );

    // Erst die Zeilen, dann die Dateien: Bleibt eine Datei liegen, findet sie
    // `scripts/medien-verwaiste.js`. Bliebe umgekehrt eine Zeile ohne Datei
    // stehen, zeigte die Galerie ein kaputtes Bild.
    await dbService.query(
        `DELETE FROM guild_media WHERE guild_id = ? AND id IN (${platzhalter})`,
        [guildId, ...auswahl.ids]
    );

    for (const zeile of zeilen) {
        const pfad = path.join(__dirname, '../../uploads/media', guildId, zeile.stored_name);
        try { fs.unlinkSync(pfad); } catch { /* evtl. schon weg */ }
    }

    Logger.info(`[Media] ${zeilen.length} Datei(en) gelöscht (Guild ${guildId})`);
    return res.json({ success: true, message: `${zeilen.length} Datei(en) gelöscht`, anzahl: zeilen.length });
});

// POST /api/ordner/umbenennen — Ordner umbenennen ODER zusammenführen
//
// Beides ist derselbe Vorgang: Zeigt der neue Name auf einen vorhandenen
// Ordner, wandern die Dateien dorthin. Das ist kein Unfall, sondern der Weg,
// ein verdoppeltes Paar wie „icons"/„newicons" wieder zusammenzubringen — die
// Antwort sagt deshalb, was passiert ist.
router.post('/api/ordner/umbenennen', requirePermission('CORE.MEDIA.UPLOAD'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    const guildId = res.locals.guildId;

    const von = ordnernamePruefen(req.body?.von);
    const nach = ordnernamePruefen(req.body?.nach);
    if (!von.ok) return res.status(400).json({ success: false, message: von.fehler });
    if (!nach.ok) return res.status(400).json({ success: false, message: nach.fehler });
    if (von.name === nach.name) {
        return res.status(400).json({ success: false, message: 'Alter und neuer Name sind gleich.' });
    }

    const [vorhanden] = await dbService.query(
        'SELECT COUNT(*) AS n FROM guild_media WHERE guild_id = ? AND folder = ?',
        [guildId, von.name]
    );
    if (!vorhanden || vorhanden.n === 0) {
        return res.status(404).json({ success: false, message: `Den Ordner „${von.name}" gibt es nicht.` });
    }

    const [ziel] = await dbService.query(
        'SELECT COUNT(*) AS n FROM guild_media WHERE guild_id = ? AND folder = ?',
        [guildId, nach.name]
    );
    const zusammengefuehrt = Boolean(ziel && ziel.n > 0);

    await dbService.query(
        'UPDATE guild_media SET folder = ? WHERE guild_id = ? AND folder = ?',
        [nach.name, guildId, von.name]
    );

    Logger.info(
        `[Media] Ordner "${von.name}" → "${nach.name}" ` +
        `(${vorhanden.n} Datei(en)${zusammengefuehrt ? ', zusammengeführt' : ''}, Guild ${guildId})`
    );
    return res.json({
        success: true,
        zusammengefuehrt,
        message: zusammengefuehrt
            ? `${vorhanden.n} Datei(en) aus „${von.name}" nach „${nach.name}" zusammengeführt`
            : `Ordner „${von.name}" heißt jetzt „${nach.name}" (${vorhanden.n} Datei(en))`
    });
});

// POST /api/ordner/loeschen — Ordner auflösen
//
// **Löscht keine Datei.** Der Ordner ist nur ein Name an den Dateien; sie
// wandern in den Vorgabe-Ordner und bleiben alle erhalten. Wer Dateien
// loswerden will, waehlt sie aus und loescht sie — das ist ein anderer Knopf,
// und das soll man auch merken.
router.post('/api/ordner/loeschen', requirePermission('CORE.MEDIA.UPLOAD'), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    const guildId = res.locals.guildId;

    const ordner = ordnernamePruefen(req.body?.ordner);
    if (!ordner.ok) return res.status(400).json({ success: false, message: ordner.fehler });
    if (ordner.name === VORGABE_ORDNER) {
        return res.status(400).json({
            success: false,
            message: `„${VORGABE_ORDNER}" ist der Vorgabe-Ordner und lässt sich nicht auflösen.`
        });
    }

    const [vorhanden] = await dbService.query(
        'SELECT COUNT(*) AS n FROM guild_media WHERE guild_id = ? AND folder = ?',
        [guildId, ordner.name]
    );
    if (!vorhanden || vorhanden.n === 0) {
        return res.status(404).json({ success: false, message: `Den Ordner „${ordner.name}" gibt es nicht.` });
    }

    await dbService.query(
        'UPDATE guild_media SET folder = ? WHERE guild_id = ? AND folder = ?',
        [VORGABE_ORDNER, guildId, ordner.name]
    );

    Logger.info(`[Media] Ordner "${ordner.name}" aufgelöst, ${vorhanden.n} Datei(en) nach "${VORGABE_ORDNER}" (Guild ${guildId})`);
    return res.json({
        success: true,
        message: `Ordner „${ordner.name}" aufgelöst — ${vorhanden.n} Datei(en) liegen jetzt in „${VORGABE_ORDNER}"`
    });
});

// =====================================================
// POST /guild/:guildId/media/api/:id/edit — Bild bearbeiten (Crop/Rotate/Flip)
// Empfängt ein Base64-encoded bearbeitetes Bild vom Cropper.js Frontend
// =====================================================
router.post('/api/:id/edit', requirePermission('CORE.MEDIA.UPLOAD'), express.json({ limit: '10mb' }), async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');
    const guildId = res.locals.guildId;
    const { imageData, saveAs } = req.body;

    if (!imageData) return res.status(400).json({ success: false, message: 'Keine Bilddaten' });

    // Originalbild laden
    const [media] = await dbService.query(
        'SELECT * FROM guild_media WHERE id = ? AND guild_id = ?',
        [req.params.id, guildId]
    );
    if (!media) return res.status(404).json({ success: false, message: 'Datei nicht gefunden' });

    // Nur bearbeitbare Raster-Formate
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(media.mime_type)) {
        return res.status(400).json({ success: false, message: 'Dieses Format kann nicht bearbeitet werden' });
    }

    try {
        // Base64 → Buffer
        const base64Match = imageData.match(/^data:image\/(png|jpeg|webp);base64,(.+)$/);
        if (!base64Match) return res.status(400).json({ success: false, message: 'Ungültiges Bildformat' });

        const outputMime = `image/${base64Match[1]}`;
        const buffer = Buffer.from(base64Match[2], 'base64');
        const dimensions = getImageDimensions(null, outputMime, buffer);
        const uploadDir = path.join(__dirname, '../../uploads/media', guildId);

        if (saveAs === 'copy') {
            // Als Kopie speichern
            const ext = outputMime === 'image/png' ? '.png' : outputMime === 'image/webp' ? '.webp' : '.jpg';
            const newStoredName = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`;
            const newFilePath = path.join(uploadDir, newStoredName);
            fs.writeFileSync(newFilePath, buffer);

            const nameBase = path.basename(media.filename, path.extname(media.filename));
            const newFilename = `${nameBase}-edited${ext}`;

            const result = await dbService.query(
                `INSERT INTO guild_media (guild_id, uploaded_by, filename, stored_name, mime_type, file_size, width, height, folder, alt_text, title)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [guildId, res.locals.user.id, newFilename, newStoredName, outputMime, buffer.length,
                 dimensions?.width || null, dimensions?.height || null, media.folder, media.alt_text, media.title]
            );

            Logger.info(`[Media] Bild bearbeitet (Kopie) → ${newFilename} (Guild ${guildId})`);
            return res.json({
                success: true,
                message: 'Bearbeitetes Bild als Kopie gespeichert',
                data: { id: result.insertId, url: `/uploads/media/${guildId}/${newStoredName}` }
            });
        } else {
            // Original überschreiben
            const filePath = path.join(uploadDir, media.stored_name);
            fs.writeFileSync(filePath, buffer);

            await dbService.query(
                'UPDATE guild_media SET file_size = ?, width = ?, height = ?, mime_type = ? WHERE id = ? AND guild_id = ?',
                [buffer.length, dimensions?.width || null, dimensions?.height || null, outputMime, req.params.id, guildId]
            );

            Logger.info(`[Media] Bild bearbeitet (überschrieben) → ${media.filename} (Guild ${guildId})`);
            return res.json({
                success: true,
                message: 'Bild wurde aktualisiert',
                data: { id: media.id, url: `/uploads/media/${guildId}/${media.stored_name}?t=${Date.now()}` }
            });
        }
    } catch (error) {
        Logger.error('[Media] Bearbeitungsfehler:', error);
        res.status(500).json({ success: false, message: 'Bearbeitung fehlgeschlagen' });
    }
});

// ── Helper: Einfache Bildgrößen-Erkennung ohne externe Deps ──
function getImageDimensions(filePath, mimeType, existingBuffer) {
    try {
        const buffer = existingBuffer || fs.readFileSync(filePath);
        
        if (mimeType === 'image/png') {
            if (buffer.length >= 24 && buffer[0] === 0x89 && buffer[1] === 0x50) {
                return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
            }
        }
        
        if (mimeType === 'image/jpeg') {
            let offset = 2;
            while (offset < buffer.length) {
                if (buffer[offset] !== 0xFF) break;
                const marker = buffer[offset + 1];
                if (marker === 0xC0 || marker === 0xC2) {
                    return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
                }
                const segmentLength = buffer.readUInt16BE(offset + 2);
                offset += 2 + segmentLength;
            }
        }
        
        if (mimeType === 'image/gif') {
            if (buffer.length >= 10) {
                return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) };
            }
        }

        return null;
    } catch {
        return null;
    }
}

// Nur zum Pruefen nach aussen gegeben (scripts/check-medienordner.js). Die
// Anwendung benutzt den Export nicht — sie haengt den Router ein.
module.exports = router;
module.exports.ordnernamePruefen = ordnernamePruefen;
module.exports.VORGABE_ORDNER = VORGABE_ORDNER;
