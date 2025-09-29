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
    console.log('ðŸ¤– Clasificando nota con IA...');

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
- El resumen debe ser conciso (mÃ¡ximo 10 palabras)
- Para el tÃ­tulo del evento, usa un resumen breve y descriptivo
- Elige UN emoji relevante y variado segÃºn el contexto:
  * CumpleaÃ±os/Fiestas: ðŸŽ‰ðŸŽ‚ðŸŽˆðŸŽŠðŸ¥³
  * MÃ©dico/Salud: ðŸ¥ðŸ’Šâš•ï¸ðŸ©ºðŸ’‰
  * Comida/Restaurante: ðŸ•ðŸ”ðŸœðŸ±ðŸ¥˜
  * Dinero/Compras: ðŸ’°ðŸ’µðŸ’³ðŸ›’ðŸ·ï¸
  * PelÃ­culas/Entretenimiento: ðŸŽ¬ðŸŽ¥ðŸ¿ðŸ“ºðŸŽª
  * Ejercicio/Gym: ðŸ‹ï¸â€â™‚ï¸ðŸ’ªðŸƒâ€â™‚ï¸âš½ðŸ§˜
  * Trabajo/Reuniones: ðŸ’¼ðŸ“ŠðŸ–¥ï¸ðŸ“ðŸ‘”
  * Viajes: âœˆï¸ðŸ—ºï¸ðŸ–ï¸ðŸ§³ðŸš—
  * EducaciÃ³n: ðŸ“šâœï¸ðŸŽ“ðŸ“–ðŸ‘¨â€ðŸŽ“
  * Mascotas: ðŸ•ðŸˆðŸ¾ðŸ¦´ðŸ¶
- Hashtags deben ser temÃ¡ticos y relevantes (#cumpleaÃ±os, #salud, #compras, #pelÃ­cula, #ejercicio, #trabajo, etc.)
- NUNCA uses hashtags genÃ©ricos como #imagen, #general, #nota

Detecta fechas en espaÃ±ol:
- "maÃ±ana" = fecha de maÃ±ana
- "el lunes", "el martes", etc = prÃ³ximo dÃ­a de la semana
- "el 15" = dÃ­a 15 del mes actual o siguiente
- "el 15 de octubre" = fecha especÃ­fica

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
  "suggestedTitle": "tÃ­tulo breve del evento",
  "emoji": "emoji Ãºnico y relevante",
  "summary": "resumen corto en mÃ¡ximo 10 palabras"
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
      
      console.log('âœ… ClasificaciÃ³n:', result);
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
        emoji: 'ðŸ“',
        summary: content.substring(0, 50)
      };
    }
  }
}