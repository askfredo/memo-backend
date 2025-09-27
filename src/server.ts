import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { notesController } from './controllers/notesController';
import { db } from './db';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Función para inicializar la base de datos con el schema
const initDB = async () => {
  try {
    const schemaPath = path.join(__dirname, '../schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf8');
    await db.query(schema);
    console.log('✅ Schema ejecutado correctamente');
  } catch (error) {
    console.error('❌ Error ejecutando schema:', error);
  }
};

// Probar conexión a BD y ejecutar schema al iniciar
db.query('SELECT NOW()')
  .then(() => {
    console.log('✅ Base de datos conectada');
    return initDB();
  })
  .catch((err: any) => console.error('❌ Error BD:', err));

// Rutas básicas
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    message: '¡Backend funcionando correctamente!',
    timestamp: new Date().toISOString()
  });
});

// Rutas de notas
app.post('/api/notes', notesController.createNote.bind(notesController));
app.get('/api/notes', notesController.getNotes.bind(notesController));
app.patch('/api/notes/:noteId', notesController.updateNote.bind(notesController));
app.delete('/api/notes/:noteId', notesController.deleteNote.bind(notesController));

// Rutas de calendario
app.get('/api/calendar/events', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    let query = 'SELECT * FROM calendar_events WHERE user_id = $1';
    const params: any[] = ['00000000-0000-0000-0000-000000000001'];

    if (startDate && endDate) {
      query += ' AND start_datetime BETWEEN $2 AND $3';
      params.push(startDate, endDate);
    }

    query += ' ORDER BY start_datetime ASC';

    const result = await db.query(query, params);
    res.json({ events: result.rows });
  } catch (error) {
    console.error('Error fetching events:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Rutas de amigos
app.get('/api/friends', async (req, res) => {
  try {
    const userId = '00000000-0000-0000-0000-000000000001';
    
    const result = await db.query(
      `SELECT u.id, u.username, u.full_name, u.profile_picture_url,
              f.status, f.created_at
       FROM friendships f
       JOIN users u ON u.id = f.friend_id
       WHERE f.user_id = $1
       ORDER BY f.created_at DESC`,
      [userId]
    );

    res.json({ friends: result.rows });
  } catch (error) {
    console.error('Error fetching friends:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Rutas de invitaciones
app.get('/api/invitations', async (req, res) => {
  try {
    const userId = '00000000-0000-0000-0000-000000000001';

    const result = await db.query(
      `SELECT i.*, e.title as event_title, e.start_datetime,
              u.full_name as invited_by_name
       FROM event_invitations i
       JOIN calendar_events e ON e.id = i.event_id
       JOIN users u ON u.id = i.invited_by
       WHERE i.invited_user_id = $1 AND i.status = 'pending'
       ORDER BY i.created_at DESC`,
      [userId]
    );

    res.json({ invitations: result.rows });
  } catch (error) {
    console.error('Error fetching invitations:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.patch('/api/invitations/:invitationId/respond', async (req, res) => {
  try {
    const userId = '00000000-0000-0000-0000-000000000001';
    const { invitationId } = req.params;
    const { status, message } = req.body;

    const result = await db.query(
      `UPDATE event_invitations 
       SET status = $1, response_message = $2, responded_at = CURRENT_TIMESTAMP
       WHERE id = $3 AND invited_user_id = $4
       RETURNING *`,
      [status, message, invitationId, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Invitation not found' });
    }

    res.json({ invitation: result.rows[0] });
  } catch (error) {
    console.error('Error responding to invitation:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Rutas de perfil de usuario
app.get('/api/user/profile', async (req, res) => {
  try {
    const userId = '00000000-0000-0000-0000-000000000001';
    
    const result = await db.query(
      'SELECT id, email, username, full_name, profile_picture_url, user_profile, preferences FROM users WHERE id = $1',
      [userId]
    );

    res.json({ user: result.rows[0] });
  } catch (error) {
    console.error('Error fetching profile:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.patch('/api/user/profile', async (req, res) => {
  try {
    const userId = '00000000-0000-0000-0000-000000000001';
    const { userProfile, preferences } = req.body;

    const result = await db.query(
      `UPDATE users 
       SET user_profile = $1, preferences = $2, updated_at = CURRENT_TIMESTAMP
       WHERE id = $3
       RETURNING *`,
      [userProfile, preferences, userId]
    );

    res.json({ user: result.rows[0] });
  } catch (error) {
    console.error('Error updating profile:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
  console.log(`📝 Prueba: http://localhost:${PORT}/api/health`);
  console.log(`📋 Ver notas: GET http://localhost:${PORT}/api/notes`);
  console.log(`➕ Crear nota: POST http://localhost:${PORT}/api/notes`);
});