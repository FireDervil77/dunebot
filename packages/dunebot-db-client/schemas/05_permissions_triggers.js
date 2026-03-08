/**
 * Kern-Schema: Permissions-System Triggers
 * 
 * Hält member_count in guild_groups automatisch aktuell.
 * Nutzt rawQuery() statt query() da TRIGGER-Statements keine
 * prepared statements unterstützen (MySQL-Protokoll-Limitation).
 * 
 * @param {import('../lib/DBService')} dbService
 */
module.exports = async (dbService) => {
    // Trigger: Increment member_count wenn User zu Gruppe hinzugefügt wird
    await dbService.rawQuery('DROP TRIGGER IF EXISTS trg_group_member_added');
    await dbService.rawQuery(`
        CREATE TRIGGER trg_group_member_added
        AFTER INSERT ON guild_user_groups
        FOR EACH ROW
        BEGIN
            UPDATE guild_groups SET member_count = member_count + 1 WHERE id = NEW.group_id;
        END
    `);

    // Trigger: Decrement member_count wenn User aus Gruppe entfernt wird
    await dbService.rawQuery('DROP TRIGGER IF EXISTS trg_group_member_removed');
    await dbService.rawQuery(`
        CREATE TRIGGER trg_group_member_removed
        AFTER DELETE ON guild_user_groups
        FOR EACH ROW
        BEGIN
            UPDATE guild_groups SET member_count = member_count - 1 WHERE id = OLD.group_id;
        END
    `);
};
