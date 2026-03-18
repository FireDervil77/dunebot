const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');
const { request } = require('undici');
const path = require('path');

// Background presets
const BACKGROUNDS = {
    default: { type: 'gradient', colors: ['#1a1a2e', '#16213e', '#0f3460'] },
    dark: { type: 'gradient', colors: ['#0d0d0d', '#1a1a1a', '#2d2d2d'] },
    blue: { type: 'gradient', colors: ['#0f0c29', '#302b63', '#24243e'] },
    purple: { type: 'gradient', colors: ['#12011e', '#3c1053', '#6a0572'] },
    green: { type: 'gradient', colors: ['#0a1a0a', '#1b4332', '#2d6a4f'] },
    sunset: { type: 'gradient', colors: ['#2d1b69', '#6b2fa0', '#e94560'] },
    ocean: { type: 'gradient', colors: ['#0a192f', '#172a45', '#1c4a6e'] },
};

/**
 * Generate a welcome image card with member avatar
 * @param {import('discord.js').GuildMember} member
 * @param {Object} options
 * @param {string} options.bg - Background preset name
 * @param {string} options.text - Custom text (or null for default)
 * @param {string} options.color - Accent color hex
 * @returns {Promise<Buffer>}
 */
async function generateWelcomeImage(member, options = {}) {
    const width = 1024;
    const height = 450;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    // === Background ===
    const bg = BACKGROUNDS[options.bg] || BACKGROUNDS.default;
    const gradient = ctx.createLinearGradient(0, 0, width, height);
    bg.colors.forEach((color, i) => {
        gradient.addColorStop(i / (bg.colors.length - 1), color);
    });
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    // === Decorative elements ===
    const accentColor = options.color || '#5865f2';

    // Subtle grid pattern
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
    ctx.lineWidth = 1;
    for (let x = 0; x < width; x += 40) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
    }
    for (let y = 0; y < height; y += 40) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
    }

    // Accent line at bottom
    ctx.fillStyle = accentColor;
    ctx.fillRect(0, height - 6, width, 6);

    // Glow circle behind avatar
    const centerX = width / 2;
    const avatarY = 140;
    const glowGrad = ctx.createRadialGradient(centerX, avatarY, 50, centerX, avatarY, 150);
    glowGrad.addColorStop(0, accentColor + '40');
    glowGrad.addColorStop(1, 'transparent');
    ctx.fillStyle = glowGrad;
    ctx.beginPath();
    ctx.arc(centerX, avatarY, 150, 0, Math.PI * 2);
    ctx.fill();

    // === Avatar ===
    const avatarSize = 160;
    const avatarX = centerX - avatarSize / 2;
    const avatarYPos = avatarY - avatarSize / 2;

    try {
        const avatarURL = member.displayAvatarURL({ extension: 'png', size: 256 });
        const { body } = await request(avatarURL);
        const avatarBuffer = Buffer.from(await body.arrayBuffer());
        const avatarImg = await loadImage(avatarBuffer);

        // Circular clip
        ctx.save();
        ctx.beginPath();
        ctx.arc(centerX, avatarY, avatarSize / 2, 0, Math.PI * 2);
        ctx.closePath();
        ctx.clip();
        ctx.drawImage(avatarImg, avatarX, avatarYPos, avatarSize, avatarSize);
        ctx.restore();

        // Avatar border ring
        ctx.strokeStyle = accentColor;
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(centerX, avatarY, avatarSize / 2 + 4, 0, Math.PI * 2);
        ctx.stroke();

        // Outer glow ring
        ctx.strokeStyle = accentColor + '60';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(centerX, avatarY, avatarSize / 2 + 10, 0, Math.PI * 2);
        ctx.stroke();
    } catch {
        // Fallback: colored circle with initial
        ctx.fillStyle = accentColor;
        ctx.beginPath();
        ctx.arc(centerX, avatarY, avatarSize / 2, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 72px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText((member.user.username || '?')[0].toUpperCase(), centerX, avatarY);
    }

    // === Text ===
    const textY = avatarY + avatarSize / 2 + 40;

    // Welcome text
    const welcomeText = options.text || 'Welcome to the server!';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.font = '20px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(welcomeText.toUpperCase(), centerX, textY);

    // Username
    const username = member.user.username;
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 40px sans-serif';
    ctx.fillText(username, centerX, textY + 45);

    // Member count
    const memberCount = `Member #${member.guild.memberCount}`;
    ctx.fillStyle = accentColor;
    ctx.font = '18px sans-serif';
    ctx.fillText(memberCount, centerX, textY + 80);

    // Server name (top)
    ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.font = '16px sans-serif';
    ctx.fillText(member.guild.name, centerX, 30);

    return canvas.toBuffer('image/png');
}

module.exports = { generateWelcomeImage, BACKGROUNDS };
