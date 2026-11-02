'use strict';

/**
 * Dateien vom Browser annehmen — Grenze, Speicher und eine lesbare Absage.
 *
 * ── Warum das hier steht und nicht im Dateimanager ──────────────────────────
 *
 * Seit dem 2026-09-09 laedt auch die Inhalte-Seite hoch (Mods und der
 * Mod-Lader, E6/B.12). Beide Wege muessen dieselbe Grenze einhalten, und die
 * Grenze ist keine Geschmacksfrage, sondern folgt aus der Leitung — die
 * Begruendung darunter darf deshalb nicht in zwei Fassungen existieren.
 */

const multer = require('multer');

/**
 * Groesste Datei, die das Panel annimmt.
 *
 * Seit FireBus Etappe 2 geht sie per PUT zum Daemon, nicht mehr im Bus. Die Zahl
 * blieb: Die Datei liegt beim Annehmen im Speicher des Dashboards, und der
 * Daemon nimmt bis `MaxSchreibBytes`.
 */
const MAX_UPLOAD_BYTES = 45 * 1024 * 1024;

/**
 * Upload-Middleware mit verstaendlicher Fehlermeldung.
 *
 * Ohne diesen Mantel landet ein zu grosser Upload als MulterError im
 * allgemeinen Fehlerpfad — der Nutzer sieht einen 500er ohne Grund.
 */
function nimmDatei(req, res, next) {
    upload.single('file')(req, res, (err) => {
        if (err && err.code === 'LIMIT_FILE_SIZE') {
            return res.status(413).json({
                success: false,
                error: `Datei zu gross. Das Panel nimmt hoechstens ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB.`
            });
        }
        if (err) return next(err);
        next();
    });
}

const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: MAX_UPLOAD_BYTES,
        files: 1
    }
});


module.exports = { nimmDatei, MAX_UPLOAD_BYTES };
