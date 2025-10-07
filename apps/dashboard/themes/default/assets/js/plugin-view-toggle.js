/**
 * Plugin View Toggle
 * Wechselt zwischen Karten- und Tabellen-Ansicht auf der Plugin-Seite
 * 
 * @author FireDervil
 */
(function() {
    'use strict';
    
    // Nur auf Plugin-Seite ausführen
    if (!window.location.pathname.includes('/plugins')) {
        return;
    }
    
    document.addEventListener('DOMContentLoaded', function() {
        console.log('[Plugin View Toggle] Script geladen');
        
        const cardViewBtn = document.getElementById('cardViewBtn');
        const tableViewBtn = document.getElementById('tableViewBtn');
        const cardViews = document.querySelectorAll('.plugin-view-cards');
        const tableViews = document.querySelectorAll('.plugin-view-table');
        
        console.log('[Plugin View Toggle] Buttons gefunden:', {
            cardViewBtn: !!cardViewBtn,
            tableViewBtn: !!tableViewBtn,
            cardViews: cardViews.length,
            tableViews: tableViews.length
        });
        
        if (!cardViewBtn || !tableViewBtn) {
            console.warn('[Plugin View Toggle] Toggle-Buttons nicht gefunden - Plugin-Seite?');
            return;
        }
        
        // Aus LocalStorage laden
        const savedView = localStorage.getItem('pluginViewMode') || 'cards';
        console.log('[Plugin View Toggle] Gespeicherte Ansicht:', savedView);
        
        if (savedView === 'table') {
            switchToTable();
        }
        
        cardViewBtn.addEventListener('click', function(e) {
            console.log('[Plugin View Toggle] Karten-Button geklickt');
            e.preventDefault();
            switchToCards();
            localStorage.setItem('pluginViewMode', 'cards');
        });
        
        tableViewBtn.addEventListener('click', function(e) {
            console.log('[Plugin View Toggle] Tabellen-Button geklickt');
            e.preventDefault();
            switchToTable();
            localStorage.setItem('pluginViewMode', 'table');
        });
        
        function switchToCards() {
            console.log('[Plugin View Toggle] Wechsle zu Karten-Ansicht');
            cardViews.forEach(el => el.style.display = '');
            tableViews.forEach(el => el.style.display = 'none');
            cardViewBtn.classList.add('active');
            tableViewBtn.classList.remove('active');
        }
        
        function switchToTable() {
            console.log('[Plugin View Toggle] Wechsle zu Tabellen-Ansicht');
            cardViews.forEach(el => el.style.display = 'none');
            tableViews.forEach(el => el.style.display = 'block');
            cardViewBtn.classList.remove('active');
            tableViewBtn.classList.add('active');
        }
    });
})();
