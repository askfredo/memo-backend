import { Request, Response } from 'express';
import { db } from '../db';
import { AIService } from '../services/aiService';

export class NotesController {
  private aiService: AIService;

  constructor() {
    this.aiService = new AIService();
  }

  async createNote(req: Request, res: Response) {
    try {
      const { content, userId = '00000000-0000-0000-0000-000000000001' } = req.body;

      const classification = await this.aiService.classifyNote(content);

      const noteResult = await db.query(
        `INSERT INTO notes (user_id, content, note_type, hashtags, ai_classification)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [
          userId,
          content,
          classification.intent,
          classification.entities.hashtags || [],
          JSON.stringify(classification)
        ]
      );

      const note = noteResult.rows[0];

      if (classification.intent === 'calendar_event' || classification.intent === 'reminder') {
        let startDateTime: Date;
        if (classification.entities.date) {
          startDateTime = new Date(classification.entities.date);
          
          if (classification.entities.time) {
            const [hours, minutes] = classification.entities.time.split(':');
            startDateTime.setHours(parseInt(hours), parseInt(minutes), 0, 0);
          } else {
            startDateTime.setHours(0, 0, 0, 0);
          }
        } else {
          startDateTime = new Date();
          startDateTime.setDate(startDateTime.getDate() + 1);
          startDateTime.setHours(9, 0, 0, 0);
        }

        const eventResult = await db.query(
          `INSERT INTO calendar_events 
           (user_id, note_id, title, description, start_datetime, location, is_social)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING *`,
          [
            userId,
            note.id,
            classification.suggestedTitle,
            content,
            startDateTime.toISOString(),
            classification.entities.location || null,
            (classification.entities.participants?.length || 0) > 0
          ]
        );

        return res.json({
          note,
          event: eventResult.rows[0],
          classification
        });
      }

      res.json({ note, classification });
    } catch (error) {
      console.error('Error creating note:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  async processImageNote(extractedText: string, userId: string) {
    const classification = await this.aiService.classifyNote(extractedText);

    const noteResult = await db.query(
      `INSERT INTO notes (user_id, content, note_type, hashtags, ai_classification)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [userId, extractedText, classification.intent, classification.entities.hashtags || [], JSON.stringify(classification)]
    );

    const note = noteResult.rows[0];

    if (classification.intent === 'calendar_event' || classification.intent === 'reminder') {
      let startDateTime: Date;
      if (classification.entities.date) {
        startDateTime = new Date(classification.entities.date);
        if (classification.entities.time) {
          const [hours, minutes] = classification.entities.time.split(':');
          startDateTime.setHours(parseInt(hours), parseInt(minutes), 0, 0);
        } else {
          startDateTime.setHours(0, 0, 0, 0);
        }
      } else {
        startDateTime = new Date();
        startDateTime.setDate(startDateTime.getDate() + 1);
        startDateTime.setHours(9, 0, 0, 0);
      }

      const eventResult = await db.query(
        `INSERT INTO calendar_events 
         (user_id, note_id, title, description, start_datetime, location, is_social)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [userId, note.id, classification.suggestedTitle, extractedText, startDateTime.toISOString(), 
         classification.entities.location || null, (classification.entities.participants?.length || 0) > 0]
      );

      return { note, event: eventResult.rows[0], classification };
    }

    return { note, classification };
  }

  async getNotes(req: Request, res: Response) {
    try {
      const userId = '00000000-0000-0000-0000-000000000001';
      
      const result = await db.query(
        `SELECT n.* FROM notes n
         WHERE n.user_id = $1 
         AND NOT EXISTS (
           SELECT 1 FROM calendar_events ce 
           WHERE ce.note_id = n.id
         )
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
      const { isFavorite, hashtags, content } = req.body;
      const userId = '00000000-0000-0000-0000-000000000001';

      const updates: string[] = [];
      const values: any[] = [];
      let paramCount = 1;

      if (isFavorite !== undefined) {
        updates.push(`is_favorite = $${paramCount}`);
        values.push(isFavorite);
        paramCount++;
      }

      if (hashtags !== undefined) {
        updates.push(`hashtags = $${paramCount}`);
        values.push(hashtags);
        paramCount++;
      }

      if (content !== undefined) {
        updates.push(`content = $${paramCount}`);
        values.push(content);
        paramCount++;
      }

      if (updates.length === 0) {
        return res.status(400).json({ error: 'No updates provided' });
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
}

export const notesController = new NotesController();