/**
 * Kern-Schema: Donation Stats View
 * 
 * Aggregierte Statistiken über alle Donations.
 * Verschoben aus SuperAdmin Plugin → Kern-Schema.
 * 
 * @param {import('../lib/DBService')} dbService
 */
module.exports = async (dbService) => {
    await dbService.rawQuery(`
        CREATE OR REPLACE VIEW donation_stats AS
        SELECT
            COUNT(DISTINCT user_id) AS total_supporters,
            COUNT(*) AS total_donations,
            SUM(CASE WHEN payment_status = 'completed' THEN amount ELSE 0 END) AS total_amount,
            SUM(CASE WHEN payment_status = 'completed' AND is_recurring = 1 THEN amount ELSE 0 END) AS recurring_amount,
            AVG(CASE WHEN payment_status = 'completed' THEN amount END) AS average_donation,
            COUNT(CASE WHEN payment_status = 'completed' AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY) THEN 1 END) AS donations_last_30_days,
            SUM(CASE WHEN payment_status = 'completed' AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY) THEN amount ELSE 0 END) AS amount_last_30_days
        FROM donations
    `);
};
