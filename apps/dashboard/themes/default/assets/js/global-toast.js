/**
 * Globales Toast-System für DuneBot Dashboard
 * 
 * Features:
 * - Einheitliche Toast-API über alle Plugins hinweg
 * - Automatisches Logging von kritischen Toasts
 * - I18n-Support über window.i18n
 * - Konfigurierbare Toast-Optionen
 * 
 * @author FireDervil
 * @version 1.0.0
 */

(function(window) {
    'use strict';

    // Toastr Globale Konfiguration
    if (typeof toastr !== 'undefined') {
        toastr.options = {
            closeButton: true,
            debug: false,
            newestOnTop: true,
            progressBar: true,
            positionClass: 'toast-top-right',
            preventDuplicates: false,
            onclick: null,
            showDuration: '300',
            hideDuration: '1000',
            timeOut: '5000',
            extendedTimeOut: '1000',
            showEasing: 'swing',
            hideEasing: 'linear',
            showMethod: 'fadeIn',
            hideMethod: 'fadeOut'
        };
    }

    /**
     * Zeigt eine Toast-Benachrichtigung an
     * 
     * @param {string} type - Toast-Typ: 'success', 'error', 'warning', 'info'
     * @param {string} message - Nachricht (kann i18n-Key sein)
     * @param {object} options - Optionale Einstellungen
     * @param {string} options.title - Toast-Titel
     * @param {number} options.timeOut - Anzeigedauer in ms (0 = dauerhaft)
     * @param {boolean} options.logToServer - Toast an Server loggen (Standard: nur bei error/warning)
     * @param {object} options.metadata - Zusätzliche Metadaten für Server-Log
     * @returns {void}
     */
    window.showToast = function(type, message, options) {
        options = options || {};

        // Validierung
        if (!type || !message) {
            console.error('[Toast] Type und Message sind erforderlich');
            return;
        }

        const validTypes = ['success', 'error', 'warning', 'info'];
        if (!validTypes.includes(type)) {
            console.error('[Toast] Ungültiger Type:', type);
            type = 'info';
        }

        // I18n-Übersetzung versuchen (falls window.i18n verfügbar)
        let translatedMessage = message;
        if (window.i18n && window.i18n.TOAST_MESSAGES && window.i18n.TOAST_MESSAGES[message]) {
            translatedMessage = window.i18n.TOAST_MESSAGES[message];
        }

        // Toast anzeigen
        if (typeof toastr !== 'undefined') {
            const toastOptions = {};
            if (options.title) toastOptions.title = options.title;
            if (options.timeOut !== undefined) toastOptions.timeOut = options.timeOut;
            if (options.closeButton !== undefined) toastOptions.closeButton = options.closeButton;
            
            toastr[type](translatedMessage, options.title || '', toastOptions);
        } else {
            // Fallback: Console-Log wenn Toastr nicht geladen
            console.warn('[Toast] Toastr nicht verfügbar - Fallback auf Console:', type, translatedMessage);
        }

        // Server-Logging für kritische Toasts
        const shouldLog = options.logToServer !== undefined 
            ? options.logToServer 
            : (type === 'error' || type === 'warning');

        if (shouldLog && window.logToastToServer) {
            window.logToastToServer(type, message, options.metadata);
        }

        // Event feuern für Notification Center
        if (typeof CustomEvent !== 'undefined') {
            const event = new CustomEvent('toastShown', { 
                detail: { type, message, metadata: options.metadata } 
            });
            window.dispatchEvent(event);
        }
    };

    /**
     * Loggt Toast-Event an den Server (für Monitoring/Debugging)
     * 
     * @param {string} type - Toast-Typ
     * @param {string} message - Nachricht
     * @param {object} metadata - Zusätzliche Metadaten
     * @returns {Promise<void>}
     */
    window.logToastToServer = async function(type, message, metadata) {
        try {
            const payload = {
                type: type,
                message: message,
                timestamp: new Date().toISOString(),
                url: window.location.pathname,
                userAgent: navigator.userAgent,
                metadata: metadata || {}
            };

            // Guild-ID aus URL extrahieren (falls vorhanden)
            const guildMatch = window.location.pathname.match(/\/guild\/(\d+)/);
            if (guildMatch) {
                payload.guildId = guildMatch[1];
            }

            await fetch('/api/core/toasts/log', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            });
        } catch (error) {
            console.error('[Toast] Fehler beim Loggen an Server:', error);
        }
    };

    /**
     * Convenience-Funktionen für häufig genutzte Toast-Typen
     */
    window.showSuccess = function(message, options) {
        window.showToast('success', message, options);
    };

    window.showError = function(message, options) {
        window.showToast('error', message, options);
    };

    window.showWarning = function(message, options) {
        window.showToast('warning', message, options);
    };

    window.showInfo = function(message, options) {
        window.showToast('info', message, options);
    };

    /**
     * Zeigt Toast mit automatischer Netzwerk-Fehlerbehandlung
     * 
     * @param {Promise} promise - Fetch-Promise
     * @param {object} messages - Success/Error Messages
     * @param {string} messages.success - Erfolgs-Nachricht
     * @param {string} messages.error - Fehler-Nachricht
     * @returns {Promise<any>}
     */
    window.showToastForPromise = async function(promise, messages) {
        try {
            const result = await promise;
            
            if (result.ok || result.success) {
                window.showSuccess(messages.success || 'GENERIC_SUCCESS');
                return result;
            } else {
                const errorMsg = result.error || result.message || messages.error || 'GENERIC_ERROR';
                window.showError(errorMsg);
                throw new Error(errorMsg);
            }
        } catch (error) {
            const errorMsg = error.message || messages.error || 'GENERIC_ERROR';
            window.showError(errorMsg, { metadata: { error: error.toString() } });
            throw error;
        }
    };

    console.log('[Toast] Globales Toast-System initialisiert');

})(window);
