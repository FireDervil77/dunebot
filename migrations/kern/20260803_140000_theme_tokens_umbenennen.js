'use strict';

/**
 * Die Theme-Anpassungen einer Guild lagen als lose CSS-Variablennamen in
 * `guild_themes.custom_variables` (`primary-color`, `sidebar-bg`, …). Mit der
 * Token-Schicht heißen sie `fb-*` und sind eine benannte Rolle statt einer
 * beliebigen Variable.
 *
 * Umbenannt wird nur, was es gibt — unbekannte Schlüssel bleiben unangetastet,
 * damit selbst gesetzte Variablen nicht verloren gehen.
 */

const UMBENENNUNG = {
    'primary-color':    'fb-primary',
    'accent-color':     'fb-accent',
    'link-color':       'fb-link',
    'sidebar-bg':       'fb-sidebar-bg',
    'sidebar-color':    'fb-sidebar-text',
    'sidebar-hover-bg': 'fb-sidebar-hover-bg',
    'header-bg':        'fb-header-bg',
    'body-bg':          'fb-body-bg',
    'card-bg':          'fb-surface-bg',
    'text-color':       'fb-text'
};

/**
 * Schlüssel einer Zeile nach der Karte umbenennen.
 *
 * @param {object} variablen
 * @param {object} karte - alt → neu
 * @returns {{werte: object, geaendert: boolean}}
 */
function umbenennen(variablen, karte) {
    const werte = {};
    let geaendert = false;

    for (const [schluessel, wert] of Object.entries(variablen)) {
        const neu = karte[schluessel];
        if (neu) {
            werte[neu] = wert;
            geaendert = true;
        } else {
            werte[schluessel] = wert;
        }
    }

    return { werte, geaendert };
}

/**
 * Alle Zeilen mit gesetzten Variablen durchgehen und umschreiben.
 *
 * @param {object} db
 * @param {object} karte - alt → neu
 */
async function alleZeilenUmschreiben(db, karte) {
    const zeilen = await db.query(
        'SELECT id, custom_variables FROM guild_themes WHERE custom_variables IS NOT NULL'
    );

    for (const zeile of (zeilen || [])) {
        let variablen = zeile.custom_variables;
        if (typeof variablen === 'string') {
            try { variablen = JSON.parse(variablen); } catch { continue; }
        }
        if (!variablen || typeof variablen !== 'object') continue;

        const { werte, geaendert } = umbenennen(variablen, karte);
        if (!geaendert) continue;

        await db.query(
            'UPDATE guild_themes SET custom_variables = ? WHERE id = ?',
            [JSON.stringify(werte), zeile.id]
        );
    }
}

module.exports = {
    description: 'Theme-Anpassungen der Guilds auf die fb-Token-Namen umbenennen',

    async up(db) {
        await alleZeilenUmschreiben(db, UMBENENNUNG);
    },

    async down(db) {
        const rueckwaerts = Object.fromEntries(
            Object.entries(UMBENENNUNG).map(([alt, neu]) => [neu, alt])
        );
        await alleZeilenUmschreiben(db, rueckwaerts);
    }
};
