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

    // Obtener fecha y hora actual del sistema
    const now = new Date();
    const currentDate = now.toISOString().split('T')[0]; // YYYY-MM-DD
    const currentTime = now.toTimeString().split(' ')[0].substring(0, 5); // HH:MM
    const dayOfWeek = now.toLocaleDateString('es-ES', { weekday: 'long' });
    
    // Calcular fechas futuras para el prompt
    const tomorrow = new Date(now.getTime() + 86400000).toISOString().split('T')[0];
    const dayAfterTomorrow = new Date(now.getTime() + 172800000).toISOString().split('T')[0];

    console.log(`📅 Contexto de fecha actual: ${currentDate} (${dayOfWeek}) ${currentTime}`);

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

⏰ FECHA Y HORA ACTUAL DEL SISTEMA:
- HOY es: ${currentDate}
- Día de la semana: ${dayOfWeek}
- Hora actual: ${currentTime}
- MAÑANA será: ${tomorrow}
- PASADO MAÑANA será: ${dayAfterTomorrow}

⚠️ IMPORTANTE: USA ESTAS FECHAS COMO REFERENCIA para calcular todas las fechas relativas.

🎯 REGLAS CRÍTICAS - DEBES SEGUIR ESTRICTAMENTE:

1. EMOJI - VARIEDAD OBLIGATORIA:
   - PROHIBIDO repetir emojis genéricos como 📅 🗓️ 📝 📌
   - DEBES elegir el emoji MÁS ESPECÍFICO según el contexto exacto
   - Analiza las palabras clave y elige el emoji que mejor represente la esencia del evento
   
   Ejemplos de emojis ESPECÍFICOS por categoría:
   * Cumpleaños/Fiestas: 🎉 🎂 🎈 🎊 🥳 🎁 🍰 🎀
   * Médico/Salud: 🏥 💊 ⚕️ 🩺 💉 🦷 👨‍⚕️ 🔬
   * Comida/Restaurante: 🍕 🍔 🍜 🍱 🥘 🍝 🍣 🥗 🍽️
   * Dinero/Compras/Pagos: 💰 💵 💳 🛒 🏷️ 🏦 💸
   * Películas/Cine/Series: 🎬 🎥 🍿 📺 🎪 🎭 🎞️
   * Ejercicio/Gym/Deporte: 🏋️ 💪 🏃 ⚽ 🧘 🚴 🏊 ⛹️
   * Trabajo/Reuniones/Oficina: 💼 📊 🖥️ 📈 👔 💻 🔑
   * Viajes/Vacaciones: ✈️ 🗺️ 🏖️ 🧳 🚗 🏝️ 🗼 🏔️
   * Educación/Estudio: 📚 ✏️ 🎓 📖 👨‍🎓 🏫 📝
   * Mascotas/Veterinario: 🐕 🐈 🐾 🦴 🐶 🐱 🐕‍🦺
   * Casa/Hogar/Limpieza: 🏠 🧹 🛋️ 🛁 🚪 🪴
   * Belleza/Peluquería: 💇 💅 💄 ✂️ 🪮
   * Citas/Romance: 💑 ❤️ 💕 🌹 💍 🥰
   * Bebidas/Bar/Café: ☕ 🍺 🍷 🥂 🍹 🍵
   * Música/Conciertos: 🎵 🎸 🎤 🎧 🎹 🥁
   * Religión/Misa: ⛪ 🙏 ✝️ 📿
   
   ⚠️ Si no hay un emoji perfecto, elige el más cercano pero NUNCA uses 📅 🗓️ 📝 📌

2. RESUMEN - NUNCA TEXTUAL:
   - PROHIBIDO copiar exactamente lo que dijo el usuario
   - Genera un resumen DIFERENTE, más corto y claro
   - Máximo 8-10 palabras
   - Debe ser descriptivo pero conciso
   
   Ejemplos:
   - Usuario: "mañana tengo cita con el doctor a las 3pm"
     ❌ MAL: "Cita con el doctor mañana a las 3pm"
     ✅ BIEN: "Consulta médica" o "Revisión con doctor"
   
   - Usuario: "el viernes voy al cumpleaños de Juan"
     ❌ MAL: "Cumpleaños de Juan el viernes"
     ✅ BIEN: "Fiesta cumpleaños Juan" o "Celebración Juan"

3. TÍTULO DEL EVENTO:
   - Breve y descriptivo (3-6 palabras)
   - No incluir la fecha ni hora en el título
   - Usar el nombre del evento o actividad principal

4. HASHTAGS:
   - PROHIBIDO usar #general #nota #imagen
   - SOLO hashtags temáticos específicos
   - Ejemplos: #cumpleaños #médico #pago #película #gym #trabajo #viaje #misa #religión

5. DETECCIÓN DE FECHAS EN ESPAÑOL:
   Usa ${currentDate} (${dayOfWeek}) como punto de partida para calcular:
   - "hoy" = ${currentDate}
   - "mañana" = ${tomorrow}
   - "pasado mañana" = ${dayAfterTomorrow}
   - "el domingo", "el lunes", "el martes", etc = próximo día de la semana desde hoy
   - "el 15" = día 15 del mes actual (si ya pasó, entonces mes siguiente)
   - "el 15 de octubre" = fecha específica con año ${now.getFullYear()}
   - Si solo mencionan hora sin fecha, asumir que es HOY (${currentDate})
   
   EJEMPLOS CONCRETOS:
   - "mañana a las 3pm" → date: "${tomorrow}", time: "15:00"
   - "pasado mañana 10am" → date: "${dayAfterTomorrow}", time: "10:00"
   - "a las 5pm" (sin mención de día) → date: "${currentDate}", time: "17:00"
   - "el domingo a las 10" → calcular próximo domingo desde ${currentDate}

6. FORMATO DE HORA:
   - Siempre en formato 24 horas HH:MM
   - "3pm" = "15:00"
   - "10am" = "10:00"
   - "mediodía" = "12:00"
   - "medianoche" = "00:00"

Responde SIEMPRE en este formato JSON:
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
          temperature: 0.8
        })
      });

      const data = await response.json();
      const result = JSON.parse(data.choices[0].message.content);
      
      // Validación extra: si el emoji es genérico, forzar uno mejor
      const bannedEmojis = ['📅', '🗓️', '📝', '📌', '📄'];
      if (bannedEmojis.includes(result.emoji)) {
        console.warn('⚠️ Emoji genérico detectado, usando fallback');
        result.emoji = this.getFallbackEmoji(content);
      }
      
      console.log('✅ Clasificación completa:', result);
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
    if (lowerContent.includes('misa') || lowerContent.includes('iglesia') || lowerContent.includes('religión')) return '⛪';
    
    return '💡';
  }
}