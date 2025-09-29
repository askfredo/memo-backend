import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { notesController } from './controllers/notesController';
import { db } from './db/index';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: '50mb' }));

const initDB = async () => {
  try {
    const schemaPath = path.join(__dirname, '../schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf8');
    await db.query(schema);
    
    // Agregar columnas que faltan
    await db.query(`
      ALTER TABLE notes ADD COLUMN IF NOT EXISTS image_data TEXT;
      ALTER TABLE notes ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();
    `);
    
    console.log('✅ Schema ejecutado correctamente');
  } catch (error) {
    console.error('❌ Error ejecutando schema:', error);
  }
};

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

db.query('SELECT NOW()')
  .then(() => {
    console.log('✅ Base de datos conectada');
    return initDB();
  })
  .then(() => createTestUser())
  .catch((err: any) => console.error('❌ Error BD:', err));

app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    message: '¡Backend funcionando correctamente!',
    timestamp: new Date().toISOString()
  });
});

app.post('/api/notes', notesController.createNote.bind(notesController));
app.get('/api/notes', notesController.getNotes.bind(notesController));
app.patch('/api/notes/:noteId', notesController.updateNote.bind(notesController));
app.delete('/api/notes/:noteId', notesController.deleteNote.bind(notesController));

app.post('/api/notes/from-image', async (req, res) => {
  try {
    const { imageBase64, userId = '00000000-0000-0000-0000-000000000001' } = req.body;

    if (!imageBase64) {
      return res.status(400).json({ error: 'Image required' });
    }

    const extractedInfo = await analyzeEventImage(imageBase64);
    
    if (extractedInfo.isEvent) {
      const result = await notesController.processImageNote(extractedInfo.text, userId, imageBase64);
      return res.json({ ...result, type: 'event' });
    } else {
      const noteResult = await db.query(
        `INSERT INTO notes (user_id, content, note_type, hashtags, ai_classification, image_data)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [userId, extractedInfo.text, 'simple_note', ['#imagen'], JSON.stringify({ context: 'from_image' }), imageBase64]
      );
      return res.json({ note: noteResult.rows[0], type: 'note' });
    }
  } catch (error) {
    console.error('Error processing image:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

async function analyzeEventImage(imageBase64: string) {
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

app.delete('/api/calendar/events/:eventId', async (req, res) => {
  try {
    const { eventId } = req.params;
    const userId = '00000000-0000-0000-0000-000000000001';
    
    const eventResult = await db.query(
      'SELECT note_id FROM calendar_events WHERE id = $1 AND user_id = $2',
      [eventId, userId]
    );

    if (eventResult.rows.length === 0) {
      return res.status(404).json({ error: 'Event not found' });
    }

    const noteId = eventResult.rows[0].note_id;

    await db.query(
      'DELETE FROM calendar_events WHERE id = $1 AND user_id = $2',
      [eventId, userId]
    );

    if (noteId) {
      await db.query(
        'DELETE FROM notes WHERE id = $1 AND user_id = $2',
        [noteId, userId]
      );
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting event:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
  console.log(`🔍 Prueba: http://localhost:${PORT}/api/health`);
  console.log(`📋 Ver notas: GET http://localhost:${PORT}/api/notes`);
  console.log(`➕ Crear nota: POST http://localhost:${PORT}/api/notes`);
});