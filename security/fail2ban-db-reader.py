#!/usr/bin/env python3
"""
Fail2ban Filter: DuneBot Database Blocked IPs

Liest blocked_ips aus der MySQL-Datenbank und gibt sie als Fail2ban-Log aus
Fail2ban parsed dieses "Log" und erstellt iptables-Regeln

Installation:
  1. In /etc/fail2ban/filter.d/ kopieren
  2. Jail konfigurieren (siehe fail2ban-jail-dunebot-db.conf)
  3. MySQL-Python-Modul installieren: apt install python3-pymysql

Autor: FireBot Team
"""

import sys
import time
import os

try:
    import pymysql
except ImportError:
    print("ERROR: pymysql module not installed!", file=sys.stderr)
    print("Install: sudo apt install python3-pymysql", file=sys.stderr)
    sys.exit(1)

# Konfiguration (aus Environment oder Defaults)
DB_HOST = os.getenv('MYSQL_HOST', 'localhost')
DB_PORT = int(os.getenv('MYSQL_PORT', 3306))
DB_USER = os.getenv('MYSQL_USER', 'firedervil')
DB_PASS = os.getenv('MYSQL_PASSWORD', 'D3l$br@ck$')
DB_NAME = os.getenv('MYSQL_DATABASE', 'dunebot_dev')

def get_blocked_ips():
    """Liest alle aktiven blocked_ips aus der Datenbank"""
    try:
        connection = pymysql.connect(
            host=DB_HOST,
            port=DB_PORT,
            user=DB_USER,
            password=DB_PASS,
            database=DB_NAME,
            cursorclass=pymysql.cursors.DictCursor
        )
        
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT ip, reason, blocked_at FROM blocked_ips WHERE is_whitelisted = 0"
            )
            return cursor.fetchall()
    
    except Exception as e:
        print(f"ERROR: Database connection failed: {e}", file=sys.stderr)
        return []
    
    finally:
        if 'connection' in locals():
            connection.close()

def main():
    """Gibt geblockte IPs im Fail2ban-Log-Format aus"""
    blocked_ips = get_blocked_ips()
    
    if not blocked_ips:
        print("No blocked IPs in database", file=sys.stderr)
        return
    
    # Fail2ban erwartet Log-Zeilen im Format:
    # TIMESTAMP HOST MESSAGE
    # Wir simulieren Apache-Access-Log-Einträge
    for entry in blocked_ips:
        ip = entry['ip']
        reason = entry.get('reason', 'Unknown')
        timestamp = entry.get('blocked_at', 'unknown')
        
        # Simuliere Apache-Log-Zeile (damit Fail2ban es erkennt)
        # Format: IP - - [TIMESTAMP] "REQUEST" STATUS SIZE "REFERER" "USER-AGENT"
        log_line = f'{ip} - - [{timestamp}] "GET /exploit.php HTTP/1.1" 403 0 "-" "DuneBot-DB-Block: {reason}"'
        print(log_line)
        sys.stdout.flush()

if __name__ == '__main__':
    main()
