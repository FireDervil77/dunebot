'use strict';

/**
 * Der Player als OBS-Browserquelle (Punkt 4 aus `docs/musikwunsch/README.md`).
 *
 * ## Warum diese Routen ausserhalb der Anmeldung liegen
 *
 * OBS bringt keine Sitzung mit. Es oeffnet eine Adresse und sonst nichts -
 * kein Anmelden, keine Cookies, kein Zurueck. Der **Schluessel in der Adresse
 * ist der ganze Ausweis**, und deshalb ist er 32 zufaellige Bytes lang und
 * jederzeit neu erzeugbar. Wer ihn hat, hoert die Bibliothek dieser einen
 * Guild; wer ihn nicht hat, bekommt 404 - nicht 403, denn eine Adresse, die
 * "hier waere etwas, aber nicht fuer dich" sagt, ist eine Einladung zum Raten.
 *
 * ## Warum alles GET ist, auch das, was etwas bewirkt
 *
 * `naechster` schiebt den Zeiger weiter - streng genommen kein GET. Die
 * Alternative waere POST, und das liefe in die CSRF-Pruefung: Sie nimmt nur
 * zustandsaendernde Methoden, und der Player hat weder Sitzung noch Token.
 *
 * Ihn von der Pruefung auszunehmen hiesse, im **Kern** eine Ausnahme
 * einzutragen (`isCsrfExempt`) - fuer eine Plugin-Seite. Das waere die
 * teurere Loesung an der falschen Stelle. Und der Schutz, den CSRF gibt,
 * greift hier ohnehin nicht: Er verhindert, dass eine fremde Seite die
 * **Sitzung** des Nutzers missbraucht. Hier gibt es keine Sitzung; wer den
 * Schluessel kennt, darf ohnehin alles, was diese Routen koennen.
 *
 * ## Was hier NICHT ins Protokoll geht
 *
 * **Der Schluessel.** Ein Protokoll wird gelesen, weitergereicht und
 * aufbewahrt; ein Zugangsschluessel darin waere derselbe Fehler wie ein
 * Passwort im Klartext. Gemeldet wird die Guild, wenn sie bekannt ist - und
 * sonst nur, dass ein unbekannter Schluessel angefragt hat.
 *
 * @module streaming/routes/player
 */

const express = require('express');
const router = express.Router({ mergeParams: true });

const { ServiceManager } = require('dunebot-core');
const musik = require('../../shared/musikwunsch');

/** @returns {Object} Protokoll */
function log() {
    return ServiceManager.get('Logger');
}

/**
 * Den Schluessel aufloesen - oder mit 404 enden.
 *
 * @param {Object} req Anfrage
 * @param {Object} res Antwort
 * @returns {Promise<string|null>} Guild-Kennung, oder null wenn schon geantwortet
 */
async function guildOder404(req, res) {
    const guildId = await musik.guildZuSchluessel(req.params.schluessel);
    if (!guildId) {
        res.status(404).type('text/plain').send('Nicht gefunden.');
        return null;
    }
    return guildId;
}

/** Suchmaschinen und Zwischenspeicher haben hier nichts verloren. */
function kopfzeilen(res) {
    res.set('X-Robots-Tag', 'noindex, nofollow');
    res.set('Cache-Control', 'no-store');
}

// =====================================================
// Die Seite selbst
// =====================================================

router.get('/:schluessel', async (req, res) => {
    const guildId = await guildOder404(req, res);
    if (!guildId) return;

    kopfzeilen(res);
    await musik.playerGesehen(guildId);

    // **Die Seite steht hier und nicht in einer Vorlage.** Sie benutzt nichts
    // vom Theme - kein Tabler, keine Navigation, keinen Seitenkopf; in OBS
    // waere all das nur Ladezeit fuer etwas, das niemand sieht. Und sie muss
    // ohne jede Anmeldung ausgeliefert werden, waehrend der ThemeManager auf
    // `res.locals` aus der Sitzung baut.
    //
    // Der Schluessel wird aus `req.params` uebernommen, ohne ihn in den Text
    // zu setzen: `guildZuSchluessel` hat ihn schon geprueft, er ist also
    // 64 Hex-Zeichen und nichts anderes.
    const s = req.params.schluessel;

    res.type('html').send(`<!doctype html>
<html lang="de"><head>
<meta charset="utf-8">
<meta name="robots" content="noindex, nofollow">
<title>Musikwunsch</title>
<style>
  :root { color-scheme: dark; }
  body { margin:0; font:16px/1.4 system-ui, sans-serif; color:#fff;
         background:transparent; display:flex; align-items:center;
         justify-content:center; height:100vh; }
  /* Unsichtbar, solange nichts laeuft: In OBS soll eine leere Warteschlange
     kein schwarzes Rechteck im Bild sein. */
  #karte { display:none; padding:.6em 1em; border-radius:.5em;
           background:rgba(0,0,0,.55); max-width:90vw; }
  #karte.an { display:block; }
  #titel { font-weight:600; white-space:nowrap; overflow:hidden;
           text-overflow:ellipsis; }
  #wer { opacity:.75; font-size:.85em; }
</style>
</head><body>
<div id="karte"><div id="titel"></div><div id="wer"></div></div>
<audio id="ton" autoplay></audio>
<script>
(function () {
  'use strict';
  var BASIS = ${JSON.stringify('/stream/player/' + s)};
  var ton = document.getElementById('ton');
  var karte = document.getElementById('karte');
  var titel = document.getElementById('titel');
  var wer = document.getElementById('wer');
  var laueft = false;

  function zeigen(t, w) {
    titel.textContent = t || '';
    wer.textContent = w ? 'gewünscht von ' + w : '';
    karte.className = t ? 'an' : '';
  }

  // **Der Player fragt, wir schieben nicht.** Eine OBS-Browserquelle verliert
  // ihre Verbindung beim Szenenwechsel und muss von selbst zurueckfinden -
  // eine offene Leitung waere still tot, ein Abruf alle paar Sekunden nicht.
  // **"weiter" nur, wenn wirklich weitergerueckt werden soll.** Diese Seite
  // wird bei jedem Szenenwechsel neu geladen; fragte sie dann nach dem
  // NAECHSTEN, spraenge sie ueber den Titel, den sie eben noch spielte - und
  // bei nur einem Titel in der Warteschlange bliebe es still. Genau das ist
  // beim ersten Lauf passiert.
  function holen(weiter) {
    var adresse = BASIS + '/naechster' + (weiter ? '?weiter=1' : '');
    fetch(adresse, { cache: 'no-store' })
      .then(function (a) { return a.json(); })
      .then(function (d) {
        if (!d || !d.spielen) { laueft = false; zeigen(null); return; }

        // Derselbe Titel, der schon laeuft: nicht neu anfangen lassen. Sonst
        // setzte jeder Takt die Wiedergabe zurueck auf den Versatz.
        if (laueft && ton.dataset.id === String(d.id)) return;

        laueft = true;
        ton.dataset.id = String(d.id);
        zeigen(d.titel, d.gewuenschtVon);
        ton.src = BASIS + '/ton/' + d.id;

        // An die Stelle springen, an der der Titel gerade waere. Ohne das
        // begaenne er nach jedem Szenenwechsel von vorn.
        if (d.versatzSek > 0) {
          ton.addEventListener('loadedmetadata', function versetzen() {
            ton.removeEventListener('loadedmetadata', versetzen);
            try { ton.currentTime = d.versatzSek; } catch (e) { /* dann eben von vorn */ }
          });
        }

        ton.play().catch(function () {
          // Autoplay kann scheitern. In OBS nicht, aber in einem normalen
          // Browser-Tab - und dort soll es nicht still haengen bleiben.
          laueft = false;
        });
      })
      .catch(function () { laueft = false; });
  }

  // Durch: **jetzt** darf vorgerueckt werden.
  ton.addEventListener('ended', function () { laueft = false; holen(true); });

  ton.addEventListener('error', function () {
    // Eine Datei, die der Browser nicht abspielen kann, darf den Rest der
    // Warteschlange nicht anhalten - also weiter, nicht noch einmal dieselbe.
    laueft = false;
    holen(true);
  });

  // Der Takt tut zweierlei: Er holt Nachschub, wenn nichts laeuft, und er
  // meldet der Anlage, dass die Browserquelle ueberhaupt offen ist.
  setInterval(function () {
    fetch(BASIS + '/gesehen', { cache: 'no-store' }).catch(function () {});
    if (!laueft) holen(false);
  }, 5000);

  holen(false);
})();
</script>
</body></html>`);
});

// =====================================================
// Was soll ich spielen?
// =====================================================

router.get('/:schluessel/naechster', async (req, res) => {
    const guildId = await guildOder404(req, res);
    if (!guildId) return;

    kopfzeilen(res);
    await musik.playerGesehen(guildId);

    try {
        // **`weiter` entscheidet, ob vorgerueckt wird.** Ohne den Schalter
        // rueckte diese Route immer vor - und ein neu geladener Player (jeder
        // Szenenwechsel in OBS laedt neu) sprang damit ueber den Titel, den er
        // gerade noch spielte. Beim ersten echten Lauf am 2026-09-07 blieb es
        // deshalb still: Der einzige Titel war schon der laufende.
        const e = await musik.naechster(guildId, { weiter: req.query.weiter === '1' });
        if (!e.spielen) return res.json({ spielen: false, grund: e.grund });

        const zeile = await musik.aktueller(guildId);
        return res.json({
            spielen: true,
            id: e.id,
            titel: e.titel,
            dauerSek: e.dauerSek,
            versatzSek: e.versatzSek || 0,
            gewuenschtVon: zeile?.gewuenscht_von || null
        });
    } catch (fehler) {
        log().error('[Streaming] Player: naechster Titel nicht ermittelbar:', fehler);
        return res.status(500).json({ spielen: false, grund: 'fehler' });
    }
});

// =====================================================
// Die Bytes
// =====================================================

router.get('/:schluessel/ton/:id', async (req, res) => {
    const guildId = await guildOder404(req, res);
    if (!guildId) return;

    // **Die Kennung aus der Warteschlange, nicht die der Datei.** Wer die
    // Adresse hat, koennte sonst jede Dateinummer durchprobieren; so kommt er
    // nur an das, was auch wirklich gewuenscht wurde.
    const zeilen = await ServiceManager.get('dbService').query(
        'SELECT datei_id FROM streaming_music_queue WHERE id = ? AND guild_id = ? LIMIT 1',
        [Number(req.params.id), guildId]);

    const dateiId = zeilen?.[0]?.datei_id;
    if (!dateiId) return res.status(404).type('text/plain').send('Nicht gefunden.');

    const ablage = musik.ablage();
    if (!ablage) {
        log().warn('[Streaming] Player: keine Musikablage eingetragen');
        return res.status(503).type('text/plain').send('Ablage nicht verfuegbar.');
    }

    const ton = await ablage.tonquelle(guildId, dateiId);
    if (!ton) {
        // Freigabe zurueckgenommen oder Datei weg. Der Player holt sich beim
        // `error` den naechsten - deshalb reicht hier 404.
        return res.status(404).type('text/plain').send('Nicht mehr verfuegbar.');
    }

    res.set('X-Robots-Tag', 'noindex, nofollow');

    // **`sendFile` und nicht ein eigener Datenstrom.** Express beantwortet
    // damit Range-Anfragen (206) von selbst, und ohne die springt kein
    // Browser im Titel - er laedt dann jedes Mal von vorn.
    res.sendFile(ton.pfad, {
        headers: { 'Content-Type': ton.typ, 'Cache-Control': 'no-store' }
    }, (fehler) => {
        if (!fehler) return;
        // Abgebrochene Verbindungen sind der Normalfall, wenn OBS die Szene
        // wechselt - die gehoeren nicht ins Protokoll.
        if (fehler.code === 'ECONNABORTED' || res.headersSent) return;
        log().error('[Streaming] Player: Datei nicht auslieferbar:', fehler);
    });
});

// =====================================================
// Lebenszeichen
// =====================================================

router.get('/:schluessel/gesehen', async (req, res) => {
    const guildId = await guildOder404(req, res);
    if (!guildId) return;

    kopfzeilen(res);
    await musik.playerGesehen(guildId);
    res.json({ ok: true });
});

module.exports = router;
