import { Request, Response } from 'express';
import { GoogleGenAI, LiveServerMessage, MediaResolution, Modality } from '@google/genai';
import { db } from '../db/index';
import { AIService } from '../services/aiService';

const aiService = new AIService();

class AudioAssistantController {
  async processVoiceWithAudio(req: Request, res: Response) {
    try {
      const { message, conversationHistory = [], userId = '00000000-0000-0000-0000-000000000001' } = req.body;

      if (!message || message.trim() === '') {
        return res.status(400).json({ error: 'Message is required' });
      }

      console.log('🎤 Procesando con voz nativa...');

      // Filtrar conversación de últimos 5 minutos
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
      const recentHistory = conversationHistory
        .filter((msg: any) => new Date(msg.timestamp) > fiveMinutesAgo)
        .slice(-30);

      // Detectar si quiere guardar conversación
      const wantsToSaveConversation = /guarda.*conversación|guarda.*esto|guarda.*chat|guarda.*todo|guardar.*conversación|anota.*conversación|salva.*conversación/i.test(message);
      
      if (wantsToSaveConversation && recentHistory.length > 0) {
        const formattedConversation = recentHistory
          .map((msg: any) => `${msg.type === 'user' ? 'Yo' : 'AI'}: ${msg.text}`)
          .join('\n\n');

        const title = `Conversación con AI - ${new Date().toLocaleDateString('es-ES')}`;
        const content = `${title}\n\n${formattedConversation}`;

        await db.query(
          `INSERT INTO notes (user_id, content, note_type, hashtags, ai_classification)
           VALUES ($1, $2, $3, $4, $5)`,
          [userId, content, 'simple_note', ['#conversacion', '#ai'], JSON.stringify({ type: 'ai_conversation' })]
        );

        // Generar respuesta en audio
        const audioResponse = await this.generateAudioResponse('Listo, conversación guardada como nota');
        return res.json({
          type: 'conversation_saved',
          response: 'Listo, conversación guardada como nota',
          audioData: audioResponse
        });
      }

      // Detectar intención
      const intent = await this.detectIntent(message);

      if (intent === 'question') {
        // Construir contexto
        const context = await this.getUserContext(userId);
        const conversationContext = this.buildConversationContext(recentHistory);
        
        const fullPrompt = this.buildPrompt(message, context, conversationContext);
        
        // Generar respuesta con audio
        const audioResponse = await this.generateAudioResponse(fullPrompt);
        
        const shouldOfferSave = this.shouldOfferSaveConversation(recentHistory);
        
        return res.json({
          type: 'conversation',
          response: audioResponse.text,
          audioData: audioResponse.audio,
          shouldOfferSave
        });
      } else {
        // Es una nota/evento - procesar
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
          const startDatetime = `${classification.entities.date}T${classification.entities.time || '00:00'}:00`;
          const titleWithEmoji = `${classification.emoji} ${classification.suggestedTitle}`;

          await db.query(
            `INSERT INTO calendar_events (user_id, note_id, title, description, start_datetime, location, color)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [userId, note.id, titleWithEmoji, classification.summary, startDatetime, classification.entities.location, 'blue']
          );

          const audioResponse = await this.generateAudioResponse(`Evento creado: ${titleWithEmoji}`);
          return res.json({
            type: 'event_created',
            response: `Evento creado: ${titleWithEmoji}`,
            audioData: audioResponse.audio,
            note
          });
        }

        const audioResponse = await this.generateAudioResponse('Nota guardada');
        return res.json({
          type: 'note_created',
          response: 'Nota guardada',
          audioData: audioResponse.audio,
          note
        });
      }
    } catch (error: any) {
      console.error('Error:', error);
      res.status(500).json({ error: 'Internal server error', details: error.message });
    }
  }

  private async generateAudioResponse(text: string): Promise<{ text: string, audio: string }> {
    const ai = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '',
    });

    const responseQueue: LiveServerMessage[] = [];
    const audioParts: string[] = [];

    return new Promise(async (resolve, reject) => {
      try {
        const session = await ai.live.connect({
          model: 'models/gemini-2.5-flash-native-audio-preview-09-2025',
          callbacks: {
            onmessage: (message: LiveServerMessage) => {
              responseQueue.push(message);
              
              if (message.serverContent?.modelTurn?.parts) {
                const part = message.serverContent.modelTurn.parts[0];
                if (part?.inlineData) {
                  audioParts.push(part.inlineData.data ?? '');
                }
              }
            },
            onerror: (e: ErrorEvent) => reject(e),
            onclose: () => {
              const audioBase64 = audioParts.join('');
              resolve({ text, audio: audioBase64 });
            }
          },
          config: {
            responseModalities: [Modality.AUDIO],
            mediaResolution: MediaResolution.MEDIA_RESOLUTION_MEDIUM,
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: {
                  voiceName: 'Zephyr',
                }
              }
            }
          }
        });

        session.sendClientContent({
          turns: [text]
        });

        // Esperar respuesta
        setTimeout(() => {
          session.close();
        }, 3000);

      } catch (error) {
        reject(error);
      }
    });
  }

  private buildPrompt(message: string, context: string, conversationContext: string): string {
    const isPersonalQuestion = /qué|cuál|cuándo|tengo|mis|eventos|tareas|notas|cumpleaños|reunión/i.test(message);

    if (isPersonalQuestion && context.length > 50) {
      return `Eres MemoVoz, asistente personal. Responde brevemente (1-2 oraciones).${conversationContext}\n${context}\n\nPregunta: ${message}`;
    } else {
      return `Eres MemoVoz, asistente amigable. Responde brevemente (1-2 oraciones).${conversationContext}\n\nPregunta: ${message}`;
    }
  }

  private buildConversationContext(history: any[]): string {
    if (history.length === 0) return '';
    
    let context = '\n\nCONVERSACIÓN:\n';
    history.forEach((msg: any) => {
      context += `${msg.type === 'user' ? 'Usuario' : 'Tú'}: ${msg.text}\n`;
    });
    return context;
  }

  private async detectIntent(message: string): Promise<'question' | 'action'> {
    // Reusar lógica del smartAssistantController
    return /recordar|anotar|guardar|mañana tengo|hoy tengo|pasado mañana/i.test(message) ? 'action' : 'question';
  }

  private async getUserContext(userId: string): Promise<string> {
    const now = new Date();
    const monthFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    const eventsResult = await db.query(
      `SELECT title, start_datetime FROM calendar_events 
       WHERE user_id = $1 AND start_datetime BETWEEN $2 AND $3
       ORDER BY start_datetime ASC LIMIT 10`,
      [userId, now.toISOString(), monthFromNow.toISOString()]
    );

    const notesResult = await db.query(
      `SELECT content FROM notes 
       WHERE user_id = $1 AND NOT hashtags && ARRAY['#secreto']
       ORDER BY created_at DESC LIMIT 10`,
      [userId]
    );

    let context = 'INFO:\n';
    if (eventsResult.rows.length > 0) {
      context += 'EVENTOS:\n';
      eventsResult.rows.forEach((e: any) => {
        context += `- ${e.title} (${new Date(e.start_datetime).toLocaleDateString('es-ES', { day: 'numeric', month: 'long' })})\n`;
      });
    }

    if (notesResult.rows.length > 0) {
      context += 'NOTAS:\n';
      notesResult.rows.forEach((n: any) => context += `- ${n.content.substring(0, 80)}\n`);
    }

    return context;
  }

  private shouldOfferSaveConversation(history: any[]): boolean {
    return history.length >= 8;
  }
}

export const audioAssistantController = new AudioAssistantController();