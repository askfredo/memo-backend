"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const dotenv_1 = __importDefault(require("dotenv"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const notesController_1 = require("./controllers/notesController");
const passwordVaultController_1 = require("./controllers/passwordVaultController");
const notificationsController_1 = require("./controllers/notificationsController");
const aiChatController_1 = require("./controllers/aiChatController");
const smartAssistantController_1 = require("./controllers/smartAssistantController");
const index_1 = require("./db/index");
dotenv_1.default.config();
const app = (0, express_1.default)();
const PORT = process.env.PORT || 3001;
app.use((0, cors_1.default)());
app.use(express_1.default.json({ limit: '50mb' }));
const initDB = async () => {
    try {
        const schemaPath = path_1.default.join(__dirname, '../schema.sql');
        const schema = fs_1.default.readFileSync(schemaPath, 'utf8');
        await index_1.db.query(schema);
        console.log('✅ Schema ejecutado correctamente');
    }
    catch (error) {
        console.error('❌ Error ejecutando schema:', error);
    }
};
const createTestUser = async () => {
    try {
        await index_1.db.query(`
      INSERT INTO users (id, email, username, full_name) 
      VALUES ('00000000-0000-0000-0000-000000000001', 'test@memovoz.com', 'testuser', 'Usuario de Prueba')
      ON CONFLICT (id) DO NOTHING
    `);
        console.log('✅ Usuario de prueba listo');
    }
    catch (error) {
        console.error('Error creando usuario de prueba:', error);
    }
};
index_1.db.query('SELECT NOW()')
    .then(() => {
    console.log('✅ Base de datos conectada');
    return initDB();
})
    .then(() => createTestUser())
    .catch((err) => console.error('❌ Error BD:', err));
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        message: '¡Backend funcionando correctamente!',
        timestamp: new Date().toISOString()
    });
});
// Rutas de Notas
app.post('/api/notes', notesController_1.notesController.createNote.bind(notesController_1.notesController));
app.get('/api/notes', notesController_1.notesController.getNotes.bind(notesController_1.notesController));
app.patch('/api/notes/:noteId', notesController_1.notesController.updateNote.bind(notesController_1.notesController));
app.delete('/api/notes/:noteId', notesController_1.notesController.deleteNote.bind(notesController_1.notesController));
app.post('/api/notes/from-image', async (req, res) => {
    try {
        const { imageBase64, userId = '00000000-0000-0000-0000-000000000001' } = req.body;
        if (!imageBase64) {
            return res.status(400).json({ error: 'Image required' });
        }
        const extractedInfo = await analyzeEventImage(imageBase64);
        if (extractedInfo.isEvent) {
            const result = await notesController_1.notesController.processImageNote(extractedInfo.text, userId, imageBase64);
            return res.json({ ...result, type: 'event' });
        }
        else {
            const noteResult = await index_1.db.query(`INSERT INTO notes (user_id, content, note_type, hashtags, ai_classification, image_data)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`, [userId, extractedInfo.text, 'simple_note', ['#imagen'], JSON.stringify({ context: 'from_image' }), imageBase64]);
            return res.json({ note: noteResult.rows[0], type: 'note' });
        }
    }
    catch (error) {
        console.error('Error processing image:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
async function analyzeEventImage(imageBase64) {
    const openaiApiKey = process.env.OPENAI_API_KEY;
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${openaiApiKey}`
        },
        body: JSON.stringify({
            model: 'gpt-4o',
            messages: [
                {
                    role: 'system',
                    content: 'Analiza si esta imagen es de un evento (invitación, poster, flyer, screenshot de evento). Si es evento, extrae: fecha, hora, título, ubicación. Si NO es evento, describe brevemente qué muestra la imagen. Responde en JSON: {isEvent: boolean, text: string}'
                },
                {
                    role: 'user',
                    content: [
                        {
                            type: 'image_url',
                            image_url: {
                                url: `data:image/jpeg;base64,${imageBase64}`
                            }
                        }
                    ]
                }
            ],
            max_tokens: 300,
            response_format: { type: "json_object" }
        })
    });
    const data = await response.json();
    return JSON.parse(data.choices[0].message.content);
}
// Rutas de Calendario
app.get('/api/calendar/events', async (req, res) => {
    try {
        const { startDate, endDate } = req.query;
        let query = 'SELECT * FROM calendar_events WHERE user_id = $1';
        const params = ['00000000-0000-0000-0000-000000000001'];
        if (startDate && endDate) {
            query += ' AND start_datetime BETWEEN $2 AND $3';
            params.push(startDate, endDate);
        }
        query += ' ORDER BY start_datetime ASC';
        const result = await index_1.db.query(query, params);
        res.json({ events: result.rows });
    }
    catch (error) {
        console.error('Error fetching events:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
app.delete('/api/calendar/events/:eventId', async (req, res) => {
    try {
        const { eventId } = req.params;
        const userId = '00000000-0000-0000-0000-000000000001';
        const eventResult = await index_1.db.query('SELECT note_id FROM calendar_events WHERE id = $1 AND user_id = $2', [eventId, userId]);
        if (eventResult.rows.length === 0) {
            return res.status(404).json({ error: 'Event not found' });
        }
        const noteId = eventResult.rows[0].note_id;
        await index_1.db.query('DELETE FROM calendar_events WHERE id = $1 AND user_id = $2', [eventId, userId]);
        if (noteId) {
            await index_1.db.query('DELETE FROM notes WHERE id = $1 AND user_id = $2', [noteId, userId]);
        }
        res.json({ success: true });
    }
    catch (error) {
        console.error('Error deleting event:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// Rutas de Password Vault
app.post('/api/vault/passwords', passwordVaultController_1.passwordVaultController.createPassword.bind(passwordVaultController_1.passwordVaultController));
app.get('/api/vault/passwords', passwordVaultController_1.passwordVaultController.getPasswords.bind(passwordVaultController_1.passwordVaultController));
app.get('/api/vault/passwords/:passwordId', passwordVaultController_1.passwordVaultController.getPassword.bind(passwordVaultController_1.passwordVaultController));
app.patch('/api/vault/passwords/:passwordId', passwordVaultController_1.passwordVaultController.updatePassword.bind(passwordVaultController_1.passwordVaultController));
app.delete('/api/vault/passwords/:passwordId', passwordVaultController_1.passwordVaultController.deletePassword.bind(passwordVaultController_1.passwordVaultController));
// Rutas de Notificaciones
app.post('/api/notifications', notificationsController_1.notificationsController.createNotification.bind(notificationsController_1.notificationsController));
app.get('/api/notifications', notificationsController_1.notificationsController.getNotifications.bind(notificationsController_1.notificationsController));
app.get('/api/notifications/unread-count', notificationsController_1.notificationsController.getUnreadCount.bind(notificationsController_1.notificationsController));
app.patch('/api/notifications/:notificationId/read', notificationsController_1.notificationsController.markAsRead.bind(notificationsController_1.notificationsController));
app.patch('/api/notifications/mark-all-read', notificationsController_1.notificationsController.markAllAsRead.bind(notificationsController_1.notificationsController));
app.delete('/api/notifications/:notificationId', notificationsController_1.notificationsController.deleteNotification.bind(notificationsController_1.notificationsController));
// Rutas de AI Chat
app.post('/api/ai/chat', aiChatController_1.aiChatController.chat.bind(aiChatController_1.aiChatController));
app.post('/api/ai/save-conversation', aiChatController_1.aiChatController.saveConversation.bind(aiChatController_1.aiChatController));
// Ruta de Smart Assistant (Voz inteligente)
app.post('/api/assistant/process', smartAssistantController_1.smartAssistantController.processVoiceInput.bind(smartAssistantController_1.smartAssistantController));
app.listen(PORT, () => {
    console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
    console.log(`🏥 Prueba: http://localhost:${PORT}/api/health`);
    console.log(`📋 Ver notas: GET http://localhost:${PORT}/api/notes`);
    console.log(`🔐 Vault: GET http://localhost:${PORT}/api/vault/passwords`);
    console.log(`🔔 Notificaciones: GET http://localhost:${PORT}/api/notifications`);
    console.log(`🤖 AI Chat: POST http://localhost:${PORT}/api/ai/chat`);
    console.log(`🎤 Smart Assistant: POST http://localhost:${PORT}/api/assistant/process`);
});
