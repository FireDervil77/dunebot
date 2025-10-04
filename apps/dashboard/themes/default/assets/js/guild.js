/**
 * Guild-AJAX-Handler
 * Universeller Handler für alle AJAX-Aktionen im Guild-Dashboard
 * @author FireDervil
 */
class GuildAjaxHandler {
    static init() {
        // Toast-Container initialisieren
        if (!document.getElementById('toast-container')) {
            const container = document.createElement('div');
            container.id = 'toast-container';
            // Neue Position: Oben mittig
            container.className = 'position-fixed top-0 start-50 translate-middle-x p-3';
            // Optional: Z-Index um sicherzustellen dass der Toast über allem liegt
            container.style.zIndex = '9999';
            document.body.appendChild(container);
        }

        // Alle AJAX-Formulare im Guild-Bereich abfangen
        document.querySelectorAll('.guild-ajax-form').forEach(form => {
            form.addEventListener('submit', e => {
                e.preventDefault();
                GuildAjaxHandler.handleForm(form);
            });
        });
    }

    static async handleForm(form) {
        try {
            const formData = new FormData(form);
            const formType = form.dataset.formType || 'default';

            // Korrekte URL aus form.action (String!)
            const url = typeof form.action === 'string' ? form.action : form.getAttribute('action');

            const response = await fetch(url, {
                method: form.method || 'POST',
                headers: {
                    'X-CSRF-Token': document.querySelector('meta[name="csrf-token"]')?.content || '',
                    'Accept': 'application/json',
                    'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8'
                },
                body: new URLSearchParams(formData)
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const result = await response.json();

            // Form-spezifische Aktionen basierend auf data-attributes
            switch(formType) {
                case 'plugin':
                    await this.handlePluginResponse(form, result);
                    break;
                    
                case 'locale':
                    await this.handleLocaleResponse(form, result);
                    break;
                    
                case 'settings':
                    await this.handleSettingsResponse(form, result);
                    break;
                    
                case 'widget':
                    await this.handleWidgetResponse(form, result);
                    break;
                    
                default:
                    // Generische Behandlung
                    if (result.success) {
                        this.showToast('success', result.message || 'Aktion erfolgreich!');
                    } else {
                        this.showToast('error', result.message || 'Fehler bei der Aktion');
                    }
            }

            // Button-Status und UI aktualisieren
            await this.updateUI(form, result);

        } catch (error) {
            this.showToast('error', 'Netzwerkfehler oder Serverfehler');
            console.error(error);
        }
    }

    static async handlePluginResponse(form, result) {
        // Remove console.log
        const pluginName = form.querySelector('input[name="plugins[]"]')?.value;
        const action = form.querySelector('input[name="action"]')?.value;
        
        if (result.success) {
            this.showToast('success', 
                `Plugin "${pluginName}" wurde erfolgreich ${action === 'enable' ? 'aktiviert' : 'deaktiviert'}`
            );
            if (result.requiresReload) {
                setTimeout(() => window.location.reload(), 1500);
            }
        } else {
            this.showToast('error', 
                `Fehler beim ${action === 'enable' ? 'Aktivieren' : 'Deaktivieren'} von "${pluginName}": ${result.message}`
            );
        }
    }

    static async handleLocaleResponse(form, result) {
        if (result.success) {
            this.showToast('success', 'Spracheinstellungen wurden aktualisiert');
            if (result.requiresReload) {
                setTimeout(() => window.location.reload(), 1500);
            }
        } else {
            this.showToast('error', `Fehler beim Speichern der Spracheinstellungen: ${result.message}`);
        }
    }

    static async handleSettingsResponse(form, result) {
        if (result.success) {
            this.showToast('success', 'Einstellungen wurden gespeichert');
        } else {
            this.showToast('error', `Fehler beim Speichern der Einstellungen: ${result.message}`);
        }
    }

    static async updateUI(form, result) {
        // Button-Status aktualisieren
        const button = form.querySelector('button[type="submit"]');
        if (button) {
            button.disabled = false;
            
            // Success-Animation
            if (result.success) {
                button.classList.add('btn-success');
                setTimeout(() => button.classList.remove('btn-success'), 1000);
            }
        }

        // Form-spezifische UI Updates
        const formType = form.dataset.formType;
        const updateTarget = form.dataset.updateTarget;
        
        if (result.success && result.data) {
            if (updateTarget) {
                const target = document.querySelector(updateTarget);
                if (target) {
                    // Partial Update wenn möglich
                    if (result.html) {
                        target.innerHTML = result.html;
                    }
                }
            }
        }
    }

    static updateButtonState(form, success) {
        // Optional: Button-Status anpassen
        const button = form.querySelector('button[type="submit"]');
        if (button) {
            button.disabled = success;
            // Weitere UI-Anpassungen je nach Aktion
        }
    }

    static showToast(type, message) {
        const toast = document.createElement('div');
        // Toast-spezifische Styles für zentrierte Position
        toast.className = `toast toast-${type} align-items-center`;
        toast.innerHTML = `
            <div class="toast-header">
                <i class="fas ${this.getIconForType(type)} me-2"></i>
                <strong class="me-auto">${this.getTextForType(type)}</strong>
                <button type="button" class="btn-close" data-bs-dismiss="toast"></button>
            </div>
            <div class="toast-body">${message}</div>
        `;
        
        document.getElementById('toast-container').appendChild(toast);
        
        // Bootstrap 5 Toast mit angepassten Optionen
        const bsToast = new bootstrap.Toast(toast, { 
            delay: 3000,
            animation: true,
            // Optional: Automatisches Ausblenden deaktivieren
            // autohide: false
        });
        
        bsToast.show();
        toast.addEventListener('hidden.bs.toast', () => toast.remove());
    }

    static getIconForType(type) {
        return {
            success: 'fa-check-circle',
            error: 'fa-exclamation-circle',
            warning: 'fa-exclamation-triangle',
            info: 'fa-info-circle'
        }[type] || 'fa-info-circle';
    }

    static getTextForType(type) {
        return {
            success: 'Erfolg',
            error: 'Fehler',
            warning: 'Warnung',
            info: 'Info'
        }[type] || 'Info';
    }
}

// Initialisierung nach DOM-Load
document.addEventListener('DOMContentLoaded', () => GuildAjaxHandler.init());