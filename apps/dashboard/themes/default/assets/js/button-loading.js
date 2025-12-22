/**
 * Universal Button Loading System
 * 
 * Verhindert Doppelklicks und zeigt User-Feedback während IPM-Operationen
 * 
 * @author FireBot Team
 */
class ButtonLoader {
    /**
     * Setzt Button in Loading-State
     * 
     * @param {HTMLButtonElement|string} button - Button-Element oder Selector
     * @param {string} loadingText - Text während Loading (default: "Bitte warten...")
     * @returns {Object} Original state für Wiederherstellung
     */
    static setLoading(button, loadingText = 'Bitte warten...') {
        const btn = typeof button === 'string' ? document.querySelector(button) : button;
        if (!btn) {
            console.warn('[ButtonLoader] Button nicht gefunden:', button);
            return null;
        }

        // Original State speichern
        const originalState = {
            text: btn.innerHTML,
            disabled: btn.disabled,
            classes: btn.className
        };

        // Button deaktivieren
        btn.disabled = true;

        // Loading Spinner + Text
        btn.innerHTML = `
            <span class="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>
            ${loadingText}
        `;

        // Optional: Loading-Klasse für CSS-Styling
        btn.classList.add('btn-loading');

        return originalState;
    }

    /**
     * Stellt Button-State wieder her
     * 
     * @param {HTMLButtonElement|string} button - Button-Element oder Selector
     * @param {Object} originalState - Original State von setLoading()
     */
    static restore(button, originalState) {
        const btn = typeof button === 'string' ? document.querySelector(button) : button;
        if (!btn || !originalState) return;

        btn.innerHTML = originalState.text;
        btn.disabled = originalState.disabled;
        btn.className = originalState.classes;
    }

    /**
     * Setzt Button auf Success-State (kurz)
     * 
     * @param {HTMLButtonElement|string} button - Button-Element oder Selector
     * @param {string} successText - Success-Text (default: "Erfolgreich!")
     * @param {number} duration - Anzeigedauer in ms (default: 1500)
     */
    static setSuccess(button, successText = 'Erfolgreich!', duration = 1500) {
        const btn = typeof button === 'string' ? document.querySelector(button) : button;
        if (!btn) return;

        const originalState = {
            text: btn.innerHTML,
            disabled: btn.disabled,
            classes: btn.className
        };

        btn.disabled = true;
        btn.innerHTML = `
            <i class="fas fa-check me-2"></i>
            ${successText}
        `;
        btn.classList.remove('btn-loading');
        btn.classList.add('btn-success-temp');

        setTimeout(() => {
            ButtonLoader.restore(btn, originalState);
        }, duration);
    }

    /**
     * Setzt Button auf Error-State (kurz)
     * 
     * @param {HTMLButtonElement|string} button - Button-Element oder Selector
     * @param {string} errorText - Error-Text (default: "Fehler!")
     * @param {number} duration - Anzeigedauer in ms (default: 2000)
     */
    static setError(button, errorText = 'Fehler!', duration = 2000) {
        const btn = typeof button === 'string' ? document.querySelector(button) : button;
        if (!btn) return;

        const originalState = {
            text: btn.innerHTML,
            disabled: btn.disabled,
            classes: btn.className
        };

        btn.disabled = true;
        btn.innerHTML = `
            <i class="fas fa-exclamation-triangle me-2"></i>
            ${errorText}
        `;
        btn.classList.remove('btn-loading');
        btn.classList.add('btn-error-temp');

        setTimeout(() => {
            ButtonLoader.restore(btn, originalState);
        }, duration);
    }

    /**
     * Findet Submit-Button in Form automatisch
     * 
     * @param {HTMLFormElement} form - Form-Element
     * @returns {HTMLButtonElement|null}
     */
    static findSubmitButton(form) {
        // Suche nach button[type="submit"] oder input[type="submit"]
        let btn = form.querySelector('button[type="submit"]');
        if (!btn) btn = form.querySelector('input[type="submit"]');
        if (!btn) btn = form.querySelector('button:not([type="button"])');
        return btn;
    }
}

// Global verfügbar machen
window.ButtonLoader = ButtonLoader;
