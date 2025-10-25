// local-whisper-service.js - Fast local Whisper.cpp integration
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class LocalWhisperService {
    constructor() {
        this.whisperPath = path.join(__dirname, 'whisper.cpp/build/bin/whisper-cli');
        this.modelPath = path.join(__dirname, 'whisper.cpp/models/ggml-base.bin');
        this.tempDir = path.join(__dirname, 'temp_audio');
        
        // Create temp directory
        if (!fs.existsSync(this.tempDir)) {
            fs.mkdirSync(this.tempDir, { recursive: true });
        }
        
        console.log('[Local Whisper] Service initialized');
        console.log('[Local Whisper] Whisper binary:', this.whisperPath);
        console.log('[Local Whisper] Model:', this.modelPath);
    }
    
    async transcribe(audioBuffer, options = {}) {
        const startTime = Date.now();
        
        try {
            // Generate temp filename
            const tempId = crypto.randomUUID();
            const tempWavPath = path.join(this.tempDir, `${tempId}.wav`);
            
            // Write audio buffer to temp file
            fs.writeFileSync(tempWavPath, audioBuffer);
            
            // Prepare Whisper command
            const args = [
                '-m', this.modelPath,
                '-f', tempWavPath,
                '--output-json',
                '--no-prints'  // Reduce output noise
            ];
            
            // Add language if specified
            if (options.language) {
                args.push('-l', options.language === 'ar' ? 'ar' : options.language);
            }
            
            console.log('[Local Whisper] Running transcription...', { language: options.language });
            
            // Run Whisper
            const result = await this.runWhisper(args);
            
            // Clean up temp file
            try {
                fs.unlinkSync(tempWavPath);
            } catch (cleanupError) {
                console.warn('[Local Whisper] Cleanup failed:', cleanupError.message);
            }
            
            const duration = Date.now() - startTime;
            console.log('[Local Whisper] Transcription completed in', duration + 'ms');
            
            return {
                text: result.text || '',
                language: result.language || options.language || 'unknown',
                duration: duration / 1000,
                segments: result.segments || []
            };
            
        } catch (error) {
            console.error('[Local Whisper] Transcription failed:', error);
            throw new Error('Local transcription failed: ' + error.message);
        }
    }
    
    runWhisper(args) {
        return new Promise((resolve, reject) => {
            const whisper = spawn(this.whisperPath, args);
            let stdout = '';
            let stderr = '';
            
            whisper.stdout.on('data', (data) => {
                stdout += data.toString();
            });
            
            whisper.stderr.on('data', (data) => {
                stderr += data.toString();
            });
            
            whisper.on('close', (code) => {
                if (code === 0) {
                    try {
                        // Parse JSON output
                        const jsonMatch = stdout.match(/\{[\s\S]*\}/);
                        if (jsonMatch) {
                            const result = JSON.parse(jsonMatch[0]);
                            resolve(result);
                        } else {
                            // Fallback: extract text from stdout
                            const lines = stdout.split('\n');
                            const textLines = lines.filter(line => 
                                line.trim() && 
                                !line.includes('[') && 
                                !line.includes('whisper_')
                            );
                            resolve({ text: textLines.join(' ').trim() });
                        }
                    } catch (parseError) {
                        console.warn('[Local Whisper] JSON parse failed, using fallback');
                        resolve({ text: stdout.trim() });
                    }
                } else {
                    reject(new Error(`Whisper process failed with code ${code}: ${stderr}`));
                }
            });
            
            whisper.on('error', (error) => {
                reject(new Error(`Failed to start Whisper process: ${error.message}`));
            });
        });
    }
    
    isAvailable() {
        return fs.existsSync(this.whisperPath) && fs.existsSync(this.modelPath);
    }
}

module.exports = LocalWhisperService;