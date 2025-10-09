/**
 * Toast Notification Center
 * Zeigt kritische Toasts (error, warning) in der Navbar-Glocke an
 * 
 * @author FireDervil
 */

(function() {
    'use strict';

    // Konfiguration
    const REFRESH_INTERVAL = 30000; // 30 Sekunden
    const MAX_DISPLAY_TOASTS = 5;   // Max. Toasts im Dropdown

    /**
     * Lädt Toast-History vom Server und aktualisiert UI
     */
    async function loadToastNotifications() {
        try {
            const response = await fetch('/api/core/toasts/history');
            const data = await response.json();

            if (data.success) {
                updateNotificationUI(data.toasts || []);
            } else {
                console.error('[Toast Notifications] Fehler beim Laden:', data.error);
            }
        } catch (error) {
            console.error('[Toast Notifications] Netzwerkfehler:', error);
        }
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

        // Nur kritische Toasts (error, warning)
        const criticalToasts = toasts.filter(t => t.type === 'error' || t.type === 'warning');
        const count = criticalToasts.length;

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
        if (criticalToasts.length === 0) {
            list.innerHTML = `
                <li class="dropdown-item text-center text-muted py-3">
                    <i class="bi bi-check-circle me-2"></i>
                    Keine kritischen Benachrichtigungen
                </li>
            `;
        } else {
            // Nur die neuesten X Toasts anzeigen
            const displayToasts = criticalToasts.slice(0, MAX_DISPLAY_TOASTS);
            
            list.innerHTML = displayToasts.map(toast => {
                const icon = toast.type === 'error' 
                    ? '<i class="bi bi-exclamation-circle-fill text-danger me-2"></i>' 
                    : '<i class="bi bi-exclamation-triangle-fill text-warning me-2"></i>';
                
                const timeAgo = getTimeAgo(toast.timestamp);
                const truncatedMessage = toast.message.length > 60 
                    ? toast.message.substring(0, 60) + '...' 
                    : toast.message;

                return `
                    <li>
                        <a href="#" class="dropdown-item py-2" 
                           onclick="showToastDetails(${JSON.stringify(toast).replace(/"/g, '&quot;')}); return false;"
                           style="white-space: normal; border-bottom: 1px solid rgba(0,0,0,0.05);">
                            <div class="d-flex align-items-start">
                                <div class="flex-shrink-0">
                                    ${icon}
                                </div>
                                <div class="flex-grow-1">
                                    <div class="small text-muted">${timeAgo}</div>
                                    <div class="text-dark">${truncatedMessage}</div>
                                </div>
                            </div>
                        </a>
                    </li>
                `;
            }).join('');
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
        // Initial laden
        loadToastNotifications();

        // Periodisches Aktualisieren
        setInterval(loadToastNotifications, REFRESH_INTERVAL);

        // Bei jedem neuen Toast auch sofort aktualisieren
        if (window.addEventListener) {
            window.addEventListener('toastShown', function() {
                setTimeout(loadToastNotifications, 500);
            });
        }

        console.log('[Toast Notifications] Notification Center initialisiert');
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
