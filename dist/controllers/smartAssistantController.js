"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.smartAssistantController = void 0;
const index_1 = require("../db/index");
const generative_ai_1 = require("@google/generative-ai");
const aiService_1 = require("../services/aiService");
const geminiLiveService_1 = require("../services/geminiLiveService");
const genAI = new generative_ai_1.GoogleGenerativeAI(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '');
const aiService = new aiService_1.AIService();
class SmartAssistantController {
    async processVoiceInput(req, res) {
        try {
            const { message, conversationHistory = [], userId = '00000000-0000-0000-0000-000000000001', useNativeVoice = true } = req.body;
            if (!message || message.trim() === '') {
                return res.status(400).json({ error: 'Message is required' });
            }
            console.log('🎤 Voz procesada:', message);
            console.log('📜 Historial:', conversationHistory.length, 'mensajes');
            const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
            const recentHistory = conversationHistory
                .filter((msg) => new Date(msg.timestamp) > fiveMinutesAgo)
                .slice(-30);
            console.log('📜 Mensajes recientes (5 min):', recentHistory.length);
            const wantsToSaveConversation = this.detectSaveConversationIntent(message);
            if (wantsToSaveConversation && recentHistory.length > 0) {
                const formattedConversation = recentHistory
                    .map((msg) => `${msg.type === 'user' ? 'Yo' : 'AI'}: ${msg.text}`)
                    .join('\n\n');
                const title = `Conversación con AI - ${new Date().toLocaleDateString('es-ES')}`;
                const content = `${title}\n\n${formattedConversation}`;
                const result = await index_1.db.query(`INSERT INTO notes (user_id, content, note_type, hashtags, ai_classification)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING *`, [userId, content, 'simple_note', ['#conversacion', '#ai'], JSON.stringify({ type: 'ai_conversation' })]);
                return res.json({
                    type: 'conversation_saved',
                    response: 'Listo, conversación guardada como nota',
                    note: result.rows[0]
                });
            }
            const intent = await this.detectIntent(message);
            console.log('🎯 Intención detectada:', intent);
            if (intent === 'question') {
                const context = await this.getUserContext(userId);
                // Si useNativeVoice está activado, usar Gemini Live
                if (useNativeVoice) {
                    try {
                        const contextPrompt = this.buildContextPrompt(message, context, recentHistory);
                        const audioResponse = await geminiLiveService_1.geminiLiveService.sendMessage(contextPrompt);
                        const shouldOfferSave = this.shouldOfferSaveConversation(recentHistory);
                        return res.json({
                            type: 'conversation',
                            response: audioResponse.text,
                            audioData: audioResponse.audioData,
                            audioMimeType: audioResponse.mimeType,
                            hasNativeAudio: true,
                            shouldOfferSave
                        });
                    }
                    catch (error) {
                        console.error('Error con voz nativa, usando fallback:', error);
                        // Fallback a texto normal
                        const aiResponse = await this.generateResponse(message, context, recentHistory);
                        const shouldOfferSave = this.shouldOfferSaveConversation(recentHistory);
                        return res.json({
                            type: 'conversation',
                            response: aiResponse,
                            hasNativeAudio: false,
                            shouldOfferSave
                        });
                    }
                }
                else {
                    // Usar método tradicional (texto + TTS del navegador)
                    const aiResponse = await this.generateResponse(message, context, recentHistory);
                    const shouldOfferSave = this.shouldOfferSaveConversation(recentHistory);
                    return res.json({
                        type: 'conversation',
                        response: aiResponse,
                        hasNativeAudio: false,
                        shouldOfferSave
                    });
                }
            }
            else {
                // Es una nota/evento - procesar con el sistema existente
                const classification = await aiService.classifyNote(message);
                const finalContent = classification.reformattedContent || message;
                const noteResult = await index_1.db.query(`INSERT INTO notes (user_id, content, note_type, hashtags, ai_classification)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING *`, [userId, finalContent, classification.intent, classification.entities.hashtags, JSON.stringify(classification)]);
                const note = noteResult.rows[0];
                if (classification.intent === 'calendar_event' && classification.entities.date) {
                    const startDatetime = this.buildDateTime(classification.entities.date, classification.entities.time);
                    const titleWithEmoji = `${classification.emoji} ${classification.suggestedTitle}`;
                    const eventResult = await index_1.db.query(`INSERT INTO calendar_events (user_id, note_id, title, description, start_datetime, location, color)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             RETURNING *`, [userId, note.id, titleWithEmoji, classification.summary, startDatetime, classification.entities.location, 'blue']);
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
        }
        catch (error) {
            console.error('❌ Error procesando entrada:', error);
            res.status(500).json({ error: 'Internal server error', details: error.message });
        }
    }
    buildContextPrompt(message, context, conversationHistory) {
        const isPersonalQuestion = /qué|cuál|cuándo|tengo|mis|eventos|tareas|notas|cumpleaños|reunión/i.test(message);
        let conversationContext = '';
        if (conversationHistory.length > 0) {
            conversationContext = '\n\nHISTORIAL DE LA CONVERSACIÓN:\n';
            conversationHistory.forEach((msg) => {
                conversationContext += `${msg.type === 'user' ? 'Usuario' : 'Tú'}: ${msg.text}\n`;
            });
            conversationContext += '\n';
        }
        if (isPersonalQuestion && context.length > 50) {
            return `Eres MemoVoz, asistente personal inteligente. Responde brevemente (1-2 oraciones).${conversationContext}\n${context}\n\nPregunta actual: ${message}\n\nRespuesta:`;
        }
        else {
            return `Eres MemoVoz, asistente amigable e inteligente. Responde brevemente (1-2 oraciones) manteniendo el contexto de la conversación.${conversationContext}\n\nPregunta actual: ${message}\n\nRespuesta:`;
        }
    }
    detectSaveConversationIntent(message) {
        const savePatterns = /guarda.*conversación|guarda.*esto|guarda.*chat|guarda.*todo|guardar.*conversación|anota.*conversación|salva.*conversación/i;
        return savePatterns.test(message);
    }
    shouldOfferSaveConversation(conversationHistory) {
        if (conversationHistory.length < 8)
            return false;
        const lastThree = conversationHistory.slice(-3);
        const hasRecentOffer = lastThree.some((msg) => msg.text?.includes('guardar') || msg.text?.includes('conversación'));
        return !hasRecentOffer;
    }
    async detectIntent(message) {
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
        }
        catch (error) {
            console.error('Error detectando intención:', error);
            return 'question';
        }
    }
    async getUserContext(userId) {
        try {
            const now = new Date();
            const monthFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
            const eventsResult = await index_1.db.query(`SELECT title, description, start_datetime, location 
         FROM calendar_events 
         WHERE user_id = $1 AND start_datetime BETWEEN $2 AND $3
         ORDER BY start_datetime ASC
         LIMIT 20`, [userId, now.toISOString(), monthFromNow.toISOString()]);
            const notesResult = await index_1.db.query(`SELECT content, hashtags 
         FROM notes 
         WHERE user_id = $1 AND NOT hashtags && ARRAY['#secreto']
         ORDER BY created_at DESC
         LIMIT 20`, [userId]);
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
                    if (event.location)
                        context += ` en ${event.location}`;
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
        }
        catch (error) {
            console.error('Error obteniendo contexto:', error);
            return '';
        }
    }
    async generateResponse(message, context, conversationHistory) {
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
                conversationContext = '\n\nHISTORIAL DE LA CONVERSACIÓN:\n';
                conversationHistory.forEach((msg) => {
                    conversationContext += `${msg.type === 'user' ? 'Usuario' : 'Tú'}: ${msg.text}\n`;
                });
                conversationContext += '\n';
            }
            let prompt = '';
            if (isPersonalQuestion && context.length > 50) {
                prompt = `Eres MemoVoz, asistente personal inteligente. Responde brevemente (1-2 oraciones).${conversationContext}\n${context}\n\nPregunta actual: ${message}\n\nRespuesta:`;
            }
            else {
                prompt = `Eres MemoVoz, asistente amigable e inteligente. Responde brevemente (1-2 oraciones) manteniendo el contexto de la conversación.${conversationContext}\n\nPregunta actual: ${message}\n\nRespuesta:`;
            }
            const result = await model.generateContent(prompt);
            return result.response.text();
        }
        catch (error) {
            console.error('Error generando respuesta:', error);
            throw error;
        }
    }
    buildDateTime(date, time) {
        return time ? `${date}T${time}:00` : `${date}T00:00:00`;
    }
}
exports.smartAssistantController = new SmartAssistantController();
