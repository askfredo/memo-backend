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

// Crear usuario de prueba si no existe
const createTestUser = async () => {
  try {
    await db.query(`
      INSERT INTO users (id, email, username, full_name) 
      VALUES ('00000000-0000-0000-0000-000000000001', 'test@memovoz.com', 'testuser', 'Usuario de Prueba')
      ON CONFLICT (id) DO NOTHING
    `);
    console.log('✅ Usuario de prueba listo');
  } catch (error) {
    console.error('Error creando usuario de prueba:', error);
  }
};

// Probar conexión a BD y ejecutar schema al iniciar
db.query('SELECT NOW()')
  .then(() => {
    console.log('✅ Base de datos conectada');
    return initDB();
  })
  .then(() => createTestUser())
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

// Eliminar evento
app.delete('/api/calendar/events/:eventId', async (req, res) => {
  try {
    const { eventId } = req.params;
    const userId = '00000000-0000-0000-0000-000000000001';
    
    const result = await db.query(
      'DELETE FROM calendar_events WHERE id = $1 AND user_id = $2 RETURNING *',
      [eventId, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Event not found' });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting event:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
  console.log(`📝 Prueba: http://localhost:${PORT}/api/health`);
  console.log(`📋 Ver notas: GET http://localhost:${PORT}/api/notes`);
  console.log(`➕ Crear nota: POST http://localhost:${PORT}/api/notes`);
});