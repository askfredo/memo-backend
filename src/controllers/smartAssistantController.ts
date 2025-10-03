import { Request, Response } from 'express';
import { db } from '../db/index';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { AIService } from '../services/aiService';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '');
const aiService = new AIService();

class SmartAssistantController {
  async processVoiceInput(req: Request, res: Response) {
    try {
      const { message, conversationHistory = [], userId = '00000000-0000-0000-0000-000000000001', useNativeVoice = false } = req.body;

      if (!message || message.trim() === '') {
        return res.status(400).json({ error: 'Message is required' });
      }

      console.log('🎤 Mensaje:', message);
      console.log('📚 Historial:', conversationHistory.length, 'mensajes');

      const wantsToSaveConversation = this.detectSaveConversationIntent(message);
      
      if (wantsToSaveConversation && conversationHistory.length > 0) {
        const formattedConversation = conversationHistory
          .map((msg: any) => `${msg.type === 'user' ? 'Yo' : 'AI'}: ${msg.text}`)
          .join('\n\n');

        const title = `Conversación con AI - ${new Date().toLocaleDateString('es-ES')}`;
        const content = `${title}\n\n${formattedConversation}`;

        const result = await db.query(
          `INSERT INTO notes (user_id, content, note_type, hashtags, ai_classification)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING *`,
          [userId, content, 'simple_note', ['#conversacion', '#ai'], JSON.stringify({ type: 'ai_conversation' })]
        );

        return res.json({
          type: 'conversation_saved',
          response: 'Listo, conversación guardada como nota',
          note: result.rows[0]
        });
      }

      const intent = await this.detectIntent(message);
      console.log('🎯 Intención:', intent);

      if (intent === 'question') {
        const context = await this.getUserContext(userId);
        const aiResponse = await this.generateResponse(message, context, conversationHistory);
        
        if (!aiResponse || aiResponse.trim() === '') {
          throw new Error('Respuesta vacía generada');
        }

        const shouldOfferSave = this.shouldOfferSaveConversation(conversationHistory);
        
        return res.json({
          type: 'conversation',
          response: aiResponse,
          hasNativeAudio: false,
          shouldOfferSave
        });
      } else {
        const classification = await aiService.classifyNote(message);
        const finalContent = classification.reformattedContent || message;

        const noteResult = await db.query(
          `INSERT INTO notes (user_id, content, note_type, hashtags, ai_classification)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING *`,
          [userId, finalContent, classification.intent, classification.entities.hashtags, JSON.stringify(classification)]
        );

        const note = noteResult.rows[0];

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
      console.error('❌ Error:', error);
      res.status(500).json({ 
        error: 'Internal server error', 
        details: error.message 
      });
    }
  }

  private detectSaveConversationIntent(message: string): boolean {
    const savePatterns = /guarda.*conversación|guarda.*esto|guarda.*chat|guarda.*todo|guardar.*conversación|anota.*conversación|salva.*conversación/i;
    return savePatterns.test(message);
  }

  private shouldOfferSaveConversation(conversationHistory: any[]): boolean {
    if (conversationHistory.length < 8) return false;
    
    const lastThree = conversationHistory.slice(-3);
    const hasRecentOffer = lastThree.some((msg: any) => 
      msg.text?.includes('guardar') || msg.text?.includes('conversación')
    );
    
    return !hasRecentOffer;
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
- "question": El usuario hace una pregunta, quiere información, o conversa (ejemplos: "hola", "qué eventos tengo", "cuéntame más", "explícame", "y eso qué es")
- "action": El usuario quiere crear una nota, tarea, evento o recordatorio (ejemplos: "recordar comprar pan", "mañana tengo dentista", "anotar reunión")

Mensaje: "${message}"

Responde SOLO con la palabra: question o action`;

      const result = await model.generateContent(prompt);
      const response = result.response.text().trim().toLowerCase();
      
      return response.includes('action') ? 'action' : 'question';
    } catch (error) {
      console.error('Error detectando intención:', error);
      return 'question';
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

      let context = 'CONTEXTO DEL USUARIO:\n\n';

      if (eventsResult.rows.length > 0) {
        context += 'EVENTOS PRÓXIMOS:\n';
        eventsResult.rows.forEach(event => {
          const date = new Date(event.start_datetime).toLocaleDateString('es-ES', { 
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
        context += 'NOTAS RECIENTES:\n';
        notesResult.rows.slice(0, 5).forEach(note => {
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
          maxOutputTokens: 200
        }
      });

      const isPersonalQuestion = /qué|cuál|cuándo|dónde|tengo|mis|mi|eventos|tareas|notas|cumpleaños|reunión|cita/i.test(message);

      // Construir historial de conversación
      let conversationContext = '';
      if (conversationHistory.length > 0) {
        conversationContext = '\n\nHISTORIAL DE LA CONVERSACIÓN (últimos 10 mensajes):\n';
        conversationHistory.slice(-10).forEach((msg: any) => {
          conversationContext += `${msg.type === 'user' ? 'Usuario' : 'Asistente'}: ${msg.text}\n`;
        });
        conversationContext += '\n';
      }

      let systemPrompt = `Eres MemoVoz, un asistente personal inteligente y conversacional en español.

IMPORTANTE:
- Mantén coherencia con la conversación previa
- Recuerda lo que el usuario te ha dicho antes
- Si te preguntan sobre algo que ya mencionaron, referéncialo
- Responde de forma natural y breve (máximo 2-3 oraciones)
- Si no tienes información específica del contexto, dilo claramente

${conversationContext}`;

      let prompt = '';
      
      if (isPersonalQuestion && context.length > 50) {
        prompt = `${systemPrompt}
${context}

Pregunta actual del usuario: ${message}

Responde de forma directa y conversacional, usando la información del contexto y del historial:`;
      } else {
        prompt = `${systemPrompt}

Pregunta actual del usuario: ${message}

Responde de forma amigable y conversacional, manteniendo coherencia con el historial:`;
      }

      const result = await model.generateContent(prompt);
      const response = result.response.text().trim();
      
      // Validar respuesta
      if (response.includes('**Composing') || response.includes('crafted') || response.length > 400) {
        return 'Disculpa, ¿puedes reformular tu pregunta?';
      }
      
      return response;
    } catch (error) {
      console.error('Error generando respuesta:', error);
      return 'Hola, ¿en qué puedo ayudarte?';
    }
  }

  private buildDateTime(date: string, time: string | null): string {
    return time ? `${date}T${time}:00` : `${date}T00:00:00`;
  }
}

export const smartAssistantController = new SmartAssistantController();