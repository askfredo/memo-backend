import OpenAI from 'openai';

interface NoteClassification {
  intent: 'simple_note' | 'calendar_event' | 'reminder' | 'social_event';
  entities: {
    date?: string;
    time?: string;
    location?: string;
    participants?: string[];
    hashtags?: string[];
  };
  confidence: number;
  suggestedTitle?: string;
  emoji?: string;
}

export class AIService {
  private client: OpenAI;

  constructor() {
    this.client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY || '',
    });
  }

  async classifyNote(noteContent: string): Promise<NoteClassification> {
    const today = new Date();
    const currentDate = today.toISOString().split('T')[0];
    const dayOfWeek = today.getDay();
    
    const prompt = `Fecha actual: ${currentDate} (día de la semana: ${dayOfWeek}, donde 0=domingo)

Clasifica esta nota: "${noteContent}"

REGLAS ESTRICTAS:
1. "calendar_event" = Menciona fecha/tiempo Y hora específica
   Ejemplos: "reunión mañana a las 9", "cita viernes 3pm", "evento el martes 10:30"

2. "reminder" = Menciona fecha/tiempo PERO SIN hora específica  
   Ejemplos: "compras mañana", "llamar el lunes", "comprar regalo mañana"

3. "social_event" = Menciona personas Y tiene fecha/hora
   Ejemplos: "cena con Ana mañana 8pm", "reunión con Maria viernes 5pm"

4. "simple_note" = NO menciona fecha ni tiempo
   Ejemplos: "comprar leche", "idea para proyecto", "recordar contraseña"

CÁLCULO DE FECHAS:
- "mañana" = ${new Date(today.getTime() + 86400000).toISOString().split('T')[0]}
- "lunes/martes/etc" = próxima ocurrencia de ese día
- "la otra semana" = próxima semana

IMPORTANTE:
- Genera emoji relevante al contenido
- Genera 2-3 hashtags relevantes
- Si tiene hora específica (9am, 3pm, 10:30) → calendar_event
- Si solo dice día sin hora → reminder
- Si no dice ni día ni hora → simple_note

Responde en JSON:
{
  "intent": "<tipo>",
  "entities": {
    "date": "YYYY-MM-DD o null",
    "time": "HH:MM o null",
    "location": "string o null",
    "participants": ["nombre"] o [],
    "hashtags": ["#tag1", "#tag2"]
  },
  "confidence": 0.9,
  "suggestedTitle": "título corto",
  "emoji": "😊"
}`;

    const completion = await this.client.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: "Eres experto clasificando notas en español. Responde SOLO JSON válido."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      temperature: 0.1,
      response_format: { type: "json_object" }
    });

    const responseText = completion.choices[0].message.content || '{}';
    return JSON.parse(responseText);
  }
}

export const aiService = new AIService();