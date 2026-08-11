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

/** Was noch von außen kommt. Ziel ist, auch das lokal zu haben. */
const CDN = {
    jquery:    'https://cdn.jsdelivr.net/npm/jquery@3.7.1/dist/jquery.min.js',
    toastrJs:  'https://cdn.jsdelivr.net/npm/toastr@2.1.4/build/toastr.min.js',
    toastrCss: 'https://cdn.jsdelivr.net/npm/toastr@2.1.4/build/toastr.min.css',
    sortable:  'https://cdn.jsdelivr.net/npm/sortablejs@1.15.6/Sortable.min.js',
    fontawesome: 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css',
    // Nur fuer das oeffentliche Frontend — der Guild-Bereich nutzt Tablers eigene Schrift.
    fontsFrontend: 'https://fonts.googleapis.com/css2?family=Roboto:wght@300;400;500;700&family=Raleway:wght@400;600;700&family=Poppins:wght@400;500;600&display=swap'
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
        this.version = '2.0.0';
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
        am.registerVendorStyle('fa-css', CDN.fontawesome, { version: '6.5.1' });
        am.registerVendorStyle('toastr-css', CDN.toastrCss, { version: '2.1.4' });
        am.registerVendorScript('jquery', CDN.jquery, { version: '3.7.1' });
        am.registerVendorScript('toastr-js', CDN.toastrJs, { deps: ['jquery'], version: '2.1.4' });
        am.registerVendorScript('sortable', CDN.sortable, { version: '1.15.6' });

        // ── Eigene Dateien (über die Theme-Kette auflösbar) ──────────────────
        am.registerStyle('data-table-css', 'data-table.css', { version: this.version });
        am.registerStyle('tokens', 'tokens.css', { deps: ['tabler-css'], version: this.version });

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
        am.registerVendorStyle('fontawesome', CDN.fontawesome, { version: '6.5.1' });
        am.registerVendorStyle('fonts-frontend', CDN.fontsFrontend, { version: '' });
        am.registerVendorStyle('aos-css', '/public/vendor/aos/aos.css', { version: '2.3.4' });
        am.registerVendorStyle('glightbox-css', '/public/vendor/glightbox/css/glightbox.min.css', { version: '3.2.0' });
        am.registerVendorStyle('swiper-css', '/public/vendor/swiper/swiper-bundle.min.css', { version: '11.0.5' });
        am.registerStyle('auth-css', 'auth.css', { deps: ['tokens'], version: this.version });
        am.registerStyle('frontend-css', 'frontend.css', { deps: ['tokens'], version: this.version });

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
        am.registerScript('toast-notification-center', 'toast-notification-center.js', { deps: ['global-toast'], version: this.version });
        am.registerScript('button-loading', 'button-loading.js', { version: this.version });
        // DuneDataTable. Beim Umstieg von AdminLTE auf Tabler ist es haengen
        // geblieben: das alte Theme reihte es fuer Guild-Seiten ein, dieses
        // nicht. `new DuneDataTable(...)` warf seitdem, und weil das im selben
        // Skriptblock steht wie der Rest, blieb die Port-Verwaltung des
        // Masterservers vollstaendig leer — kein Fehler, kein Leer-Zustand,
        // nichts. `firebot-tabler` hat kein Eltern-Theme, erbt die Datei also
        // nicht; sie liegt hier als eigene Kopie.
        am.registerScript('data-table', 'data-table.js', { deps: ['jquery'], version: this.version });
        am.registerScript('guild', 'guild.js', { deps: ['jquery'], version: this.version });
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
            ['tabler-css', 'tabler-themes-css', 'tokens', 'auth-css']
                .forEach(h => am.enqueueStyle(h));
            ['tabler-js', 'bootstrap-alias', 'auth-js']
                .forEach(h => am.enqueueScript(h));
            return;
        }

        if (section !== 'guild') {
            ['fonts-frontend', 'bootstrap-icons', 'fontawesome', 'bootstrap-css',
             'aos-css', 'glightbox-css', 'swiper-css', 'tokens', 'frontend-css']
                .forEach(h => am.enqueueStyle(h));
            ['jquery', 'bootstrap-js', 'php-email-form', 'aos-js', 'waypoints',
             'purecounter', 'glightbox-js', 'imagesloaded', 'isotope', 'swiper-js',
             'frontend-js']
                .forEach(h => am.enqueueScript(h));
            return;
        }

        am.enqueueStyle('tabler-css');
        am.enqueueStyle('tabler-themes-css');
        am.enqueueStyle('tokens');
        am.enqueueStyle('toastr-css');
        am.enqueueStyle('data-table-css');

        am.enqueueScript('tabler-js');
        am.enqueueScript('bootstrap-alias');
        am.enqueueScript('jquery');
        am.enqueueScript('toastr-js');
        am.enqueueScript('sortable');
        am.enqueueScript('global-toast');
        am.enqueueScript('toast-notification-center');
        am.enqueueScript('button-loading');
        am.enqueueScript('data-table');
        am.enqueueScript('guild');
    }
}

module.exports = DefaultTheme;
