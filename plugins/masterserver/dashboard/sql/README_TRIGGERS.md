# Quota Triggers - Manuelle Installation

## ⚠️ Problem

MySQL/MariaDB Triggers können **NICHT** über mysql2 (Node.js) automatisch installiert werden, da:
- `CREATE TRIGGER` Multi-Statement-Support benötigt
- mysql2 führt Dateien als Single-Query aus
- `DELIMITER` funktioniert nicht in mysql2

## 🔧 Lösung: Manuelle Installation

Die Triggers müssen einmalig via MySQL CLI installiert werden:

### 1. MySQL CLI öffnen

```bash
mysql -u root -p dunebot_dev
```

### 2. Triggers installieren

**RootServer-Quota-Trigger:**

```sql
DROP TRIGGER IF EXISTS rootserver_quotas_after_update;

DELIMITER $$

CREATE TRIGGER rootserver_quotas_after_update
AFTER UPDATE ON rootserver_quotas
FOR EACH ROW
BEGIN
    -- RAM geändert?
    IF OLD.custom_ram_mb != NEW.custom_ram_mb OR (OLD.custom_ram_mb IS NULL AND NEW.custom_ram_mb IS NOT NULL) THEN
        INSERT INTO quota_history (entity_type, entity_id, field_name, old_value, new_value)
        VALUES ('rootserver', NEW.rootserver_id, 'custom_ram_mb', OLD.custom_ram_mb, NEW.custom_ram_mb);
    END IF;
    
    -- CPU geändert?
    IF OLD.custom_cpu_cores != NEW.custom_cpu_cores OR (OLD.custom_cpu_cores IS NULL AND NEW.custom_cpu_cores IS NOT NULL) THEN
        INSERT INTO quota_history (entity_type, entity_id, field_name, old_value, new_value)
        VALUES ('rootserver', NEW.rootserver_id, 'custom_cpu_cores', OLD.custom_cpu_cores, NEW.custom_cpu_cores);
    END IF;
    
    -- Disk geändert?
    IF OLD.custom_disk_gb != NEW.custom_disk_gb OR (OLD.custom_disk_gb IS NULL AND NEW.custom_disk_gb IS NOT NULL) THEN
        INSERT INTO quota_history (entity_type, entity_id, field_name, old_value, new_value)
        VALUES ('rootserver', NEW.rootserver_id, 'custom_disk_gb', OLD.custom_disk_gb, NEW.custom_disk_gb);
    END IF;
    
    -- Profil geändert?
    IF OLD.profile_id != NEW.profile_id OR (OLD.profile_id IS NULL AND NEW.profile_id IS NOT NULL) THEN
        INSERT INTO quota_history (entity_type, entity_id, field_name, old_value, new_value)
        VALUES ('rootserver', NEW.rootserver_id, 'profile_id', OLD.profile_id, NEW.profile_id);
    END IF;
END$$

DELIMITER ;
```

**Gameserver-Quota-Trigger:**

```sql
DROP TRIGGER IF EXISTS gameserver_quotas_after_update;

DELIMITER $$

CREATE TRIGGER gameserver_quotas_after_update
AFTER UPDATE ON gameserver_quotas
FOR EACH ROW
BEGIN
    -- RAM geändert?
    IF OLD.allocated_ram_mb != NEW.allocated_ram_mb THEN
        INSERT INTO quota_history (entity_type, entity_id, field_name, old_value, new_value)
        VALUES ('gameserver', NEW.gameserver_id, 'allocated_ram_mb', OLD.allocated_ram_mb, NEW.allocated_ram_mb);
    END IF;
    
    -- CPU geändert?
    IF OLD.allocated_cpu_cores != NEW.allocated_cpu_cores THEN
        INSERT INTO quota_history (entity_type, entity_id, field_name, old_value, new_value)
        VALUES ('gameserver', NEW.gameserver_id, 'allocated_cpu_cores', OLD.allocated_cpu_cores, NEW.allocated_cpu_cores);
    END IF;
    
    -- Disk geändert?
    IF OLD.allocated_disk_gb != NEW.allocated_disk_gb THEN
        INSERT INTO quota_history (entity_type, entity_id, field_name, old_value, new_value)
        VALUES ('gameserver', NEW.gameserver_id, 'allocated_disk_gb', OLD.allocated_disk_gb, NEW.allocated_disk_gb);
    END IF;
END$$

DELIMITER ;
```

### 3. Triggers prüfen

```sql
SHOW TRIGGERS LIKE 'rootserver_quotas';
SHOW TRIGGERS LIKE 'gameserver_quotas';
```

## ✅ Ergebnis

Nach Installation loggen die Triggers automatisch alle Quota-Änderungen in die `quota_history`-Tabelle.

**Logs prüfen:**

```sql
SELECT * FROM quota_history ORDER BY changed_at DESC LIMIT 10;
```

## 🔄 Alternative: Trigger via Script installieren

**Shell-Script erstellen:**

```bash
#!/bin/bash
# install-quota-triggers.sh

MYSQL_USER="root"
MYSQL_PASS="dein_passwort"
MYSQL_DB="dunebot_dev"

mysql -u $MYSQL_USER -p$MYSQL_PASS $MYSQL_DB < quota_trigger_rootserver.sql.disabled
mysql -u $MYSQL_USER -p$MYSQL_PASS $MYSQL_DB < quota_trigger_gameserver.sql.disabled

echo "✅ Triggers installiert!"
```

**Ausführbar machen:**

```bash
chmod +x install-quota-triggers.sh
./install-quota-triggers.sh
```

## 📝 Hinweise

- ⚠️ Triggers werden **NICHT** automatisch beim Plugin-Enable installiert
- ⚠️ Du musst sie **nach jedem DB-Reset** neu installieren
- ✅ Triggers sind **optional** - das System funktioniert auch ohne sie
- ✅ Mit Triggers: Vollständige Audit-History aller Quota-Änderungen
- ✅ Ohne Triggers: Quota-System funktioniert, aber keine automatische History

## 🔮 Zukünftige Verbesserung

Mögliche Lösung: **Trigger-Installation über separates Node.js-Script** mit `multipleStatements: true`:

```javascript
// scripts/install-triggers.js
const mysql = require('mysql2/promise');

const connection = await mysql.createConnection({
    host: process.env.MYSQL_HOST,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
    multipleStatements: true // WICHTIG!
});

const triggerSQL = fs.readFileSync('./quota_trigger_rootserver.sql.disabled', 'utf-8');
await connection.query(triggerSQL);

console.log('✅ Triggers installiert!');
```

**Problem:** `multipleStatements: true` ist ein **Security-Risiko** und sollte nicht in der Haupt-DB-Connection aktiviert werden!
