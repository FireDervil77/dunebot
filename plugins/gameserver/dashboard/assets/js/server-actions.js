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
 */
async function serverAction(serverId, action) {
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
    const button = event.target;
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
        });

        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.message || `HTTP-Fehler ${response.status}`);
        }

        if (result.success) {
            console.log(`[ServerAction] ✅ ${action} erfolgreich:`, result);
            
            // Erfolgs-Meldungen
            const messages = {
                start: 'Server wird gestartet...',
                stop: 'Server wird gestoppt...',
                restart: 'Server wird neugestartet...'
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

/**
 * Server löschen/deinstallieren
 * @param {string} serverId - Server-ID
 * @param {string} serverName - Server-Name (für Bestätigung)
 */
async function deleteServer(serverId, serverName) {
    console.log(`[ServerAction] Delete Server ${serverId} (${serverName})`);

    // Doppelte Bestätigung (wichtige Aktion!)
    if (!confirm(`⚠️ WARNUNG: Möchtest du den Server "${serverName}" wirklich LÖSCHEN?\n\nDies wird:\n- Alle Server-Dateien löschen\n- Den systemd-Service entfernen\n- Alle DB-Einträge löschen\n\nDiese Aktion kann NICHT rückgängig gemacht werden!`)) {
        console.log('[ServerAction] Delete abgebrochen durch Benutzer');
        return;
    }

    // Zweite Bestätigung
    if (!confirm(`Letzte Bestätigung: Server "${serverName}" wirklich löschen?`)) {
        console.log('[ServerAction] Delete abgebrochen (zweite Bestätigung)');
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
        window.showToast('info', 'Server wird gelöscht...');
    }

    try {
        const url = `/guild/${guildId}/plugins/gameserver/servers/${serverId}`;
        console.log(`[ServerAction] DELETE ${url}`);

        const response = await fetch(url, {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json',
            },
        });

        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.message || `HTTP-Fehler ${response.status}`);
        }

        if (result.success) {
            console.log(`[ServerAction] ✅ Server gelöscht:`, result);
            
            if (window.showToast) {
                window.showToast('success', `Server "${serverName}" erfolgreich gelöscht!`);
            }
            
            // Nach 1,5s zur Server-Liste zurückkehren
            setTimeout(() => {
                window.location.href = `/guild/${guildId}/plugins/gameserver/servers`;
            }, 1500);
            
        } else {
            throw new Error(result.message || 'Unbekannter Fehler');
        }

    } catch (error) {
        console.error(`[ServerAction] ❌ Fehler beim Löschen:`, error);
        if (window.showToast) {
            window.showToast('error', `Fehler beim Löschen: ${error.message}`);
        }
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
    if (!confirm(`🔧 Möchtest du den Server "${serverName}" neu installieren?\n\nDies wird:\n- Die bestehende Installation ersetzen\n- Alle Spiel-Dateien neu herunterladen\n- Config-Dateien bleiben erhalten\n\nDauer: 5-15 Minuten (je nach Spiel)`)) {
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
        window.showToast('info', `Installation von "${serverName}" wird gestartet...`);
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
                window.showToast('success', `Installation läuft! Du erhältst eine Benachrichtigung wenn sie abgeschlossen ist.`);
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
    console.log('[ServerAction] Event-Delegation initialisiert');
    console.log('[ServerAction] Nutzt globales Toast-System (window.showToast)');
    
    // Hinweis: Buttons nutzen onclick-Attribut in server-card.ejs
    // → serverAction() und copyToClipboard() sind global verfügbar
});
