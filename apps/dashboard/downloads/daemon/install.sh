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

    # Docker prüfen / installieren (zwingend erforderlich)
    check_docker
}

# ============================================================================
# DOCKER
# ============================================================================

check_docker() {
    log_info "Prüfe Docker..."

    if check_command docker; then
        local docker_version
        docker_version=$(docker --version 2>/dev/null | awk '{print $3}' | tr -d ',')
        log_success "Docker bereits installiert: v${docker_version}"

        # Docker-Daemon läuft?
        if ! docker info &>/dev/null; then
            log_warn "Docker ist installiert aber der Daemon läuft nicht!"
            log_info "Starte Docker..."
            systemctl start docker
            sleep 2
            if ! docker info &>/dev/null; then
                log_error "Docker-Daemon konnte nicht gestartet werden!"
                log_info "Bitte manuell prüfen: systemctl status docker"
                exit 1
            fi
            log_success "Docker-Daemon gestartet"
        fi

        # Auto-Start sicherstellen
        systemctl enable docker &>/dev/null
        return 0
    fi

    log_warn "Docker nicht gefunden!"
    if prompt_yes_no "Docker Engine jetzt installieren?" "y"; then
        install_docker
    else
        log_error "Docker ist zwingend erforderlich für den FireBot Daemon!"
        log_info "Bitte Docker manuell installieren: https://docs.docker.com/engine/install/"
        exit 1
    fi
}

install_docker() {
    log_info "Installiere Docker Engine..."

    # Prüfe OS
    if [[ ! -f /etc/os-release ]]; then
        log_error "Betriebssystem nicht erkennbar!"
        exit 1
    fi
    source /etc/os-release

    if check_command apt-get || check_command yum || check_command dnf; then
        log_info "Nutze offizielles Docker-Install-Script (get.docker.com)..."

        local tmp_script="/tmp/get-docker.sh"
        if ! curl -fsSL https://get.docker.com -o "$tmp_script"; then
            log_error "Docker-Install-Script konnte nicht heruntergeladen werden!"
            log_info "Manuelle Installation: https://docs.docker.com/engine/install/"
            exit 1
        fi

        sh "$tmp_script"
        rm -f "$tmp_script"
    else
        log_error "Kein unterstützter Paketmanager gefunden (apt/yum/dnf)!"
        log_info "Bitte Docker manuell installieren: https://docs.docker.com/engine/install/"
        exit 1
    fi

    # Docker starten & aktivieren
    systemctl enable --now docker
    sleep 2

    if ! docker info &>/dev/null; then
        log_error "Docker-Installation fehlgeschlagen - Daemon antwortet nicht!"
        exit 1
    fi

    log_success "Docker installiert: $(docker --version)"

    # firebot Bridge-Network anlegen
    setup_docker_network
}

setup_docker_network() {
    log_info "Richte Docker-Network 'firebot' ein..."

    if docker network inspect firebot &>/dev/null; then
        log_info "Docker-Network 'firebot' existiert bereits"
        return 0
    fi

    if docker network create \
        --driver bridge \
        --label "firebot.managed=true" \
        firebot &>/dev/null; then
        log_success "Docker-Network 'firebot' erstellt (Bridge)"
    else
        log_error "Docker-Network konnte nicht erstellt werden!"
        exit 1
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

    # Daemon läuft als root (wie Pterodactyl Wings)
    # Gameserver laufen als isolierte Docker-Container – kein gs-User mehr nötig
    log_success "System-Voraussetzungen geprüft (Daemon läuft als root, Gameserver in Docker)"
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

    local base_dir="/var/lib/firebot-daemon"

    # Server-Volumes: {base_dir}/{serverID}/serverfiles/ → /home/container (Docker Bind-Mount)
    mkdir -p "$base_dir"/logs           # Daemon-Logs
    mkdir -p "$base_dir"/volumes        # Gameserver-Volumes (per Server-ID)

    # Docker-Network 'firebot' sicherstellen (falls install_docker nicht aufgerufen wurde)
    if docker info &>/dev/null && ! docker network inspect firebot &>/dev/null; then
        setup_docker_network
    fi

    chown -R root:root "$base_dir"
    chmod 755 "$base_dir"
    chmod 755 "$base_dir"/logs
    chmod 755 "$base_dir"/volumes

    log_success "Daten-Verzeichnisse erstellt: $base_dir"
    log_info "  - $base_dir/logs/         (Daemon-System-Logs)"
    log_info "  - $base_dir/volumes/      (Gameserver-Volumes, per Server-ID)"
    log_info "  Container-Pfad im Volume: /home/container (Runtime) / /mnt/server (Install)"
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
After=network-online.target docker.service
Wants=network-online.target
Requires=docker.service

[Service]
Type=simple
User=root
Group=root
WorkingDirectory=/opt/firebot-daemon

# Binary
ExecStart=/opt/firebot-daemon/firebot-daemon

# Docker Socket
Environment="DOCKER_HOST=unix:///var/run/docker.sock"

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
    echo -e "${CYAN}� Docker:${NC}"
    echo -e "   Docker Version: $(docker --version 2>/dev/null || echo 'N/A')"
    echo -e "   Network:        firebot (Bridge)"
    echo -e "   Volumes:        /var/lib/firebot-daemon/volumes/{serverID}/serverfiles/"
    echo -e "   Socket:         /var/run/docker.sock"
    echo ""
    echo -e "${CYAN}🔒 Security:${NC}"
    echo -e "   - Daemon läuft als root (wie Pterodactyl Wings)"
    echo -e "   - Gameserver laufen als isolierte Docker-Container"
    echo -e "   - Container-Isolation: Bridge-Network + Volume-Mount"
    echo -e "   - Ressourcen-Limits via Docker (--memory / --cpus)"
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
    
    # Remove /var/lib/firebot-daemon (Docker-Daten)
    if [[ -d "/var/lib/firebot-daemon" ]]; then
        echo ""
        if prompt_yes_no "Docker-Datenverzeichnis /var/lib/firebot-daemon löschen? (Gameserver-Volumes!)" "n"; then
            log_info "Entferne /var/lib/firebot-daemon..."
            rm -rf "/var/lib/firebot-daemon"
            log_success "/var/lib/firebot-daemon entfernt"
        else
            log_info "/var/lib/firebot-daemon behalten"
        fi
    fi
    # Rückwärtskompatibilität: altes /data/firebot aufräumen
    if [[ -d "/data/firebot" ]]; then
        echo ""
        if prompt_yes_no "Altes Datenverzeichnis /data/firebot löschen?" "n"; then
            log_info "Entferne /data/firebot..."
            rm -rf "/data/firebot"
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
    
    # Docker-Container stoppen & entfernen (alle fb-* Container)
    echo ""
    FB_CONTAINERS=$(docker ps -a --filter "label=firebot.managed=true" --format "{{.Names}}" 2>/dev/null || true)
    if [[ -n "$FB_CONTAINERS" ]]; then
        FB_COUNT=$(echo "$FB_CONTAINERS" | wc -l)
        log_warn "Gefundene FireBot Docker-Container: $FB_COUNT"
        echo "$FB_CONTAINERS" | while IFS= read -r cname; do
            echo "   - $cname"
        done
        echo ""

        if prompt_yes_no "Alle FireBot Docker-Container stoppen & entfernen?" "y"; then
            log_info "Stoppe & entferne Container..."
            echo "$FB_CONTAINERS" | while IFS= read -r cname; do
                log_info "  → $cname"
                docker stop "$cname" &>/dev/null || true
                docker rm "$cname" &>/dev/null || true
            done
            log_success "Docker-Container entfernt ($FB_COUNT Container)"
        else
            log_info "Docker-Container behalten ($FB_COUNT Container)"
        fi
    else
        log_info "Keine FireBot Docker-Container gefunden"
    fi

    # Docker-Network entfernen
    echo ""
    if docker network inspect firebot &>/dev/null 2>&1; then
        if prompt_yes_no "Docker-Network 'firebot' entfernen?" "y"; then
            docker network rm firebot &>/dev/null || true
            log_success "Docker-Network 'firebot' entfernt"
        else
            log_info "Docker-Network 'firebot' behalten"
        fi
    fi

    # Legacy: Alte gs-User entfernen (Migration von PTY → Docker)
    echo ""
    GAMESERVER_USERS=$(getent passwd | grep "^gs-" | cut -d: -f1 || true)
    if [[ -n "$GAMESERVER_USERS" ]]; then
        GS_COUNT=$(echo "$GAMESERVER_USERS" | wc -l)
        log_warn "Legacy Gameserver-User (gs-*) gefunden: $GS_COUNT (aus alter PTY-Architektur)"
        if prompt_yes_no "Alte gs-* User entfernen?" "y"; then
            echo "$GAMESERVER_USERS" | while IFS= read -r gs_user; do
                userdel -r "$gs_user" 2>/dev/null || userdel "$gs_user" 2>/dev/null || true
            done
            log_success "Legacy gs-User entfernt"
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
    echo -e "   ${GREEN}✓${NC} Docker-Container & Network behandelt"
    echo -e "   ${GREEN}✓${NC} Installations-Verzeichnis behandelt"
    echo -e "   ${GREEN}✓${NC} Daten-Verzeichnisse behandelt"
    echo -e "   ${GREEN}✓${NC} System-User behandelt"
    echo -e "   ${YELLOW}ℹ${NC}  Docker Engine selbst wurde NICHT deinstalliert"
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
    echo -e "   ${YELLOW}ℹ️  Hinweis:${NC} Der Daemon läuft als root für Docker-Operationen"
    echo -e "   Gameserver laufen als isolierte Docker-Container (kein gs-User mehr)"
    echo -e "   Docker-Network: firebot | Volumes: /var/lib/firebot-daemon/volumes/"
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