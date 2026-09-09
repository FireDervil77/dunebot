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
 * Groesste Datei, die durch die Daemon-Verbindung passt.
 *
 * Der Inhalt geht base64-kodiert in EINER WebSocket-Nachricht zum Daemon, wird
 * dabei also um ein Drittel groesser. Die Nachrichtengrenze liegt bei 64 MiB
 * (MAX_NACHRICHT_BYTES im IPMServer, MaxNachrichtBytes im Daemon) — 45 MB
 * Rohgroesse landen bei rund 60 MiB und bleiben sicher darunter.
 *
 * Bis zum 2026-08-04 stand hier 500 MB. Das war eine Zusage, die die Leitung
 * nicht halten konnte: Ueberschreitet eine Nachricht die Grenze der Gegenseite,
 * schliesst diese die Verbindung (Status 1009), statt zu antworten. Der Daemon
 * verschwand also mitten im Upload und galt als offline.
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
                error: `Datei zu gross. Ueber die Daemon-Verbindung passen hoechstens ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB.`
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
