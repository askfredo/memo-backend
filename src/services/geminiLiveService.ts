// backend/src/services/geminiLiveService.ts
import { GoogleGenAI, LiveServerMessage, MediaResolution, Modality, Session } from '@google/genai';

interface AudioChunk {
  data: string;
  mimeType: string;
}

export class GeminiLiveService {
  private ai: GoogleGenAI;
  private session: Session | undefined;
  private responseQueue: LiveServerMessage[] = [];
  private audioChunks: AudioChunk[] = [];

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
            voiceName: 'Zephyr', // 🎤 Voz mejorada: más natural e inteligente
          }
        }
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
          this.responseQueue.push(message);
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

  async sendMessage(text: string): Promise<{ audioData: string, mimeType: string, text: string }> {
    if (!this.session) {
      await this.connect();
    }

    this.audioChunks = [];
    this.responseQueue = [];

    this.session!.sendClientContent({
      turns: [text]
    });

    const turn = await this.handleTurn();
    
    // Extraer audio y texto
    let audioData = '';
    let mimeType = '';
    let responseText = '';

    for (const message of turn) {
      if (message.serverContent?.modelTurn?.parts) {
        for (const part of message.serverContent.modelTurn.parts) {
          if (part.inlineData) {
            audioData += part.inlineData.data || '';
            mimeType = part.inlineData.mimeType || '';
          }
          if (part.text) {
            responseText += part.text;
          }
        }
      }
    }

    return { audioData, mimeType, text: responseText };
  }

  private async handleTurn(): Promise<LiveServerMessage[]> {
    const turn: LiveServerMessage[] = [];
    let done = false;
    
    while (!done) {
      const message = await this.waitMessage();
      turn.push(message);
      if (message.serverContent && message.serverContent.turnComplete) {
        done = true;
      }
    }
    
    return turn;
  }

  private async waitMessage(): Promise<LiveServerMessage> {
    let message: LiveServerMessage | undefined;
    
    while (!message) {
      message = this.responseQueue.shift();
      if (!message) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    
    return message;
  }

  close(): void {
    if (this.session) {
      this.session.close();
      this.session = undefined;
    }
  }
}

export const geminiLiveService = new GeminiLiveService();