
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
        model: 'gemini-2.5-pro',
        generationConfig: {
          temperature: 0.7,
          responseMimeType: 'application/json',
        },
      });

      const prompt = `Clasifica notas en español. HOY: ${currentDate} (${dayOfWeek}), hora: ${currentTime}, mañana: ${tomorrow}.

CLASIFICACIÓN DE INTENT (CRÍTICO):
- "calendar_event": Cuando hay FECHA/HORA específica (ej: "mañana 3pm", "el lunes", "pasado mañana")
- "reminder": Cuando debe recordarse algo pero SIN fecha/hora específica (ej: "recordar comprar", "no olvidar")
- "simple_note": Solo notas generales sin fechas ni recordatorios (ej: "idea:", "nota:", observaciones)

REGLAS:
1. EMOJI: Elige el MÁS específico. 
   Ejemplos: cumpleaños→🎉 médico→🥇 comida→🍽️ pago→💰 cine→🎬 gym→🏋️ trabajo→💼 viaje→✈️ estudio→📚 mascota→🐾 misa→⛪ bebida→☕ música→🎵 belleza→💇

2. RESUMEN: Max 8 palabras.. Parafrasea.

3. TÍTULO: 3-6 palabras, sin fecha ni hora.

4. HASHTAGS: Específicos temáticos. NO uses #general #nota #imagen

5. FECHAS: "hoy"→${currentDate}, "mañana"→${tomorrow}, "el domingo"→próximo domingo, "a las 5pm" (sin día)→${currentDate}

6. HORA: Formato 24h. "3pm"→"15:00", "10am"→"10:00"

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
  "summary": "resumen corto diferente"
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