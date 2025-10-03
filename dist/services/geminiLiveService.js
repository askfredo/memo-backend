"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.geminiLiveService = exports.GeminiLiveService = void 0;
// backend/src/services/geminiLiveService.ts
const genai_1 = require("@google/genai");
class GeminiLiveService {
    constructor() {
        this.responseQueue = [];
        this.audioChunks = [];
        this.ai = new genai_1.GoogleGenAI({
            apiKey: process.env.GEMINI_API_KEY || '',
        });
    }
    async connect() {
        const model = 'models/gemini-2.5-flash-native-audio-preview-09-2025';
        const config = {
            responseModalities: [genai_1.Modality.AUDIO],
            mediaResolution: genai_1.MediaResolution.MEDIA_RESOLUTION_MEDIUM,
            speechConfig: {
                voiceConfig: {
                    prebuiltVoiceConfig: {
                        voiceName: 'Zephyr',
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
                onmessage: (message) => {
                    this.responseQueue.push(message);
                },
                onerror: (e) => {
                    console.error('Gemini Live error:', e.message);
                },
                onclose: (e) => {
                    console.log('Gemini Live session closed:', e.reason);
                },
            },
            config
        });
    }
    async sendMessage(text) {
        if (!this.session) {
            await this.connect();
        }
        this.audioChunks = [];
        this.responseQueue = [];
        this.session.sendClientContent({
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
    async handleTurn() {
        const turn = [];
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
    async waitMessage() {
        let message;
        while (!message) {
            message = this.responseQueue.shift();
            if (!message) {
                await new Promise((resolve) => setTimeout(resolve, 100));
            }
        }
        return message;
    }
    close() {
        if (this.session) {
            this.session.close();
            this.session = undefined;
        }
    }
}
exports.GeminiLiveService = GeminiLiveService;
exports.geminiLiveService = new GeminiLiveService();
