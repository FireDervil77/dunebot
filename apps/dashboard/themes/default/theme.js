/**
 * FireBot Tabler — Verhalten
 *
 * Eigenständiges Theme: Es erklärt keinen `parent`, bringt seine Assets also
 * allein mit und erbt nicht die des Standard-Themes. Views, die es (noch) nicht
 * selbst hat, holt es weiterhin aus `default` — dafür sorgt die Theme-Kette.
 *
 * Der Unterbau ist Tabler. Das bedeutet:
 *   - `tabler.min.css` bringt Bootstrap 5 vollständig mit → kein AdminLTE,
 *     keine zweite Bootstrap-Datei
 *   - `tabler.min.js` bringt Bootstrap-JS vollständig mit → Offcanvas, Modals,
 *     Dropdowns und Tooltips laufen über `data-bs-*`
 *   - Ausgeliefert wird aus node_modules über `/vendor/tabler` (siehe app.js),
 *     gepflegt wird es per `npm update`
 *
 * @author FireDervil
 */

/**
 * Bibliotheken vom eigenen Server, aus node_modules (Vendor-Route in app.js).
 *
 * Bis 2026-11-07 (Kassensturz K279) kamen sie von cdn.jsdelivr.net,
 * cdnjs.cloudflare.com und fonts.googleapis.com — jeder Seitenaufruf meldete
 * dort die Adresse des Besuchers, ohne Einwilligung, und ein Ausfall dort
 * nahm Icons, Toasts und Schriften mit. Fassungen exakt wie vorher, gepflegt
 * in apps/dashboard/package.json.
 *
 * **Der Guild-Bereich hatte bis zum 2026-09-04 gar keine Schrift.** Tabler
 * bittet in `tabler.min.css` um "Inter Var"/Inter, liefert sie aber nicht mit.
 * Seitdem die drei aus dem Entwurf: Bricolage Grotesque für Überschriften,
 * Public Sans für Fließtext, JetBrains Mono für Zahlen und Kennungen. Die
 * Schnitte stehen in `schriften-guild.css` und `schriften-frontend.css`;
 * jede Rolle hat in `tokens.css` einen vollständigen Fallback-Stapel.
 */
const LOKAL = {
    jquery:      '/vendor/jquery/jquery.min.js',
    toastrJs:    '/vendor/toastr/toastr.min.js',
    toastrCss:   '/vendor/toastr/toastr.min.css',
    sortable:    '/vendor/sortablejs/Sortable.min.js',
    fontawesome: '/vendor/fontawesome/css/all.min.css'
};

/** Aus node_modules ausgeliefert — siehe die Vendor-Route in app.js. */
const TABLER = {
    css:    '/vendor/tabler/css/tabler.min.css',
    js:     '/vendor/tabler/js/tabler.min.js',
    themes: '/vendor/tabler/css/tabler-themes.min.css'
};

class DefaultTheme {
    constructor(app) {
        this.app = app;
        this.name = 'default';
        // **Das ist der Cache-Schluessel aller eigenen Dateien** (`?v=`), nicht
        // die Nummer in `theme.json`. Wer nur dort hochzaehlt, aendert die CSS
        // und der Browser zeigt weiter die alte — ohne Fehler, ohne Hinweis.
        this.version = '2.2.1';
        this.description = 'Standard-Theme auf Tabler (Bootstrap 5). Loest AdminLTE ab.';
        this.author = 'firedervil';
        this.info = { darkMode: true, supportRTL: false, responsive: true };
    }

    /**
     * @param {import('dunebot-sdk/lib/AssetManager')} am
     */
    registerAssets(am) {
        if (!am) return;

        // ── Unterbau ────────────────────────────────────────────────────────
        am.registerVendorStyle('tabler-css', TABLER.css, { version: '1.4.0' });
        am.registerVendorStyle('tabler-themes-css', TABLER.themes, { deps: ['tabler-css'], version: '1.4.0' });
        am.registerVendorScript('tabler-js', TABLER.js, { version: '1.4.0' });
        // Muss direkt hinter tabler-js laufen: legt window.bootstrap an
        am.registerScript('bootstrap-alias', 'bootstrap-alias.js', { deps: ['tabler-js'], version: this.version });

        // ── Was Tabler (noch) nicht abdeckt ─────────────────────────────────
        // Font Awesome bleibt vorerst: die Icon-Namen stecken über alle Views
        // verteilt. Der Wechsel auf @tabler/icons ist ein eigener Schritt.
        am.registerVendorStyle('fa-css', LOKAL.fontawesome, { version: '6.5.1' });
        // Vor `tokens`, damit die Familien stehen, bevor die Rollen sie nennen.
        am.registerStyle('fonts-guild', 'schriften-guild.css', { version: this.version });
        am.registerVendorStyle('toastr-css', LOKAL.toastrCss, { version: '2.1.4' });
        am.registerVendorScript('jquery', LOKAL.jquery, { version: '3.7.1' });
        am.registerVendorScript('toastr-js', LOKAL.toastrJs, { deps: ['jquery'], version: '2.1.4' });
        am.registerVendorScript('sortable', LOKAL.sortable, { version: '1.15.6' });

        // ── Eigene Dateien (über die Theme-Kette auflösbar) ──────────────────
        am.registerStyle('data-table-css', 'data-table.css', { version: this.version });
        am.registerStyle('tokens', 'tokens.css', { deps: ['tabler-css'], version: this.version });
        // **Am 2026-09-03 nachgetragen — die Datei war nie eingebunden.**
        //
        // `guild.css` liegt seit jeher im Theme und traegt 631 Zeilen: die
        // Checkbox-Regeln, die Rechtematrix, seit heute die Bauteile des
        // Panel-Entwurfs. Registriert und eingereiht war sie **nirgends**;
        // gefunden, weil frisch geschriebene Regeln auf der Seite nicht
        // ankamen.
        //
        // Zwei Ansichten sagen in ihren Kommentaren ausdruecklich "global in
        // guild.css definiert" (`permissions/matrix.ejs`,
        // `permissions/groups.ejs`) — sie haben sich auf eine Datei verlassen,
        // die der Browser nie geladen hat. Was dort trotzdem richtig aussah,
        // sah durch Tablers Vorgaben richtig aus, nicht durch unsere Regeln.
        //
        // `deps: ['tokens']`, damit die Rollen vorher stehen: `guild.css`
        // liest `var(--fb-*)`.
        am.registerStyle('guild-css', 'guild.css', { deps: ['tokens'], version: this.version });

        // ── Das oeffentliche Frontend: eigenes Onepage-Design ───────────────
        //
        // Guild-Bereich und Anmeldung laufen auf Tabler. Das Frontend **nicht**,
        // und das ist eine Entscheidung, keine Restarbeit: Es ist ein
        // eigenstaendiges Onepage-Design mit eigener Bildsprache und eigenen
        // Bibliotheken (aos, glightbox, swiper, isotope, purecounter). Es soll
        // so bleiben.
        //
        // Dass hier Bootstrap 4 steht, ist deshalb unbedenklich — die beiden
        // Generationen teilen sich keine Seite mehr. Problematisch war das nur,
        // solange Guild-Seiten BS5-Aufrufe auf einem BS4-Unterbau machten.
        //
        // Weglassen waere teuer: Die drei Guilds auf `firebot-tabler` haben nie
        // gemerkt, dass das Frontend ueber `default` lief — es hat keine Guild,
        // greift also auf `ACTIVE_THEME || 'default'` zurueck. Ohne diesen Block
        // stuenden Startseite und Blog ohne ihre Bibliotheken da.
        am.registerVendorStyle('bootstrap-css', '/public/vendor/bootstrap/css/bootstrap.min.css', { version: '4.4.1' });
        am.registerVendorStyle('bootstrap-icons', '/public/vendor/bootstrap-icons/bootstrap-icons.min.css', { version: '1.13.1' });
        am.registerVendorStyle('fontawesome', LOKAL.fontawesome, { version: '6.5.1' });
        am.registerStyle('fonts-frontend', 'schriften-frontend.css', { version: this.version });
        am.registerVendorStyle('aos-css', '/public/vendor/aos/aos.css', { version: '2.3.4' });
        am.registerVendorStyle('glightbox-css', '/public/vendor/glightbox/css/glightbox.min.css', { version: '3.2.0' });
        am.registerVendorStyle('swiper-css', '/public/vendor/swiper/swiper-bundle.min.css', { version: '11.0.5' });
        am.registerStyle('auth-css', 'auth.css', { deps: ['tokens'], version: this.version });
        am.registerStyle('frontend-css', 'frontend.css', { deps: ['tokens'], version: this.version });
        // Hero der Startseite aus dem Grafik-Kit (`.hero-kit`). Eigene Datei
        // hinter frontend-css, damit ihre Regeln gegen Tabler und die alten
        // `.hero`-Regeln gewinnen.
        am.registerStyle('hero-kit-css', 'hero-kit.css', { deps: ['frontend-css'], version: this.version });

        am.registerVendorScript('bootstrap-js', '/public/vendor/bootstrap/js/bootstrap.bundle.min.js', { deps: ['jquery'], version: '4.4.1' });
        am.registerVendorScript('php-email-form', '/public/vendor/php-email-form/validate.js', { version: '3.7.0' });
        am.registerVendorScript('aos-js', '/public/vendor/aos/aos.js', { version: '2.3.4' });
        am.registerVendorScript('waypoints', '/public/vendor/waypoints/noframework.waypoints.js', { version: '4.0.1' });
        am.registerVendorScript('purecounter', '/public/vendor/purecounter/purecounter_vanilla.js', { version: '1.5.0' });
        am.registerVendorScript('glightbox-js', '/public/vendor/glightbox/js/glightbox.min.js', { version: '3.2.0' });
        am.registerVendorScript('imagesloaded', '/public/vendor/imagesloaded/imagesloaded.pkgd.min.js', { version: '5.0.0' });
        am.registerVendorScript('isotope', '/public/vendor/isotope-layout/isotope.pkgd.min.js', { version: '3.0.6' });
        am.registerVendorScript('swiper-js', '/public/vendor/swiper/swiper-bundle.min.js', { version: '11.0.5' });
        am.registerScript('auth-js', 'auth.js', { deps: ['tabler-js'], version: this.version });
        am.registerScript('frontend-js', 'frontend.js', { deps: ['bootstrap-js'], version: this.version });

        // Anordnen im Dashboard — wird von der Dashboard-View selbst eingereiht
        am.registerScript('widget-arrange', 'widget-arrange.js', { deps: ['sortable'], version: this.version });

        am.registerScript('csrf-helper', 'csrf-helper.js', { inFooter: false, version: this.version });
        am.registerScript('global-toast', 'global-toast.js', { deps: ['toastr-js'], version: this.version });
        am.registerScript('form-toast', 'form-toast.js', { deps: ['global-toast', 'csrf-helper'], version: this.version });
        am.registerScript('toast-notification-center', 'toast-notification-center.js', { deps: ['global-toast'], version: this.version });
        am.registerScript('button-loading', 'button-loading.js', { version: this.version });
        // Ein Auge an jedem Kennwortfeld, auch an später eingefügten (2026-11-03).
        am.registerScript('kennwort-auge', 'kennwort-auge.js', { version: this.version });
        // DuneDataTable. Beim Umstieg von AdminLTE auf Tabler ist es haengen
        // geblieben: das alte Theme reihte es fuer Guild-Seiten ein, dieses
        // nicht. `new DuneDataTable(...)` warf seitdem, und weil das im selben
        // Skriptblock steht wie der Rest, blieb die Port-Verwaltung des
        // Masterservers vollstaendig leer — kein Fehler, kein Leer-Zustand,
        // nichts. `firebot-tabler` hat kein Eltern-Theme, erbt die Datei also
        // nicht; sie liegt hier als eigene Kopie.
        am.registerScript('data-table', 'data-table.js', { deps: ['jquery'], version: this.version });
        am.registerScript('guild', 'guild.js', { deps: ['jquery'], version: this.version });
        // Nach dem Neuladen wieder an derselben Stelle — der Inhaltsbereich rollt
        // selbst, und dessen Position merkt sich kein Browser (2026-10-08).
        am.registerScript('rollstand', 'rollstand.js', { version: this.version });
    }

    /**
     * Widget-Bereiche dieses Themes — Gegenstück zu register_sidebar().
     *
     * Die vier Bezeichner bleiben wie im Kern, damit vorhandene Widgets dort
     * landen, wo sie hingehören. Nur die Spaltenbreiten sind auf Tablers
     * ruhigeres Raster abgestimmt, und ein zusätzlicher Bereich zeigt, dass ein
     * Theme das Raster selbst bestimmt.
     *
     * @param {{registerArea: Function}} bereiche
     */
    registerWidgetAreas(bereiche) {
        bereiche.registerArea('dashboard-top', {
            label: 'Oben (Vollbreite)',
            description: 'Hinweise über dem Inhalt',
            defaultSize: 12
        });
        bereiche.registerArea('dashboard-primary', {
            label: 'Kennzahlen (4-spaltig)',
            description: 'Kompakte Kacheln nebeneinander',
            defaultSize: 3
        });
        bereiche.registerArea('dashboard-secondary', {
            label: 'Analyse (2-spaltig)',
            description: 'Auswertungen und Verläufe',
            defaultSize: 6
        });
        bereiche.registerArea('dashboard-side', {
            label: 'Nebenspalte',
            description: 'Schmale Karten neben dem Hauptinhalt',
            defaultSize: 4
        });
        bereiche.registerArea('dashboard-bottom', {
            label: 'Unten (Vollbreite)',
            description: 'Abschließende Karten',
            defaultSize: 12
        });
    }

    /**
     * @param {import('dunebot-sdk/lib/AssetManager')} am
     * @param {string} section
     */
    enqueueAssets(am, section) {
        if (!am) return;

        // In jedem Bereich: Icons und der CSRF-Helfer
        am.enqueueStyle('fa-css');
        am.enqueueScript('csrf-helper');

        // Nur der Guild-Bereich laeuft auf Tabler. Anmeldung und oeffentliche
        // Webseite behalten ihren bisherigen Satz unveraendert — ihr Markup ist
        // auf Bootstrap 4 und AdminLTE gebaut, und beide funktionieren heute.
        // Sie umzustellen ist ein eigener Durchgang, kein Nebeneffekt dieses.
        // Anmeldung laeuft auf demselben Geruest wie das Dashboard. Sie hat
        // bewusst kein Layout mit Navigation: Wer sich anmeldet oder einen
        // Server auswaehlt, hat noch keine Guild — Seitenleiste und Umschalter
        // haetten dort nichts anzuzeigen. Tabler deckt genau das mit
        // `.page.page-center` ab.
        if (section === 'auth') {
            ['fonts-guild', 'tabler-css', 'tabler-themes-css', 'tokens', 'auth-css']
                .forEach(h => am.enqueueStyle(h));
            ['tabler-js', 'bootstrap-alias', 'auth-js']
                .forEach(h => am.enqueueScript(h));
            return;
        }

        if (section !== 'guild') {
            ['fonts-frontend', 'bootstrap-icons', 'fontawesome', 'bootstrap-css',
             'aos-css', 'glightbox-css', 'swiper-css', 'tokens', 'frontend-css',
             'hero-kit-css']
                .forEach(h => am.enqueueStyle(h));
            ['jquery', 'bootstrap-js', 'php-email-form', 'aos-js', 'waypoints',
             'purecounter', 'glightbox-js', 'imagesloaded', 'isotope', 'swiper-js',
             'frontend-js']
                .forEach(h => am.enqueueScript(h));
            return;
        }

        am.enqueueStyle('fonts-guild');
        am.enqueueStyle('tabler-css');
        am.enqueueStyle('tabler-themes-css');
        am.enqueueStyle('tokens');
        am.enqueueStyle('toastr-css');
        am.enqueueStyle('data-table-css');
        am.enqueueStyle('guild-css');

        am.enqueueScript('tabler-js');
        am.enqueueScript('bootstrap-alias');
        am.enqueueScript('jquery');
        am.enqueueScript('toastr-js');
        am.enqueueScript('sortable');
        am.enqueueScript('global-toast');
        am.enqueueScript('form-toast');
        am.enqueueScript('toast-notification-center');
        am.enqueueScript('button-loading');
        am.enqueueScript('kennwort-auge');
        am.enqueueScript('data-table');
        am.enqueueScript('guild');
        am.enqueueScript('rollstand');
    }
}

module.exports = DefaultTheme;
