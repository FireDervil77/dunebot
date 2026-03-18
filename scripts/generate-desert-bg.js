/**
 * Generiert ein Deep Desert Hintergrundbild für die DuneMap Leaflet-Karte
 * Verwendet @napi-rs/canvas (bereits installiert)
 * 
 * Ausführen: node scripts/generate-desert-bg.js
 */
const { createCanvas } = require('@napi-rs/canvas');
const fs = require('fs');
const path = require('path');

const SIZE = 1800; // 2x Auflösung für scharfes Bild beim Zoomen
const canvas = createCanvas(SIZE, SIZE);
const ctx = canvas.getContext('2d');

// === 1. Basis-Gradient: Deep Desert Farben ===
const baseGrad = ctx.createRadialGradient(SIZE/2, SIZE/2, SIZE*0.05, SIZE/2, SIZE/2, SIZE*0.75);
baseGrad.addColorStop(0, '#4a3518');   // Helles Sand-Zentrum
baseGrad.addColorStop(0.3, '#3d2a10');
baseGrad.addColorStop(0.6, '#2a1d0a');
baseGrad.addColorStop(1, '#1a1207');   // Dunkler Rand
ctx.fillStyle = baseGrad;
ctx.fillRect(0, 0, SIZE, SIZE);

// === 2. Große Dünen-Wellen ===
for (let w = 0; w < 25; w++) {
  const yBase = Math.random() * SIZE;
  const amplitude = 30 + Math.random() * 60;
  const freq = 0.003 + Math.random() * 0.008;
  const alpha = 0.02 + Math.random() * 0.04;
  
  ctx.strokeStyle = `rgba(210,180,110,${alpha})`;
  ctx.lineWidth = 3 + Math.random() * 8;
  ctx.beginPath();
  for (let x = 0; x < SIZE; x += 3) {
    const y = yBase + Math.sin(x * freq + w * 0.7) * amplitude + Math.cos(x * freq * 0.5) * amplitude * 0.3;
    if (x === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

// === 3. Diagonale Dünen (Wind-Richtung) ===
for (let d = 0; d < 20; d++) {
  const startX = Math.random() * SIZE;
  const startY = Math.random() * SIZE;
  const angle = 0.3 + Math.random() * 0.4; // ~20-40° Winkel
  const length = 200 + Math.random() * 600;
  const alpha = 0.015 + Math.random() * 0.03;
  
  ctx.strokeStyle = `rgba(180,150,80,${alpha})`;
  ctx.lineWidth = 10 + Math.random() * 30;
  ctx.beginPath();
  ctx.moveTo(startX, startY);
  ctx.lineTo(startX + Math.cos(angle) * length, startY + Math.sin(angle) * length);
  ctx.stroke();
}

// === 4. Feine Sand-Textur (Noise) ===
for (let i = 0; i < 50000; i++) {
  const x = Math.random() * SIZE;
  const y = Math.random() * SIZE;
  const alpha = Math.random() * 0.07;
  const size = Math.random() * 2.5 + 0.5;
  
  // Helle und dunkle Partikel mischen
  if (Math.random() > 0.4) {
    ctx.fillStyle = `rgba(210,180,120,${alpha})`;
  } else {
    ctx.fillStyle = `rgba(80,60,30,${alpha * 1.5})`;
  }
  ctx.fillRect(x, y, size, size);
}

// === 5. Subtile Fels-/Stein-Flecken ===
for (let s = 0; s < 40; s++) {
  const cx = Math.random() * SIZE;
  const cy = Math.random() * SIZE;
  const r = 15 + Math.random() * 50;
  const alpha = 0.02 + Math.random() * 0.03;
  
  const stoneGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  stoneGrad.addColorStop(0, `rgba(60,45,25,${alpha})`);
  stoneGrad.addColorStop(1, 'rgba(60,45,25,0)');
  ctx.fillStyle = stoneGrad;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
}

// === 6. Windstreifen (sehr fein) ===
for (let w = 0; w < 80; w++) {
  const y = Math.random() * SIZE;
  const xStart = Math.random() * SIZE * 0.5;
  const length = 100 + Math.random() * 400;
  
  ctx.strokeStyle = `rgba(200,170,100,${0.01 + Math.random() * 0.02})`;
  ctx.lineWidth = 0.5 + Math.random() * 1.5;
  ctx.beginPath();
  ctx.moveTo(xStart, y);
  ctx.lineTo(xStart + length, y + (Math.random() - 0.5) * 20);
  ctx.stroke();
}

// === 7. Vignette (dunkle Ränder) ===
const vignette = ctx.createRadialGradient(SIZE/2, SIZE/2, SIZE*0.25, SIZE/2, SIZE/2, SIZE*0.72);
vignette.addColorStop(0, 'rgba(0,0,0,0)');
vignette.addColorStop(1, 'rgba(0,0,0,0.35)');
ctx.fillStyle = vignette;
ctx.fillRect(0, 0, SIZE, SIZE);

// === 8. PvE/PvP Zone Farbton-Variation ===
// Obere Hälfte (PvE) leicht grünlich
const pveGrad = ctx.createLinearGradient(0, 0, 0, SIZE/2);
pveGrad.addColorStop(0, 'rgba(40,80,30,0.04)');
pveGrad.addColorStop(1, 'rgba(40,80,30,0)');
ctx.fillStyle = pveGrad;
ctx.fillRect(0, 0, SIZE, SIZE * 0.55);

// Untere Hälfte (PvP) leicht rötlich
const pvpGrad = ctx.createLinearGradient(0, SIZE*0.5, 0, SIZE);
pvpGrad.addColorStop(0, 'rgba(80,30,20,0)');
pvpGrad.addColorStop(1, 'rgba(80,30,20,0.05)');
ctx.fillStyle = pvpGrad;
ctx.fillRect(0, SIZE * 0.45, SIZE, SIZE * 0.55);

// === SPEICHERN ===
const outputDir = path.join(__dirname, '..', 'plugins', 'dunemap', 'dashboard', 'assets', 'images');
const outputPath = path.join(outputDir, 'deep-desert-bg.png');

// Ordner sicherstellen
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

const buffer = canvas.toBuffer('image/png');
fs.writeFileSync(outputPath, buffer);

const sizeMB = (buffer.length / 1024 / 1024).toFixed(2);
console.log(`✅ Deep Desert Background generiert: ${outputPath}`);
console.log(`   Größe: ${SIZE}x${SIZE}px, ${sizeMB} MB`);
