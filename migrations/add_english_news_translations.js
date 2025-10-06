/**
 * Script zum Hinzufügen englischer Übersetzungen für News
 * 
 * Dieses Script fügt englische Übersetzungen (en-GB) zu allen vorhandenen
 * News-Einträgen hinzu, die aktuell nur deutsche Texte haben.
 * 
 * @author FireDervil
 * @date 2025-10-06
 */

require('dotenv').config({ path: './apps/dashboard/.env' });
const mysql = require('mysql2/promise');

// Englische Übersetzungen für alle News
const englishTranslations = {
    1: {
        title: "New Update Brings Exciting Features",
        excerpt: "The current platform update contains numerous new features and optimizations that will enhance your user experience.",
        content: `<p>We are pleased to announce a comprehensive update that brings many new features and improvements to our platform.</p>

<h3>Highlights of the Update:</h3>
<ul>
    <li><strong>Improved Performance:</strong> Faster loading times and optimized resource usage</li>
    <li><strong>New Features:</strong> Extended functionality and user-friendly tools</li>
    <li><strong>Bug Fixes:</strong> Resolution of known issues and stability improvements</li>
    <li><strong>Modern Design:</strong> Updated interface for better usability</li>
</ul>

<p>The update is available immediately for all users. We recommend logging out and back in to activate all new features.</p>

<p>We appreciate your feedback and are continuously working on further improvements!</p>`
    },
    2: {
        title: "Community Launches Charity Event",
        excerpt: "The dedicated community is collecting donations for local aid projects.",
        content: `<p>Our community is launching an impressive charity initiative to support local aid projects.</p>

<h3>Event Details:</h3>
<ul>
    <li><strong>Duration:</strong> Throughout the month</li>
    <li><strong>Goal:</strong> Supporting local organizations and projects</li>
    <li><strong>Participation:</strong> Everyone can contribute</li>
</ul>

<p>We are proud of the commitment and solidarity within our community. Every contribution makes a difference!</p>

<p>More information and participation options can be found in our community channels.</p>`
    },
    3: {
        title: "Server Maintenance Scheduled for Weekend",
        excerpt: "Planned server maintenance may lead to brief outages.",
        content: `<p>To ensure optimal performance and stability, we are conducting scheduled server maintenance this weekend.</p>

<h3>Maintenance Details:</h3>
<ul>
    <li><strong>Time:</strong> Saturday, 02:00 - 06:00 AM</li>
    <li><strong>Duration:</strong> Approximately 4 hours</li>
    <li><strong>Impact:</strong> Brief service interruptions possible</li>
</ul>

<p>We apologize for any inconvenience and thank you for your understanding.</p>

<p>All services will be fully available again after the maintenance work is completed.</p>`
    },
    4: {
        title: "New Ranking System for Players Introduced",
        excerpt: "A fresh ranking system helps players better track their achievements.",
        content: `<p>We are introducing a completely revised ranking system that provides more transparency and motivation.</p>

<h3>New Features:</h3>
<ul>
    <li><strong>Detailed Statistics:</strong> Comprehensive overview of your achievements</li>
    <li><strong>Fair Ranking:</strong> Balanced calculation based on various criteria</li>
    <li><strong>Rewards:</strong> Exclusive rewards for top performers</li>
    <li><strong>Leaderboards:</strong> Compare yourself with other players</li>
</ul>

<p>The new system is already active and your current progress has been transferred.</p>

<p>Good luck climbing the ranks!</p>`
    },
    5: {
        title: "Beta Test for New Plugin Started",
        excerpt: "The beta version of the new plugin offers redesigned interface and more options.",
        content: `<p>We are excited to announce the start of the beta test for our latest plugin!</p>

<h3>Beta Features:</h3>
<ul>
    <li><strong>Modern Design:</strong> Completely redesigned user interface</li>
    <li><strong>Extended Functions:</strong> New tools and options</li>
    <li><strong>Performance:</strong> Optimized for speed and efficiency</li>
    <li><strong>Feedback:</strong> Your input helps us improve</li>
</ul>

<p>Beta testers can access the new features immediately and provide valuable feedback.</p>

<p>Registration for the beta test is available in your settings.</p>`
    },
    6: {
        title: "Partnership with International Partner",
        excerpt: "Strategic partnership aims to open new markets.",
        content: `<p>We are proud to announce a strategic partnership with an international leader in the industry.</p>

<h3>Partnership Benefits:</h3>
<ul>
    <li><strong>Expansion:</strong> Access to new markets and regions</li>
    <li><strong>Innovation:</strong> Joint development of new technologies</li>
    <li><strong>Resources:</strong> Enhanced infrastructure and support</li>
    <li><strong>Growth:</strong> Expanded opportunities for all users</li>
</ul>

<p>This partnership marks an important milestone in our development and opens up exciting perspectives for the future.</p>

<p>We look forward to sharing the benefits of this collaboration with our community!</p>`
    },
    8: {
        title: "Fall Update 2025 Arrives...",
        excerpt: "We are currently working on the <b>Fall Update 2025</b>. <br /><br />We expect to have it ready by the end of the year...",
        content: `<p>We are excited to share our plans for the comprehensive <strong>Fall Update 2025</strong>!</p>

<h3>What to Expect:</h3>
<ul>
    <li><strong>Major Features:</strong> Significant new functionality and tools</li>
    <li><strong>Performance Boost:</strong> Optimized for better speed and reliability</li>
    <li><strong>User Experience:</strong> Enhanced interface and usability improvements</li>
    <li><strong>Security:</strong> Updated security measures and protocols</li>
</ul>

<p>Our development team is working intensively to deliver a high-quality update that meets your expectations.</p>

<p><strong>Expected Release:</strong> End of the year 2025</p>

<p>Stay tuned for more updates and sneak peeks as we get closer to the release!</p>

<p>We appreciate your patience and continued support. This update will be worth the wait!</p>`
    }
};

async function addEnglishTranslations() {
    let connection;
    
    try {
        console.log('🌐 Füge englische Übersetzungen zu News hinzu...\n');
        
        // Verbindung zur Datenbank herstellen
        connection = await mysql.createConnection({
            host: process.env.MYSQL_HOST,
            port: process.env.MYSQL_PORT,
            user: process.env.MYSQL_USER,
            password: process.env.MYSQL_PASSWORD,
            database: process.env.MYSQL_DATABASE
        });
        
        console.log('✅ Datenbankverbindung hergestellt\n');
        
        // Alle News abrufen
        const [newsEntries] = await connection.execute(
            'SELECT _id, slug, title_translations, content_translations, excerpt_translations FROM news ORDER BY _id'
        );
        
        console.log(`📰 ${newsEntries.length} News-Einträge gefunden\n`);
        
        let updatedCount = 0;
        
        // Für jeden News-Eintrag englische Übersetzungen hinzufügen
        for (const news of newsEntries) {
            const newsId = news._id;
            
            // Prüfen, ob Übersetzungen für diese ID vorhanden sind
            if (!englishTranslations[newsId]) {
                console.log(`⚠️  Keine Übersetzung für News ID ${newsId} (${news.slug}) - überspringe`);
                continue;
            }
            
            // Aktuelle JSON-Daten parsen
            const titleTranslations = JSON.parse(news.title_translations);
            const contentTranslations = JSON.parse(news.content_translations);
            const excerptTranslations = JSON.parse(news.excerpt_translations);
            
            // Prüfen, ob bereits englische Übersetzung vorhanden
            if (titleTranslations['en-GB']) {
                console.log(`ℹ️  News ID ${newsId} hat bereits englische Übersetzung - überspringe`);
                continue;
            }
            
            // Englische Übersetzungen hinzufügen
            titleTranslations['en-GB'] = englishTranslations[newsId].title;
            contentTranslations['en-GB'] = englishTranslations[newsId].content;
            excerptTranslations['en-GB'] = englishTranslations[newsId].excerpt;
            
            // Zurück in Datenbank schreiben
            await connection.execute(
                `UPDATE news 
                SET 
                    title_translations = ?,
                    content_translations = ?,
                    excerpt_translations = ?
                WHERE _id = ?`,
                [
                    JSON.stringify(titleTranslations),
                    JSON.stringify(contentTranslations),
                    JSON.stringify(excerptTranslations),
                    newsId
                ]
            );
            
            console.log(`✅ News ID ${newsId}: "${englishTranslations[newsId].title}" - Englische Übersetzung hinzugefügt`);
            updatedCount++;
        }
        
        console.log(`\n✨ Migration abgeschlossen!`);
        console.log(`📊 ${updatedCount} von ${newsEntries.length} News-Einträgen aktualisiert\n`);
        
        // Verifikation: Zeige aktualisierte News
        console.log('🔍 VERIFIKATION - News mit beiden Sprachen:\n');
        const [updatedNews] = await connection.execute(
            'SELECT _id, slug, title_translations FROM news ORDER BY _id'
        );
        
        updatedNews.forEach(n => {
            const titles = JSON.parse(n.title_translations);
            const hasDE = titles['de-DE'] ? '✓' : '✗';
            const hasEN = titles['en-GB'] ? '✓' : '✗';
            console.log(`   ID ${n._id}: [DE ${hasDE}] [EN ${hasEN}] - ${n.slug}`);
        });
        
        console.log('\n✅ Alle News haben jetzt Übersetzungen in beiden Sprachen!');
        
    } catch (error) {
        console.error('\n❌ Fehler beim Hinzufügen der Übersetzungen:', error);
        process.exit(1);
    } finally {
        if (connection) {
            await connection.end();
            console.log('\n🔌 Datenbankverbindung geschlossen');
        }
    }
}

// Script ausführen
addEnglishTranslations();
