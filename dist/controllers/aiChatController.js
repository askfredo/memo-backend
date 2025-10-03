"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.aiChatController = void 0;
const index_1 = require("../db/index");
const generative_ai_1 = require("@google/generative-ai");
const genAI = new generative_ai_1.GoogleGenerativeAI(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '');
class AIChatController {
    async chat(req, res) {
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
        }
        catch (error) {
            console.error('❌ Error detallado en chat:', error);
            console.error('Stack:', error.stack);
            res.status(500).json({
                error: 'Internal server error',
                details: error.message
            });
        }
    }
    async saveConversation(req, res) {
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
            const result = await index_1.db.query(`INSERT INTO notes (user_id, content, note_type, hashtags, ai_classification)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`, [userId, content, 'simple_note', ['#conversacion', '#ai'], JSON.stringify({ type: 'ai_conversation' })]);
            res.json({ note: result.rows[0] });
        }
        catch (error) {
            console.error('Error guardando conversación:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }
    async getUserContext(userId) {
        try {
            const now = new Date();
            const monthFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
            // Obtener eventos del próximo mes
            const eventsResult = await index_1.db.query(`SELECT title, description, start_datetime, location 
         FROM calendar_events 
         WHERE user_id = $1 AND start_datetime BETWEEN $2 AND $3
         ORDER BY start_datetime ASC
         LIMIT 20`, [userId, now.toISOString(), monthFromNow.toISOString()]);
            // Obtener notas recientes (últimas 20)
            const notesResult = await index_1.db.query(`SELECT content, hashtags, created_at 
         FROM notes 
         WHERE user_id = $1 AND NOT hashtags && ARRAY['#secreto']
         ORDER BY created_at DESC
         LIMIT 20`, [userId]);
            // Formatear contexto
            let context = 'INFORMACIÓN DEL USUARIO:\n\n';
            if (eventsResult.rows.length > 0) {
                context += 'EVENTOS Y CITAS PRÓXIMOS (30 DÍAS):\n';
                eventsResult.rows.forEach(event => {
                    const date = new Date(event.start_datetime);
                    const dateStr = date.toLocaleDateString('es-ES', {
                        weekday: 'long',
                        day: 'numeric',
                        month: 'long',
                        hour: '2-digit',
                        minute: '2-digit'
                    });
                    context += `- ${event.title} (${dateStr})`;
                    if (event.location)
                        context += ` en ${event.location}`;
                    if (event.description)
                        context += ` - ${event.description}`;
                    context += '\n';
                });
                context += '\n';
            }
            if (notesResult.rows.length > 0) {
                context += 'NOTAS Y TAREAS RECIENTES:\n';
                notesResult.rows.forEach(note => {
                    const content = note.content.substring(0, 150);
                    const hashtags = note.hashtags?.join(' ') || '';
                    context += `- ${content}${note.content.length > 150 ? '...' : ''} ${hashtags}\n`;
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
    async generateResponse(message, context) {
        try {
            const model = genAI.getGenerativeModel({
                model: 'gemini-2.5-flash-lite',
                generationConfig: {
                    temperature: 0.7,
                    maxOutputTokens: 500,
                }
            });
            // Detectar preguntas sobre información personal del usuario
            const isPersonalQuestion = /qué|cuál|cuáles|cuándo|dónde|quién|quiénes|tengo|mis|mi|próximo|próxima|esta semana|este mes|hoy|mañana|evento|eventos|tarea|tareas|nota|notas|reunión|reuniones|cita|citas|cumpleaños|fiesta|fiestas|actividad|actividades|pendiente|pendientes|programado|agenda|calendario/i.test(message);
            let prompt = '';
            if (isPersonalQuestion && context.length > 100) {
                // Pregunta personal CON contexto disponible
                prompt = `Eres MemoVoz, un asistente personal inteligente. Analiza el contexto del usuario y responde su pregunta específica.

${context}

Pregunta del usuario: ${message}

IMPORTANTE:
- Busca en TODOS los eventos y notas la información relevante
- Si pregunta por cumpleaños, busca eventos con "cumpleaños" o "cumple" en el título
- Si pregunta por reuniones, busca eventos con "reunión" o "junta" en el título
- Si pregunta por tareas, busca en las notas con checklist (•) o palabras como "hacer", "comprar", "pendiente"
- Si pregunta "quién cumple años", extrae los NOMBRES de los eventos de cumpleaños
- Responde de forma natural y directa (2-3 oraciones)
- Si no encuentras información específica, dilo claramente
- No uses emojis

Respuesta:`;
            }
            else if (isPersonalQuestion && context.length <= 100) {
                // Pregunta personal SIN información
                return "No tengo información registrada sobre eso en tu agenda o notas. ¿Te gustaría agregar algo?";
            }
            else {
                // Conversación general
                prompt = `Eres MemoVoz, un asistente inteligente y amigable. Responde de forma natural y concisa (2-3 oraciones).

Pregunta: ${message}

Responde usando tu conocimiento general. Sé útil y conversacional. No uses emojis.`;
            }
            const result = await model.generateContent(prompt);
            const response = result.response;
            return response.text();
        }
        catch (error) {
            console.error('Error generando respuesta:', error);
            throw error;
        }
    }
}
exports.aiChatController = new AIChatController();
