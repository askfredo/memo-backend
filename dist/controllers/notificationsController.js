"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.notificationsController = void 0;
const index_1 = require("../db/index");
class NotificationsController {
    async createNotification(req, res) {
        try {
            const { title, message, type = 'info', relatedEntityType, relatedEntityId, userId = '00000000-0000-0000-0000-000000000001' } = req.body;
            if (!title || !message) {
                return res.status(400).json({ error: 'Title and message are required' });
            }
            const result = await index_1.db.query(`INSERT INTO notifications 
         (user_id, title, message, type, related_entity_type, related_entity_id)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`, [userId, title, message, type, relatedEntityType, relatedEntityId]);
            res.json({ notification: result.rows[0] });
        }
        catch (error) {
            console.error('Error creating notification:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }
    async getNotifications(req, res) {
        try {
            const userId = req.query.userId || '00000000-0000-0000-0000-000000000001';
            const unreadOnly = req.query.unreadOnly === 'true';
            let query = 'SELECT * FROM notifications WHERE user_id = $1';
            if (unreadOnly) {
                query += ' AND is_read = false';
            }
            query += ' ORDER BY created_at DESC LIMIT 50';
            const result = await index_1.db.query(query, [userId]);
            res.json({ notifications: result.rows });
        }
        catch (error) {
            console.error('Error fetching notifications:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }
    async markAsRead(req, res) {
        try {
            const { notificationId } = req.params;
            const userId = '00000000-0000-0000-0000-000000000001';
            const result = await index_1.db.query('UPDATE notifications SET is_read = true WHERE id = $1 AND user_id = $2 RETURNING *', [notificationId, userId]);
            if (result.rows.length === 0) {
                return res.status(404).json({ error: 'Notification not found' });
            }
            res.json({ notification: result.rows[0] });
        }
        catch (error) {
            console.error('Error marking notification as read:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }
    async markAllAsRead(req, res) {
        try {
            const userId = '00000000-0000-0000-0000-000000000001';
            await index_1.db.query('UPDATE notifications SET is_read = true WHERE user_id = $1 AND is_read = false', [userId]);
            res.json({ success: true });
        }
        catch (error) {
            console.error('Error marking all as read:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }
    async deleteNotification(req, res) {
        try {
            const { notificationId } = req.params;
            const userId = '00000000-0000-0000-0000-000000000001';
            const result = await index_1.db.query('DELETE FROM notifications WHERE id = $1 AND user_id = $2 RETURNING *', [notificationId, userId]);
            if (result.rows.length === 0) {
                return res.status(404).json({ error: 'Notification not found' });
            }
            res.json({ success: true });
        }
        catch (error) {
            console.error('Error deleting notification:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }
    async getUnreadCount(req, res) {
        try {
            const userId = req.query.userId || '00000000-0000-0000-0000-000000000001';
            const result = await index_1.db.query('SELECT COUNT(*) as count FROM notifications WHERE user_id = $1 AND is_read = false', [userId]);
            res.json({ count: parseInt(result.rows[0].count) });
        }
        catch (error) {
            console.error('Error getting unread count:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }
}
exports.notificationsController = new NotificationsController();
