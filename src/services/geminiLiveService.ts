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
  onAudioChunk?: (chunk: string) => void;
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
        // Procesar audio inmediatamente
        if (part.inlineData) {
          this.audioChunks.push(part.inlineData.data || '');
          this.currentMimeType = part.inlineData.mimeType || '';
          
          // Callback opcional para streaming
          if (this.streamCallback?.onAudioChunk) {
            this.streamCallback.onAudioChunk(part.inlineData.data || '');
          }
        }
        
        // Procesar texto inmediatamente
        if (part.text) {
          this.textChunks.push(part.text);
          
          // Callback opcional para streaming
          if (this.streamCallback?.onTextChunk) {
            this.streamCallback.onTextChunk(part.text);
          }
        }
      }
    }

    // Notificar cuando el turno esté completo
    if (message.serverContent?.turnComplete && this.streamCallback?.onComplete) {
      this.streamCallback.onComplete();
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

    // Enviar mensaje
    this.session!.sendClientContent({
      turns: [text]
    });

    // Esperar a que el turno esté completo
    await this.waitForTurnComplete();

    // Convertir todos los chunks acumulados a WAV
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

    // http://soundfile.sapp.org/doc/WaveFormat
    const byteRate = sampleRate * numChannels * bitsPerSample / 8;
    const blockAlign = numChannels * bitsPerSample / 8;
    const buffer = Buffer.alloc(44);

    buffer.write('RIFF', 0);                      // ChunkID
    buffer.writeUInt32LE(36 + dataLength, 4);     // ChunkSize
    buffer.write('WAVE', 8);                      // Format
    buffer.write('fmt ', 12);                     // Subchunk1ID
    buffer.writeUInt32LE(16, 16);                 // Subchunk1Size (PCM)
    buffer.writeUInt16LE(1, 20);                  // AudioFormat (1 = PCM)
    buffer.writeUInt16LE(numChannels, 22);        // NumChannels
    buffer.writeUInt32LE(sampleRate, 24);         // SampleRate
    buffer.writeUInt32LE(byteRate, 28);           // ByteRate
    buffer.writeUInt16LE(blockAlign, 32);         // BlockAlign
    buffer.writeUInt16LE(bitsPerSample, 34);      // BitsPerSample
    buffer.write('data', 36);                     // Subchunk2ID
    buffer.writeUInt32LE(dataLength, 40);         // Subchunk2Size

    return buffer;
  }

  private convertToWav(rawData: string[], mimeType: string): Buffer {
    const options = this.parseMimeType(mimeType);
    
    // Convertir todos los chunks de base64 a Buffer
    const buffers = rawData.map(data => Buffer.from(data, 'base64'));
    const dataBuffer = Buffer.concat(buffers);
    const dataLength = dataBuffer.length;
    
    // Crear header WAV
    const wavHeader = this.createWavHeader(dataLength, options);
    
    // Combinar header + data
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