import { Request, Response } from 'express';
import { db } from '../db/index';
import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '');

class SmartAssistantController {
  async processVoiceInput(req: Request, res: Response) {
    try {
      const { message, conversationHistory = [], userId = '00000000-0000-0000-0000-000000000001' } = req.body;

      if (!message || message.trim() === '') {
        return res.status(400).json({ error: 'Message is required' });
      }

      console.log('🎤 Voz procesada:', message);
      console.log('📜 Historial:', conversationHistory.length, 'mensajes');

      // Filtrar conversación de últimos 5 minutos (30 mensajes máx)
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
      const recentHistory = conversationHistory
        .filter((msg: any) => new Date(msg.timestamp) > fiveMinutesAgo)
        .slice(-30);

      console.log('📜 Mensajes recientes (5 min):', recentHistory.length);

      // Detectar intención
      const intent = await this.detectIntent(message);
      console.log('🎯 Intención detectada:', intent);

      if (intent === 'question') {
        // Es una pregunta - responder conversacionalmente
        const context = await this.getUserContext(userId);
        const aiResponse = await this.generateResponse(message, context, recentHistory);
        
        // Decidir si sugerir guardar conversación
        const shouldOfferSave = this.shouldOfferSaveConversation(recentHistory);
        
        return res.json({
          type: 'conversation',
          response: aiResponse,
          shouldOfferSave
        });
      } else {
        // Es una nota/evento - usar el mismo sistema que el endpoint /api/notes
        console.log('📝 Procesando como acción/nota...');
        
        // Clasificar con Gemini
        const classification = await this.classifyWithGemini(message);
        console.log('📊 Clasificación:', classification);

        const finalContent = classification.reformattedContent || message;

        const noteResult = await db.query(
          `INSERT INTO notes (user_id, content, note_type, hashtags, ai_classification)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING *`,
          [userId, finalContent, classification.intent, classification.entities.hashtags, JSON.stringify(classification)]
        );

        const note = noteResult.rows[0];
        console.log('✅ Nota creada:', note.id);

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

          console.log('📅 Evento creado:', eventResult.rows[0].id);

          return res.json({
            type: 'event_created',
            response: `Listo, evento creado`,
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

  private async classifyWithGemini(message: string) {
    const model = genAI.getGenerativeModel({ 
      model: 'gemini-2.5-flash-lite',
      generationConfig: {
        temperature: 0.3,
        response_mime_type: "application/json"
      }
    });

    const prompt = `Clasifica esta nota y extrae información estructurada.

Mensaje: "${message}"

Responde en JSON con este formato exacto:
{
  "intent": "simple_note" | "calendar_event" | "reminder" | "checklist",
  "summary": "resumen breve",
  "suggestedTitle": "título sugerido",
  "emoji": "emoji apropiado",
  "reformattedContent": "contenido reformateado",
  "entities": {
    "date": "YYYY-MM-DD" (solo si es evento),
    "time": "HH:MM" (solo si se menciona),
    "location": "ubicación" (solo si se menciona),
    "hashtags": ["#tag1", "#tag2"]
  }
}

Reglas:
- Si menciona fecha/hora específica = "calendar_event"
- Si es lista con viñetas = "checklist"
- Si menciona "recordar" sin fecha = "reminder"
- Sino = "simple_note"
- Incluye emoji relevante
- Extrae fecha en formato ISO (YYYY-MM-DD)
- Si dice "mañana", calcula la fecha correcta (hoy es ${new Date().toISOString().split('T')[0]})
- Si dice "pasado mañana", suma 2 días
- Hashtags relevantes según el contenido`;

    const result = await model.generateContent(prompt);
    const text = result.response.text();
    return JSON.parse(text);
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
- "question": El usuario hace una pregunta, quiere información, o conversa (ejemplos: "hola", "qué eventos tengo", "quién fue Einstein", "cómo estás", "en esa fecha", "y qué más")
- "action": El usuario quiere crear una nota, tarea, evento o recordatorio (ejemplos: "recordar comprar pan", "mañana tengo dentista", "anotar pagar celular", "evento el sábado", "comprar leche")

Mensaje: "${message}"

Responde SOLO con la palabra: question o action`;

      const result = await model.generateContent(prompt);
      const response = result.response.text().trim().toLowerCase();
      
      console.log('🔍 Respuesta de detección:', response);
      
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

      let conversationContext = '';
      if (conversationHistory.length > 0) {
        conversationContext = '\n\nHISTORIAL DE LA CONVERSACIÓN (últimos 5 minutos):\n';
        conversationHistory.forEach((msg: any) => {
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
    if (!time) {
      return `${date}T00:00:00`;
    }
    
    // Asegurar formato correcto
    const timeParts = time.split(':');
    if (timeParts.length === 2) {
      return `${date}T${time}:00`;
    }
    
    return `${date}T${time}`;
  }
}

export const smartAssistantController = new SmartAssistantController();