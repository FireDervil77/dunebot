const { holen, ABSTAND_DASHBOARD_MS } = require('../../quellen/vorschlaege');

/**
 * IPC: Trefferliste waehrend des Tippens - fuer das Dashboard.
 *
 * Dieselbe Funktion, die Discord bei jedem Tastendruck befragt, samt ihrem
 * Zwischenspeicher, dem Mindestabstand je Nutzer und der Frist. Die Suche
 * gehoert in den Bot, nicht ins Dashboard: dort liegen die Zugangsdaten, und
 * ein zweiter Sucher haette einen zweiten Zwischenspeicher - also doppelt so
 * viele Anfragen an YouTube fuer dieselbe Frage.
 *
 * Braucht **keinen** Abspieler und keine Sprachverbindung. Nachsehen, was es
 * gibt, muss auch gehen, wenn der Bot nirgends steht.
 */
module.exports = async (payload) => {
    const { eingabe, angefordertVon, guildId } = payload;

    if (!eingabe) return { success: true, treffer: [] };

    try {
        // Das Dashboard bekommt den kleinen Mindestabstand: Das Eingabefeld dort
        // wartet schon selbst, bevor es losschickt, und verwirft ueberholte
        // Antworten. Der grosse Abstand (fuer Discords Tastendruck-Sturm) hat
        // dort nur gebremst.
        const treffer = await holen(eingabe, angefordertVon || 'dashboard', guildId, {
            mindestabstandMs: ABSTAND_DASHBOARD_MS
        });
        return { success: true, treffer };
    } catch (error) {
        return { success: false, error: error.message };
    }
};
