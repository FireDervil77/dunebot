/**
 * MySQL-Tabellendefinition für NavItem
 * @author firedervil
 * @returns {string} SQL CREATE TABLE Statement
 */
module.exports = () => {
  return `
    CREATE TABLE IF NOT EXISTS nav_items (
      _id int(11) NOT NULL,
      plugin varchar(255) DEFAULT NULL COMMENT 'Name des Plugins, das diesen Eintrag registriert hat',
      guildId varchar(255) DEFAULT NULL COMMENT 'ID der Guild, zu der dieser Navigationseintrag gehört',
      title varchar(255) DEFAULT NULL COMMENT 'Anzeigename des Menüpunkts',
      url varchar(255) DEFAULT NULL COMMENT 'URL oder Pfad für den Menüpunkt',
      icon varchar(255) DEFAULT 'fa-puzzle-piece' COMMENT 'Font Awesome Icon-Klasse',
      order int(11) DEFAULT 50 COMMENT 'Reihenfolge des Menüpunkts (niedrigere Werte erscheinen zuerst)',
      parent varchar(255) DEFAULT NULL COMMENT 'URL des übergeordneten Menüpunkts für Untermenüs oder null für Hauptmenüpunkte',
      type varchar(255) NOT NULL DEFAULT 'main' COMMENT 'Art des Menüs: main, settings, plugin, widget, metabox',
      capability varchar(255) DEFAULT 'manage_guild' COMMENT 'Erforderliche Berechtigung für den Zugriff auf diesen Menüpunkt',
      target varchar(255) DEFAULT '_self' COMMENT 'Ziel für Links: _self, _blank, _parent, _top',
      visible tinyint(1) DEFAULT 1 COMMENT 'Gibt an, ob der Menüpunkt sichtbar ist',
      classes varchar(255) DEFAULT '' COMMENT 'Zusätzliche CSS-Klassen für den Menüpunkt',
      position varchar(255) DEFAULT 'normal' COMMENT 'Position für Metaboxen: normal, side, advanced',
      meta longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL,
      createdAt datetime NOT NULL,
      updatedAt datetime NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `;

  
};