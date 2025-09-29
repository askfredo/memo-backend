import { Request, Response } from 'express';
import { db } from '../db';
import { AIService } from '../services/aiService';

const aiService = new AIService();

export class NotesController {
  async createNote(req: Request, res: Response) {
    try {
      const { content, userId = '00000000-0000-0000-0000-000000000001' } = req.body;

      if (!content || content.trim() === '') {
        return res.status(400).json({ error: 'Content is required' });
      }

      console.log('📝 Procesando nueva nota:', content);

      const classification = await aiService.classifyNote(content);
      console.log('🎯 Clasificación:', classification);

      const noteResult = await db.query(
        `INSERT INTO notes (user_id, content, note_type, hashtags, ai_classification)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [
          userId,
          content,
          classification.intent,
          classification.entities.hashtags,
          JSON.stringify(classification)
        ]
      );

      const note = noteResult.rows[0];

      if (classification.intent === 'calendar_event' && classification.entities.date) {
        const startDatetime = this.buildDateTime(
          classification.entities.date,
          classification.entities.time
        );

        const titleWithEmoji = `${classification.emoji} ${classification.suggestedTitle}`;

        console.log('📅 Creando evento de calendario:', {
          title: titleWithEmoji,
          datetime: startDatetime
        });

        const eventResult = await db.query(
          `INSERT INTO calendar_events (user_id, note_id, title, description, start_datetime, location, color)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING *`,
          [
            userId,
            note.id,
            titleWithEmoji,
            classification.summary,
            startDatetime,
            classification.entities.location,
            'blue'
          ]
        );

        return res.json({
          note,
          event: eventResult.rows[0],
          classification
        });
      }

      return res.json({
        note,
        classification
      });
    } catch (error) {
      console.error('Error creating note:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  async getNotes(req: Request, res: Response) {
    try {
      const userId = req.query.userId || '00000000-0000-0000-0000-000000000001';
      
      // MODIFICADO: Excluir notas que tienen eventos de calendario asociados
      const result = await db.query(
        `SELECT n.* FROM notes n
         LEFT JOIN calendar_events ce ON ce.note_id = n.id
         WHERE n.user_id = $1 AND ce.id IS NULL
         ORDER BY n.created_at DESC`,
        [userId]
      );

      res.json({ notes: result.rows });
    } catch (error) {
      console.error('Error fetching notes:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  async updateNote(req: Request, res: Response) {
    try {
      const { noteId } = req.params;
      const { content, isArchived } = req.body;
      const userId = '00000000-0000-0000-0000-000000000001';

      const updates: string[] = [];
      const values: any[] = [];
      let paramCount = 1;

      if (content !== undefined) {
        updates.push(`content = $${paramCount}`);
        values.push(content);
        paramCount++;
      }

      if (isArchived !== undefined) {
        updates.push(`is_archived = $${paramCount}`);
        values.push(isArchived);
        paramCount++;
      }

      values.push(noteId, userId);

      const result = await db.query(
        `UPDATE notes 
         SET ${updates.join(', ')}
         WHERE id = $${paramCount} AND user_id = $${paramCount + 1}
         RETURNING *`,
        values
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Note not found' });
      }

      res.json({ note: result.rows[0] });
    } catch (error) {
      console.error('Error updating note:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  async deleteNote(req: Request, res: Response) {
    try {
      const { noteId } = req.params;
      const userId = '00000000-0000-0000-0000-000000000001';

      // MODIFICADO: Primero eliminar eventos asociados
      await db.query(
        'DELETE FROM calendar_events WHERE note_id = $1 AND user_id = $2',
        [noteId, userId]
      );

      // Luego eliminar la nota
      const result = await db.query(
        'DELETE FROM notes WHERE id = $1 AND user_id = $2 RETURNING *',
        [noteId, userId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Note not found' });
      }

      res.json({ success: true });
    } catch (error) {
      console.error('Error deleting note:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  async processImageNote(content: string, userId: string) {
    const classification = await aiService.classifyNote(content);

    const noteResult = await db.query(
      `INSERT INTO notes (user_id, content, note_type, hashtags, ai_classification)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [userId, content, classification.intent, classification.entities.hashtags, JSON.stringify(classification)]
    );

    const note = noteResult.rows[0];

    if (classification.intent === 'calendar_event' && classification.entities.date) {
      const startDatetime = this.buildDateTime(
        classification.entities.date,
        classification.entities.time
      );

      const titleWithEmoji = `${classification.emoji} ${classification.suggestedTitle}`;

      const eventResult = await db.query(
        `INSERT INTO calendar_events (user_id, note_id, title, description, start_datetime, location, color)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [
          userId,
          note.id,
          titleWithEmoji,
          classification.summary,
          startDatetime,
          classification.entities.location,
          'blue'
        ]
      );

      return {
        note,
        event: eventResult.rows[0],
        classification
      };
    }

    return { note, classification };
  }

  private buildDateTime(date: string, time: string | null): string {
    if (time) {
      return `${date}T${time}:00`;
    }
    return `${date}T00:00:00`;
  }
}

export const notesController = new NotesController();