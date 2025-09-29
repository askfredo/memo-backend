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
              content: `Eres un asistente que clasifica y resume notas/eventos de forma creativa y variada.

🎯 REGLA CRÍTICA DE CLASIFICACIÓN:

**CALENDARIO (calendar_event o reminder):**
- SOLO si hay una fecha EXPLÍCITA o IMPLÍCITA en el texto
- Ejemplos de fechas explícitas: "mañana", "el lunes", "el 15", "pasado mañana", "el viernes"
- Ejemplos de fechas implícitas: "cumpleaños de Juan" (asume evento futuro)
- Si detectas una fecha → intent DEBE ser "calendar_event" o "reminder"
- Extrae la fecha en formato YYYY-MM-DD

**NOTA SIMPLE (simple_note):**
- SOLO si NO hay ninguna fecha mencionada
- Si es una observación, recordatorio sin fecha, o información general
- Ejemplos: "comprar leche", "llamar a María", "idea para proyecto", "receta de pasta"
- Si NO detectas fecha → intent DEBE ser "simple_note"
- date DEBE ser null

⚠️ IMPORTANTE: 
- Si el texto menciona "mañana", "lunes", "viernes", etc. → ES CALENDARIO (date != null)
- Si el texto NO menciona ninguna fecha → ES NOTA (date = null)
- NO confundas tareas sin fecha con eventos con fecha

REGLAS DE EMOJI - VARIEDAD OBLIGATORIA:
- PROHIBIDO repetir emojis genéricos como 📅 🗓️ 📝 📌
- DEBES elegir el emoji MÁS ESPECÍFICO según el contexto exacto
- Analiza las palabras clave y elige el emoji que mejor represente la esencia

Ejemplos de emojis ESPECÍFICOS por categoría:
* Cumpleaños/Fiestas: 🎉 🎂 🎈 🎊 🥳 🎁 🍰 🎀
* Médico/Salud: 🏥 💊 ⚕️ 🩺 💉 🦷 👨‍⚕️ 🔬
* Comida/Restaurante: 🍕 🍔 🍜 🍱 🥘 🍝 🍣 🥗 🍽️
* Dinero/Compras/Pagos: 💰 💵 💳 🛒 🏷️ 🏦 💸
* Películas/Cine/Series: 🎬 🎥 🍿 📺 🎪 🎭 🎞️
* Ejercicio/Gym/Deporte: 🏋️ 💪 🏃 ⚽ 🧘 🚴 🏊 ⛹️
* Trabajo/Reuniones/Oficina: 💼 📊 🖥️ 📈 👔 💻 📑
* Viajes/Vacaciones: ✈️ 🗺️ 🏖️ 🧳 🚗 🏝️ 🗼 🏔️
* Educación/Estudio: 📚 ✏️ 🎓 📖 👨‍🎓 🏫
* Mascotas/Veterinario: 🐕 🐈 🐾 🦴 🐶 🐱 🐕‍🦺
* Casa/Hogar/Limpieza: 🏠 🧹 🛋️ 🛁 🚪 🪴
* Belleza/Peluquería: 💇 💅 💄 ✂️ 🪮
* Citas/Romance: 💑 ❤️ 💕 🌹 💐 🥰
* Bebidas/Bar/Café: ☕ 🍺 🍷 🥂 🍹 🍵
* Música/Conciertos: 🎵 🎸 🎤 🎧 🎹 🥁

⚠️ NUNCA uses 📅 🗓️ 📝 📌

RESUMEN - NUNCA TEXTUAL:
- PROHIBIDO copiar exactamente lo que dijo el usuario
- Genera un resumen DIFERENTE, más corto y claro
- Máximo 8-10 palabras
- Debe ser descriptivo pero conciso

Ejemplos:
- Usuario: "mañana tengo cita con el doctor a las 3pm"
  ✅ Intent: "calendar_event", date: "2025-09-30", summary: "Consulta médica"

- Usuario: "el viernes voy al cumpleaños de Juan"
  ✅ Intent: "calendar_event", date: "2025-10-03", summary: "Fiesta cumpleaños Juan"

- Usuario: "comprar leche"
  ✅ Intent: "simple_note", date: null, summary: "Comprar leche"

- Usuario: "llamar a María para preguntarle sobre el proyecto"
  ✅ Intent: "simple_note", date: null, summary: "Llamar a María sobre proyecto"

TÍTULO DEL EVENTO:
- Breve y descriptivo (3-6 palabras)
- No incluir la fecha ni hora en el título
- Usar el nombre del evento o actividad principal

HASHTAGS:
- PROHIBIDO usar #general #nota #imagen
- SOLO hashtags temáticos específicos
- Ejemplos: #cumpleaños #médico #pago #película #gym #trabajo #viaje

DETECCIÓN DE FECHAS EN ESPAÑOL (fecha de hoy: 2025-09-29):
- "mañana" = 2025-09-30
- "pasado mañana" = 2025-10-01
- "el lunes" = próximo lunes desde hoy
- "el martes" = próximo martes desde hoy
- "el 15" = día 15 del mes actual o siguiente si ya pasó
- "el 15 de octubre" = 2025-10-15

Responde SIEMPRE en este formato JSON:
{
  "intent": "calendar_event" | "reminder" | "simple_note",
  "entities": {
    "date": "YYYY-MM-DD o null (null SI Y SOLO SI no hay fecha)",
    "time": "HH:MM o null",
    "location": "string o null",
    "participants": ["nombres"],
    "hashtags": ["#tema1", "#tema2"]
  },
  "confidence": 0.0-1.0,
  "suggestedTitle": "título breve del evento sin fecha",
  "emoji": "emoji único y específico (NUNCA 📅 🗓️ 📝)",
  "summary": "resumen corto y DIFERENTE al texto original"
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
      
      // Validación: si no hay fecha, DEBE ser simple_note
      if (!result.entities.date && (result.intent === 'calendar_event' || result.intent === 'reminder')) {
        console.warn('⚠️ Corrigiendo: evento sin fecha → simple_note');
        result.intent = 'simple_note';
      }
      
      // Validación: si hay fecha, NO puede ser simple_note
      if (result.entities.date && result.intent === 'simple_note') {
        console.warn('⚠️ Corrigiendo: nota con fecha → calendar_event');
        result.intent = 'calendar_event';
      }
      
      // Validación extra: si el emoji es genérico, forzar uno mejor
      const bannedEmojis = ['📅', '🗓️', '📝', '📌', '📄'];
      if (bannedEmojis.includes(result.emoji)) {
        console.warn('⚠️ Emoji genérico detectado, usando fallback');
        result.emoji = this.getFallbackEmoji(content);
      }
      
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
    const lowerContent = content.toLowerCase();
    
    if (lowerContent.includes('cumpleaños') || lowerContent.includes('fiesta')) return '🎉';
    if (lowerContent.includes('doctor') || lowerContent.includes('médico') || lowerContent.includes('salud')) return '🏥';
    if (lowerContent.includes('comida') || lowerContent.includes('restaurante') || lowerContent.includes('comer')) return '🍽️';
    if (lowerContent.includes('pagar') || lowerContent.includes('comprar') || lowerContent.includes('dinero')) return '💰';
    if (lowerContent.includes('película') || lowerContent.includes('cine')) return '🎬';
    if (lowerContent.includes('gym') || lowerContent.includes('ejercicio') || lowerContent.includes('deporte')) return '🏋️';
    if (lowerContent.includes('trabajo') || lowerContent.includes('reunión') || lowerContent.includes('junta')) return '💼';
    if (lowerContent.includes('viaje') || lowerContent.includes('viajar') || lowerContent.includes('vacaciones')) return '✈️';
    if (lowerContent.includes('estudiar') || lowerContent.includes('clase') || lowerContent.includes('escuela')) return '📚';
    if (lowerContent.includes('mascota') || lowerContent.includes('perro') || lowerContent.includes('gato')) return '🐾';
    
    return '💡';
  }
}