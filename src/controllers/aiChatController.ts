import { Request, Response } from 'express';
import { db } from '../db/index';
import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '');

class AIChatController {
  async chat(req: Request, res: Response) {
    try {
      const { message, userId = '00000000-0000-0000-0000-000000000001' } = req.body;

      if (!message || message.trim() === '') {
        return res.status(400).json({ error: 'Message is required' });
      }

      // Obtener contexto del usuario
      const context = await this.getUserContext(userId);

      // Generar respuesta con Gemini
      const aiResponse = await this.generateResponse(message, context);

      res.json({ 
        response: aiResponse,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Error en chat:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  async saveConversation(req: Request, res: Response) {
    try {
      const { conversation, userId = '00000000-0000-0000-0000-000000000001' } = req.body;

      if (!conversation || !Array.isArray(conversation)) {
        return res.status(400).json({ error: 'Conversation array is required' });
      }

      // Formatear conversación
      const formattedConversation = conversation
        .map(msg => `${msg.sender === 'user' ? 'Yo' : 'AI'}: ${msg.text}`)
        .join('\n\n');

      const title = `Conversación con AI - ${new Date().toLocaleDateString('es-ES')}`;
      const content = `${title}\n\n${formattedConversation}`;

      // Guardar como nota
      const result = await db.query(
        `INSERT INTO notes (user_id, content, note_type, hashtags, ai_classification)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [userId, content, 'simple_note', ['#conversacion', '#ai'], JSON.stringify({ type: 'ai_conversation' })]
      );

      res.json({ note: result.rows[0] });
    } catch (error) {
      console.error('Error guardando conversación:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  private async getUserContext(userId: string): Promise<string> {
    try {
      const now = new Date();
      const weekFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

      // Obtener eventos de esta semana
      const eventsResult = await db.query(
        `SELECT title, description, start_datetime, location 
         FROM calendar_events 
         WHERE user_id = $1 AND start_datetime BETWEEN $2 AND $3
         ORDER BY start_datetime ASC
         LIMIT 10`,
        [userId, now.toISOString(), weekFromNow.toISOString()]
      );

      // Obtener notas recientes (últimas 10)
      const notesResult = await db.query(
        `SELECT content, hashtags, created_at 
         FROM notes 
         WHERE user_id = $1 AND NOT hashtags && ARRAY['#secreto']
         ORDER BY created_at DESC
         LIMIT 10`,
        [userId]
      );

      // Formatear contexto
      let context = 'INFORMACIÓN DEL USUARIO:\n\n';

      if (eventsResult.rows.length > 0) {
        context += 'EVENTOS PRÓXIMOS:\n';
        eventsResult.rows.forEach(event => {
          const date = new Date(event.start_datetime).toLocaleDateString('es-ES', { 
            weekday: 'long', 
            day: 'numeric', 
            month: 'long',
            hour: '2-digit',
            minute: '2-digit'
          });
          context += `- ${event.title} (${date})`;
          if (event.location) context += ` en ${event.location}`;
          context += '\n';
        });
        context += '\n';
      }

      if (notesResult.rows.length > 0) {
        context += 'NOTAS Y TAREAS RECIENTES:\n';
        notesResult.rows.forEach(note => {
          const preview = note.content.substring(0, 100);
          context += `- ${preview}${note.content.length > 100 ? '...' : ''}\n`;
        });
        context += '\n';
      }

      return context;
    } catch (error) {
      console.error('Error obteniendo contexto:', error);
      return '';
    }
  }

  private async generateResponse(message: string, context: string): Promise<string> {
    try {
      const model = genAI.getGenerativeModel({ 
        model: 'gemini 2.5-flash-lite',
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 500,
        }
      });

      const prompt = `Eres un asistente personal inteligente y amigable. Responde de forma CONCISA y DIRECTA (máximo 2-3 oraciones).

${context}

Pregunta del usuario: ${message}

Instrucciones:
- Si el usuario pregunta por eventos, tareas o información personal, usa el contexto provisto
- Si no tienes la información, dilo claramente
- Sé amigable pero breve
- No uses emojis excesivamente
- Si el contexto está vacío, menciona que no tienes información registrada

Respuesta:`;

      const result = await model.generateContent(prompt);
      const response = result.response;
      return response.text();
    } catch (error) {
      console.error('Error generando respuesta:', error);
      return 'Lo siento, tuve un problema al procesar tu mensaje. ¿Podrías intentarlo de nuevo?';
    }
  }
}

export const aiChatController = new AIChatController();