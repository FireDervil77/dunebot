#!/usr/bin/env node
/**
 * LinuxGSM Dependency Importer
 * 
 * Parst check_deps.sh von LinuxGSM und extrahiert Dependencies für alle Games
 * Output: JSON-File mit allen Game-Dependencies
 * 
 * Usage:
 *   1. git clone https://github.com/GameServerManagers/LinuxGSM.git /tmp/LinuxGSM
 *   2. node scripts/import-linuxgsm-dependencies.js
 */

const fs = require('fs');
const path = require('path');

// ===== CONFIG =====
const LINUXGSM_PATH = '/tmp/LinuxGSM';
const CHECK_DEPS_FILE = path.join(LINUXGSM_PATH, 'lgsm/functions/check_deps.sh');
const OUTPUT_FILE = path.join(__dirname, '..', 'data', 'gameserver-dependencies.json');

// ===== PARSER =====
function parseLinuxGSMDependencies() {
    console.log('🔍 Reading LinuxGSM check_deps.sh...');
    
    if (!fs.existsSync(CHECK_DEPS_FILE)) {
        console.error('❌ LinuxGSM nicht gefunden!');
        console.error('   Bitte zuerst klonen:');
        console.error('   git clone https://github.com/GameServerManagers/LinuxGSM.git /tmp/LinuxGSM');
        process.exit(1);
    }
    
    const content = fs.readFileSync(CHECK_DEPS_FILE, 'utf-8');
    const lines = content.split('\n');
    
    const games = {};
    let currentGame = null;
    let inDepsBlock = false;
    
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        
        // Game-Block starten: if [ "${shortname}" == "csgo" ]; then
        const gameMatch = line.match(/if \[ "\$\{shortname\}" == "([^"]+)" \]; then/);
        if (gameMatch) {
            currentGame = gameMatch[1];
            games[currentGame] = {
                shortname: currentGame,
                system_packages: [],
                notes: []
            };
            inDepsBlock = false;
            continue;
        }
        
        // deps_required Block starten
        if (line.includes('deps_required=(')) {
            inDepsBlock = true;
            
            // Single-line Array? deps_required=(lib32gcc-s1 libcurl4)
            const singleLineMatch = line.match(/deps_required=\((.*)\)/);
            if (singleLineMatch) {
                const packages = singleLineMatch[1].trim().split(/\s+/).filter(p => p);
                if (currentGame) {
                    games[currentGame].system_packages.push(...packages);
                }
                inDepsBlock = false;
            }
            continue;
        }
        
        // deps_required Block Ende
        if (inDepsBlock && line === ')') {
            inDepsBlock = false;
            continue;
        }
        
        // Package in deps_required Block
        if (inDepsBlock && currentGame) {
            const pkg = line.replace(/["']/g, '').trim();
            if (pkg && !pkg.startsWith('#')) {
                games[currentGame].system_packages.push(pkg);
            }
        }
        
        // Kommentare als Notizen sammeln
        if (currentGame && line.startsWith('#') && !line.includes('shortname')) {
            const note = line.replace(/^#+\s*/, '').trim();
            if (note) {
                games[currentGame].notes.push(note);
            }
        }
        
        // Game-Block Ende: fi
        if (line === 'fi' && currentGame) {
            currentGame = null;
        }
    }
    
    console.log(`✅ ${Object.keys(games).length} Games gefunden!`);
    return games;
}

// ===== GAME NAME MAPPING =====
// LinuxGSM shortnames → Pterodactyl Egg Namen
const GAME_NAME_MAPPING = {
    'csgo': 'Counter-Strike: Global Offensive',
    'cs2': 'Counter-Strike 2',
    'pw': 'Palworld',
    'ark': 'ARK: Survival Evolved',
    'ase': 'ARK: Survival Evolved',
    'mc': 'Minecraft',
    'rust': 'Rust',
    'terraria': 'Terraria',
    'squad': 'Squad',
    'insurgency': 'Insurgency: Sandstorm',
    'pavlov': 'Pavlov VR',
    'vr': 'Valheim',
    '7d2d': '7 Days to Die',
    'arma3': 'ARMA 3',
    'cod4': 'Call of Duty 4',
    'dst': "Don't Starve Together",
    'eco': 'Eco',
    'fctr': 'Factorio',
    'gmod': "Garry's Mod",
    'hl2dm': 'Half-Life 2: Deathmatch',
    'hlds': 'Half-Life 1',
    'hurtworld': 'Hurtworld',
    'jc2': 'Just Cause 2',
    'jc3': 'Just Cause 3',
    'kf2': 'Killing Floor 2',
    'l4d2': 'Left 4 Dead 2',
    'mh': 'Medal of Honor',
    'mta': 'Multi Theft Auto',
    'nmrih': 'No More Room in Hell',
    'pixark': 'PixARK',
    'pvkii': 'Pirates, Vikings and Knights II',
    'pz': 'Project Zomboid',
    'ql': 'Quake Live',
    'ro': 'Red Orchestra',
    'rok': 'Rising Storm 2: Vietnam',
    'samp': 'San Andreas Multiplayer',
    'sbots': 'Starbound',
    'scpsl': 'SCP: Secret Laboratory',
    'sdtd': '7 Days to Die',
    'sfc': 'Soldier of Fortune',
    'sof2': 'Soldier of Fortune 2',
    'sol': 'Soldat',
    'st': 'Stationeers',
    'tb': 'Terraria - TShock',
    'tf2': 'Team Fortress 2',
    'ts3': 'TeamSpeak 3',
    'tw': 'The Witcher',
    'unreal': 'Unreal Tournament',
    'ut2k4': 'Unreal Tournament 2004',
    'ut3': 'Unreal Tournament 3',
    'ut99': 'Unreal Tournament 99',
    'unt': 'Unturned',
    'vh': 'Valheim',
    'vpk': 'V Rising',
    'wet': 'Wolfenstein: Enemy Territory',
    'wf': 'Warframe',
    'wurm': 'Wurm Unlimited',
    'zmr': 'Zombie Master Reborn'
};

// ===== COMMON DEPENDENCIES =====
// Dependencies die für fast alle Steam-Games gelten
const COMMON_STEAM_DEPENDENCIES = {
    system_packages: [
        'lib32gcc-s1',      // 32-bit GCC support
        'lib32stdc++6',     // 32-bit C++ standard library
        'steamcmd'          // Steam Console Client
    ],
    notes: ['Common dependencies for most Steam-based games']
};

// ===== ENRICHMENT =====
function enrichWithCommonDeps(games) {
    console.log('🔧 Enriching mit Common Dependencies...');
    
    for (const [shortname, game] of Object.entries(games)) {
        // Deduplizieren
        game.system_packages = [...new Set(game.system_packages)];
        
        // Runtime-Type bestimmen
        if (game.system_packages.some(p => p.includes(':i386') || p.includes('lib32'))) {
            game.runtime_type = 'native_steamcmd';
        } else {
            game.runtime_type = 'native';
        }
        
        // Full-Name aus Mapping
        game.name = GAME_NAME_MAPPING[shortname] || `Unknown (${shortname})`;
    }
    
    return games;
}

// ===== MAIN =====
function main() {
    console.log('🚀 LinuxGSM Dependency Importer');
    console.log('================================\n');
    
    // 1. Parse LinuxGSM
    const games = parseLinuxGSMDependencies();
    
    // 2. Enrich
    const enriched = enrichWithCommonDeps(games);
    
    // 3. Output
    const outputDir = path.dirname(OUTPUT_FILE);
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }
    
    const output = {
        source: 'LinuxGSM',
        source_url: 'https://github.com/GameServerManagers/LinuxGSM',
        imported_at: new Date().toISOString(),
        game_count: Object.keys(enriched).length,
        common_dependencies: COMMON_STEAM_DEPENDENCIES,
        games: enriched
    };
    
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));
    
    console.log(`\n✅ Erfolgreich exportiert!`);
    console.log(`   File: ${OUTPUT_FILE}`);
    console.log(`   Games: ${Object.keys(enriched).length}`);
    console.log(`\n📊 Beispiele:`);
    
    // Zeige einige Beispiele
    const examples = ['csgo', 'cs2', 'pw', 'ark', 'mc'];
    examples.forEach(shortname => {
        if (enriched[shortname]) {
            console.log(`\n   ${enriched[shortname].name} (${shortname}):`);
            console.log(`   └─ ${enriched[shortname].system_packages.length} Packages: ${enriched[shortname].system_packages.slice(0, 3).join(', ')}...`);
        }
    });
}

// Run
if (require.main === module) {
    main();
}
