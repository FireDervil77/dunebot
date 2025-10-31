/**
 * Toast Notification Center
 * Zeigt ALLE Toast-Benachrichtigungen in der Navbar-Glocke an
 * 
 * @author FireDervil
 */

(function() {
    'use strict';

    // Konfiguration
    const REFRESH_INTERVAL = 300000; // 5 Minuten (statt 30 Sekunden)
    const MAX_DISPLAY_TOASTS = 5;    // Max. Toasts im Dropdown
    const ERROR_BACKOFF_TIME = 5000; // 5 Sekunden Pause nach Fehler

    // State
    let lastErrorTime = 0;
    let consecutiveErrors = 0;

    /**
     * Lädt Toast-History vom Server und aktualisiert UI
     */
    async function loadToastNotifications() {
        try {
            // ✅ Rate Limiting bei wiederholten Fehlern
            if (consecutiveErrors > 3) {
                const timeSinceError = Date.now() - lastErrorTime;
                if (timeSinceError < ERROR_BACKOFF_TIME) {
                    console.warn('[Toast Notifications] Zu viele Fehler, warte...');
                    return;
                }
            }

            const guildId = getCurrentGuildId();
            // ✅ ALLE Notifications anzeigen (nicht nur critical)
            const url = `/api/core/toasts/history?criticalOnly=false&limit=${MAX_DISPLAY_TOASTS}${guildId ? `&guildId=${guildId}` : ''}`;
            
            const response = await fetch(url);
            const data = await response.json();

            if (data.success) {
                updateNotificationUI(data.toasts || []);
                
                // ✅ Reset Error-Counter bei Erfolg
                consecutiveErrors = 0;
                
                // Debug-Info loggen falls verfügbar
                if (data.debug) {
                    console.log('[Toast Notifications] Session Debug:', data.debug);
                }
                if (data.message) {
                    console.log('[Toast Notifications] Info:', data.message);
                }
            } else {
                console.error('[Toast Notifications] Fehler beim Laden:', data.error);
                consecutiveErrors++;
                lastErrorTime = Date.now();
                // Bei Fehler leere Liste anzeigen
                updateNotificationUI([]);
            }
        } catch (error) {
            console.error('[Toast Notifications] Netzwerkfehler:', error);
            consecutiveErrors++;
            lastErrorTime = Date.now();
            // Bei Netzwerkfehler leere Liste anzeigen
            updateNotificationUI([]);
        }
    }
    
    // ✅ Exportiere loadToastNotifications global für Cross-Page Updates
    window.loadToastNotifications = loadToastNotifications;

    /**
     * Ermittelt Guild-ID aus aktueller URL
     */
    function getCurrentGuildId() {
        const guildMatch = window.location.pathname.match(/\/guild\/(\d+)/);
        return guildMatch ? guildMatch[1] : null;
    }

    /**
     * Aktualisiert Notification UI (Badge + Dropdown-Liste)
     */
    function updateNotificationUI(toasts) {
        const badge = document.getElementById('toastNotificationBadge');
        const list = document.getElementById('toastNotificationList');

        if (!badge || !list) {
            console.warn('[Toast Notifications] UI-Elemente nicht gefunden');
            return;
        }

        // ✅ ALLE Toasts anzeigen (nicht nur critical)
        const allToasts = toasts;
        const count = allToasts.length;

        // Badge aktualisieren
        if (count > 0) {
            badge.textContent = count > 99 ? '99+' : count;
            badge.style.display = 'inline';
            
            // Pulsieren bei neuen Toasts
            badge.classList.add('pulse-animation');
            setTimeout(() => badge.classList.remove('pulse-animation'), 1000);
        } else {
            badge.style.display = 'none';
        }

        // Liste aktualisieren
        if (allToasts.length === 0) {
            list.innerHTML = `
                <li class="dropdown-item text-center text-muted py-3">
                    <i class="bi bi-check-circle me-2"></i>
                    Keine Benachrichtigungen
                </li>
            `;
        } else {
            // Nur die neuesten X Toasts anzeigen
            const displayToasts = allToasts.slice(0, MAX_DISPLAY_TOASTS);
            
            list.innerHTML = displayToasts.map(toast => {
                // ✅ Icons für alle Toast-Typen
                let icon;
                switch(toast.type) {
                    case 'error':
                        icon = '<i class="bi bi-exclamation-circle-fill text-danger me-2"></i>';
                        break;
                    case 'warning':
                        icon = '<i class="bi bi-exclamation-triangle-fill text-warning me-2"></i>';
                        break;
                    case 'success':
                        icon = '<i class="bi bi-check-circle-fill text-success me-2"></i>';
                        break;
                    case 'info':
                        icon = '<i class="bi bi-info-circle-fill text-info me-2"></i>';
                        break;
                    default:
                        icon = '<i class="bi bi-bell-fill text-secondary me-2"></i>';
                }
                
                const timeAgo = getTimeAgo(toast.timestamp);
                const truncatedMessage = toast.message.length > 60 
                    ? toast.message.substring(0, 60) + '...' 
                    : toast.message;

                return `
                    <li>
                        <a href="#" class="dropdown-item py-2 toast-item-link" 
                           data-toast='${JSON.stringify(toast).replace(/'/g, "&#39;")}'
                           style="white-space: normal; border-bottom: 1px solid rgba(0,0,0,0.05);">
                            <div class="d-flex align-items-start">
                                <div class="flex-shrink-0">
                                    ${icon}
                                </div>
                                <div class="flex-grow-1">
                                    <div class="small text-muted">${timeAgo}</div>
                                    <div class="text-dark">${truncatedMessage}</div>
                                </div>
                                <button class="btn btn-sm btn-link text-muted dismiss-toast-btn p-0 ml-2" 
                                        data-id="${toast.id}" 
                                        title="Entfernen">
                                    <i class="bi bi-x-lg"></i>
                                </button>
                            </div>
                        </a>
                    </li>
                `;
            }).join('');
            
            // "Alle löschen" Button hinzufügen wenn Toasts vorhanden
            if (displayToasts.length > 0) {
                list.innerHTML += `
                    <li><hr class="dropdown-divider"></li>
                    <li>
                        <a href="#" class="dropdown-item text-center text-danger py-2 dismiss-all-toasts-btn">
                            <i class="bi bi-trash me-2"></i>
                            Alle löschen
                        </a>
                    </li>
                `;
            }
        }
    }

    /**
     * Zeigt Toast-Details in einem Modal (optional)
     */
    window.showToastDetails = function(toast) {
        // Einfache Alert-Version (kann später zu Modal ausgebaut werden)
        const details = `
Toast-Typ: ${toast.type}
Zeitpunkt: ${new Date(toast.timestamp).toLocaleString('de-DE')}
URL: ${toast.url || 'N/A'}

Nachricht:
${toast.message}

${toast.metadata ? 'Metadata:\n' + JSON.stringify(toast.metadata, null, 2) : ''}
        `.trim();

        alert(details);
    };

    /**
     * Löscht einen einzelnen Toast
     */
    window.dismissToast = async function(toastId) {
        try {
            const response = await fetch(`/api/core/toasts/dismiss/${toastId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            });

            const result = await response.json();

            if (result.success) {
                console.log(`[Toast Notifications] Toast ${toastId} dismissed`);
                // UI sofort aktualisieren
                await loadToastNotifications();
            } else {
                console.error('[Toast Notifications] Dismiss fehlgeschlagen:', result.error);
            }
        } catch (error) {
            console.error('[Toast Notifications] Fehler beim Dismissing:', error);
        }
    };

    /**
     * Löscht alle Toasts des Users
     */
    window.dismissAllToasts = async function() {
        if (!confirm('Wirklich alle Benachrichtigungen löschen?')) {
            return;
        }

        try {
            const guildId = getCurrentGuildId();
            const response = await fetch('/api/core/toasts/dismiss-all', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ guildId })
            });

            const result = await response.json();

            if (result.success) {
                console.log(`[Toast Notifications] ${result.count} Toasts dismissed`);
                // UI sofort aktualisieren
                await loadToastNotifications();
            } else {
                console.error('[Toast Notifications] Dismiss-All fehlgeschlagen:', result.error);
            }
        } catch (error) {
            console.error('[Toast Notifications] Fehler beim Dismiss-All:', error);
        }
    };

    /**
     * Berechnet "vor X Minuten/Stunden" Text
     */
    function getTimeAgo(timestamp) {
        const now = Date.now();
        const time = new Date(timestamp).getTime();
        const diff = now - time;

        const seconds = Math.floor(diff / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);

        if (days > 0) return `vor ${days} Tag${days > 1 ? 'en' : ''}`;
        if (hours > 0) return `vor ${hours} Std.`;
        if (minutes > 0) return `vor ${minutes} Min.`;
        return 'gerade eben';
    }

    /**
     * Initialisierung
     */
    document.addEventListener('DOMContentLoaded', function() {
        // Prevent multiple initializations (wichtig bei SPA-Navigation!)
        if (window._toastNotificationCenterInitialized) {
            console.log('[Toast Notifications] Bereits initialisiert, überspringe...');
            return;
        }
        window._toastNotificationCenterInitialized = true;

        // Initial laden
        loadToastNotifications();

        // Periodisches Aktualisieren (5 Minuten statt 30 Sekunden)
        const refreshInterval = setInterval(loadToastNotifications, REFRESH_INTERVAL);

        // ✅ NEU: On-Demand Laden wenn Dropdown geöffnet wird
        const notificationBell = document.getElementById('toastNotificationBell');
        if (notificationBell) {
            notificationBell.addEventListener('click', function() {
                console.log('[Toast Notifications] Dropdown geöffnet - lade aktuelle Toasts...');
                loadToastNotifications();
            });
        }

        // ✅ Event-Delegation für Toast-Details (CSP-konform)
        document.addEventListener('click', function(e) {
            const toastLink = e.target.closest('.toast-item-link');
            if (toastLink) {
                e.preventDefault();
                try {
                    const toastData = JSON.parse(toastLink.getAttribute('data-toast'));
                    showToastDetails(toastData);
                } catch (error) {
                    console.error('[Toast Notifications] Fehler beim Parsen der Toast-Daten:', error);
                }
            }
        });

        // ✅ Event-Delegation für Dismiss-Button (CSP-konform)
        document.addEventListener('click', function(e) {
            const dismissBtn = e.target.closest('.dismiss-toast-btn');
            if (dismissBtn) {
                e.preventDefault();
                e.stopPropagation();
                const toastId = parseInt(dismissBtn.getAttribute('data-id'));
                if (toastId) {
                    dismissToast(toastId);
                }
            }
        });

        // ✅ Event-Delegation für "Alle löschen" Button (CSP-konform)
        document.addEventListener('click', function(e) {
            const dismissAllBtn = e.target.closest('.dismiss-all-toasts-btn');
            if (dismissAllBtn) {
                e.preventDefault();
                dismissAllToasts();
            }
        });

        // Bei jedem neuen Toast auch sofort aktualisieren
        // ✅ Named function für removeEventListener
        const handleToastShown = function() {
            setTimeout(loadToastNotifications, 500);
        };
        window.addEventListener('toastShown', handleToastShown);

        // Cleanup bei Page Unload (SPA-Navigation)
        window.addEventListener('beforeunload', function() {
            clearInterval(refreshInterval);
            window.removeEventListener('toastShown', handleToastShown);
            window._toastNotificationCenterInitialized = false;
        });

        console.log('[Toast Notifications] Notification Center initialisiert (Polling: 5 min)');
    });

    // CSS für Pulsier-Animation
    if (!document.getElementById('toast-notification-styles')) {
        const style = document.createElement('style');
        style.id = 'toast-notification-styles';
        style.textContent = `
            @keyframes pulse {
                0%, 100% { transform: scale(1); }
                50% { transform: scale(1.1); }
            }
            .pulse-animation {
                animation: pulse 0.5s ease-in-out 2;
            }
            #toastNotificationBadge {
                position: absolute;
                top: 2px;
                right: 2px;
                font-size: 0.65rem;
                padding: 2px 5px;
                border-radius: 10px;
            }
        `;
        document.head.appendChild(style);
    }

})();
