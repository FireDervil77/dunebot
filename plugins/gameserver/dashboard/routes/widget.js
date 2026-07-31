/**
 * Einbettbares Status-Widget (E5)
 *
 * Eine eigenständige HTML-Seite, die per iframe auf fremden Websites landen
 * kann – damit niemand die API selbst anbinden muss.
 *
 * Zwei Dinge sind hier besonders:
 *
 * 1. **Helmet muss für diese eine Antwort zurücktreten.** Global setzt es
 *    `X-Frame-Options` und `frame-ancestors 'self'`; beides verbietet genau das,
 *    wofür diese Seite gebaut ist. Die Ausnahme gilt ausschließlich hier und
 *    ausschließlich für eine Seite, die nichts als öffentliche Statusdaten
 *    anzeigt: keine Anmeldung, keine Cookies, keine Formulare. Es gibt nichts,
 *    was ein fremder Rahmen abgreifen könnte.
 *
 * 2. **Alles ist eingebettet** – kein externes Stylesheet, kein Framework.
 *    Ein Widget, das eine fremde Seite langsam macht, wird wieder ausgebaut.
 *
 * @module routes/widget
 */

'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const { ServiceManager } = require('dunebot-core');

const router = express.Router();

const bremse = rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: 'Zu viele Anfragen',
});

/** Verhindert, dass ein Token als HTML in die Seite zurückläuft. */
function escapeJs(wert) {
    return String(wert).replace(/[^A-Za-z0-9_-]/g, '');
}

/**
 * GET /plugin/gameserver/widget/:token
 * Einbettbare Statusanzeige.
 */
router.get('/widget/:token', bremse, async (req, res) => {
    const Logger = ServiceManager.get('Logger');
    const dbService = ServiceManager.get('dbService');

    try {
        const token = escapeJs(req.params.token);

        // Nur prüfen, ob es die Seite gibt – die Daten holt sich das Widget
        // selbst über die API. So gibt es genau eine Stelle, die entscheidet,
        // welche Felder öffentlich sind.
        const [server] = await dbService.query(
            'SELECT id FROM gameservers WHERE public_status_token = ? AND public_status_enabled = 1 LIMIT 1',
            [token]
        );
        if (!server) return res.status(404).send('Nicht gefunden');

        const dunkel = req.query.theme !== 'light';

        // Helmet weicht nur für diese Antwort zurück; die CSP bleibt eng.
        res.removeHeader('X-Frame-Options');
        res.set('Content-Security-Policy',
            "frame-ancestors *; default-src 'none'; style-src 'unsafe-inline'; "
            + "script-src 'unsafe-inline'; connect-src 'self'");
        res.set('Cache-Control', 'public, max-age=60');
        res.type('html');

        return res.send(`<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Serverstatus</title>
<style>
  :root {
    --bg: ${dunkel ? '#1e2124' : '#ffffff'};
    --fg: ${dunkel ? '#dcddde' : '#2e3338'};
    --muted: ${dunkel ? '#8e9297' : '#747f8d'};
    --line: ${dunkel ? '#2f3136' : '#e3e5e8'};
    --on: #43b581;
    --off: #747f8d;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 12px;
    font: 14px/1.45 -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    background: var(--bg); color: var(--fg);
  }
  .kopf { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
  .punkt { width: 10px; height: 10px; border-radius: 50%; background: var(--off); flex: none; }
  .punkt.an { background: var(--on); }
  .name { font-weight: 600; font-size: 15px; }
  .spiel { color: var(--muted); font-size: 12px; }
  .zeile { display: flex; justify-content: space-between; gap: 12px; padding: 4px 0; border-top: 1px solid var(--line); }
  .zeile .k { color: var(--muted); }
  .namen { margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--line); }
  .namen span { display: inline-block; background: var(--line); border-radius: 10px; padding: 1px 8px; margin: 2px 2px 0 0; font-size: 12px; }
  .fuss { margin-top: 10px; color: var(--muted); font-size: 11px; }
  .fehler { color: var(--muted); font-style: italic; }
</style>
</head>
<body>
<div id="w"><div class="fehler">Lade …</div></div>
<script>
(function () {
  var TOKEN = '${token}';
  var ZIEL = document.getElementById('w');

  function txt(s) { var d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }

  function zeichne(d) {
    var teile = [];
    teile.push('<div class="kopf"><span class="punkt' + (d.online ? ' an' : '') + '"></span>'
      + '<div><div class="name">' + txt(d.name) + '</div>'
      + (d.game ? '<div class="spiel">' + txt(d.game) + '</div>' : '') + '</div></div>');

    var spieler = d.players_current == null
      ? (d.source === 'daemon' ? 'nicht abfragbar' : 'unbekannt')
      : d.players_current + (d.players_max ? ' / ' + d.players_max : '');
    teile.push('<div class="zeile"><span class="k">Spieler</span><span>' + txt(spieler) + '</span></div>');

    (d.fields || []).forEach(function (f) {
      teile.push('<div class="zeile"><span class="k">' + txt(f.label) + '</span><span>' + txt(f.value) + '</span></div>');
    });

    if (d.players && d.players.length) {
      teile.push('<div class="namen">' + d.players.map(function (n) {
        return '<span>' + txt(n) + '</span>';
      }).join('') + '</div>');
    }

    if (d.updated_at) {
      teile.push('<div class="fuss">Stand: ' + txt(new Date(d.updated_at).toLocaleString('de-DE')) + '</div>');
    }

    ZIEL.innerHTML = teile.join('');
  }

  function hole() {
    fetch('/api/gameserver/status/' + TOKEN, { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('nicht erreichbar'); return r.json(); })
      .then(zeichne)
      .catch(function () { ZIEL.innerHTML = '<div class="fehler">Status gerade nicht verfuegbar</div>'; });
  }

  hole();
  // 30 s: Der Snapshot selbst wird hoechstens minuetlich frisch, oefter zu fragen
  // brachte nichts ausser Last.
  setInterval(hole, 30000);
})();
</script>
</body>
</html>`);

    } catch (error) {
        Logger.error('[Gameserver] Widget fehlgeschlagen:', error);
        return res.status(500).send('Interner Fehler');
    }
});

module.exports = router;
