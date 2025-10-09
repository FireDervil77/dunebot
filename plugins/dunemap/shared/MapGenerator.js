const { createCanvas, loadImage } = require('canvas');
const path = require('path');

class MapGenerator {
    constructor() {
        // Map Konfiguration
        this.config = {
            gridWidth: 9,
            gridHeight: 9,
            tileSize: 70,
            colors: {
                background: '#F4E2B6', // Wüstensand Farbe
                lines: '#C8B48C',      // Dunklerer Sand für Linien
                font: '#321E00'        // Dunkelbraun für Text
            },
            markerSize: 24,            // Größe der Marker Icons
            maxMarkersPerCell: 6       // Maximale Marker pro Zelle
        };

        // Assets Pfad
        this.assetsPath = path.join(__dirname, '../assets/icons');
    }

    /**
     * Zeichnet das Grundraster der Karte
     * @param {CanvasRenderingContext2D} ctx Canvas Context
     * @private
     */
    #drawGrid(ctx, width, height) {
        // Hintergrund
        ctx.fillStyle = this.config.colors.background;
        ctx.fillRect(0, 0, width, height);

        // Linien
        ctx.strokeStyle = this.config.colors.lines;
        ctx.lineWidth = 1;

        // Vertikale Linien (ab x=1, da erste Spalte für Buchstaben)
        for (let x = 1; x <= this.config.gridWidth + 1; x++) {
            ctx.beginPath();
            ctx.moveTo(x * this.config.tileSize, 0);
            ctx.lineTo(x * this.config.tileSize, height - this.config.tileSize);
            ctx.stroke();
        }

        // Horizontale Linien (ab y=0 bis gridHeight, ohne letzte Zeile für Zahlen)
        for (let y = 0; y <= this.config.gridHeight; y++) {
            ctx.beginPath();
            ctx.moveTo(this.config.tileSize, y * this.config.tileSize);
            ctx.lineTo(width, y * this.config.tileSize);
            ctx.stroke();
        }

        // Rote Sturmlinie horizontal in der Mitte von Feld E (durchgehend)
        ctx.strokeStyle = '#FF0000';
        ctx.lineWidth = 3;
        ctx.setLineDash([10, 5]); // Gestrichelte Linie
        const stormLineY = (4 * this.config.tileSize) + (this.config.tileSize / 2); // Mitte von Feld E
        ctx.beginPath();
        ctx.moveTo(this.config.tileSize, stormLineY);
        ctx.lineTo(width, stormLineY); // Bis zum rechten Rand
        ctx.stroke();
        ctx.setLineDash([]); // Zurücksetzen
        ctx.lineWidth = 1;
        ctx.strokeStyle = this.config.colors.lines;

        // Koordinaten beschriften
        ctx.fillStyle = this.config.colors.font;
        ctx.font = '16px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        // Buchstaben (I oben, A unten) - wie im Spiel
        for (let y = 0; y < this.config.gridHeight; y++) {
            const letter = String.fromCharCode(73 - y); // I=73, H=72, ..., A=65
            ctx.fillText(letter, 
                this.config.tileSize / 2, 
                y * this.config.tileSize + this.config.tileSize / 2
            );
        }

        // Zahlen (1-9)
        for (let x = 0; x < this.config.gridWidth; x++) {
            ctx.fillText(String(x + 1),
                (x + 1) * this.config.tileSize + this.config.tileSize / 2,
                height - this.config.tileSize / 2
            );
        }
    }

    /**
     * Platziert Marker auf der Karte
     * @param {CanvasRenderingContext2D} ctx Canvas Context
     * @param {Array} markers Array von Marker-Objekten
     * @private
     */
    async #placeMarkers(ctx, markers) {
        // Marker nach Zellen gruppieren
        const cellMarkers = new Map();
        
        for (const marker of markers) {
            const key = `${marker.sector_x}${marker.sector_y}`;
            if (!cellMarkers.has(key)) {
                cellMarkers.set(key, []);
            }
            cellMarkers.get(key).push(marker);
        }

        // Marker in jeder Zelle platzieren
        for (const [cell, cellMarkerList] of cellMarkers) {
            const x = parseInt(cell.slice(1)) - 1;
            // FIX: Y-Koordinate invertieren (A=8, B=7, ..., I=0) für korrekte Anzeige
            const y = 8 - (cell.charCodeAt(0) - 65); // I oben (y=0), A unten (y=8)
            
            // Position in der Zelle berechnen
            const centerX = (x + 1) * this.config.tileSize + this.config.tileSize / 2;
            const centerY = y * this.config.tileSize + this.config.tileSize / 2;

            // Marker im Kreis anordnen wenn mehrere
            const markerCount = Math.min(cellMarkerList.length, this.config.maxMarkersPerCell);
            const radius = this.config.tileSize / 3;

            for (let i = 0; i < markerCount; i++) {
                const marker = cellMarkerList[i];
                const angle = (2 * Math.PI * i) / markerCount;
                
                // Position für mehrere Marker berechnen
                const markerX = centerX + (markerCount > 1 ? Math.cos(angle) * radius : 0);
                const markerY = centerY + (markerCount > 1 ? Math.sin(angle) * radius : 0);

                // Marker Icon laden und zeichnen
                try {
                    const iconPath = path.join(this.assetsPath, `${marker.marker_type}.png`);
                    const icon = await loadImage(iconPath);
                    ctx.drawImage(icon, 
                        markerX - this.config.markerSize/2,
                        markerY - this.config.markerSize/2,
                        this.config.markerSize,
                        this.config.markerSize
                    );
                } catch (err) {
                    // Fallback: Zeichne ein farbiges Quadrat wenn Icon fehlt
                    const colors = {
                        titan: '#FF6B35',
                        spice: '#FFC300',
                        stravidium: '#9B59B6',
                        base: '#3498DB',
                        wrack: '#95A5A6',
                        aluminium: '#A8B8C8',
                        basalt: '#4A4A4A',
                        eisen: '#C0C0C0',
                        karbon: '#1C1C1C',
                        hoele: '#8B4513',
                        hole: '#654321',
                        kontrollpunkt: '#00FF00',
                        taxi: '#FFFF00',
                        test: '#FF00FF'
                    };
                    ctx.fillStyle = colors[marker.marker_type] || '#FFFFFF';
                    ctx.fillRect(
                        markerX - this.config.markerSize/2,
                        markerY - this.config.markerSize/2,
                        this.config.markerSize,
                        this.config.markerSize
                    );
                }
            }
        }
    }

    /**
     * Generiert die Sturm-Timer Anzeige
     * @param {string|null} stormTimer Timer-String oder null
     * @returns {Buffer} PNG Buffer der Sturm-Anzeige
     */
    async generateStormTimer(stormTimer = null) {
        const width = 630; // Breite der Karte
        const height = 60;
        const canvas = createCanvas(width, height);
        const ctx = canvas.getContext('2d');

        // Hintergrund
        ctx.fillStyle = '#2C2C2C';
        ctx.fillRect(0, 0, width, height);

        // Text
        ctx.fillStyle = '#FFFFFF';
        ctx.font = 'bold 18px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        if (stormTimer) {
            ctx.fillText(`🌪️ Coriolis-Sturm: ${stormTimer}`, width / 2, height / 2);
        } else {
            ctx.fillStyle = '#FF6B6B';
            ctx.fillText('🌪️ Coriolis-Sturm: Kein aktiver Sturm gesetzt. Bitte den Admin bitten eine Zeit zu setzen!', width / 2, height / 2);
        }

        return canvas.toBuffer('image/png');
    }

    /**
     * Generiert die Karte mit allen Markern
     * @param {Array} markers Array von Marker-Objekten
     * @returns {Buffer} PNG Buffer der generierten Karte
     */
    async generateMap(markers = []) {
        // Canvas erstellen
        const width = (this.config.gridWidth + 1) * this.config.tileSize;
        const height = (this.config.gridHeight + 1) * this.config.tileSize;
        const canvas = createCanvas(width, height);
        const ctx = canvas.getContext('2d');

        // Grundraster zeichnen
        this.#drawGrid(ctx, width, height);

        // Marker platzieren
        await this.#placeMarkers(ctx, markers);

        // Als PNG Buffer zurückgeben
        return canvas.toBuffer('image/png');
    }

    /**
     * Generiert die Legende mit allen verfügbaren Marker-Typen
     * @returns {Buffer} PNG Buffer der Legende
     */
    async generateLegend() {
        const markerTypes = [
            { id: 'titan', name: 'Titan' },
            { id: 'spice', name: 'Spice' },
            { id: 'stravidium', name: 'Stravidium' },
            { id: 'base', name: 'Basis' },
            { id: 'wrack', name: 'Wrack' },
            { id: 'aluminium', name: 'Aluminium' },
            { id: 'basalt', name: 'Basalt' },
            { id: 'eisen', name: 'Eisen' },
            { id: 'karbon', name: 'Karbon' },
            { id: 'hoele', name: 'Höhle' },
            { id: 'hole', name: 'Loch' },
            { id: 'kontrollpunkt', name: 'Kontrollpunkt' },
            { id: 'taxi', name: 'Taxi' },
            { id: 'test', name: 'Test' }
        ];

        // Dimensionen wie im Python-Script
        const iconSize = 32;
        const padding = 10;
        const fontSize = 20;
        const width = 250;
        const height = (iconSize + padding) * markerTypes.length + padding;
        
        const canvas = createCanvas(width, height);
        const ctx = canvas.getContext('2d');

        // Hintergrund (Dunkelgrau wie im Python: (34, 34, 34, 255))
        ctx.fillStyle = '#222222';
        ctx.fillRect(0, 0, width, height);

        // Text-Font
        ctx.font = `${fontSize}px Arial`;
        ctx.fillStyle = '#FFFFFF';
        ctx.textBaseline = 'middle';

        // Marker durchgehen
        for (let i = 0; i < markerTypes.length; i++) {
            const y = padding + i * (iconSize + padding);
            
            // Icon laden oder Fallback zeichnen
            try {
                const iconPath = path.join(this.assetsPath, `${markerTypes[i].id}.png`);
                const icon = await loadImage(iconPath);
                ctx.drawImage(icon, padding, y, iconSize, iconSize);
            } catch (err) {
                // Fallback: Zeichne ein farbiges Quadrat
                const colors = {
                    titan: '#FF6B35',
                    spice: '#FFC300',
                    stravidium: '#9B59B6',
                    base: '#3498DB',
                    wrack: '#95A5A6',
                    aluminium: '#A8B8C8',
                    basalt: '#4A4A4A',
                    eisen: '#C0C0C0',
                    karbon: '#1C1C1C',
                    hoele: '#8B4513',
                    hole: '#654321',
                    kontrollpunkt: '#00FF00',
                    taxi: '#FFFF00',
                    test: '#FF00FF'
                };
                ctx.fillStyle = colors[markerTypes[i].id] || '#FFFFFF';
                ctx.fillRect(padding, y, iconSize, iconSize);
            }
            
            // Text (Icon-Name kapitalisiert)
            ctx.fillStyle = '#FFFFFF';
            const textX = padding + iconSize + 10;
            const textY = y + iconSize / 2;
            ctx.fillText(markerTypes[i].name, textX, textY);
        }

        return canvas.toBuffer('image/png');
    }
}

module.exports = MapGenerator;