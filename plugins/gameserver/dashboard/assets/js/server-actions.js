/**
 * Server-Action-Handler
 * 
 * Verwaltet Benutzer-Aktionen für Gameserver:
 * - Start/Stop/Restart via AJAX
 * - Copy-to-Clipboard Funktionalität
 * - Toast-Benachrichtigungen
 * - Error-Handling
 * 
 * @author FireDervil
 * @version 1.0.0
 */

/**
 * Führt Server-Action aus (Start, Stop, Restart)
 * @param {string} serverId - Server-ID
 * @param {string} action - Action-Type: 'start', 'stop', 'restart'
 * @param {{update?: boolean}} [optionen] - update: „Mit Update starten"
 *        (2026-10-16) — vor dem Start holt der Daemon die neueste Fassung.
 */
async function serverAction(serverId, action, optionen = {}) {
    console.log(`[ServerAction] ${action} für Server ${serverId}`);

    // Bestätigungsdialog nur für Stop (nicht für Start/Restart)
    if (action === 'stop') {
        if (!confirm('Möchtest du den Server wirklich stoppen?')) {
            console.log('[ServerAction] Action abgebrochen durch Benutzer');
            return;
        }
    }

    // Guild-ID aus URL extrahieren
    const pathParts = window.location.pathname.split('/');
    const guildIdIndex = pathParts.indexOf('guild') + 1;
    const guildId = pathParts[guildIdIndex];

    if (!guildId) {
        console.error('[ServerAction] ❌ Keine Guild-ID gefunden');
        if (window.showToast) {
            window.showToast('error', 'Fehler: Keine Guild-ID gefunden');
        }
        return;
    }    // Button disablen während Request
    // Aus dem Menü des Pfeils („Mit Update starten") gerufen, ist event.target
    // ein Menüeintrag — gesperrt und umbeschriftet wird der Knopf daneben.
    const ziel = (typeof event !== 'undefined' && event) ? event.target : null;
    const imMenue = ziel && ziel.closest && ziel.closest('.dropdown-menu');
    const button = (imMenue ? imMenue.closest('.btn-group')?.querySelector('button') : ziel?.closest?.('button')) || ziel;
    const originalText = button.innerHTML;
    button.disabled = true;
    button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Lade...';

    try {
        const url = `/guild/${guildId}/plugins/gameserver/servers/${serverId}/${action}`;
        console.log(`[ServerAction] POST ${url}`);

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(optionen.update ? { update: true } : {}),
        });

        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.message || `HTTP-Fehler ${response.status}`);
        }

        if (result.success) {
            console.log(`[ServerAction] ✅ ${action} erfolgreich:`, result);
            
            // Erfolgs-Meldungen
            const messages = {
                start: optionen.update ? 'Server wird aktualisiert und gestartet …' : 'Server wird gestartet...',
                stop: 'Server wird gestoppt...',
                restart: optionen.update ? 'Server wird aktualisiert und neu gestartet …' : 'Server wird neugestartet...'
            };
            
            if (window.showToast) {
                window.showToast('success', messages[action] || 'Action erfolgreich');
            }
            
            // ✅ Sofortiges UI-Update für besseres UX (SSE liefert später finale Status)
            // Setze Zwischenstatus bis SSE-Event kommt
            const intermediateStatus = {
                start: 'starting',
                stop: 'stopping',
                restart: 'restarting'
            }[action];
            
            if (intermediateStatus) {
                console.log(`[ServerAction] Setze Zwischenstatus: ${intermediateStatus}`);
                
                // Overview-Page: GameserverOverview (hat eigene SSE-Connection)
                if (window.gameserverOverview) {
                    window.gameserverOverview.updateServerStatus({
                        server_id: serverId,
                        status: intermediateStatus
                    });
                }
                
                // Detail-Page: Direkte UI-Update-Funktion
                if (window.updateDetailUI) {
                    window.updateDetailUI(intermediateStatus);
                }
            }
            
            // Status-Update erfolgt automatisch via SSE!
            
        } else {
            throw new Error(result.message || 'Unbekannter Fehler');
        }

    } catch (error) {
        console.error(`[ServerAction] ❌ Fehler bei ${action}:`, error);
        if (window.showToast) {
            window.showToast('error', `Fehler: ${error.message}`);
        }

        // ✅ UI sofort auf 'error' setzen (Fallback falls SSE-Event nicht ankommt)
        if (window.gameserverOverview) {
            window.gameserverOverview.updateServerStatus({
                server_id: serverId,
                status: 'error'
            });
        }
        if (window.updateDetailUI) {
            window.updateDetailUI('error');
        }
    } finally {
        // Button wieder aktivieren
        button.disabled = false;
        button.innerHTML = originalText;
    }
}

/**
 * Kopiert Text in Clipboard
 * @param {string} text - Zu kopierender Text
 */
async function copyToClipboard(text) {
    console.log('[ServerAction] Copy to Clipboard:', text);

    try {
        // Modern Clipboard API (Chrome, Firefox, Edge)
        if (navigator.clipboard && window.isSecureContext) {
            await navigator.clipboard.writeText(text);
            if (window.showToast) {
                window.showToast('success', 'In Zwischenablage kopiert!');
            }
        } else {
            // Fallback für ältere Browser
            const textarea = document.createElement('textarea');
            textarea.value = text;
            textarea.style.position = 'fixed';
            textarea.style.left = '-9999px';
            document.body.appendChild(textarea);
            textarea.select();
            
            const success = document.execCommand('copy');
            document.body.removeChild(textarea);
            
            if (success) {
                if (window.showToast) {
                    window.showToast('success', 'In Zwischenablage kopiert!');
                }
            } else {
                throw new Error('document.execCommand failed');
            }
        }
        
        console.log('[ServerAction] ✅ Copy erfolgreich');
        
    } catch (error) {
        console.error('[ServerAction] ❌ Copy fehlgeschlagen:', error);
        if (window.showToast) {
            window.showToast('error', 'Kopieren fehlgeschlagen!');
        }
    }
}

/** Der blaue Toast überlebt den Sprung in die Übersicht nur hier. */
const TOAST_NACH_SPRUNG = 'gameserver-toast-nach-sprung';

/** Was im Dialog einzutippen ist; die Route prüft dasselbe (Loeschung.WORT). */
const LOESCH_WORT = 'löschen';

/**
 * Server löschen: roter Dialog, Wort eintippen. Danach läuft es im Hintergrund
 * (helpers/Loeschung.js), die Seite springt in die Übersicht und die Zeile
 * bleibt dort gesperrt und rot, bis es fertig ist.
 *
 * @param {string} serverId - Server-ID
 * @param {string} serverName - Server-Name (für Bestätigung)
 */
function deleteServer(serverId, serverName) {
    const dialog = document.getElementById('serverLoeschenModal');
    const eingabe = document.getElementById('serverLoeschenEingabe');
    const knopf = document.getElementById('serverLoeschenKnopf');
    document.getElementById('serverLoeschenName').textContent = serverName;
    document.getElementById('serverLoeschenSoll').textContent = LOESCH_WORT;
    eingabe.value = '';
    knopf.disabled = true;

    // Wie Loeschung.bestaetigt: Großschreibung machen Handys von selbst.
    const passt = () => eingabe.value.trim().toLowerCase() === LOESCH_WORT;
    eingabe.oninput = () => { knopf.disabled = !passt(); };
    eingabe.onkeydown = (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        if (!knopf.disabled) knopf.click();
    };

    const guildId = window.location.pathname.match(/\/guild\/(\d+)/)[1];
    const uebersicht = `/guild/${guildId}/plugins/gameserver/servers`;
    zeigeMitgehendeSicherungen(uebersicht, serverId);

    const fenster = bootstrap.Modal.getOrCreateInstance(dialog);
    knopf.onclick = async () => {
        if (!passt()) return;
        knopf.disabled = true;
        const meldung = 'Server wird gelöscht. Läuft er noch, wird er vorher beendet.';

        // Vor der Anfrage: Die Live-Anzeige springt bei „wird gelöscht" schon
        // selbst und kann der Antwort zuvorkommen.
        try { sessionStorage.setItem(TOAST_NACH_SPRUNG, meldung); } catch (_) { /* dann ohne Toast */ }

        try {
            const antwort = await fetch(`${uebersicht}/${serverId}`, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ bestaetigung: eingabe.value }),
            });
            const ergebnis = await antwort.json();
            if (!antwort.ok || !ergebnis.success) throw new Error(ergebnis.message || `HTTP-Fehler ${antwort.status}`);
            window.location.href = uebersicht;
        } catch (fehler) {
            // Der Dialog bleibt offen: Noch ist nichts passiert.
            try { sessionStorage.removeItem(TOAST_NACH_SPRUNG); } catch (_) { /* nichts zu räumen */ }
            console.error('[ServerAction] ❌ Löschen abgewiesen:', fehler);
            window.showToast?.('error', fehler.message);
            knopf.disabled = false;
        }
    };

    fenster.show();
    dialog.addEventListener('shown.bs.modal', () => eingabe.focus(), { once: true });
}

/**
 * Im Löschdialog: Wie viele Sicherungen gehen mit? (K313, 2026-11-08)
 *
 * Gezählt wird, was als Archiv noch auf der Maschine liegt — fertig und nicht
 * von der Aufbewahrung entfernt. Kommt die Liste nicht (kein Recht, Fehler),
 * bleibt es bei der Aufzählung im Dialog, die sagt es auch.
 */
async function zeigeMitgehendeSicherungen(uebersicht, serverId) {
    const kasten = document.getElementById('serverLoeschenSicherungen');
    if (!kasten) return;
    kasten.classList.add('d-none');
    try {
        const antwort = await fetch(`${uebersicht}/${serverId}/backups`, { headers: { Accept: 'application/json' } });
        if (!antwort.ok) return;
        const { backups } = await antwort.json();
        const da = (backups || []).filter(b => b.status === 'completed' && !b.pruned_at);
        if (!da.length) return;
        const bytes = da.reduce((n, b) => n + (Number(b.size_bytes) || 0), 0);
        const groesse = bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1).replace('.', ',')} GB` : `${Math.max(1, Math.round(bytes / 1e6))} MB`;
        document.getElementById('serverLoeschenSicherungenSatz').textContent = da.length === 1
            ? `Dieser Server hat eine Sicherung (${groesse}). Sie wird mit gelöscht.`
            : `Dieser Server hat ${da.length} Sicherungen (zusammen ${groesse}). Sie werden mit gelöscht.`;
        document.getElementById('serverLoeschenZuSicherungen').href = `${uebersicht}/${serverId}?bereich=sicherungen`;
        kasten.classList.remove('d-none');
    } catch (_) {
        // Ohne Liste kein Kasten — die Aufzählung im Dialog nennt die Sicherungen trotzdem.
    }
}

/**
 * Server neu installieren (bei error-Status)
 * @param {string} serverId - Server-ID
 * @param {string} serverName - Server-Name (für Bestätigung)
 */
async function reinstallServer(serverId, serverName) {
    console.log(`[ServerAction] Reinstall Server ${serverId} (${serverName})`);

    // Bestätigung
    if (!confirm(`🔧 Möchtest du den Server "${serverName}" neu installieren?\n\nDies wird:\n- Die bestehende Installation ersetzen\n- Alle Spiel-Dateien neu herunterladen\n- Config-Dateien bleiben erhalten\n\nLäuft er noch, wird er vorher sauber gestoppt — das kann bis zu zweieinhalb Minuten dauern.\n\nDauer: 5-15 Minuten (je nach Spiel)`)) {
        console.log('[ServerAction] Reinstall abgebrochen durch Benutzer');
        return;
    }

    // Guild-ID aus URL extrahieren
    const pathParts = window.location.pathname.split('/');
    const guildIdIndex = pathParts.indexOf('guild') + 1;
    const guildId = pathParts[guildIdIndex];

    if (!guildId) {
        console.error('[ServerAction] ❌ Keine Guild-ID gefunden');
        if (window.showToast) {
            window.showToast('error', 'Fehler: Keine Guild-ID gefunden');
        }
        return;
    }

    // Loading-Toast
    if (window.showToast) {
        window.showToast('info', `Neuinstallation von "${serverName}" … läuft er noch, wird er zuerst gestoppt.`);
    }

    try {
        const url = `/guild/${guildId}/plugins/gameserver/servers/${serverId}/reinstall`;
        console.log(`[ServerAction] POST ${url}`);

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
        });

        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.message || `HTTP-Fehler ${response.status}`);
        }

        if (result.success) {
            console.log(`[ServerAction] ✅ Reinstall gestartet:`, result);
            
            if (window.showToast) {
                // Die Route sagt selbst, ob vorher gestoppt wurde (Baustelle 155).
                window.showToast('success', result.message || 'Installation läuft! Du erhältst eine Benachrichtigung, wenn sie abgeschlossen ist.');
            }
            
            // Status-Update erfolgt automatisch via SSE (installing → offline/error)
            
        } else {
            throw new Error(result.message || 'Unbekannter Fehler');
        }

    } catch (error) {
        console.error(`[ServerAction] ❌ Fehler beim Reinstall:`, error);
        if (window.showToast) {
            window.showToast('error', `Fehler beim Reinstall: ${error.message}`);
        }
    }
}

// ============================================
// Event-Delegation für Action-Buttons
// ============================================
document.addEventListener('DOMContentLoaded', () => {
    try {
        const nachSprung = sessionStorage.getItem(TOAST_NACH_SPRUNG);
        if (nachSprung) {
            sessionStorage.removeItem(TOAST_NACH_SPRUNG);
            window.showToast?.('info', nachSprung);
        }
    } catch (_) { /* Speicher gesperrt: dann ohne Toast */ }

    console.log('[ServerAction] Event-Delegation initialisiert');
    console.log('[ServerAction] Nutzt globales Toast-System (window.showToast)');
    
    // Hinweis: Buttons nutzen onclick-Attribut in server-card.ejs
    // → serverAction() und copyToClipboard() sind global verfügbar
});
