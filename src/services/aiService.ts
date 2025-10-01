import dotenv from 'dotenv';
import { GoogleGenerativeAI } from '@google/generative-ai';
dotenv.config();

interface ClassificationResult {
  intent: 'calendar_event' | 'reminder' | 'simple_note';
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
        model: 'gemini-2.5-flash',
        generationConfig: {
          temperature: 0.7,
          responseMimeType: 'application/json',
        },
      });

      const prompt = `Clasifica notas en español. HOY: ${currentDate} (${dayOfWeek}), hora: ${currentTime}, mañana: ${tomorrow}.

CLASIFICACIÓN DE INTENT (MUY IMPORTANTE):
- "calendar_event": SI detectas palabras como "mañana", "el lunes", "el martes", "pasado mañana", "hoy", nombres de días, fechas específicas, horas ("3pm", "a las 5", "10am") → SIEMPRE usa "calendar_event"
- "reminder": Solo cuando dice explícitamente "recordar", "no olvidar" SIN mencionar día ni hora específica
- "simple_note": Ideas, pensamientos, observaciones SIN referencias temporales

CRÍTICO - REFORMATEAR LISTAS:
Si el texto contiene múltiples items (separados por comas, espacios, "y", o palabras como "comprar"):
1. Detecta cada item individual
2. Agrega un emoji específico para cada item
3. Formatea con bullet • al inicio de cada línea
4. Separa cada item con salto de línea (\n)
5. Devuelve el texto reformateado en el campo "reformattedContent"

Ejemplos de reformateo:
Input: "comprar pan leche huevo atún"
Output reformattedContent: "• 🥖 Pan\n• 🥛 Leche\n• 🥚 Huevo\n• 🐟 Atún"

Input: "anota creatina omega 3 y cordones"
Output reformattedContent: "• 💊 Creatina\n• 🐟 Omega 3\n• 👟 Cordones"

Input: "tareas limpiar cocina lavar ropa sacar perro"
Output reformattedContent: "• 🧹 Limpiar cocina\n• 👕 Lavar ropa\n• 🐕 Sacar perro"

Si NO es lista (una sola cosa), deja reformattedContent como null.

EJEMPLOS CRÍTICOS:
- "mañana tengo dentista" → intent: "calendar_event", date: "${tomorrow}", time: null, reformattedContent: null
- "el viernes voy al cine" → intent: "calendar_event", date: (calcular próximo viernes), time: null, reformattedContent: null
- "hoy a las 5pm reunión" → intent: "calendar_event", date: "${currentDate}", time: "17:00", reformattedContent: null
- "mañana a las 4 de la tarde" → intent: "calendar_event", date: "${tomorrow}", time: "16:00", reformattedContent: null
- "el viernes a las 10am" → intent: "calendar_event", time: "10:00", reformattedContent: null
- "hoy a las 3pm reunión" → intent: "calendar_event", date: "${currentDate}", time: "15:00", reformattedContent: null
- "pasado mañana cumpleaños Juan" → intent: "calendar_event", reformattedContent: null
- "recordar comprar leche" → intent: "reminder", date: null, reformattedContent: null
- "idea para proyecto" → intent: "simple_note", date: null, reformattedContent: null

REGLAS:
1. EMOJI: Elige el MÁS específico. 
   Ejemplos: cumpleaños→🎉 médico→🥇 comida→🍽️ pago→💰 cine→🎬 gym→🏋️ trabajo→💼 viaje→✈️ estudio→📚 mascota→🐾 misa→⛪ bebida→☕ música→🎵 belleza→💇

2. RESUMEN: Max 8 palabras. Parafrasea.

3. TÍTULO: 3-6 palabras, sin fecha ni hora.

4. HASHTAGS: OBLIGATORIO generar SOLO 1 hashtag. NUNCA más de uno. Ejemplos de hashtags ÚNICOS: #médico #cumpleaños #trabajo #compras #gym #cine

5. FECHAS: "hoy"→${currentDate}, "mañana"→${tomorrow}, "el domingo"→próximo domingo, "a las 5pm" (sin día)→${currentDate}

6. HORA: Formato 24h. MUY IMPORTANTE - Conversión correcta:
   - "1 de la tarde" / "1pm" = "13:00"
   - "2 de la tarde" / "2pm" = "14:00"
   - "3 de la tarde" / "3pm" = "15:00"
   - "4 de la tarde" / "4pm" = "16:00"
   - "5 de la tarde" / "5pm" = "17:00"
   - "6 de la tarde" / "6pm" = "18:00"
   - "7 de la tarde" / "7pm" = "19:00"
   - "8 de la tarde" / "8pm" = "20:00"
   - "9 de la tarde" / "9pm" = "21:00"
   - "10 de la tarde" / "10pm" = "22:00"
   - "11 de la tarde" / "11pm" = "23:00"
   - "12 de la tarde" / "mediodía" = "12:00"
   - "1 de la mañana" / "1am" = "01:00"
   - "10 de la mañana" / "10am" = "10:00"
   - "medianoche" = "00:00"
   REGLA: Si dice "tarde" o "pm" con número 1-11, SUMA 12. Si dice "mañana" o "am", usa el número tal cual.

Responde SOLO con JSON en este formato:
{
  "intent": "calendar_event|reminder|simple_note",
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
  "summary": "resumen corto diferente",
  "reformattedContent": "contenido con bullets y emojis si es lista, o null si no"
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
        summary: content.substring(0, 50)
      };
    }
  }

  private getFallbackEmoji(content: string): string {
    const c = content.toLowerCase();
    
    if (c.match(/cumpleaños|fiesta|celebr/)) return '🎉';
    if (c.match(/doctor|médico|hospital|salud|cita médica/)) return '🥇';
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