/**
 * Template Plugin - Custom JavaScript
 * 
 * Dieses Skript wird auf allen Template-Plugin-Seiten geladen.
 * 
 * @author DuneBot Team
 */

(function() {
    'use strict';

    console.log('Template Plugin JS geladen');

    /**
     * Initialisierung beim Laden der Seite
     */
    document.addEventListener('DOMContentLoaded', function() {
        initializeTooltips();
        initializeConfirmDialogs();
        initializeFormValidation();
    });

    /**
     * Bootstrap Tooltips initialisieren
     */
    function initializeTooltips() {
        const tooltipTriggerList = [].slice.call(
            document.querySelectorAll('[data-bs-toggle="tooltip"]')
        );
        
        tooltipTriggerList.map(function (tooltipTriggerEl) {
            return new bootstrap.Tooltip(tooltipTriggerEl);
        });
    }

    /**
     * Bestätigungs-Dialoge für kritische Aktionen
     */
    function initializeConfirmDialogs() {
        const confirmButtons = document.querySelectorAll('[data-confirm]');
        
        confirmButtons.forEach(button => {
            button.addEventListener('click', function(e) {
                const message = this.getAttribute('data-confirm');
                if (!confirm(message)) {
                    e.preventDefault();
                    return false;
                }
            });
        });
    }

    /**
     * Formular-Validierung
     */
    function initializeFormValidation() {
        const forms = document.querySelectorAll('.needs-validation');
        
        forms.forEach(form => {
            form.addEventListener('submit', function(event) {
                if (!form.checkValidity()) {
                    event.preventDefault();
                    event.stopPropagation();
                }
                
                form.classList.add('was-validated');
            }, false);
        });
    }

    /**
     * Beispiel: Daten vom Server laden
     */
    async function loadStats(guildId) {
        try {
            const response = await fetch(`/api/guild/${guildId}/template/stats`);
            const data = await response.json();
            
            if (data.success) {
                updateStatsDisplay(data.stats);
            }
        } catch (error) {
            console.error('Fehler beim Laden der Stats:', error);
        }
    }

    /**
     * Stats-Anzeige aktualisieren
     */
    function updateStatsDisplay(stats) {
        // Beispiel: Stats in DOM einfügen
        console.log('Stats aktualisiert:', stats);
    }

    /**
     * Erfolgs-Benachrichtigung anzeigen
     */
    function showSuccessNotification(message) {
        // Implementiere dein Notification-System hier
        console.log('Success:', message);
    }

    /**
     * Fehler-Benachrichtigung anzeigen
     */
    function showErrorNotification(message) {
        // Implementiere dein Notification-System hier
        console.error('Error:', message);
    }

    // Öffentliche API
    window.TemplatePlugin = {
        loadStats,
        showSuccessNotification,
        showErrorNotification
    };

})();
