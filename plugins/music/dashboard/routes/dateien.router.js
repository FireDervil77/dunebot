'use strict';

/**
 * Musik - eigene Tondateien
 *
 * Hochladen, auflisten, abspielen, loeschen. Der Weg um Discords
 * Anhang-Grenze herum: Die Datei geht nie durch Discord, sondern vom Browser
 * direkt zu uns, und der Bot liest sie von der Platte.
 *
 * Drei Riegel gegen ein volllaufendes Dateisystem, weil der Plattenplatz ein
 * geteilter, endlicher Vorrat ist:
 *
 *   1. `MUSIC.FILES.UPLOAD` - ein eigenes Recht. Wer es nicht vergibt, fuer den
 *      gibt es die Funktion in seiner Guild nicht.
 *   2. Obergrenze je Guild (`datei_quota_mb`). Geprueft wird **vor** dem
 *      Annehmen, sonst liegt die Datei schon da, wenn wir Nein sagen.
 *   3. Aufbewahrung - siehe den Aufraeumer im Bot.
 *
 * @module music/dashboard/routes/dateien
 */

const express = require('express');
const router = express.Router({ mergeParams: true });

const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const { ServiceManager } = require('dunebot-core');
const { requirePermission } = require('../../../../apps/dashboard/middlewares/permissions.middleware');
const { MusicFiles, MusicSettings } = require('../../shared/models');
const { guildVerzeichnis, pfadFuer, ERLAUBTE_TYPEN, ERLAUBTE_ENDUNGEN } = require('../../shared/dateien');
const { makeTranslator, renderView, renderFehler, auspacken, angemeldeterNutzer } = require('./_shared');

/**
 * Groesste Datei, die wir ueberhaupt annehmen - unabhaengig von der Guild-Quota.
 *
 * Eine einzelne Obergrenze braucht es zusaetzlich: Multer muss beim Annehmen
 * schon eine Zahl kennen, die Quota-Pruefung kommt erst danach. 500 MB ist
 * grosszuegig genug fuer einen langen Mitschnitt und klein genug, dass ein
 * Fehlgriff nicht die Platte fuellt.
 */
const MAX_EINZELN_BYTES = 500 * 1024 * 1024;

const speicher = multer.diskStorage({
    destination: (req, datei, weiter) => {
        // Ohne Guild waere das Ziel `.../musik/undefined/` - alle Guilds in
        // einem Topf, und niemandem faellt es auf. Lieber hier abbrechen.
        const guildId = req.params?.guildId || req.res?.locals?.guildId;
        if (!guildId) return weiter(new Error('GUILD_FEHLT'));

        try {
            weiter(null, guildVerzeichnis(guildId));
        } catch (fehler) {
            weiter(fehler);
        }
    },
    filename: (req, datei, weiter) => {
        // Der Name auf der Platte wird immer selbst vergeben. Was der Nutzer
        // geschickt hat, steht spaeter in `originalname` - aber niemals im Pfad.
        const endung = path.extname(datei.originalname).toLowerCase();
        weiter(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${endung}`);
    }
});

const hochladen = multer({
    storage: speicher,
    limits: { fileSize: MAX_EINZELN_BYTES, files: 1 },
    fileFilter: (req, datei, weiter) => {
        const endung = path.extname(datei.originalname).toLowerCase();

        // Typ **oder** Endung reicht: Browser melden bei exotischen Formaten
        // gern `application/octet-stream`, und eine .flac ist trotzdem eine.
        if (ERLAUBTE_TYPEN.includes(datei.mimetype) || ERLAUBTE_ENDUNGEN.includes(endung)) {
            return weiter(null, true);
        }

        weiter(new Error('DATEITYP'));
    }
});

/** Bytes als "12,3 MB". */
function groesse(bytes) {
    const mb = Number(bytes || 0) / (1024 * 1024);
    return mb >= 1024
        ? `${(mb / 1024).toFixed(1).replace('.', ',')} GB`
        : `${mb.toFixed(1).replace('.', ',')} MB`;
}

// =====================================================
// Seite
// =====================================================
router.get('/', requirePermission('MUSIC.VIEW'), async (req, res) => {
    const guildId = res.locals.guildId;
    const tr = makeTranslator(req, res);

    try {
        const permissionManager = ServiceManager.get('permissionManager');

        const [dateien, einstellungen, belegung, darfHochladen] = await Promise.all([
            MusicFiles.getAll(guildId),
            MusicSettings.getSettings(guildId),
            MusicFiles.belegung(guildId),
            // Das Feld bleibt sichtbar, aber gesperrt. Ein verstecktes Feld
            // erklaert nicht, warum es fehlt; ein gesperrtes mit Hinweis schon.
            permissionManager
                ? permissionManager.hasPermission(res.locals.user?.id, guildId, 'MUSIC.FILES.UPLOAD').catch(() => false)
                : Promise.resolve(false)
        ]);

        const quotaMB = Number(einstellungen.datei_quota_mb) || 0;
        const belegtMB = belegung.bytes / (1024 * 1024);

        await renderView(res, 'guild/music-dateien', {
            tr,
            guildId,
            dateien,
            einstellungen,
            belegung,
            quotaMB,
            belegtMB,
            darfHochladen,
            // Bei "unbegrenzt" gibt es keinen sinnvollen Balken
            belegtProzent: quotaMB > 0 ? Math.min(100, Math.round((belegtMB / quotaMB) * 100)) : 0,
            groesse
        });
    } catch (error) {
        return renderFehler(res, error, 'Die Dateien konnten nicht geladen werden');
    }
});

// =====================================================
// Hochladen
// =====================================================
router.post('/upload', requirePermission('MUSIC.FILES.UPLOAD'), (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const guildId = res.locals.guildId;

    hochladen.single('datei')(req, res, async (fehler) => {
        if (fehler) {
            const meldung = fehler.message === 'DATEITYP'
                ? 'Das ist kein Tonformat, das wir abspielen können.'
                : fehler.code === 'LIMIT_FILE_SIZE'
                    ? `Die Datei ist größer als ${groesse(MAX_EINZELN_BYTES)}.`
                    : 'Die Datei konnte nicht angenommen werden.';

            return res.status(400).json({ success: false, message: meldung });
        }

        if (!req.file) {
            return res.status(400).json({ success: false, message: 'Es wurde keine Datei geschickt.' });
        }

        try {
            const einstellungen = await MusicSettings.getSettings(guildId);
            const quotaBytes = (Number(einstellungen.datei_quota_mb) || 0) * 1024 * 1024;

            if (quotaBytes > 0) {
                const belegung = await MusicFiles.belegung(guildId);

                if (belegung.bytes + req.file.size > quotaBytes) {
                    // Die Datei liegt schon auf der Platte - Multer nimmt sie an,
                    // bevor wir rechnen koennen. Also wieder weg damit, sonst
                    // waechst der Ordner genau an der Grenze weiter.
                    fs.unlink(req.file.path, () => {});

                    return res.status(413).json({
                        success: false,
                        message: `Kein Platz mehr: ${groesse(belegung.bytes)} von ${groesse(quotaBytes)} belegt, `
                               + `diese Datei braucht ${groesse(req.file.size)}.`
                    });
                }
            }

            const id = await MusicFiles.anlegen(guildId, {
                dateiname: req.file.filename,
                originalname: req.file.originalname,
                groesseBytes: req.file.size,
                hochgeladenVon: angemeldeterNutzer(req, res)
            });

            Logger.info(`[Musik] Datei abgelegt (Guild ${guildId}, ${groesse(req.file.size)}): ${req.file.originalname}`);
            return res.json({ success: true, id, name: req.file.originalname });

        } catch (error) {
            // Was schon liegt, aber nicht eingetragen ist, waere eine Leiche
            if (req.file?.path) fs.unlink(req.file.path, () => {});

            Logger.error('[Musik] Datei konnte nicht abgelegt werden:', error);
            return res.status(500).json({ success: false, message: 'Die Datei konnte nicht abgelegt werden.' });
        }
    });
});

// =====================================================
// Abspielen - geht denselben Weg wie jede andere Eingabe
// =====================================================
router.post('/:id/abspielen', requirePermission('MUSIC.PLAY'), async (req, res) => {
    const guildId = res.locals.guildId;
    const ipcServer = ServiceManager.get('ipcServer');

    const datei = await MusicFiles.get(parseInt(req.params.id, 10), guildId);
    if (!datei) return res.status(404).json({ success: false, message: 'Datei nicht gefunden.' });

    if (!ipcServer) return res.status(503).json({ success: false, message: 'Der Bot ist nicht erreichbar.' });

    try {
        // `datei:<id>` ist die Eingabe - aufgeloest wird sie im Bot, genau wie
        // eine Adresse. So braucht der Abspielweg keine Sonderbehandlung.
        const ergebnis = auspacken(await ipcServer.broadcast('music:addTrack', {
            guildId,
            eingabe: `datei:${datei.id}`,
            angefordertVon: angemeldeterNutzer(req, res),
            anfang: Boolean(req.body?.anfang)
        }));

        if (!ergebnis?.success) {
            return res.status(400).json({ success: false, message: ergebnis?.error || 'Abspielen nicht möglich.' });
        }

        return res.json({ success: true, name: datei.originalname });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
});

// =====================================================
// Loeschen - Eintrag und Datei, in dieser Reihenfolge
// =====================================================
router.delete('/:id', requirePermission('MUSIC.FILES.DELETE'), async (req, res) => {
    const guildId = res.locals.guildId;
    const id = parseInt(req.params.id, 10);

    if (Number.isNaN(id)) return res.status(400).json({ success: false, message: 'Ungültige ID.' });

    try {
        const datei = await MusicFiles.get(id, guildId);
        if (!datei) return res.status(404).json({ success: false, message: 'Datei nicht gefunden.' });

        await MusicFiles.entfernen(id, guildId);

        // Erst der Eintrag, dann die Datei: Bleibt eine Datei ohne Eintrag
        // liegen, kostet das nur Platz. Ein Eintrag ohne Datei dagegen sieht
        // abspielbar aus und scheitert erst im Sprachkanal.
        const pfad = pfadFuer(guildId, datei.dateiname);
        if (pfad) fs.unlink(pfad, () => {});

        return res.json({ success: true });
    } catch (error) {
        ServiceManager.get('Logger').error('[Musik] Datei konnte nicht entfernt werden:', error);
        return res.status(500).json({ success: false, message: 'Die Datei konnte nicht entfernt werden.' });
    }
});

module.exports = router;
