import dotenv from 'dotenv';
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
  private apiKey: string;

  constructor() {
    this.apiKey = process.env.OPENAI_API_KEY || '';
  }

  async classifyNote(content: string): Promise<ClassificationResult> {
    console.log('🤖 Clasificando nota con IA...');

    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            {
              role: 'system',
              content: `Eres un asistente que clasifica y resume notas/eventos. 

IMPORTANTE:
- Genera un RESUMEN corto y claro del contenido, NO repitas textualmente lo que dijo el usuario
- El resumen debe ser conciso (máximo 10 palabras)
- Para el título del evento, usa un resumen breve y descriptivo
- Elige UN emoji relevante y variado según el contexto:
  * Cumpleaños/Fiestas: 🎉🎂🎈🎊🥳
  * Médico/Salud: 🏥💊⚕️🩺💉
  * Comida/Restaurante: 🍕🍔🍜🍱🥘
  * Dinero/Compras: 💰💵💳🛒🏷️
  * Películas/Entretenimiento: 🎬🎥🍿📺🎪
  * Ejercicio/Gym: 🏋️‍♂️💪🏃‍♂️⚽🧘
  * Trabajo/Reuniones: 💼📊🖥️📁👔
  * Viajes: ✈️🗺️🏖️🧳🚗
  * Educación: 📚✏️🎓📖👨‍🎓
  * Mascotas: 🐕🐈🐾🦴🐶
- Hashtags deben ser temáticos y relevantes (#cumpleaños, #salud, #compras, #película, #ejercicio, #trabajo, etc.)
- NUNCA uses hashtags genéricos como #imagen, #general, #nota

Detecta fechas en español:
- "mañana" = fecha de mañana
- "el lunes", "el martes", etc = próximo día de la semana
- "el 15" = día 15 del mes actual o siguiente
- "el 15 de octubre" = fecha específica

Responde en JSON:
{
  "intent": "calendar_event" | "reminder" | "simple_note",
  "entities": {
    "date": "YYYY-MM-DD o null",
    "time": "HH:MM o null",
    "location": "string o null",
    "participants": ["nombres"],
    "hashtags": ["#tema1", "#tema2"]
  },
  "confidence": 0.0-1.0,
  "suggestedTitle": "título breve del evento",
  "emoji": "emoji único y relevante",
  "summary": "resumen corto en máximo 10 palabras"
}`
            },
            {
              role: 'user',
              content: content
            }
          ],
          response_format: { type: "json_object" },
          temperature: 0.7
        })
      });

      const data = await response.json();
      const result = JSON.parse(data.choices[0].message.content);
      
      console.log('✅ Clasificación:', result);
      return result;

    } catch (error) {
      console.error('Error clasificando nota:', error);
      return {
        intent: 'simple_note',
        entities: {
          date: null,
          time: null,
          location: null,
          participants: [],
          hashtags: ['#general']
        },
        confidence: 0.5,
        suggestedTitle: content.substring(0, 30),
        emoji: '📝',
        summary: content.substring(0, 50)
      };
    }
  }
}