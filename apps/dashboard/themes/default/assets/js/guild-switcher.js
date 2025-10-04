/**
 * Guild Switcher JavaScript
 * Handles guild switching with smooth transitions and loading states
 * 
 * @author FireDervil
 */

(function() {
    'use strict';

    // Warte auf DOM-Ready
    document.addEventListener('DOMContentLoaded', function() {
        initGuildSwitcher();
    });

    /**
     * Initialisiert den Guild-Switcher
     */
    function initGuildSwitcher() {
        const guildLinks = document.querySelectorAll('.dropdown-item[href^="/guild/"]');
        
        if (!guildLinks.length) {
            return;
        }

        guildLinks.forEach(link => {
            link.addEventListener('click', function(e) {
                // Wenn es die aktive Guild ist, nicht wechseln
                if (this.classList.contains('active')) {
                    e.preventDefault();
                    return;
                }

                // Loading-State anzeigen
                showLoadingState(this);
                
                // Optional: Smooth Scroll to Top vor Redirect
                window.scrollTo({ top: 0, behavior: 'smooth' });
            });
        });

        // Keyboard Navigation (Pfeiltasten)
        const dropdown = document.getElementById('guildSwitcher');
        if (dropdown) {
            dropdown.addEventListener('keydown', handleKeyboardNavigation);
        }
    }

    /**
     * Zeigt Loading-State beim Wechseln
     */
    function showLoadingState(linkElement) {
        const icon = linkElement.querySelector('img');
        const text = linkElement.querySelector('div > div');
        
        if (text) {
            text.innerHTML = '<i class="bi bi-arrow-clockwise spin"></i> Lade...';
        }
        
        // Disable alle anderen Links
        const allLinks = document.querySelectorAll('.dropdown-item[href^="/guild/"]');
        allLinks.forEach(link => {
            link.style.pointerEvents = 'none';
            link.style.opacity = '0.6';
        });
    }

    /**
     * Keyboard Navigation für Dropdown
     */
    function handleKeyboardNavigation(e) {
        const dropdown = e.currentTarget;
        const items = dropdown.querySelectorAll('.dropdown-item');
        const currentIndex = Array.from(items).findIndex(item => 
            item === document.activeElement
        );

        switch(e.key) {
            case 'ArrowDown':
                e.preventDefault();
                if (currentIndex < items.length - 1) {
                    items[currentIndex + 1].focus();
                }
                break;
            case 'ArrowUp':
                e.preventDefault();
                if (currentIndex > 0) {
                    items[currentIndex - 1].focus();
                }
                break;
            case 'Enter':
                if (document.activeElement.classList.contains('dropdown-item')) {
                    document.activeElement.click();
                }
                break;
        }
    }

    /**
     * Preload Guild Icons für bessere Performance
     */
    function preloadGuildIcons() {
        const icons = document.querySelectorAll('.dropdown-item img[src*="cdn.discordapp.com"]');
        icons.forEach(icon => {
            const img = new Image();
            img.src = icon.src;
        });
    }

    // Preload Icons nach kurzer Verzögerung
    setTimeout(preloadGuildIcons, 1000);

})();

// CSS für Spin-Animation (falls nicht schon vorhanden)
const style = document.createElement('style');
style.textContent = `
    @keyframes spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
    }
    .spin {
        animation: spin 1s linear infinite;
        display: inline-block;
    }
`;
document.head.appendChild(style);
