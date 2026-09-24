/**
 * Werkbank — gemeinsame Helfer der Router, nach dem Vorbild von `discord`.
 *
 * @module werkbank/routes/_shared
 */

const { ServiceManager } = require('dunebot-core');

async function renderView(res, viewPath, data) {
    return await ServiceManager.get('themeManager').renderView(res, viewPath, data);
}

function renderFehler(res, error, kontext) {
    const themeManager = ServiceManager.get('themeManager');
    ServiceManager.get('Logger').error(`[Werkbank] ${kontext}:`, error);
    res.locals.layout = themeManager?.getLayout('guild');
    return res.status(500).render('error', {
        status: 500,
        message: 'Werkbank',
        error: { status: 500, title: 'Seite konnte nicht geladen werden', message: kontext, details: error.message }
    });
}

function fehler(res, error, nachricht, status = 500) {
    ServiceManager.get('Logger').error(`[Werkbank] ${nachricht}:`, error);
    return res.status(status).json({ success: false, message: error?.message || nachricht });
}

module.exports = { renderView, renderFehler, fehler };
