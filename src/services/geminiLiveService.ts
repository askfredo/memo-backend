// backend/src/services/geminiLiveService.ts
import { GoogleGenAI, LiveServerMessage, MediaResolution, Modality, Session } from '@google/genai';

interface AudioChunk {
  data: string;
  mimeType: string;
}

interface WavConversionOptions {
  numChannels: number;
  sampleRate: number;
  bitsPerSample: number;
}

interface StreamCallback {
  onAudioChunk?: (chunk: string) => void; // Base64 WAV chunk
  onTextChunk?: (text: string) => void;
  onComplete?: () => void;
}

export class GeminiLiveService {
  private ai: GoogleGenAI;
  private session: Session | undefined;
  private audioChunks: string[] = [];
  private textChunks: string[] = [];
  private currentMimeType: string = '';
  private streamCallback: StreamCallback | null = null;
  private wavOptions: WavConversionOptions | null = null;
  private headerSent: boolean = false;

  constructor() {
    this.ai = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY || '',
    });
  }

  async connect(): Promise<void> {
    const model = 'models/gemini-2.5-flash-native-audio-preview-09-2025';

    const config = {
      responseModalities: [Modality.AUDIO],
      mediaResolution: MediaResolution.MEDIA_RESOLUTION_MEDIUM,
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: {
            voiceName: 'Puck',
          }
        }
      },
      systemInstruction: {
        parts: [{
          text: `Eres MemoVoz, un asistente personal inteligente y conversacional en español.

PERSONALIDAD:
- Amigable, natural y cercano
- Conciso: responde en 2-3 oraciones máximo
- Útil: usa la información de contexto cuando esté disponible
- Profesional pero relajado

REGLAS:
- Si te dan contexto (eventos, notas), úsalo para responder
- Si no encuentras información, dilo claramente
- Mantén coherencia con el historial de conversación
- Responde SOLO en español
- No inventes información que no esté en el contexto`
        }]
      },
      contextWindowCompression: {
        triggerTokens: '25600',
        slidingWindow: { targetTokens: '12800' },
      },
    };

    this.session = await this.ai.live.connect({
      model,
      callbacks: {
        onopen: () => {
          console.log('Gemini Live session opened');
        },
        onmessage: (message: LiveServerMessage) => {
          this.handleStreamMessage(message);
        },
        onerror: (e: ErrorEvent) => {
          console.error('Gemini Live error:', e.message);
        },
        onclose: (e: CloseEvent) => {
          console.log('Gemini Live session closed:', e.reason);
        },
      },
      config
    });
  }

  private handleStreamMessage(message: LiveServerMessage): void {
    if (message.serverContent?.modelTurn?.parts) {
      for (const part of message.serverContent.modelTurn.parts) {
        // Procesar audio inmediatamente en streaming
        if (part.inlineData) {
          const rawData = part.inlineData.data || '';
          this.currentMimeType = part.inlineData.mimeType || '';
          
          // Almacenar para la respuesta final
          this.audioChunks.push(rawData);

          // STREAMING: Enviar chunk inmediatamente convertido a WAV
          if (this.streamCallback?.onAudioChunk && rawData) {
            this.streamAudioChunk(rawData);
          }
        }
        
        // Procesar texto inmediatamente
        if (part.text) {
          this.textChunks.push(part.text);
          
          if (this.streamCallback?.onTextChunk) {
            this.streamCallback.onTextChunk(part.text);
          }
        }
      }
    }

    // Notificar cuando el turno esté completo
    if (message.serverContent?.turnComplete && this.streamCallback?.onComplete) {
      this.streamCallback.onComplete();
      this.headerSent = false; // Reset para el próximo mensaje
    }
  }

  private streamAudioChunk(rawData: string): void {
    if (!this.streamCallback?.onAudioChunk) return;

    // Parsear opciones WAV solo la primera vez
    if (!this.wavOptions && this.currentMimeType) {
      this.wavOptions = this.parseMimeType(this.currentMimeType);
    }

    if (!this.wavOptions) return;

    // Convertir el chunk individual a buffer
    const chunkBuffer = Buffer.from(rawData, 'base64');

    // En el PRIMER chunk, incluir el header WAV
    if (!this.headerSent) {
      // Nota: El header tiene un tamaño de datos estimado
      // Para streaming perfecto, usarías un tamaño grande o
      // crearías un header con tamaño indefinido (0xFFFFFFFF)
      const wavHeader = this.createWavHeader(0xFFFFFFFF - 36, this.wavOptions);
      const firstChunk = Buffer.concat([wavHeader, chunkBuffer]);
      this.streamCallback.onAudioChunk(firstChunk.toString('base64'));
      this.headerSent = true;
    } else {
      // Chunks subsiguientes: solo los datos PCM
      this.streamCallback.onAudioChunk(chunkBuffer.toString('base64'));
    }
  }

  async sendMessage(
    text: string, 
    callback?: StreamCallback
  ): Promise<{ audioData: string, mimeType: string, text: string }> {
    if (!this.session) {
      await this.connect();
    }

    // Resetear estado
    this.audioChunks = [];
    this.textChunks = [];
    this.currentMimeType = '';
    this.streamCallback = callback || null;
    this.wavOptions = null;
    this.headerSent = false;

    // Enviar mensaje
    this.session!.sendClientContent({
      turns: [text]
    });

    // Esperar a que el turno esté completo
    await this.waitForTurnComplete();

    // Convertir todos los chunks acumulados a WAV (para respuesta final)
    let audioData = '';
    let mimeType = 'audio/wav';

    if (this.audioChunks.length > 0 && this.currentMimeType) {
      const wavBuffer = this.convertToWav(this.audioChunks, this.currentMimeType);
      audioData = wavBuffer.toString('base64');
    }

    const responseText = this.textChunks.join('');

    // Limpiar callback
    this.streamCallback = null;

    return { audioData, mimeType, text: responseText };
  }

  private waitForTurnComplete(): Promise<void> {
    return new Promise((resolve) => {
      const originalCallback = this.streamCallback;
      
      this.streamCallback = {
        ...originalCallback,
        onComplete: () => {
          if (originalCallback?.onComplete) {
            originalCallback.onComplete();
          }
          resolve();
        }
      };
    });
  }

  private parseMimeType(mimeType: string): WavConversionOptions {
    const [fileType, ...params] = mimeType.split(';').map(s => s.trim());
    const [_, format] = fileType.split('/');

    const options: Partial<WavConversionOptions> = {
      numChannels: 1,
      bitsPerSample: 16,
    };

    if (format && format.startsWith('L')) {
      const bits = parseInt(format.slice(1), 10);
      if (!isNaN(bits)) {
        options.bitsPerSample = bits;
      }
    }

    for (const param of params) {
      const [key, value] = param.split('=').map(s => s.trim());
      if (key === 'rate') {
        options.sampleRate = parseInt(value, 10);
      }
    }

    return options as WavConversionOptions;
  }

  private createWavHeader(dataLength: number, options: WavConversionOptions): Buffer {
    const {
      numChannels,
      sampleRate,
      bitsPerSample,
    } = options;

    const byteRate = sampleRate * numChannels * bitsPerSample / 8;
    const blockAlign = numChannels * bitsPerSample / 8;
    const buffer = Buffer.alloc(44);

    buffer.write('RIFF', 0);
    buffer.writeUInt32LE(36 + dataLength, 4);
    buffer.write('WAVE', 8);
    buffer.write('fmt ', 12);
    buffer.writeUInt32LE(16, 16);
    buffer.writeUInt16LE(1, 20);
    buffer.writeUInt16LE(numChannels, 22);
    buffer.writeUInt32LE(sampleRate, 24);
    buffer.writeUInt32LE(byteRate, 28);
    buffer.writeUInt16LE(blockAlign, 32);
    buffer.writeUInt16LE(bitsPerSample, 34);
    buffer.write('data', 36);
    buffer.writeUInt32LE(dataLength, 40);

    return buffer;
  }

  private convertToWav(rawData: string[], mimeType: string): Buffer {
    const options = this.parseMimeType(mimeType);
    const buffers = rawData.map(data => Buffer.from(data, 'base64'));
    const dataBuffer = Buffer.concat(buffers);
    const dataLength = dataBuffer.length;
    const wavHeader = this.createWavHeader(dataLength, options);
    
    return Buffer.concat([wavHeader, dataBuffer]);
  }

  close(): void {
    if (this.session) {
      this.session.close();
      this.session = undefined;
    }
  }
}

export const geminiLiveService = new GeminiLiveService();