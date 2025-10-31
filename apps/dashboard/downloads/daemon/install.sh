#!/bin/bash
#
# FireBot Daemon - Installation Script
# =====================================
# 
# Automatische Installation des FireBot Daemons mit:
# - System-Checks (OS, Permissions, Dependencies)
# - Binary-Download oder lokales Binary
# - Setup-Wizard für Daemon-Konfiguration
# - Systemd Service Installation
# - Auto-Start Konfiguration
# - Health-Check & Dashboard-Registrierung
#
# Usage:
#   curl -fsSL https://dev.firenetworks.de/downloads/daemon/install.sh | sudo bash
#   oder: ./install.sh
#
# Author: FireNetworks 2025
# Version: 1.0.0

set -e  # Exit bei Fehler

# ============================================================================
# CONFIGURATION
# ============================================================================

VERSION="1.0.0"
BINARY_NAME="firebot-daemon"
SERVICE_NAME="firebot-daemon"
INSTALL_DIR="/opt/firebot-daemon"
CONFIG_FILE="daemon.yaml"
SYSTEMD_SERVICE="/etc/systemd/system/${SERVICE_NAME}.service"

# Download-URLs werden dynamisch basierend auf Architektur erstellt
# Format: https://dev.firenetworks.de/downloads/daemon/binaries/{os}-{arch}/firebot-daemon
DOWNLOAD_BASE_URL="https://firenetworks.de/downloads/daemon/binaries"
DOWNLOAD_BASE_URL_DEV="https://dev.firenetworks.de/downloads/daemon/binaries"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# ============================================================================
# HELPER FUNCTIONS
# ============================================================================

print_banner() {
    echo ""
    echo -e "${CYAN}╔═══════════════════════════════════════════════════╗${NC}"
    echo -e "${CYAN}║${NC}     ${GREEN}🔥 FireBot Daemon Installer v${VERSION}${NC}     ${CYAN}║${NC}"
    echo -e "${CYAN}║${NC}     WebSocket Daemon für FireBot Masterserver    ${CYAN}║${NC}"
    echo -e "${CYAN}╚═══════════════════════════════════════════════════╝${NC}"
    echo ""
}

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[✓]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[!]${NC} $1"
}

log_error() {
    echo -e "${RED}[✗]${NC} $1"
}

prompt_yes_no() {
    local prompt="$1"
    local default="${2:-n}"
    
    if [[ "$default" == "y" ]]; then
        prompt="$prompt [Y/n]: "
    else
        prompt="$prompt [y/N]: "
    fi
    
    read -p "$prompt" response
    response=${response:-$default}
    
    if [[ "$response" =~ ^[Yy]$ ]]; then
        return 0
    else
        return 1
    fi
}

prompt_input() {
    local prompt="$1"
    local default="$2"
    local value
    
    if [[ -n "$default" ]]; then
        read -p "$prompt [$default]: " value
        value=${value:-$default}
    else
        read -p "$prompt: " value
    fi
    
    echo "$value"
}

check_root() {
    if [[ $EUID -ne 0 ]]; then
        log_error "Dieses Script muss als root ausgeführt werden!"
        log_info "Führe aus: sudo $0"
        exit 1
    fi
}

check_command() {
    if ! command -v "$1" &> /dev/null; then
        return 1
    fi
    return 0
}

# ============================================================================
# SYSTEM CHECKS
# ============================================================================

check_system() {
    log_info "Prüfe System-Voraussetzungen..."
    
    # Check OS
    if [[ ! -f /etc/os-release ]]; then
        log_error "Nicht unterstütztes Betriebssystem!"
        exit 1
    fi
    
    source /etc/os-release
    log_success "Betriebssystem: $PRETTY_NAME"
    
    # Check Architecture
    local arch=$(uname -m)
    if [[ "$arch" != "x86_64" ]]; then
        log_warn "Architektur $arch wird möglicherweise nicht unterstützt!"
        log_warn "Empfohlen: x86_64 (amd64)"
    else
        log_success "Architektur: $arch"
    fi
    
    # Check systemd
    if ! check_command systemctl; then
        log_error "systemd nicht gefunden! Installation nicht möglich."
        exit 1
    fi
    log_success "systemd verfügbar"
    
    # Check Internet-Verbindung
    if ping -c 1 -W 2 8.8.8.8 &> /dev/null; then
        log_success "Internet-Verbindung aktiv"
    else
        log_warn "Keine Internet-Verbindung! Binary-Download nicht möglich."
    fi
}


check_dependencies() {
    log_info "Prüfe Dependencies..."
    
    local missing_deps=()
    
    # Essenzielle Tools
    for cmd in curl wget tar; do
        if ! check_command $cmd; then
            missing_deps+=($cmd)
        fi
    done
    
    if [[ ${#missing_deps[@]} -gt 0 ]]; then
        log_warn "Fehlende Pakete: ${missing_deps[*]}"
        
        if prompt_yes_no "Fehlende Pakete installieren?" "y"; then
            install_dependencies "${missing_deps[@]}"
        else
            log_error "Installation ohne Dependencies nicht möglich!"
            exit 1
        fi
    else
        log_success "Alle Dependencies vorhanden"
    fi
    
    # SteamCMD Dependencies prüfen (32-Bit Libraries)
    check_steamcmd_dependencies
}

check_steamcmd_dependencies() {
    log_info "Prüfe SteamCMD Dependencies (32-Bit Libraries)..."
    
    local arch=$(uname -m)
    if [[ "$arch" != "x86_64" ]]; then
        log_info "Keine 64-Bit Architektur - SteamCMD-Check übersprungen"
        return 0
    fi
    
    # Prüfe ob 32-Bit Libraries installiert sind
    local needs_libs=false
    
    # Für Debian/Ubuntu
    if check_command dpkg; then
        # Prüfe ob i386 Architecture hinzugefügt ist
        if ! dpkg --print-foreign-architectures | grep -q "i386"; then
            log_warn "32-Bit Architecture (i386) nicht aktiviert"
            needs_libs=true
        fi
        
        # Prüfe ob lib32gcc-s1 installiert ist
        if ! dpkg -l | grep -q "lib32gcc-s1"; then
            log_warn "lib32gcc-s1 nicht installiert"
            needs_libs=true
        fi
        
        # Prüfe ob lib32stdc++6 installiert ist
        if ! dpkg -l | grep -q "lib32stdc++6"; then
            log_warn "lib32stdc++6 nicht installiert"
            needs_libs=true
        fi
    fi
    
    if $needs_libs; then
        log_warn "SteamCMD benötigt 32-Bit Libraries für korrekte Funktion!"
        log_info "Betroffen: Steam-basierte Gameserver (CS2, Valheim, ARK, Rust, etc.)"
        
        if prompt_yes_no "SteamCMD Dependencies jetzt installieren?" "y"; then
            install_steamcmd_dependencies
        else
            log_warn "Installation fortgesetzt ohne SteamCMD Dependencies"
            log_warn "Steam-Gameserver werden NICHT funktionieren!"
            log_info "Manuelle Installation später möglich mit:"
            log_info "  sudo dpkg --add-architecture i386"
            log_info "  sudo apt-get update"
            log_info "  sudo apt-get install -y lib32gcc-s1 lib32stdc++6"
        fi
    else
        log_success "SteamCMD Dependencies vorhanden"
    fi
}

install_steamcmd_dependencies() {
    log_info "Installiere SteamCMD Dependencies..."
    
    if check_command apt-get; then
        log_info "Aktiviere i386 Architecture..."
        dpkg --add-architecture i386 2>&1 | grep -v "already added" || true
        
        log_info "Aktualisiere Paketlisten..."
        apt-get update -qq
        
        log_info "Installiere 32-Bit Libraries..."
        apt-get install -y -qq lib32gcc-s1 lib32stdc++6
        
        # Erstelle SteamCMD-Gruppe (für Shared Access)
        if ! getent group steamcmd > /dev/null 2>&1; then
            log_info "Erstelle steamcmd Gruppe für Shared Access..."
            groupadd --system steamcmd
            log_success "steamcmd Gruppe erstellt"
        else
            log_info "steamcmd Gruppe existiert bereits"
        fi
        
        log_success "SteamCMD Dependencies installiert"
    elif check_command yum; then
        log_info "Installiere 32-Bit Libraries (CentOS/RHEL)..."
        yum install -y -q glibc.i686 libstdc++.i686
        
        # Erstelle SteamCMD-Gruppe
        if ! getent group steamcmd > /dev/null 2>&1; then
            groupadd --system steamcmd
            log_success "steamcmd Gruppe erstellt"
        fi
        
        log_success "SteamCMD Dependencies installiert"
    elif check_command dnf; then
        log_info "Installiere 32-Bit Libraries (Fedora)..."
        dnf install -y -q glibc.i686 libstdc++.i686
        
        # Erstelle SteamCMD-Gruppe
        if ! getent group steamcmd > /dev/null 2>&1; then
            groupadd --system steamcmd
            log_success "steamcmd Gruppe erstellt"
        fi
        
        log_success "SteamCMD Dependencies installiert"
    else
        log_error "Paketmanager nicht unterstützt!"
        log_warn "Bitte manuell installieren:"
        log_info "  Debian/Ubuntu: sudo apt-get install lib32gcc-s1 lib32stdc++6"
        log_info "  CentOS/RHEL:   sudo yum install glibc.i686 libstdc++.i686"
        log_info "  Fedora:        sudo dnf install glibc.i686 libstdc++.i686"
        log_warn "Erstelle auch die steamcmd Gruppe: groupadd --system steamcmd"
    fi
}

install_dependencies() {
    local deps=("$@")
    log_info "Installiere Dependencies: ${deps[*]}..."
    
    if check_command apt-get; then
        apt-get update -qq
        apt-get install -y -qq "${deps[@]}"
    elif check_command yum; then
        yum install -y -q "${deps[@]}"
    elif check_command dnf; then
        dnf install -y -q "${deps[@]}"
    else
        log_error "Paketmanager nicht unterstützt!"
        exit 1
    fi
    
    log_success "Dependencies installiert"
}

# ============================================================================
# BINARY INSTALLATION
# ============================================================================

get_binary() {
    log_info "Binary-Quelle auswählen..."
    
    # Erkenne OS und Architektur
    local os=$(uname -s | tr '[:upper:]' '[:lower:]')
    local arch=$(uname -m)
    
    # Konvertiere Architektur zu Go-Format
    case "$arch" in
        x86_64)
            arch="amd64"
            ;;
        aarch64|arm64)
            arch="arm64"
            ;;
        *)
            log_error "Nicht unterstützte Architektur: $arch"
            exit 1
            ;;
    esac
    
    # Konvertiere OS zu Go-Format
    case "$os" in
        linux)
            os="linux"
            ;;
        darwin)
            os="darwin"
            ;;
        *)
            log_error "Nicht unterstütztes Betriebssystem: $os"
            exit 1
            ;;
    esac
    
    local platform="${os}-${arch}"
    log_info "Erkannte Plattform: $platform"
    
    # Prüfe ob lokales Binary vorhanden ist
    local local_paths=(
        "./firebot-daemon"
        "./bin/firebot-daemon"
        "./build/firebot-daemon"
        "../build/firebot-daemon"
    )
    
    local found_local=false
    for path in "${local_paths[@]}"; do
        if [[ -f "$path" && -x "$path" ]]; then
            log_success "Lokales Binary gefunden: $path"
            cp "$path" "${INSTALL_DIR}/${BINARY_NAME}"
            chmod +x "${INSTALL_DIR}/${BINARY_NAME}"
            found_local=true
            break
        fi
    done
    
    # Wenn kein lokales Binary gefunden, vom Dev-Server laden
    if ! $found_local; then
        log_info "Kein lokales Binary gefunden, lade von Dev-Server..."
        download_binary "$DOWNLOAD_BASE_URL_DEV" "$platform"
    fi
}

download_binary() {
    local base_url="$1"
    local platform="$2"
    local url="${base_url}/${platform}/firebot-daemon"
    
    log_info "Lade Binary herunter von: $url"
    
    local tmp_file="/tmp/${BINARY_NAME}"
    
    if check_command curl; then
        if curl -fsSL -o "$tmp_file" "$url"; then
            chmod +x "$tmp_file"
            mv "$tmp_file" "${INSTALL_DIR}/${BINARY_NAME}"
            log_success "Binary heruntergeladen und installiert"
        else
            log_error "Download fehlgeschlagen!"
            log_error "URL war: $url"
            log_info "Bitte Binary manuell nach ${INSTALL_DIR}/${BINARY_NAME} kopieren"
            exit 1
        fi
    else
        log_error "curl nicht verfügbar!"
        exit 1
    fi
}

# use_local_binary wird nicht mehr benötigt - ist jetzt in get_binary()
# compile_binary wird nicht mehr benötigt - für manuelle Builds

# ============================================================================
# SYSTEM USER SETUP
# ============================================================================

create_firebot_user() {
    log_info "Prüfe System-Voraussetzungen..."
    
    # HINWEIS: Daemon läuft als root (wie Pterodactyl Wings)
    # Gameserver-Prozesse laufen als gs-guild_XXXXX User
    # Kein firebot User mehr nötig - vereinfacht sudo-Komplexität
    
    # steamcmd Gruppe erstellen (für SteamCMD Shared Access)
    if ! getent group steamcmd &>/dev/null; then
        log_info "Erstelle steamcmd Gruppe..."
        groupadd --system steamcmd
        log_success "steamcmd Gruppe erstellt"
    else
        log_info "steamcmd Gruppe existiert bereits"
    fi
    
    log_success "System-Voraussetzungen geprüft (Daemon läuft als root)"
}

setup_sudoers() {
    log_info "Sudoers-Konfiguration wird übersprungen..."
    log_success "Daemon läuft als root - keine sudoers-Regeln nötig"
    
    # Alte sudoers-Dateien entfernen falls vorhanden
    if [[ -f "/etc/sudoers.d/firebot" ]]; then
        log_info "Entferne alte sudoers-Datei: /etc/sudoers.d/firebot"
        rm -f "/etc/sudoers.d/firebot"
    fi
    if [[ -f "/etc/sudoers.d/firebot-daemon" ]]; then
        log_info "Entferne alte sudoers-Datei: /etc/sudoers.d/firebot-daemon"
        rm -f "/etc/sudoers.d/firebot-daemon"
    fi
    
    log_success "Keine sudo-Komplexität mehr - Daemon läuft direkt als root"
}

create_data_directories() {
    log_info "Erstelle Daten-Verzeichnisse..."
    
    local base_dir="/data/firebot"
    
    # Basis-Verzeichnisse erstellen
    mkdir -p "$base_dir"/{servers,logs,backups,steamcmd}
    
    # Ownership setzen auf root (Daemon läuft als root)
    chown -R root:root "$base_dir"
    chmod 755 "$base_dir"
    
    # Sub-Verzeichnisse mit korrekten Permissions
    chmod 755 "$base_dir"/{servers,logs,backups,steamcmd}
    
    log_success "Daten-Verzeichnisse erstellt: $base_dir"
    log_info "Verzeichnisse gehören root:root mit Permissions 755"
    log_info "Gameserver-Prozesse laufen später als gs-guild_XXXXX User"
}


run_setup_wizard() {
    log_info "Starte Setup-Wizard..."
    
    # In Installations-Verzeichnis wechseln
    cd "$INSTALL_DIR"
    
    # Setup-Wizard ausführen (Binary macht das interaktiv)
    if ./${BINARY_NAME} 2>&1 | grep -q "Setup-Wizard"; then
        log_success "Setup-Wizard abgeschlossen"
    else
        log_error "Setup-Wizard fehlgeschlagen!"
        exit 1
    fi
}

validate_config() {
    log_info "Validiere Konfiguration..."
    
    if [[ ! -f "${INSTALL_DIR}/${CONFIG_FILE}" ]]; then
        log_error "Config-Datei nicht gefunden: ${INSTALL_DIR}/${CONFIG_FILE}"
        return 1
    fi
    
    # Prüfe ob essenzielle Felder gesetzt sind
    if ! grep -q "daemon_id:" "${INSTALL_DIR}/${CONFIG_FILE}"; then
        log_error "Daemon-ID fehlt in Config!"
        return 1
    fi
    
    if ! grep -q "token:" "${INSTALL_DIR}/${CONFIG_FILE}"; then
        log_error "Token fehlt in Config!"
        return 1
    fi
    
    log_success "Konfiguration valide"
    
    # Permissions setzen
    chmod 600 "${INSTALL_DIR}/${CONFIG_FILE}"
    log_success "Config-Permissions gesetzt (600)"
}

# ============================================================================
# SYSTEMD SERVICE
# ============================================================================

# Systemd Service erstellen
create_systemd_service() {
    log_info "Erstelle systemd Service..."
    
    cat > /etc/systemd/system/firebot-daemon.service << 'EOF'
[Unit]
Description=FireBot Daemon - Gameserver Management
Documentation=https://github.com/FireDervil77/firebot-daemon
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=root
Group=root
WorkingDirectory=/opt/firebot-daemon

# Binary
ExecStart=/opt/firebot-daemon/firebot-daemon

# Restart policy
Restart=on-failure
RestartSec=5s
StartLimitBurst=3
StartLimitInterval=60s

# Logging
StandardOutput=journal
StandardError=journal
SyslogIdentifier=firebot-daemon

# Resource limits
LimitNOFILE=65536
LimitNPROC=512

[Install]
WantedBy=multi-user.target
EOF

    systemctl daemon-reload
    log_success "Systemd Service erstellt (läuft als root)"
}

enable_service() {
    log_info "Aktiviere Auto-Start..."
    
    systemctl enable "$SERVICE_NAME"
    log_success "Auto-Start aktiviert"
}

start_service() {
    log_info "Starte Service..."
    
    systemctl start "$SERVICE_NAME"
    
    # Warte kurz
    sleep 2
    
    # Check Status
    if systemctl is-active --quiet "$SERVICE_NAME"; then
        log_success "Service gestartet"
    else
        log_error "Service konnte nicht gestartet werden!"
        log_info "Prüfe Logs mit: journalctl -u $SERVICE_NAME -f"
        return 1
    fi
}

# ============================================================================
# DAEMON SETUP - Daemon macht Setup selbst beim ersten Start!
# ============================================================================

# ============================================================================
# HEALTH CHECK
# ============================================================================

# Health-Check wird nicht mehr benötigt - Daemon macht Setup selbst
# Funktion bleibt für mögliche spätere Nutzung erhalten

health_check() {
    log_info "Führe Health-Check durch..."
    
    # Warte 5 Sekunden auf Daemon-Start
    log_info "Warte auf Daemon-Initialisierung..."
    sleep 5
    
    # Prüfe ob Process läuft
    if pgrep -f "$BINARY_NAME" > /dev/null; then
        log_success "Daemon-Process läuft"
    else
        log_error "Daemon-Process nicht gefunden!"
        return 1
    fi
    
    # Prüfe Logs auf Fehler
    if journalctl -u "$SERVICE_NAME" --since "1 minute ago" | grep -iq "error\|failed\|fatal"; then
        log_warn "Fehler in Logs gefunden!"
        log_info "Prüfe Logs mit: journalctl -u $SERVICE_NAME -n 50"
    else
        log_success "Keine Fehler in Logs"
    fi
    
    # Prüfe WebSocket-Verbindung (optional)
    if journalctl -u "$SERVICE_NAME" --since "1 minute ago" | grep -q "Verbunden mit Dashboard"; then
        log_success "WebSocket-Verbindung hergestellt"
    else
        log_warn "WebSocket-Verbindung noch nicht hergestellt"
        log_info "Dies kann einige Sekunden dauern..."
    fi
}

# ============================================================================
# SYSTEM USER SETUP
# ============================================================================

# ============================================================================
# POST-INSTALL
# ============================================================================

show_post_install_info() {
    echo ""
    echo -e "${GREEN}╔═══════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║${NC}  🎉 Installation erfolgreich abgeschlossen!       ${GREEN}║${NC}"
    echo -e "${GREEN}╚═══════════════════════════════════════════════════╝${NC}"
    echo ""
    echo -e "${CYAN}📁 Installation:${NC}"
    echo -e "   Verzeichnis: ${INSTALL_DIR}"
    echo -e "   Binary:      ${INSTALL_DIR}/${BINARY_NAME}"
    echo -e "   Config:      ${INSTALL_DIR}/${CONFIG_FILE}"
    echo -e "   User:        ${GREEN}root${NC} (Gameserver als gs-guild_* User)"
    echo ""
    echo -e "${CYAN}🔧 Service Management:${NC}"
    echo -e "   Status:      ${GREEN}systemctl status ${SERVICE_NAME}${NC}"
    echo -e "   Stoppen:     systemctl stop ${SERVICE_NAME}"
    echo -e "   Neustarten:  systemctl restart ${SERVICE_NAME}"
    echo -e "   Logs:        ${GREEN}journalctl -u ${SERVICE_NAME} -f${NC}"
    echo ""
    echo -e "${CYAN}🔒 Security:${NC}"
    echo -e "   - Daemon läuft als root (wie Pterodactyl Wings)"
    echo -e "   - Gameserver-Prozesse laufen als gs-guild_XXXXX User"
    echo -e "   - User-Isolation pro Guild/RootServer"
    echo ""
    echo -e "${CYAN}�📊 Dashboard:${NC}"
    echo -e "   Öffne das Dashboard um den Daemon zu sehen:"
    echo -e "   ${BLUE}https://dev.firenetworks.de${NC}"
    echo ""
    echo -e "${CYAN}🔍 Next Steps:${NC}"
    echo -e "   1. Setup-Wizard ausführen (siehe unten)"
    echo -e "   2. Dashboard öffnen und Daemon-Status prüfen"
    echo -e "   3. Ersten Gameserver erstellen"
    echo ""
    echo -e "${YELLOW}⚠️  Wichtig:${NC}"
    echo -e "   - Config-Datei ist nur für firebot lesbar (600)"
    echo -e "   - Token niemals teilen oder committen!"
    echo -e "   - Bei Problemen: journalctl -u ${SERVICE_NAME} -n 100"
    echo ""
}

# ============================================================================
# UNINSTALL
# ============================================================================

uninstall() {
    echo ""
    echo -e "${RED}╔═══════════════════════════════════════════════════╗${NC}"
    echo -e "${RED}║${NC}     ${YELLOW}⚠️  FireBot Daemon Deinstallation${NC}         ${RED}║${NC}"
    echo -e "${RED}╚═══════════════════════════════════════════════════╝${NC}"
    echo ""
    log_warn "Deinstalliere FireBot Daemon..."
    echo ""
    
    # Stop Service
    if systemctl is-active --quiet "$SERVICE_NAME" 2>/dev/null; then
        log_info "Stoppe Service..."
        systemctl stop "$SERVICE_NAME"
        log_success "Service gestoppt"
    fi
    
    # Disable Service
    if systemctl is-enabled --quiet "$SERVICE_NAME" 2>/dev/null; then
        log_info "Deaktiviere Auto-Start..."
        systemctl disable "$SERVICE_NAME"
        log_success "Auto-Start deaktiviert"
    fi
    
    # Remove Service-Datei
    if [[ -f "$SYSTEMD_SERVICE" ]]; then
        log_info "Entferne Systemd Service..."
        rm "$SYSTEMD_SERVICE"
        systemctl daemon-reload
        log_success "Service-Datei entfernt"
    fi
    
    # Remove sudoers-Datei
    if [[ -f "/etc/sudoers.d/firebot-daemon" ]]; then
        log_info "Entferne Sudoers-Konfiguration..."
        rm "/etc/sudoers.d/firebot-daemon"
        log_success "Sudoers-Datei entfernt"
    fi
    
    # Lese Config und entferne Daten-Verzeichnisse
    CONFIG_PATH="$INSTALL_DIR/$CONFIG_FILE"
    if [[ -f "$CONFIG_PATH" ]]; then
        log_info "Lese Konfiguration aus: $CONFIG_PATH"
        
        # Parse YAML und extrahiere base_directory (in filesystem-Sektion oder deprecated paths.base_dir)
        BASE_DIR=$(grep -E "^\s+base_directory:|^\s+base_dir:" "$CONFIG_PATH" | head -1 | sed 's/.*:\s*"\?\([^"]*\)"\?.*/\1/' | tr -d '"' || echo "")
        
        if [[ -n "$BASE_DIR" ]] && [[ -d "$BASE_DIR" ]]; then
            echo ""
            echo -e "${YELLOW}📂 Gefundenes Daten-Verzeichnis:${NC} $BASE_DIR"
            echo -e "${YELLOW}   ⚠️  Enthält möglicherweise Server-Daten, Backups, Logs${NC}"
            echo ""
            
            if prompt_yes_no "Daten-Verzeichnis löschen? ($BASE_DIR)" "n"; then
                log_info "Entferne Daten-Verzeichnis mit sudo..."
                sudo rm -rf "$BASE_DIR" 2>/dev/null || rm -rf "$BASE_DIR"
                log_success "Daten-Verzeichnis entfernt"
            else
                log_info "Daten-Verzeichnis behalten: $BASE_DIR"
            fi
        else
            log_warn "Kein base_directory in Config gefunden oder Verzeichnis existiert nicht"
        fi
    else
        log_warn "Config-Datei nicht gefunden: $CONFIG_PATH"
    fi
    
    # Remove /data/firebot (falls verwendet und nicht schon entfernt)
    if [[ -d "/data/firebot" ]]; then
        echo ""
        if prompt_yes_no "Standard-Datenverzeichnis /data/firebot löschen?" "n"; then
            log_info "Entferne /data/firebot mit sudo..."
            sudo rm -rf "/data/firebot"
            log_success "/data/firebot entfernt"
        else
            log_info "/data/firebot behalten"
        fi
    fi
    
    # Remove Installation
    echo ""
    if prompt_yes_no "Installations-Verzeichnis löschen? ($INSTALL_DIR)" "y"; then
        log_info "Entferne Installation..."
        rm -rf "$INSTALL_DIR"
        log_success "Installation entfernt: $INSTALL_DIR"
    else
        log_info "Installations-Verzeichnis behalten: $INSTALL_DIR"
    fi
    
    # Remove Gameserver Users (gs-*)
    echo ""
    GAMESERVER_USERS=$(getent passwd | grep "^gs-" | cut -d: -f1 || true)
    if [[ -n "$GAMESERVER_USERS" ]]; then
        GS_COUNT=$(echo "$GAMESERVER_USERS" | wc -l)
        log_warn "Gefundene Gameserver-User: $GS_COUNT"
        echo "$GAMESERVER_USERS" | while IFS= read -r gs_user; do
            echo "   - $gs_user"
        done
        echo ""
        
        if prompt_yes_no "Alle Gameserver-User (gs-*) entfernen?" "y"; then
            log_info "Entferne Gameserver-User..."
            echo "$GAMESERVER_USERS" | while IFS= read -r gs_user; do
                log_info "  → Entferne $gs_user..."
                userdel -r "$gs_user" 2>/dev/null || userdel "$gs_user" 2>/dev/null || true
            done
            log_success "Gameserver-User entfernt ($GS_COUNT User)"
        else
            log_info "Gameserver-User behalten ($GS_COUNT User)"
        fi
    else
        log_info "Keine Gameserver-User gefunden"
    fi
    
    # Remove steamcmd Group
    echo ""
    if getent group steamcmd >/dev/null 2>&1; then
        if prompt_yes_no "steamcmd Gruppe entfernen?" "y"; then
            log_info "Entferne steamcmd Gruppe..."
            groupdel steamcmd 2>/dev/null || true
            log_success "steamcmd Gruppe entfernt"
        else
            log_info "steamcmd Gruppe behalten"
        fi
    fi
    
    # Remove User
    echo ""
    if prompt_yes_no "firebot System-User entfernen?" "n"; then
        log_info "Entferne firebot User..."
        userdel -r firebot 2>/dev/null || userdel firebot 2>/dev/null || true
        log_success "firebot User entfernt"
    else
        log_info "firebot User behalten (UID: $(id -u firebot 2>/dev/null || echo 'N/A'))"
    fi
    
    echo ""
    echo -e "${GREEN}✅ Deinstallation abgeschlossen!${NC}"
    echo ""
    echo -e "${CYAN}Folgende Komponenten wurden behandelt:${NC}"
    echo -e "   ${GREEN}✓${NC} Systemd Service gestoppt & entfernt"
    echo -e "   ${GREEN}✓${NC} Sudoers-Konfiguration entfernt"
    echo -e "   ${GREEN}✓${NC} Installations-Verzeichnis behandelt"
    echo -e "   ${GREEN}✓${NC} Daten-Verzeichnisse behandelt"
    echo -e "   ${GREEN}✓${NC} System-User behandelt"
    echo ""
}

# ============================================================================
# MAIN
# ============================================================================

main() {
    print_banner
    
    # Check für Uninstall-Flag
    if [[ "$1" == "--uninstall" ]] || [[ "$1" == "uninstall" ]]; then
        check_root
        uninstall
        exit 0
    fi
    
    # Check Root
    check_root
    
    # System Checks
    check_system
    check_dependencies
    
    echo ""
    log_info "Installations-Verzeichnis: $INSTALL_DIR"
    
    # Erstelle Installations-Verzeichnis
    mkdir -p "$INSTALL_DIR"
    
    # Binary beschaffen
    get_binary
    
    # System-User & Verzeichnisse erstellen
    create_firebot_user
    setup_sudoers
    create_data_directories
    
    # Ownership für Install-Dir setzen (root, da Daemon als root läuft)
    chown -R root:root "$INSTALL_DIR"
    
    # Systemd Service
    create_systemd_service
    enable_service
    
    # Post-Install Info
    show_post_install_info
    
    echo ""
    echo -e "${GREEN}✅ Installation erfolgreich abgeschlossen!${NC}"
    echo ""
    echo -e "${CYAN}╔═══════════════════════════════════════════════════╗${NC}"
    echo -e "${CYAN}║${NC}     ${YELLOW}📋 Nächster Schritt: Setup-Wizard${NC}          ${CYAN}║${NC}"
    echo -e "${CYAN}╚═══════════════════════════════════════════════════╝${NC}"
    echo ""
    echo -e "${CYAN}Starte den Setup-Wizard mit:${NC}"
    echo ""
    echo -e "   ${GREEN}sudo /opt/firebot-daemon/firebot-daemon${NC}"
    echo ""
    echo -e "${CYAN}Der Wizard führt dich durch die Konfiguration.${NC}"
    echo -e "${CYAN}Nach dem Setup läuft der Daemon automatisch als Service.${NC}"
    echo ""
    echo -e "${YELLOW}ℹ️  Hinweis:${NC} Der Daemon läuft als root für direkte System-Operationen"
    echo -e "   (User-Erstellung, chown, chmod, etc. ohne sudo-Komplexität)"
    echo ""
    echo -e "${CYAN}📊 Dashboard:${NC} ${BLUE}https://dev.firenetworks.de${NC}"
    echo -e "${CYAN}📋 Logs:${NC} journalctl -u ${SERVICE_NAME} -f"
    echo ""
}

# ============================================================================
# ENTRY POINT
# ============================================================================

# Trap Ctrl+C
trap 'echo ""; log_warn "Installation abgebrochen!"; exit 130' INT

# Run
main "$@"
# Oder das neue Binary wenn deployed