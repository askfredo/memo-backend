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

      console.log('📨 Mensaje recibido:', message);

      // Obtener contexto del usuario
      console.log('🔍 Obteniendo contexto...');
      const context = await this.getUserContext(userId);
      console.log('📋 Contexto obtenido:', context.substring(0, 200));

      // Generar respuesta con Gemini
      console.log('🤖 Generando respuesta...');
      const aiResponse = await this.generateResponse(message, context);
      console.log('✅ Respuesta generada:', aiResponse);

      res.json({ 
        response: aiResponse,
        timestamp: new Date().toISOString()
      });
    } catch (error: any) {
      console.error('❌ Error detallado en chat:', error);
      console.error('Stack:', error.stack);
      res.status(500).json({ 
        error: 'Internal server error',
        details: error.message 
      });
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
        model: 'gemini-2.5-flash-lite',
        generationConfig: {
          temperature: 0.8,
          maxOutputTokens: 500,
        }
      });

      // Detectar si la pregunta es sobre agenda/eventos/tareas
      const isAgendaRelated = /eventos?|tareas?|pendientes?|notas?|calendario|reuniones?|citas?|agenda|tengo|hacer|lista|próximos?|semana|hoy|mañana/i.test(message);

      let prompt = '';
      
      if (isAgendaRelated && context.includes('EVENTOS') || context.includes('NOTAS')) {
        // Usar contexto solo si es relevante y hay información
        prompt = `Eres un asistente personal amigable llamado MemoVoz. El usuario pregunta sobre su agenda o tareas.

${context}

Pregunta del usuario: ${message}

Responde de forma natural, amigable y concisa (2-3 oraciones máximo) usando la información provista. Si no hay información relevante, dilo amablemente.`;
      } else {
        // Conversación general sin contexto
        prompt = `Eres un asistente personal amigable e inteligente llamado MemoVoz. Responde de forma natural, amigable y concisa (2-3 oraciones máximo).

Pregunta del usuario: ${message}

Responde como un asistente útil que puede hablar de cualquier tema de forma amigable y cercana.`;
      }

      const result = await model.generateContent(prompt);
      const response = result.response;
      return response.text();
    } catch (error) {
      console.error('Error generando respuesta:', error);
      throw error;
    }
  }
}

export const aiChatController = new AIChatController();