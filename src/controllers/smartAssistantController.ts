import { Request, Response } from 'express';
import { db } from '../db/index';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { AIService } from '../services/aiService';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '');
const aiService = new AIService();

class SmartAssistantController {
  async processVoiceInput(req: Request, res: Response) {
    try {
      const { message, conversationHistory = [], userId = '00000000-0000-0000-0000-000000000001', useNativeVoice = false, enrichedContext } = req.body;

      if (!message || message.trim() === '') {
        return res.status(400).json({ error: 'Message is required' });
      }

      console.log('ðŸŽ¤ Mensaje:', message);

      // 🆕 Log del contexto enriquecido si está presente
      if (enrichedContext) {
        console.log('🧠 Contexto enriquecido recibido:');
        console.log('   - Tema actual:', enrichedContext.current_topic || 'N/A');
        console.log('   - Último video:', enrichedContext.last_youtube_video?.title || 'N/A');
        console.log('   - Última búsqueda:', enrichedContext.last_web_search?.query || 'N/A');
        console.log('   - Mensajes en sesión:', enrichedContext.conversation_summary?.message_count || 0);
      }

      const wantsToSaveConversation = this.detectSaveConversationIntent(message);
      
      if (wantsToSaveConversation && conversationHistory.length > 0) {
        const formattedConversation = conversationHistory
          .map((msg: any) => `${msg.type === 'user' ? 'Yo' : 'AI'}: ${msg.text}`)
          .join('\n\n');

        const title = `ConversaciÃ³n con AI - ${new Date().toLocaleDateString('es-ES')}`;
        const content = `${title}\n\n${formattedConversation}`;

        const result = await db.query(
          `INSERT INTO notes (user_id, content, note_type, hashtags, ai_classification)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING *`,
          [userId, content, 'simple_note', ['#conversacion', '#ai'], JSON.stringify({ type: 'ai_conversation' })]
        );

        return res.json({
          type: 'conversation_saved',
          response: 'Listo, conversaciÃ³n guardada como nota',
          note: result.rows[0]
        });
      }

      // 🆕 Detectar intent considerando el contexto enriquecido
      const intent = await this.detectIntent(message, enrichedContext);
      console.log('ðŸŽ¯ IntenciÃ³n:', intent);

      //🆕 Detectar búsquedas web/YouTube basadas en contexto
      if (intent === 'web_search' || intent === 'youtube_search') {
        // Expandir query usando el contexto si es necesario
        let expandedQuery = message;

        if (enrichedContext?.last_youtube_video && /ingredientes|receta|pasos|cómo|precio|dónde/i.test(message)) {
          const videoTitle = enrichedContext.last_youtube_video.title;
          expandedQuery = `${message.replace(/busca|buscar/gi, '').trim()} ${videoTitle}`;
          console.log('🔗 Query expandido con video:', expandedQuery);
        }

        return res.json({
          type: 'conversation',
          intent: intent,
          response: intent === 'youtube_search'
            ? 'Voy a buscar videos para ti'
            : 'Déjame buscar eso en internet',
          shouldSpeak: true
        });
      }

      if (intent === 'question') {
        const context = await this.getUserContext(userId, message);
        const aiResponse = await this.generateResponse(message, context, conversationHistory, enrichedContext);
        
        if (!aiResponse || aiResponse.trim() === '') {
          throw new Error('Respuesta vacÃ­a generada');
        }

        const shouldOfferSave = this.shouldOfferSaveConversation(conversationHistory);
        
        return res.json({
          type: 'conversation',
          response: aiResponse,
          hasNativeAudio: false,
          shouldOfferSave
        });
      } else {
        // Procesar como nota/evento
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

          // Generar respuesta verbal natural
          const eventDate = new Date(startDatetime);
          const dateStr = eventDate.toLocaleDateString('es-ES', { 
            weekday: 'long', 
            day: 'numeric', 
            month: 'long',
            hour: classification.entities.time ? '2-digit' : undefined,
            minute: classification.entities.time ? '2-digit' : undefined
          });

          const verbalResponse = `Listo, agendÃ© ${titleWithEmoji} para ${dateStr}${classification.entities.location ? ' en ' + classification.entities.location : ''}`;

          return res.json({
            type: 'event_created',
            response: verbalResponse,
            note,
            event: eventResult.rows[0],
            classification,
            shouldSpeak: true // Nueva bandera para indicar que debe hablar
          });
        }

        // Respuesta verbal para notas
        const verbalResponse = classification.intent === 'checklist_note' 
          ? 'Perfecto, guardÃ© tu lista de tareas'
          : classification.intent === 'reminder'
          ? 'Listo, guardÃ© tu recordatorio'
          : 'Nota guardada correctamente';

        return res.json({
          type: 'note_created',
          response: verbalResponse,
          note,
          classification,
          shouldSpeak: true
        });
      }
    } catch (error: any) {
      console.error('âŒ Error:', error);
      res.status(500).json({ 
        error: 'Internal server error', 
        details: error.message 
      });
    }
  }

  private detectSaveConversationIntent(message: string): boolean {
    const savePatterns = /guarda.*conversaciÃ³n|guarda.*esto|guarda.*chat|guarda.*todo|guardar.*conversaciÃ³n|anota.*conversaciÃ³n|salva.*conversaciÃ³n/i;
    return savePatterns.test(message);
  }

  private shouldOfferSaveConversation(conversationHistory: any[]): boolean {
    if (conversationHistory.length < 8) return false;
    
    const lastThree = conversationHistory.slice(-3);
    const hasRecentOffer = lastThree.some((msg: any) => 
      msg.text?.includes('guardar') || msg.text?.includes('conversaciÃ³n')
    );
    
    return !hasRecentOffer;
  }

  private async detectIntent(message: string, enrichedContext?: any): Promise<'question' | 'action' | 'web_search' | 'youtube_search'> {
    try {
      const model = genAI.getGenerativeModel({
        model: 'gemini-2.5-flash-lite',
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 80,
        }
      });

      // 🆕 Construir contexto para el LLM
      let contextSection = '';
      if (enrichedContext) {
        contextSection = '\n\nCONTEXTO DISPONIBLE:\n';
        if (enrichedContext.last_youtube_video) {
          contextSection += `- Último video visto: "${enrichedContext.last_youtube_video.title}"\n`;
        }
        if (enrichedContext.last_web_search) {
          contextSection += `- Última búsqueda web: "${enrichedContext.last_web_search.query}"\n`;
        }
        if (enrichedContext.last_note) {
          contextSection += `- Última nota: "${enrichedContext.last_note.content.substring(0, 50)}..."\n`;
        }
      }

      const prompt = `Analiza este mensaje y determina el intent:${contextSection}

- "question": Pregunta, conversación, información
- "action": Crear nota, tarea, evento o recordatorio
- "web_search": Buscar información en internet (clima, precios, noticias, etc.)
- "youtube_search": Buscar videos en YouTube

REGLAS ESPECIALES (IMPORTANTE):
1. Si hay un video en contexto y el mensaje menciona "ingredientes", "receta", "pasos" → web_search
2. Si dice "busca", "búscame", "encuéntrame" y NO es para videos → web_search
3. Si dice "video", "canal", "YouTube" → youtube_search
4. Si dice "guarda", "anota" y hay búsqueda reciente → action

Mensaje: "${message}"

Responde SOLO con: question, action, web_search o youtube_search`;

      const result = await model.generateContent(prompt);
      const response = result.response.text().trim().toLowerCase();

      if (response.includes('web_search')) return 'web_search';
      if (response.includes('youtube_search')) return 'youtube_search';
      if (response.includes('action')) return 'action';
      return 'question';
    } catch (error) {
      console.error('Error detectando intenciÃ³n:', error);
      return 'question';
    }
  }

  private async getUserContext(userId: string, currentMessage: string): Promise<string> {
    try {
      const now = new Date();
      const monthFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

      // Obtener TODOS los eventos prÃ³ximos
      const eventsResult = await db.query(
        `SELECT title, description, start_datetime, location 
         FROM calendar_events 
         WHERE user_id = $1 AND start_datetime BETWEEN $2 AND $3
         ORDER BY start_datetime ASC`,
        [userId, now.toISOString(), monthFromNow.toISOString()]
      );

      // BÃºsqueda inteligente de notas segÃºn palabras clave del mensaje
      const keywords = this.extractKeywords(currentMessage);
      
      let notesQuery = `
        SELECT content, hashtags, created_at 
        FROM notes 
        WHERE user_id = $1 AND NOT hashtags && ARRAY['#secreto']
      `;
      
      const queryParams: any[] = [userId];
      
      // Si hay palabras clave, hacer bÃºsqueda por similitud
      if (keywords.length > 0) {
        notesQuery += ` AND (`;
        keywords.forEach((keyword, idx) => {
          if (idx > 0) notesQuery += ` OR `;
          notesQuery += `LOWER(content) LIKE $${idx + 2}`;
          queryParams.push(`%${keyword.toLowerCase()}%`);
        });
        notesQuery += `)`;
      }
      
      notesQuery += ` ORDER BY created_at DESC LIMIT 50`;

      const notesResult = await db.query(notesQuery, queryParams);

      let context = 'CONTEXTO DEL USUARIO:\n\n';

      if (eventsResult.rows.length > 0) {
        context += `EVENTOS PRÃ“XIMOS (${eventsResult.rows.length} total):\n`;
        eventsResult.rows.forEach(event => {
          const date = new Date(event.start_datetime).toLocaleDateString('es-ES', { 
            weekday: 'short',
            day: 'numeric', 
            month: 'short',
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
        context += `NOTAS (${notesResult.rows.length} encontradas):\n`;
        notesResult.rows.forEach(note => {
          const preview = note.content.substring(0, 120);
          const tags = note.hashtags?.join(' ') || '';
          context += `- ${preview}${note.content.length > 120 ? '...' : ''} ${tags}\n`;
        });
        context += '\n';
      }

      return context;
    } catch (error) {
      console.error('Error obteniendo contexto:', error);
      return '';
    }
  }

  private extractKeywords(message: string): string[] {
    // Palabras comunes a ignorar
    const stopWords = ['el', 'la', 'los', 'las', 'un', 'una', 'de', 'del', 'en', 'y', 'o', 'que', 'quÃ©', 'cuÃ¡l', 'cuÃ¡les', 'mi', 'mis', 'tu', 'tus', 'tengo', 'tienes', 'hay', 'estÃ¡', 'estÃ¡n', 'a', 'para', 'por'];
    
    const words = message.toLowerCase()
      .replace(/[^\wÃ¡Ã©Ã­Ã³ÃºÃ±Ã¼\s]/g, '')
      .split(/\s+/)
      .filter(word => word.length > 3 && !stopWords.includes(word));
    
    return [...new Set(words)]; // Eliminar duplicados
  }

  private async generateResponse(message: string, context: string, conversationHistory: any[], enrichedContext?: any): Promise<string> {
    try {
      const model = genAI.getGenerativeModel({ 
        model: 'gemini-2.5-flash-lite',
        generationConfig: { 
          temperature: 0.7, 
          maxOutputTokens: 200
        }
      });

      const isPersonalQuestion = /quÃ©|cuÃ¡l|cuÃ¡ndo|dÃ³nde|tengo|mis|mi|eventos|tareas|notas|cumpleaÃ±os|reuniÃ³n|cita|lista/i.test(message);

      let conversationContext = '';
      if (conversationHistory.length > 0) {
        conversationContext = '\n\nHISTORIAL RECIENTE:\n';
        conversationHistory.slice(-10).forEach((msg: any) => {
          conversationContext += `${msg.type === 'user' ? 'Usuario' : 'Asistente'}: ${msg.text}\n`;
        });
        conversationContext += '\n';
      }

      // 🆕 Agregar contexto enriquecido al system prompt
      let enrichedSection = '';
      if (enrichedContext) {
        enrichedSection = '\n\n## 🧠 CONTEXTO DE LA SESIÓN:\n';

        if (enrichedContext.current_topic) {
          enrichedSection += `📌 Tema actual: ${enrichedContext.current_topic}\n`;
        }

        if (enrichedContext.last_youtube_video) {
          const video = enrichedContext.last_youtube_video;
          enrichedSection += `\n🎥 Último video visto: "${video.title}" por ${video.channel}\n`;
        }

        if (enrichedContext.last_web_search) {
          const search = enrichedContext.last_web_search;
          const answerPreview = search.answer.substring(0, 150);
          enrichedSection += `\n🌐 Última búsqueda: "${search.query}"\n   Respuesta: ${answerPreview}...\n`;
        }

        if (enrichedContext.last_note) {
          const note = enrichedContext.last_note;
          enrichedSection += `\n📝 Última nota: ${note.content.substring(0, 80)}...\n`;
        }

        if (enrichedContext.last_event) {
          const event = enrichedContext.last_event;
          enrichedSection += `\n📅 Último evento: ${event.title} (${event.date})\n`;
        }

        enrichedSection += '\n⚠️ IMPORTANTE: Si el usuario menciona "eso", "ese", "los ingredientes", está refiriéndose al contexto anterior.\n';
      }

      let systemPrompt = `Eres MemoVoz, un asistente personal conversacional en español.

IMPORTANTE:
- Responde de forma natural y breve (2-3 oraciones máximo)
- Mantén coherencia con el historial
- Cuando te pregunten por eventos, notas o tareas, busca en el CONTEXTO completo
- Si hay mucha información, resume lo más relevante
- Si no encuentras algo específico, dilo claramente
${enrichedSection}
${conversationContext}`;

      let prompt = '';

      if (isPersonalQuestion && context.length > 50) {
        prompt = `${systemPrompt}
${context}

Pregunta: ${message}

Responde usando TODA la información disponible del contexto:`;
      } else {
        prompt = `${systemPrompt}

Pregunta: ${message}

Responde manteniendo coherencia con el historial y el contexto de la sesión:`;
      }

      const result = await model.generateContent(prompt);
      const response = result.response.text().trim();
      
      if (response.includes('**Composing') || response.includes('crafted') || response.length > 400) {
        return 'Disculpa, Â¿puedes reformular tu pregunta?';
      }
      
      return response;
    } catch (error) {
      console.error('Error generando respuesta:', error);
      return 'Hola, Â¿en quÃ© puedo ayudarte?';
    }
  }

  private buildDateTime(date: string, time: string | null): string {
    return time ? `${date}T${time}:00` : `${date}T00:00:00`;
  }
}

export const smartAssistantController = new SmartAssistantController();