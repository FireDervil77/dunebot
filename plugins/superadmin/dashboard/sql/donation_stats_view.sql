-- Statistik-View für Donations
CREATE OR REPLACE VIEW donation_stats AS
SELECT 
    COUNT(DISTINCT user_id) as total_supporters,
    COUNT(*) as total_donations,
    SUM(CASE WHEN payment_status = 'completed' THEN amount ELSE 0 END) as total_amount,
    SUM(CASE WHEN payment_status = 'completed' AND is_recurring = 1 THEN amount ELSE 0 END) as recurring_amount,
    AVG(CASE WHEN payment_status = 'completed' THEN amount END) as average_donation,
    COUNT(CASE WHEN payment_status = 'completed' AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY) THEN 1 END) as donations_last_30_days,
    SUM(CASE WHEN payment_status = 'completed' AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY) THEN amount ELSE 0 END) as amount_last_30_days
FROM donations;