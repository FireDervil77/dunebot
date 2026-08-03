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
    fontawesome: 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css'
};

/** Aus node_modules ausgeliefert — siehe die Vendor-Route in app.js. */
const TABLER = {
    css:    '/vendor/tabler/css/tabler.min.css',
    js:     '/vendor/tabler/js/tabler.min.js',
    themes: '/vendor/tabler/css/tabler-themes.min.css'
};

class TablerTheme {
    constructor(app) {
        this.app = app;
        this.name = 'firebot-tabler';
        this.version = '0.1.0';
        this.description = 'Neues Gerüst auf Tabler';
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

        // ── Was Tabler (noch) nicht abdeckt ─────────────────────────────────
        // Font Awesome bleibt vorerst: die Icon-Namen stecken über alle Views
        // verteilt. Der Wechsel auf @tabler/icons ist ein eigener Schritt.
        am.registerVendorStyle('fa-css', CDN.fontawesome, { version: '6.5.1' });
        am.registerVendorStyle('toastr-css', CDN.toastrCss, { version: '2.1.4' });
        am.registerVendorScript('jquery', CDN.jquery, { version: '3.7.1' });
        am.registerVendorScript('toastr-js', CDN.toastrJs, { deps: ['jquery'], version: '2.1.4' });
        am.registerVendorScript('sortable', CDN.sortable, { version: '1.15.6' });

        // ── Eigene Dateien (über die Theme-Kette auflösbar) ──────────────────
        am.registerStyle('tokens', 'tokens.css', { deps: ['tabler-css'], version: this.version });

        // ── Übergang: Auth und Frontend laufen noch mit dem alten Gerüst ─────
        // Ihre Layouts kommen über die Theme-Kette aus `default` und erwarten
        // AdminLTE. Solange dieses Theme sie nicht selbst mitbringt, wird für
        // diese beiden Bereiche der alte Satz geladen — sonst stünde deren
        // Markup ohne passendes CSS da. Fällt weg, sobald sie umgezogen sind.
        am.registerVendorStyle('alt-bootstrap-css', '/public/vendor/bootstrap/css/bootstrap.min.css', { version: '4.4.1' });
        am.registerVendorStyle('alt-adminlte-css', 'adminlte.min.css', { deps: ['alt-bootstrap-css'], version: '4.0.0', vendor: true });
        am.registerStyle('alt-auth-css', 'auth.css', { deps: ['alt-adminlte-css'], version: this.version });
        am.registerStyle('alt-frontend-css', 'frontend.css', { deps: ['alt-bootstrap-css'], version: this.version });
        am.registerVendorScript('alt-bootstrap-js', '/public/vendor/bootstrap/js/bootstrap.bundle.min.js', { deps: ['jquery'], version: '4.4.1' });
        am.registerVendorScript('alt-adminlte-js', 'adminlte.min.js', { deps: ['alt-bootstrap-js'], version: '4.0.0', vendor: true });
        am.registerScript('alt-auth-js', 'auth.js', { deps: ['alt-adminlte-js'], version: this.version });
        am.registerScript('alt-frontend-js', 'frontend.js', { deps: ['alt-bootstrap-js'], version: this.version });

        // Diese vier liegen im Standard-Theme und werden über die Kette
        // gefunden. Sie sind noch AdminLTE-geprägt und werden Stück für Stück
        // abgelöst — bis dahin halten sie die Seiten zusammen.
                // Anordnen im Dashboard — wird von der Dashboard-View selbst eingereiht
        am.registerScript('widget-arrange', 'widget-arrange.js', { deps: ['sortable'], version: this.version });

        am.registerScript('csrf-helper', 'csrf-helper.js', { inFooter: false, version: this.version });
        am.registerScript('global-toast', 'global-toast.js', { deps: ['toastr-js'], version: this.version });
        am.registerScript('button-loading', 'button-loading.js', { version: this.version });
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

        // Nur der Guild-Bereich hat schon ein Tabler-Layout. Auth und Frontend
        // laufen noch mit dem alten Gerüst — deren Layouts kommen aus `default`.
        if (section !== 'guild') {
            am.enqueueStyle(section === 'auth' ? 'alt-auth-css' : 'alt-frontend-css');
            am.enqueueScript('jquery');
            am.enqueueScript(section === 'auth' ? 'alt-auth-js' : 'alt-frontend-js');
            return;
        }

        am.enqueueStyle('tabler-css');
        am.enqueueStyle('tabler-themes-css');
        am.enqueueStyle('tokens');
        am.enqueueStyle('toastr-css');

        am.enqueueScript('tabler-js');
        am.enqueueScript('jquery');
        am.enqueueScript('toastr-js');
        am.enqueueScript('sortable');
        am.enqueueScript('global-toast');
        am.enqueueScript('button-loading');
        am.enqueueScript('guild');
    }
}

module.exports = TablerTheme;
