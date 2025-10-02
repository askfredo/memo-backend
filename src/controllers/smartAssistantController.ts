import { Request, Response } from 'express';
import { db } from '../db/index';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { AIService } from '../services/aiService';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '');
const aiService = new AIService();

class SmartAssistantController {
  async processVoiceInput(req: Request, res: Response) {
    try {
      const { message, conversationHistory = [], userId = '00000000-0000-0000-0000-000000000001' } = req.body;

      if (!message || message.trim() === '') {
        return res.status(400).json({ error: 'Message is required' });
      }

      console.log('🎤 Voz procesada:', message);
      console.log('📜 Historial:', conversationHistory.length, 'mensajes');

      // Detectar intención
      const intent = await this.detectIntent(message);
      console.log('🎯 Intención detectada:', intent);

      if (intent === 'question') {
        // Es una pregunta - responder conversacionalmente CON CONTEXTO
        const context = await this.getUserContext(userId);
        const aiResponse = await this.generateResponse(message, context, conversationHistory);
        
        return res.json({
          type: 'conversation',
          response: aiResponse
        });
      } else {
        // Es una nota/evento - procesar con el sistema existente
        const classification = await aiService.classifyNote(message);
        const finalContent = classification.reformattedContent || message;

        const noteResult = await db.query(
          `INSERT INTO notes (user_id, content, note_type, hashtags, ai_classification)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING *`,
          [userId, finalContent, classification.intent, classification.entities.hashtags, JSON.stringify(classification)]
        );

        const note = noteResult.rows[0];

        // Si es evento, crear en calendario
        if (classification.intent === 'calendar_event' && classification.entities.date) {
          const startDatetime = this.buildDateTime(classification.entities.date, classification.entities.time);
          const titleWithEmoji = `${classification.emoji} ${classification.suggestedTitle}`;

          const eventResult = await db.query(
            `INSERT INTO calendar_events (user_id, note_id, title, description, start_datetime, location, color)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             RETURNING *`,
            [userId, note.id, titleWithEmoji, classification.summary, startDatetime, classification.entities.location, 'blue']
          );

          return res.json({
            type: 'event_created',
            response: `Evento creado: ${titleWithEmoji}`,
            note,
            event: eventResult.rows[0],
            classification
          });
        }

        return res.json({
          type: 'note_created',
          response: `Nota guardada`,
          note,
          classification
        });
      }
    } catch (error: any) {
      console.error('❌ Error procesando entrada:', error);
      res.status(500).json({ error: 'Internal server error', details: error.message });
    }
  }

  private async detectIntent(message: string): Promise<'question' | 'action'> {
    try {
      const model = genAI.getGenerativeModel({ 
        model: 'gemini-2.5-flash-lite',
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 50,
        }
      });

      const prompt = `Analiza este mensaje y determina si es:
- "question": El usuario hace una pregunta, quiere información, o conversa (ejemplos: "hola", "qué eventos tengo", "quién fue Einstein", "cómo estás", "en esa fecha", "y qué más")
- "action": El usuario quiere crear una nota, tarea, evento o recordatorio (ejemplos: "recordar comprar pan", "mañana tengo dentista", "anotar pagar celular")

Mensaje: "${message}"

Responde SOLO con la palabra: question o action`;

      const result = await model.generateContent(prompt);
      const response = result.response.text().trim().toLowerCase();
      
      return response.includes('action') ? 'action' : 'question';
    } catch (error) {
      console.error('Error detectando intención:', error);
      return 'question'; // Por defecto, asumir pregunta
    }
  }

  private async getUserContext(userId: string): Promise<string> {
    try {
      const now = new Date();
      const monthFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

      const eventsResult = await db.query(
        `SELECT title, description, start_datetime, location 
         FROM calendar_events 
         WHERE user_id = $1 AND start_datetime BETWEEN $2 AND $3
         ORDER BY start_datetime ASC
         LIMIT 20`,
        [userId, now.toISOString(), monthFromNow.toISOString()]
      );

      const notesResult = await db.query(
        `SELECT content, hashtags 
         FROM notes 
         WHERE user_id = $1 AND NOT hashtags && ARRAY['#secreto']
         ORDER BY created_at DESC
         LIMIT 20`,
        [userId]
      );

      let context = 'INFORMACIÓN DEL USUARIO:\n\n';

      if (eventsResult.rows.length > 0) {
        context += 'EVENTOS PRÓXIMOS:\n';
        eventsResult.rows.forEach(event => {
          const date = new Date(event.start_datetime).toLocaleDateString('es-ES', { 
            day: 'numeric', 
            month: 'long',
            year: 'numeric'
          });
          context += `- ${event.title} (${date})`;
          if (event.location) context += ` en ${event.location}`;
          context += '\n';
        });
        context += '\n';
      }

      if (notesResult.rows.length > 0) {
        context += 'NOTAS Y TAREAS:\n';
        notesResult.rows.forEach(note => {
          context += `- ${note.content.substring(0, 100)}\n`;
        });
        context += '\n';
      }

      return context;
    } catch (error) {
      console.error('Error obteniendo contexto:', error);
      return '';
    }
  }

  private async generateResponse(message: string, context: string, conversationHistory: any[]): Promise<string> {
    try {
      const model = genAI.getGenerativeModel({ 
        model: 'gemini-2.5-flash-lite',
        generationConfig: { 
          temperature: 0.7, 
          maxOutputTokens: 300 
        }
      });

      const isPersonalQuestion = /qué|cuál|cuándo|tengo|mis|eventos|tareas|notas|cumpleaños|reunión/i.test(message);

      // Construir historial conversacional (últimos 6 mensajes)
      let conversationContext = '';
      if (conversationHistory.length > 0) {
        conversationContext = '\n\nHISTORIAL DE LA CONVERSACIÓN:\n';
        conversationHistory.slice(-6).forEach((msg: any) => {
          conversationContext += `${msg.type === 'user' ? 'Usuario' : 'Tú'}: ${msg.text}\n`;
        });
        conversationContext += '\n';
      }

      let prompt = '';
      
      if (isPersonalQuestion && context.length > 50) {
        prompt = `Eres MemoVoz, asistente personal inteligente. Responde brevemente (1-2 oraciones).${conversationContext}\n${context}\n\nPregunta actual: ${message}\n\nRespuesta:`;
      } else {
        prompt = `Eres MemoVoz, asistente amigable e inteligente. Responde brevemente (1-2 oraciones) manteniendo el contexto de la conversación.${conversationContext}\n\nPregunta actual: ${message}\n\nRespuesta:`;
      }

      const result = await model.generateContent(prompt);
      return result.response.text();
    } catch (error) {
      console.error('Error generando respuesta:', error);
      throw error;
    }
  }

  private buildDateTime(date: string, time: string | null): string {
    return time ? `${date}T${time}:00` : `${date}T00:00:00`;
  }
}

export const smartAssistantController = new SmartAssistantController();