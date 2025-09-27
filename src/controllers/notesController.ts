import { Request, Response } from 'express';
import { aiService } from '../services/aiService';
import { db } from '../db';

export class NotesController {
  async createNote(req: Request, res: Response) {
    try {
      const { content, userId } = req.body;

      if (!content) {
        return res.status(400).json({ error: 'Contenido requerido' });
      }

      console.log('🤖 Clasificando nota con IA...');
      const classification = await aiService.classifyNote(content);
      console.log('✅ Clasificación:', classification);

      const noteResult = await db.query(
        `INSERT INTO notes (user_id, content, note_type, hashtags, ai_classification)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [
          userId || '00000000-0000-0000-0000-000000000001',
          content,
          classification.intent === 'simple_note' ? 'simple' : 'reminder',
          classification.entities.hashtags || [],
          JSON.stringify(classification)
        ]
      );

      const note = noteResult.rows[0];

      if (
        classification.intent === 'calendar_event' || 
        classification.intent === 'social_event' ||
        classification.intent === 'reminder'
      ) {
        let eventDate = new Date();

        if (classification.entities.date) {
          if (classification.entities.time) {
            eventDate = new Date(`${classification.entities.date}T${classification.entities.time}`);
          } else {
            eventDate = new Date(`${classification.entities.date}T09:00:00`);
          }
        }

        const eventResult = await db.query(
          `INSERT INTO calendar_events (user_id, note_id, title, description, start_datetime, is_social, location)
           VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
          [
            userId || '00000000-0000-0000-0000-000000000001',
            note.id,
            `${classification.emoji || '📝'} ${classification.suggestedTitle || content.substring(0, 100)}`,
            content,
            eventDate,
            classification.intent === 'social_event',
            classification.entities.location
          ]
        );

        return res.json({
          success: true,
          note,
          event: eventResult.rows[0],
          classification
        });
      }

      return res.json({
        success: true,
        note,
        classification
      });

    } catch (error) {
      console.error('Error:', error);
      return res.status(500).json({ error: 'Error al crear nota' });
    }
  }

  async getNotes(req: Request, res: Response) {
    try {
      const result = await db.query(
        `SELECT n.* FROM notes n
         LEFT JOIN calendar_events e ON e.note_id = n.id
         WHERE e.id IS NULL
         ORDER BY n.created_at DESC LIMIT 50`
      );
      res.json({ notes: result.rows });
    } catch (error) {
      console.error('Error:', error);
      res.status(500).json({ error: 'Error al obtener notas' });
    }
  }

  async updateNote(req: Request, res: Response) {
    try {
      const userId = '00000000-0000-0000-0000-000000000001';
      const { noteId } = req.params;
      const { isFavorite, hashtags, content } = req.body;

      const updates: string[] = [];
      const params: any[] = [];
      let paramCount = 1;

      if (isFavorite !== undefined) {
        updates.push(`is_favorite = $${paramCount}`);
        params.push(isFavorite);
        paramCount++;
      }

      if (hashtags) {
        updates.push(`hashtags = $${paramCount}`);
        params.push(hashtags);
        paramCount++;
      }

      if (content) {
        updates.push(`content = $${paramCount}`);
        params.push(content);
        paramCount++;
      }

      if (updates.length === 0) {
        return res.status(400).json({ error: 'No updates provided' });
      }

      params.push(noteId, userId);

      const query = `
        UPDATE notes 
        SET ${updates.join(', ')}
        WHERE id = $${paramCount} AND user_id = $${paramCount + 1}
        RETURNING *
      `;

      const result = await db.query(query, params);

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Note not found' });
      }

      return res.json({ note: result.rows[0] });
    } catch (error) {
      console.error('Error updating note:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  async deleteNote(req: Request, res: Response) {
    try {
      const userId = '00000000-0000-0000-0000-000000000001';
      const { noteId } = req.params;

      await db.query(
        `DELETE FROM calendar_events WHERE note_id = $1`,
        [noteId]
      );

      const result = await db.query(
        `DELETE FROM notes WHERE id = $1 AND user_id = $2 RETURNING id`,
        [noteId, userId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Note not found' });
      }

      return res.json({ message: 'Note deleted successfully' });
    } catch (error) {
      console.error('Error deleting note:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
}

export const notesController = new NotesController();