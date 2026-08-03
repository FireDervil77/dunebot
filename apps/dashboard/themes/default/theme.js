/**
 * FireBot Standard-Theme — Verhalten
 *
 * Gegenstück zu `theme.json`: dort steht, *was* das Theme ist (Metadaten,
 * Layouts, Konfiguration), hier steht, *wie* es sich verhält. Das ist unsere
 * Entsprechung zur functions.php.
 *
 * Lebenszyklus, gerufen vom ThemeManager entlang der Theme-Kette
 * (Eltern zuerst, Kind zuletzt):
 *
 *   initialize(ctx)                    — einmalig beim Start
 *   registerAssets(assetManager, ctx)  — einmalig: Handles anmelden
 *   registerHooks(hooks, ctx)          — einmalig: Filter/Aktionen anmelden
 *   enqueueAssets(assetManager, section, ctx) — pro Request: einreihen
 *
 * Pfad-Konvention bei `registerStyle`/`registerScript`:
 *   - **relativer** Name (`'guild.css'`) → wird über die Theme-Kette aufgelöst,
 *     ein Child-Theme kann die Datei also ersetzen
 *   - **absoluter** Pfad (`/public/vendor/…`) → wird unverändert übernommen
 *
 * @author FireDervil
 */

/** Externe Quellen an einem Ort — von hier aus lassen sie sich lokalisieren. */
const CDN = {
    jquery:            'https://cdn.jsdelivr.net/npm/jquery@3.7.1/dist/jquery.min.js',
    overlayscrollbars: 'https://cdn.jsdelivr.net/npm/overlayscrollbars@2.11.0/browser/overlayscrollbars.browser.es6.min.js',
    chartjs:           'https://cdn.jsdelivr.net/npm/chart.js@4.4.5/dist/chart.umd.min.js',
    toastrJs:          'https://cdn.jsdelivr.net/npm/toastr@2.1.4/build/toastr.min.js',
    toastrCss:         'https://cdn.jsdelivr.net/npm/toastr@2.1.4/build/toastr.min.css',
    sortable:          'https://cdn.jsdelivr.net/npm/sortablejs@1.15.6/Sortable.min.js',
    fontawesome:       'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css',
    fontsGuild:        'https://fonts.googleapis.com/css?family=Source+Sans+Pro:300,400,400i,700&display=fallback',
    fontsFrontend:     'https://fonts.googleapis.com/css2?family=Roboto:wght@300;400;500;700&family=Raleway:wght@400;600;700&family=Poppins:wght@400;500;600&display=swap'
};

class DefaultTheme {
    constructor(app) {
        this.app = app;
        this.name = 'default';
        this.version = '1.0.0';
        this.description = 'Standard-Theme für FireBot';
        this.author = 'FireBot Team';
        this.info = { darkMode: false, supportRTL: false, responsive: true };

        this.config = {
            darkMode: true,
            primaryColor: '#3498db',
            accentColor: '#f39c12',
            logo: 'images/dunebot-logo.png',
            favicon: 'images/favicon.png'
        };
    }

    // ========================================================================
    // ASSETS ANMELDEN (einmalig beim Start)
    // ========================================================================

    /**
     * @param {import('dunebot-sdk/lib/AssetManager')} am
     */
    registerAssets(am) {
        if (!am) return;

        // ── Vendor-Styles ───────────────────────────────────────────────────
        am.registerVendorStyle('bootstrap-css', '/public/vendor/bootstrap/css/bootstrap.min.css', { version: '5.3.3' });
        am.registerVendorStyle('bootstrap-icons', '/public/vendor/bootstrap-icons/bootstrap-icons.min.css', { version: '1.13.1' });
        am.registerVendorStyle('fontawesome', CDN.fontawesome, { version: '6.5.1' });
        am.registerVendorStyle('toastr-css', CDN.toastrCss, { version: '2.1.4' });
        am.registerVendorStyle('adminlte-css', 'adminlte.min.css', { deps: ['bootstrap-css'], version: '3.2.0', vendor: true });
        am.registerVendorStyle('fonts-guild', CDN.fontsGuild, { version: '' });
        am.registerVendorStyle('fonts-frontend', CDN.fontsFrontend, { version: '' });

        am.registerVendorStyle('aos-css', '/public/vendor/aos/aos.css', { version: '2.3.4' });
        am.registerVendorStyle('glightbox-css', '/public/vendor/glightbox/css/glightbox.min.css', { version: '3.2.0' });
        am.registerVendorStyle('swiper-css', '/public/vendor/swiper/swiper-bundle.min.css', { version: '11.0.5' });

        // ── Theme-Styles (über die Kette auflösbar) ──────────────────────────
        // tokens.css trägt die --fb-Rollen und legt sie auf Bootstrap/AdminLTE.
        // Muss nach adminlte-css kommen, sonst gewinnen dessen Standardwerte.
        am.registerStyle('tokens', 'tokens.css', { deps: ['adminlte-css'], version: this.version });

        am.registerStyle('guild-css', 'guild.css', { deps: ['tokens'], version: this.version });
        am.registerStyle('guild-switcher-css', 'guild-switcher.css', { deps: ['guild-css'], version: this.version });
        am.registerStyle('data-table-css', 'data-table.css', { deps: ['guild-css'], version: this.version });
        am.registerStyle('auth-css', 'auth.css', { deps: ['tokens'], version: this.version });
        am.registerStyle('frontend-css', 'frontend.css', { deps: ['tokens'], version: this.version });

        // ── Vendor-Skripte ──────────────────────────────────────────────────
        am.registerVendorScript('jquery', CDN.jquery, { version: '3.7.1' });
        am.registerVendorScript('bootstrap-js', '/public/vendor/bootstrap/js/bootstrap.bundle.min.js', { deps: ['jquery'], version: '5.3.3' });
        am.registerVendorScript('overlayscrollbars', CDN.overlayscrollbars, { version: '2.11.0' });
        am.registerVendorScript('chartjs', CDN.chartjs, { version: '4.4.5' });
        am.registerVendorScript('toastr-js', CDN.toastrJs, { deps: ['jquery'], version: '2.1.4' });
        am.registerVendorScript('sortable', CDN.sortable, { version: '1.15.6' });
        am.registerVendorScript('adminlte-js', 'adminlte.min.js', { deps: ['bootstrap-js'], version: '3.2.0', vendor: true });

        am.registerVendorScript('php-email-form', '/public/vendor/php-email-form/validate.js', { version: '3.7.0' });
        am.registerVendorScript('aos-js', '/public/vendor/aos/aos.js', { version: '2.3.4' });
        am.registerVendorScript('waypoints', '/public/vendor/waypoints/noframework.waypoints.js', { version: '4.0.1' });
        am.registerVendorScript('purecounter', '/public/vendor/purecounter/purecounter_vanilla.js', { version: '1.5.0' });
        am.registerVendorScript('glightbox-js', '/public/vendor/glightbox/js/glightbox.min.js', { version: '3.2.0' });
        am.registerVendorScript('imagesloaded', '/public/vendor/imagesloaded/imagesloaded.pkgd.min.js', { version: '5.0.0' });
        am.registerVendorScript('isotope', '/public/vendor/isotope-layout/isotope.pkgd.min.js', { version: '3.0.6' });
        am.registerVendorScript('swiper-js', '/public/vendor/swiper/swiper-bundle.min.js', { version: '11.0.5' });

        // ── Theme-Skripte ───────────────────────────────────────────────────
        // csrf-helper muss in den Head: nachfolgende Inline-Skripte brauchen ihn
                // Anordnen im Dashboard — wird von der Dashboard-View selbst eingereiht
        am.registerScript('widget-arrange', 'widget-arrange.js', { deps: ['sortable'], version: this.version });

        am.registerScript('csrf-helper', 'csrf-helper.js', { inFooter: false, version: this.version });

        am.registerScript('global-toast', 'global-toast.js', { deps: ['toastr-js'], version: this.version });
        am.registerScript('toast-notification-center', 'toast-notification-center.js', { deps: ['global-toast'], version: this.version });
        am.registerScript('button-loading', 'button-loading.js', { version: this.version });
        am.registerScript('data-table', 'data-table.js', { deps: ['jquery'], version: this.version });
        // Handle bewusst 'guild': Plugins reihen es bereits unter diesem Namen ein
        am.registerScript('guild', 'guild.js', { deps: ['jquery', 'adminlte-js'], version: this.version });
        am.registerScript('guild-switcher', 'guild-switcher.js', { deps: ['guild'], version: this.version });
        am.registerScript('auth-js', 'auth.js', { deps: ['adminlte-js'], version: this.version });
        am.registerScript('frontend-js', 'frontend.js', { deps: ['bootstrap-js'], version: this.version });
    }

    // ========================================================================
    // ASSETS EINREIHEN (pro Request, abhängig vom Bereich)
    // ========================================================================

    /**
     * @param {import('dunebot-sdk/lib/AssetManager')} am
     * @param {string} section - 'guild', 'frontend' oder 'auth'
     */
    enqueueAssets(am, section) {
        if (!am) return;

        const bundles = {
            guild: {
                styles: [
                    'fonts-guild', 'bootstrap-css', 'bootstrap-icons', 'fontawesome',
                    'toastr-css', 'adminlte-css', 'tokens',
                    'guild-css', 'guild-switcher-css', 'data-table-css'
                ],
                scripts: [
                    'csrf-helper',
                    'jquery', 'bootstrap-js', 'overlayscrollbars', 'chartjs',
                    'toastr-js', 'sortable', 'adminlte-js',
                    'global-toast', 'toast-notification-center',
                    'button-loading', 'data-table', 'guild', 'guild-switcher'
                ]
            },
            auth: {
                styles: ['bootstrap-css', 'fontawesome', 'adminlte-css', 'tokens', 'auth-css'],
                scripts: ['csrf-helper', 'jquery', 'bootstrap-js', 'adminlte-js', 'auth-js']
            },
            frontend: {
                styles: [
                    'fonts-frontend', 'bootstrap-icons', 'fontawesome',
                    'bootstrap-css', 'aos-css', 'glightbox-css', 'swiper-css',
                    'tokens', 'frontend-css'
                ],
                scripts: [
                    'csrf-helper',
                    'jquery', 'bootstrap-js', 'php-email-form', 'aos-js', 'waypoints',
                    'purecounter', 'glightbox-js', 'imagesloaded', 'isotope', 'swiper-js',
                    'frontend-js'
                ]
            }
        };

        const bundle = bundles[section] || bundles.frontend;
        bundle.styles.forEach(handle => am.enqueueStyle(handle));
        bundle.scripts.forEach(handle => am.enqueueScript(handle));
    }

    // ========================================================================
    // HOOKS
    // ========================================================================

    /**
     * @param {object} hooks - Hook-System des PluginManagers
     */
    registerHooks(hooks) {
        if (!hooks) return;

        hooks.addFilter('body_classes', (classes, layout) => {
            if (this.config.darkMode) classes.push('dark-theme');
            if (layout === 'frontend') classes.push('frontend-layout');
            else if (layout === 'guild') classes.push('guild-layout');
            return classes;
        });
    }
}

module.exports = DefaultTheme;
