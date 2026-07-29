#!/usr/bin/env node
/**
 * Schreibt offizielle Addons aus der Datenbank nach shared/addons/<slug>.json.
 *
 * Gegenrichtung zu `_syncOfficialAddons()` – und die einzige, die Daten bewegt:
 * Die Datenbank ist die Wahrheit (dort hängen installierte Server, ihre
 * Port-Allokationen und die per Egg importierten Definitionen), die Datei ist
 * ihr versioniertes Abbild. Der Sync legt nur *fehlende* Addons an und fasst
 * vorhandene nie an.
 *
 * Vorher war es umgekehrt gedacht, was einen Bruch bedeutet hätte: Die
 * Repo-Fassung von Valheim kennt die Variable `PUBLIC`, die laufende Fassung
 * `PUBLIC_SERVER`. Ein Überschreiben hätte die Variablen der installierten
 * Server ins Leere zeigen lassen.
 *
 * Beispiele:
 *   node scripts/export-addons.js --dry
 *   node scripts/export-addons.js --slug valheim
 *   node scripts/export-addons.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '../apps/dashboard/.env') });
const mysql = require('mysql2/promise');
const fs    = require('fs');
const path  = require('path');

const TARGET_DIR = path.join(__dirname, '../plugins/gameserver/shared/addons');

function parseArgs(argv) {
    const args = { dry: false, slug: null };
    for (let i = 2; i < argv.length; i++) {
        switch (argv[i]) {
            case '--dry':  args.dry  = true;         break;
            case '--slug': args.slug = argv[++i];    break;
            default:
                console.error(`Unbekanntes Argument: ${argv[i]}`);
                process.exit(1);
        }
    }
    return args;
}

async function main() {
    const args = parseArgs(process.argv);

    if (!fs.existsSync(TARGET_DIR)) {
        console.error(`Zielverzeichnis fehlt: ${TARGET_DIR}`);
        process.exit(1);
    }

    const conn = await mysql.createConnection({
        host:     process.env.MYSQL_HOST || 'localhost',
        user:     process.env.MYSQL_USER,
        password: process.env.MYSQL_PASSWORD,
        database: process.env.MYSQL_DATABASE,
    });

    try {
        // Ohne --slug werden nur die Addons aktualisiert, die bereits als Datei
        // versioniert sind. Sonst kippte der erste Lauf alle 17 Marketplace-
        // Einträge ins Repo – die Auswahl, was versioniert gehört, ist eine
        // Entscheidung und keine Nebenwirkung.
        const tracked = fs.readdirSync(TARGET_DIR)
            .filter(f => f.endsWith('.json'))
            .map(f => path.basename(f, '.json'));

        const wanted = args.slug ? [args.slug] : tracked;
        if (!wanted.length) {
            console.log('Keine versionierten Addons gefunden – mit --slug <name> gezielt exportieren.');
            return;
        }

        const [addons] = await conn.query(`
            SELECT id, name, slug, description, category, runtime_type, source_type,
                   steam_app_id, steam_server_app_id, icon_url, banner_url,
                   tags, version, game_data
            FROM addon_marketplace
            WHERE slug IN (${wanted.map(() => '?').join(',')})
            ORDER BY slug
        `, wanted);

        // Dateien ohne Gegenstück in der Datenbank benennen statt stillschweigend
        // überspringen – genau solche Karteileichen haben heute Zeit gekostet.
        const found = new Set(addons.map(a => a.slug));
        for (const slug of wanted) {
            if (!found.has(slug)) {
                console.log(`  ! ${slug}.json – kein Addon mit diesem slug in der Datenbank`);
            }
        }

        if (!addons.length) {
            console.log(args.slug
                ? `Kein offizielles Addon mit slug "${args.slug}" gefunden.`
                : 'Keine offiziellen Addons gefunden.');
            return;
        }

        let written = 0, unchanged = 0;

        for (const addon of addons) {
            const gameData = typeof addon.game_data === 'string'
                ? JSON.parse(addon.game_data)
                : (addon.game_data || {});

            // game_data ist bereits die vollständige Addon-Definition; die
            // Spaltenwerte kommen als Kopf obendrauf, damit ein späterer Import
            // runtime_type/source_type nicht raten muss.
            const out = {
                ...gameData,
                name:         addon.name,
                slug:         addon.slug,
                description:  addon.description || '',
                category:     addon.category,
                runtime_type: addon.runtime_type,
                source_type:  addon.source_type,
                version:      addon.version,
            };

            const file    = path.join(TARGET_DIR, `${addon.slug}.json`);
            const content = JSON.stringify(out, null, 2) + '\n';
            const before  = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;

            if (before === content) {
                console.log(`  = ${addon.slug}.json (unverändert)`);
                unchanged++;
                continue;
            }

            const label = before === null ? 'neu' : 'aktualisiert';
            console.log(`  ${args.dry ? '~' : '→'} ${addon.slug}.json (${label})${args.dry ? ' [dry-run]' : ''}`);
            if (!args.dry) fs.writeFileSync(file, content, 'utf8');
            written++;
        }

        console.log(args.dry
            ? `\n${written} Datei(en) würden geschrieben, ${unchanged} unverändert – Dry-Run.`
            : `\n${written} Datei(en) geschrieben, ${unchanged} unverändert.`);
    } finally {
        await conn.end();
    }
}

main().catch(err => {
    console.error('Fehlgeschlagen:', err.message);
    process.exit(1);
});
