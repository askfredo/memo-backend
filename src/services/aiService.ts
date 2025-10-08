import dotenv from 'dotenv';
import { GoogleGenerativeAI } from '@google/generative-ai';
dotenv.config();

interface ClassificationResult {
  intent: 'calendar_event' | 'reminder' | 'simple_note' | 'checklist_note';
  entities: {
    date: string | null;
    time: string | null;
    location: string | null;
    participants: string[];
    hashtags: string[];
  };
  confidence: number;
  suggestedTitle: string;
  emoji: string;
  summary: string;
  reformattedContent?: string | null;
}

export class AIService {
  private genAI: GoogleGenerativeAI;

  constructor() {
    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';
    this.genAI = new GoogleGenerativeAI(apiKey);
  }

  async classifyNote(content: string): Promise<ClassificationResult> {
    console.log('🤖 Clasificando nota con IA...');

    const now = new Date();
    const currentDate = now.toISOString().split('T')[0];
    const currentTime = now.toTimeString().split(' ')[0].substring(0, 5);
    const dayOfWeek = now.toLocaleDateString('es-ES', { weekday: 'long' });
    const tomorrow = new Date(now.getTime() + 86400000).toISOString().split('T')[0];

    console.log(`📅 Contexto: ${currentDate} (${dayOfWeek}) ${currentTime}`);

    try {
      const model = this.genAI.getGenerativeModel({ 
        model: 'gemini-2.5-flash-preview-tts',
        generationConfig: {
          temperature: 0.7,
          responseMimeType: 'application/json',
        },
      });

      const prompt = `Clasifica notas en español. HOY: ${currentDate} (${dayOfWeek}), hora: ${currentTime}, mañana: ${tomorrow}.

CLASIFICACIÓN DE INTENT (MUY IMPORTANTE):
- "calendar_event": SI detectas palabras como "mañana", "el lunes", "el martes", "pasado mañana", "hoy", nombres de días, fechas específicas, horas ("3pm", "a las 5", "10am") → SIEMPRE usa "calendar_event"
- "reminder": Solo cuando dice explícitamente "recordar", "no olvidar" SIN mencionar día ni hora específica
- "checklist_note": SOLO cuando tiene MÚLTIPLES items claramente separados por comas Y son al menos 3 items diferentes (ej: "comprar pan, leche, huevos")
- "simple_note": TODO LO DEMÁS - Ideas, pensamientos, observaciones, UNA SOLA tarea o acción

REGLAS CRÍTICAS PARA LISTAS:
Solo usar "checklist_note" y reformatear SI:
1. Hay 3+ items CLARAMENTE separados por comas o "y"
2. El usuario dice explícitamente "lista de", "checklist", "tareas"
3. Ejemplos que SÍ son listas: "comprar pan, leche, huevos, atún" (4 items diferentes)
4. Ejemplos que NO son listas: "comprar pan" (1 item), "recordar pagar celular" (1 acción), "ir al banco a las 3" (1 evento)

REFORMATEO DE LISTAS (solo para checklist_note):
Si es checklist_note:
1. Detecta cada item individual
2. Agrega un emoji específico para cada item
3. Formatea con bullet • al inicio de cada línea
4. Separa cada item con salto de línea (\n)
5. Devuelve en "reformattedContent"

Ejemplo: "comprar pan leche huevo atún" → "• 🥖 Pan\n• 🥛 Leche\n• 🥚 Huevo\n• 🟦 Atún"

Si NO es checklist_note, deja reformattedContent como null y mantén el texto original.

EJEMPLOS CRÍTICOS:
- "el viernes a las 10am" → intent: "calendar_event", time: "10:00", reformattedContent: null
- "recordar comprar leche" → intent: "simple_note" o "reminder", reformattedContent: null
- "comprar pan" → intent: "simple_note", reformattedContent: null
- "comprar pan, leche, huevos, atún" → intent: "checklist_note", reformattedContent: "• 🥖 Pan\n• 🥛 Leche\n• 🥚 Huevos\n• 🟦 Atún"
- "idea para proyecto" → intent: "simple_note", reformattedContent: null
- "pagar celular y luz" → intent: "simple_note", reformattedContent: null (solo 2 items, mantener simple)

REGLAS:
1. EMOJI: Elige el MÁS específico. 
   Ejemplos: cumpleaños→🎉 médico→🏥 comida→🍽️ pago→💰 cine→🎬 gym→🏋️ trabajo→💼 viaje→✈️ estudio→📚 mascota→🐾 misa→⛪ bebida→☕ música→🎵 belleza→💇

2. RESUMEN: Max 8 palabras. Parafrasea.

3. TÍTULO: 3-6 palabras, sin fecha ni hora.

4. HASHTAGS: OBLIGATORIO generar SOLO 1 hashtag. NUNCA más de uno. Ejemplos: #médico #cumpleaños #trabajo #compras #gym #cine

5. FECHAS: "hoy"→${currentDate}, "mañana"→${tomorrow}, "el domingo"→próximo domingo

6. HORA: Formato 24h. MUY IMPORTANTE - Conversión correcta:
   - "1 de la tarde" / "1pm" = "13:00"
   - "2 de la tarde" / "2pm" = "14:00"
   - "1 de la mañana" / "1am" = "01:00"
   - "10 de la mañana" / "10am" = "10:00"
   - "medianoche" = "00:00"
   REGLA: Si dice "tarde" o "pm" con número 1-11, SUMA 12. Si dice "mañana" o "am", usa el número tal cual.

Responde SOLO con JSON en este formato:
{
  "intent": "calendar_event|reminder|simple_note|checklist_note",
  "entities": {
    "date": "YYYY-MM-DD o null",
    "time": "HH:MM o null",
    "location": "string o null",
    "participants": ["nombres"],
    "hashtags": ["#tema"]
  },
  "confidence": 0.0-1.0,
  "suggestedTitle": "título breve",
  "emoji": "emoji específico",
  "summary": "resumen corto",
  "reformattedContent": "contenido con bullets si es checklist_note, o null si no"
}

Texto a clasificar: "${content}"`;

      const result = await model.generateContent(prompt);
      const response = result.response;
      const text = response.text();
      
      const parsed = JSON.parse(text);
      
      // Validación de emojis prohibidos
      const banned = ['📅', '🗓️', '📝', '📌', '📄'];
      if (banned.includes(parsed.emoji)) {
        parsed.emoji = this.getFallbackEmoji(content);
      }

      // VALIDACIÓN ADICIONAL: Si marcó como checklist pero no tiene reformattedContent, convertir a simple_note
      if (parsed.intent === 'checklist_note' && !parsed.reformattedContent) {
        parsed.intent = 'simple_note';
      }

      // Si hay contenido reformateado, usarlo
      if (parsed.reformattedContent) {
        parsed.summary = parsed.reformattedContent;
      }
      
      console.log('✅ Clasificación completa:', parsed);
      return parsed;

    } catch (error) {
      console.error('Error clasificando nota:', error);
      return {
        intent: 'simple_note',
        entities: {
          date: null,
          time: null,
          location: null,
          participants: [],
          hashtags: ['#nota']
        },
        confidence: 0.5,
        suggestedTitle: content.substring(0, 30),
        emoji: this.getFallbackEmoji(content),
        summary: content.substring(0, 50),
        reformattedContent: null
      };
    }
  }

  private getFallbackEmoji(content: string): string {
    const c = content.toLowerCase();
    
    if (c.match(/cumpleaños|fiesta|celebr/)) return '🎉';
    if (c.match(/doctor|médico|hospital|salud|cita médica/)) return '🏥';
    if (c.match(/comida|restaurante|comer|almuerzo|cena/)) return '🍽️';
    if (c.match(/pagar|comprar|dinero|banco|cuenta/)) return '💰';
    if (c.match(/película|cine|serie|netflix/)) return '🎬';
    if (c.match(/gym|ejercicio|deporte|entrenar/)) return '🏋️';
    if (c.match(/trabajo|reunión|junta|oficina/)) return '💼';
    if (c.match(/viaje|viajar|vacaciones|vuelo/)) return '✈️';
    if (c.match(/estudiar|clase|escuela|universidad/)) return '📚';
    if (c.match(/mascota|perro|gato|veterinario/)) return '🐾';
    if (c.match(/misa|iglesia|religión|templo/)) return '⛪';
    if (c.match(/café|bar|cerveza|copa/)) return '☕';
    if (c.match(/música|concierto|banda/)) return '🎵';
    if (c.match(/peluquería|corte|belleza/)) return '💇';
    
    return '💡';
  }
}