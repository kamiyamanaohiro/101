class PsychedelicFMSynth {
    constructor() {
        this.audioContext = null;
        this.isPlaying = false;
        this.activeNotes = new Map();
        this.currentScale = 'd-dorian';
        this.maxVoices = 6;
        this.voiceCounter = null;
        
        // Scale definitions (1 octave lower)
        this.scales = {
            'd-dorian': [
                { note: 'D2', freq: 73.42 },
                { note: 'E2', freq: 82.41 },
                { note: 'F2', freq: 87.31 },
                { note: 'G2', freq: 98.00 },
                { note: 'A2', freq: 110.00 },
                { note: 'B2', freq: 123.47 },
                { note: 'C3', freq: 130.81 },
                { note: 'D3', freq: 146.83 },
                { note: 'E3', freq: 164.81 },
                { note: 'F3', freq: 174.61 },
                { note: 'G3', freq: 196.00 },
                { note: 'A3', freq: 220.00 },
                { note: 'B3', freq: 246.94 },
                { note: 'C4', freq: 261.63 }
            ],
            'a-dorian': [
                { note: 'A2', freq: 110.00 },
                { note: 'B2', freq: 123.47 },
                { note: 'C3', freq: 130.81 },
                { note: 'D3', freq: 146.83 },
                { note: 'E3', freq: 164.81 },
                { note: 'F#3', freq: 185.00 },
                { note: 'G3', freq: 196.00 },
                { note: 'A3', freq: 220.00 },
                { note: 'B3', freq: 246.94 },
                { note: 'C4', freq: 261.63 },
                { note: 'D4', freq: 293.66 },
                { note: 'E4', freq: 329.63 },
                { note: 'F#4', freq: 369.99 },
                { note: 'G4', freq: 392.00 }
            ]
        };

        this.initializeAudio();
        this.setupUI();
        this.createKeyboard();
        this.setupEventListeners();
        this.updateVoiceCounter();
    }

    async initializeAudio() {
        try {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            
            // Delay effect
            this.delayNode = this.audioContext.createDelay(1.0); // Max 1 second delay
            this.delayGain = this.audioContext.createGain();
            this.delayFeedback = this.audioContext.createGain();
            this.delayWetDry = this.audioContext.createGain();
            this.delayDry = this.audioContext.createGain();
            
            // Set initial delay parameters
            this.delayNode.delayTime.value = 0.25; // 250ms delay
            this.delayGain.gain.value = 0.3; // Delay level
            this.delayFeedback.gain.value = 0.4; // Feedback amount
            this.delayWetDry.gain.value = 0.5; // Wet/dry mix
            this.delayDry.gain.value = 0.5; // Dry signal level
            
            // Master gain (VCA)
            this.masterGain = this.audioContext.createGain();
            this.masterGain.gain.value = 0.3;
            
            // 18dB/octave lowpass filter (3-pole)
            this.filter1 = this.audioContext.createBiquadFilter();
            this.filter2 = this.audioContext.createBiquadFilter();
            this.filter3 = this.audioContext.createBiquadFilter();
            
            this.filter1.type = 'lowpass';
            this.filter2.type = 'lowpass';
            this.filter3.type = 'lowpass';
            
            this.filter1.frequency.value = 1000;
            this.filter2.frequency.value = 1000;
            this.filter3.frequency.value = 1000;
            
            this.filter1.Q.value = 1;
            this.filter2.Q.value = 1;
            this.filter3.Q.value = 1;

            // Connect filters in series for 18dB slope
            this.filter1.connect(this.filter2);
            this.filter2.connect(this.filter3);
            
            // Connect delay effect
            // Dry signal path
            this.filter3.connect(this.delayDry);
            this.delayDry.connect(this.masterGain);
            
            // Wet signal path (delay)
            this.filter3.connect(this.delayNode);
            this.delayNode.connect(this.delayGain);
            this.delayGain.connect(this.delayWetDry);
            this.delayWetDry.connect(this.masterGain);
            
            // Feedback loop
            this.delayGain.connect(this.delayFeedback);
            this.delayFeedback.connect(this.delayNode);
            
            this.masterGain.connect(this.audioContext.destination);

            // Create noise buffers
            this.createNoiseBuffers();

        } catch (error) {
            console.error('Audio initialization failed:', error);
        }
    }

    createNoiseBuffers() {
        const bufferSize = this.audioContext.sampleRate * 2;
        
        // White noise
        this.whiteNoiseBuffer = this.audioContext.createBuffer(1, bufferSize, this.audioContext.sampleRate);
        const whiteOutput = this.whiteNoiseBuffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            whiteOutput[i] = Math.random() * 2 - 1;
        }

        // Pink noise (1/f noise)
        this.pinkNoiseBuffer = this.audioContext.createBuffer(1, bufferSize, this.audioContext.sampleRate);
        const pinkOutput = this.pinkNoiseBuffer.getChannelData(0);
        let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
        
        for (let i = 0; i < bufferSize; i++) {
            const white = Math.random() * 2 - 1;
            b0 = 0.99886 * b0 + white * 0.0555179;
            b1 = 0.99332 * b1 + white * 0.0750759;
            b2 = 0.96900 * b2 + white * 0.1538520;
            b3 = 0.86650 * b3 + white * 0.3104856;
            b4 = 0.55000 * b4 + white * 0.5329522;
            b5 = -0.7616 * b5 - white * 0.0168980;
            pinkOutput[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
            pinkOutput[i] *= 0.11;
            b6 = white * 0.115926;
        }
    }

    createFMVoice(frequency) {
        const voice = {
            // Operator 1 (Carrier)
            op1: this.audioContext.createOscillator(),
            op1Gain: this.audioContext.createGain(),
            
            // Operator 2 (Modulator)
            op2: this.audioContext.createOscillator(),
            op2Gain: this.audioContext.createGain(),
            
            // Noise sources
            whiteNoise: this.audioContext.createBufferSource(),
            pinkNoise: this.audioContext.createBufferSource(),
            whiteNoiseGain: this.audioContext.createGain(),
            pinkNoiseGain: this.audioContext.createGain(),
            
            // Voice mixer
            voiceMixer: this.audioContext.createGain(),
            
            // Envelope
            envelope: this.audioContext.createGain()
        };

        // Setup oscillators
        voice.op1.type = 'sine';
        voice.op2.type = 'sine';
        
        voice.op1.frequency.value = frequency;
        const ratio = parseFloat(document.getElementById('fm-ratio').value);
        voice.op2.frequency.value = frequency * ratio;
        
        // Setup FM synthesis (Op2 modulates Op1)
        const fmDepth = parseFloat(document.getElementById('fm-depth').value);
        voice.op2Gain.gain.value = fmDepth;
        voice.op2.connect(voice.op2Gain);
        voice.op2Gain.connect(voice.op1.frequency);
        
        // Connect carrier to voice mixer
        voice.op1Gain.gain.value = 0.5;
        voice.op1.connect(voice.op1Gain);
        voice.op1Gain.connect(voice.voiceMixer);

        // Setup noise sources
        voice.whiteNoise.buffer = this.whiteNoiseBuffer;
        voice.pinkNoise.buffer = this.pinkNoiseBuffer;
        voice.whiteNoise.loop = true;
        voice.pinkNoise.loop = true;
        
        // Get noise levels from UI
        const whiteLevel = parseFloat(document.getElementById('white-noise').value) / 100;
        const pinkLevel = parseFloat(document.getElementById('pink-noise').value) / 100;
        
        voice.whiteNoiseGain.gain.value = whiteLevel * 0.1;
        voice.pinkNoiseGain.gain.value = pinkLevel * 0.1;
        
        voice.whiteNoise.connect(voice.whiteNoiseGain);
        voice.pinkNoise.connect(voice.pinkNoiseGain);
        voice.whiteNoiseGain.connect(voice.voiceMixer);
        voice.pinkNoiseGain.connect(voice.voiceMixer);

        // Setup envelope
        voice.envelope.gain.value = 0;
        voice.voiceMixer.connect(voice.envelope);
        voice.envelope.connect(this.filter1);

        return voice;
    }

    playNote(frequency, noteId) {
        if (this.audioContext.state === 'suspended') {
            this.audioContext.resume();
        }

        // Check if we've reached max voices
        if (this.activeNotes.size >= this.maxVoices) {
            // Stop the oldest voice
            const firstNoteId = this.activeNotes.keys().next().value;
            this.stopNote(firstNoteId, true);
        }

        // Don't play if the same note is already playing
        if (this.activeNotes.has(noteId)) {
            return;
        }

        const voice = this.createFMVoice(frequency);
        this.activeNotes.set(noteId, voice);
        this.updateVoiceCounter();

        // Start oscillators and noise
        voice.op1.start();
        voice.op2.start();
        voice.whiteNoise.start();
        voice.pinkNoise.start();

        // ADSR envelope
        const now = this.audioContext.currentTime;
        voice.envelope.gain.setValueAtTime(0, now);
        voice.envelope.gain.linearRampToValueAtTime(0.8, now + 0.01); // Attack
        voice.envelope.gain.exponentialRampToValueAtTime(0.6, now + 0.1); // Decay
        voice.envelope.gain.setValueAtTime(0.6, now + 0.1); // Sustain
    }

    stopNote(noteId, immediate = false) {
        const voice = this.activeNotes.get(noteId);
        if (voice) {
            const now = this.audioContext.currentTime;
            const releaseTime = immediate ? 0.05 : 0.3;
            
            voice.envelope.gain.cancelScheduledValues(now);
            voice.envelope.gain.setValueAtTime(voice.envelope.gain.value, now);
            voice.envelope.gain.exponentialRampToValueAtTime(0.001, now + releaseTime);

            setTimeout(() => {
                try {
                    voice.op1.stop();
                    voice.op2.stop();
                    voice.whiteNoise.stop();
                    voice.pinkNoise.stop();
                } catch (e) {
                    // Oscillator might already be stopped
                }
                this.activeNotes.delete(noteId);
                this.updateVoiceCounter();
            }, releaseTime * 1000);
        }
    }

    updateAllVoices() {
        this.activeNotes.forEach((voice) => {
            // Update FM parameters for active voices
            const ratio = parseFloat(document.getElementById('fm-ratio').value);
            const fmDepth = parseFloat(document.getElementById('fm-depth').value);
            const op1Freq = voice.op1.frequency.value;
            
            voice.op2.frequency.value = op1Freq * ratio;
            voice.op2Gain.gain.value = fmDepth;
            
            // Update noise levels
            const whiteLevel = parseFloat(document.getElementById('white-noise').value) / 100;
            const pinkLevel = parseFloat(document.getElementById('pink-noise').value) / 100;
            
            voice.whiteNoiseGain.gain.value = whiteLevel * 0.1;
            voice.pinkNoiseGain.gain.value = pinkLevel * 0.1;
        });
    }

    updateFilter() {
        const cutoff = parseFloat(document.getElementById('filter-cutoff').value);
        const resonance = parseFloat(document.getElementById('filter-resonance').value);
        
        this.filter1.frequency.value = cutoff;
        this.filter2.frequency.value = cutoff;
        this.filter3.frequency.value = cutoff;
        
        this.filter1.Q.value = resonance;
        this.filter2.Q.value = resonance;
        this.filter3.Q.value = resonance;
    }

    updateDelay() {
        const delayTime = parseFloat(document.getElementById('delay-time').value) / 1000; // Convert ms to seconds
        const delayFeedback = parseFloat(document.getElementById('delay-feedback').value) / 100;
        const delayMix = parseFloat(document.getElementById('delay-mix').value) / 100;
        
        this.delayNode.delayTime.value = delayTime;
        this.delayFeedback.gain.value = delayFeedback;
        this.delayWetDry.gain.value = delayMix;
        this.delayDry.gain.value = 1 - delayMix; // Inverse for wet/dry balance
    }

    createKeyboard() {
        const keyboard = document.getElementById('keyboard');
        keyboard.innerHTML = '';
        
        const currentNotes = this.scales[this.currentScale];
        const qwertyKeys = ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'A', 'S', 'D', 'F', 'G', 'H', 'J'];
        
        currentNotes.forEach((note, index) => {
            const key = document.createElement('div');
            key.className = 'key';
            
            // Create note label
            const noteLabel = document.createElement('div');
            noteLabel.className = 'note-label';
            noteLabel.textContent = note.note;
            
            // Create keyboard label
            const keyboardLabel = document.createElement('div');
            keyboardLabel.className = 'keyboard-label';
            keyboardLabel.textContent = qwertyKeys[index] || '';
            
            key.appendChild(noteLabel);
            key.appendChild(keyboardLabel);
            
            key.dataset.note = note.note;
            key.dataset.freq = note.freq;
            key.dataset.index = index;
            
            key.addEventListener('mousedown', (e) => {
                e.preventDefault();
                this.handleKeyDown(key);
            });
            
            key.addEventListener('mouseup', (e) => {
                e.preventDefault();
                this.handleKeyUp(key);
            });
            
            key.addEventListener('mouseleave', () => {
                this.handleKeyUp(key);
            });
            
            keyboard.appendChild(key);
        });
    }

    handleKeyDown(key) {
        if (!key.classList.contains('active')) {
            key.classList.add('active');
            const freq = parseFloat(key.dataset.freq);
            const noteId = key.dataset.note;
            this.playNote(freq, noteId);
        }
    }

    handleKeyUp(key) {
        if (key.classList.contains('active')) {
            key.classList.remove('active');
            const noteId = key.dataset.note;
            this.stopNote(noteId);
        }
    }

    setupUI() {
        // Update value displays
        const sliders = document.querySelectorAll('.slider');
        sliders.forEach(slider => {
            const updateDisplay = () => {
                const valueDisplay = document.getElementById(slider.id + '-val');
                if (valueDisplay) {
                    valueDisplay.textContent = slider.value;
                }
            };
            
            updateDisplay();
            slider.addEventListener('input', updateDisplay);
        });

        // Update synth parameters
        document.getElementById('fm-ratio').addEventListener('input', () => this.updateAllVoices());
        document.getElementById('fm-depth').addEventListener('input', () => this.updateAllVoices());
        document.getElementById('white-noise').addEventListener('input', () => this.updateAllVoices());
        document.getElementById('pink-noise').addEventListener('input', () => this.updateAllVoices());
        document.getElementById('filter-cutoff').addEventListener('input', () => this.updateFilter());
        document.getElementById('filter-resonance').addEventListener('input', () => this.updateFilter());
        document.getElementById('delay-time').addEventListener('input', () => this.updateDelay());
        document.getElementById('delay-feedback').addEventListener('input', () => this.updateDelay());
        document.getElementById('delay-mix').addEventListener('input', () => this.updateDelay());
        
        // Voice counter reference
        this.voiceCounter = document.getElementById('voice-counter');
    }

    setupEventListeners() {
        // Scale selection
        document.querySelectorAll('.scale-button').forEach(button => {
            button.addEventListener('click', () => {
                document.querySelectorAll('.scale-button').forEach(b => b.classList.remove('active'));
                button.classList.add('active');
                this.currentScale = button.dataset.scale;
                this.createKeyboard();
            });
        });

        // Panic button
        document.getElementById('panic-button').addEventListener('click', async () => {
            await this.panicStop();
        });

        // Computer keyboard support
        document.addEventListener('keydown', (e) => {
            if (e.repeat) return;
            
            const keyMap = {
                'q': 0, 'w': 1, 'e': 2, 'r': 3, 't': 4, 'y': 5, 'u': 6,
                'a': 7, 's': 8, 'd': 9, 'f': 10, 'g': 11, 'h': 12, 'j': 13
            };
            
            const keyIndex = keyMap[e.key.toLowerCase()];
            if (keyIndex !== undefined) {
                const keys = document.querySelectorAll('.key');
                if (keys[keyIndex]) {
                    this.handleKeyDown(keys[keyIndex]);
                }
            }
        });

        document.addEventListener('keyup', (e) => {
            const keyMap = {
                'q': 0, 'w': 1, 'e': 2, 'r': 3, 't': 4, 'y': 5, 'u': 6,
                'a': 7, 's': 8, 'd': 9, 'f': 10, 'g': 11, 'h': 12, 'j': 13
            };
            
            const keyIndex = keyMap[e.key.toLowerCase()];
            if (keyIndex !== undefined) {
                const keys = document.querySelectorAll('.key');
                if (keys[keyIndex]) {
                    this.handleKeyUp(keys[keyIndex]);
                }
            }
        });

        // Prevent context menu on keys
        document.addEventListener('contextmenu', (e) => {
            if (e.target.classList.contains('key')) {
                e.preventDefault();
            }
        });
    }

    updateVoiceCounter() {
        if (this.voiceCounter) {
            this.voiceCounter.textContent = `Voices: ${this.activeNotes.size}/${this.maxVoices}`;
        }
    }

    async restartAudioEngine() {
        try {
            // Close current audio context completely
            if (this.audioContext && this.audioContext.state !== 'closed') {
                await this.audioContext.close();
            }
            
            // Clear all active notes
            this.activeNotes.clear();
            
            // Reinitialize audio system
            await this.initializeAudio();
            
            // Update filter and delay settings from UI
            this.updateFilter();
            this.updateDelay();
            
        } catch (error) {
            console.error('Audio engine restart failed:', error);
            // Fallback: try to create new context anyway
            try {
                this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
                await this.initializeAudio();
            } catch (fallbackError) {
                console.error('Fallback audio initialization failed:', fallbackError);
            }
        }
    }

    async panicStop() {
        const panicButton = document.getElementById('panic-button');
        
        try {
            // Visual feedback - button becomes disabled
            panicButton.disabled = true;
            panicButton.textContent = '🔄 RESTARTING...';
            panicButton.style.filter = 'brightness(0.5)';
            
            // Remove active class from all keys immediately
            document.querySelectorAll('.key.active').forEach(key => {
                key.classList.remove('active');
            });
            
            // Update counter immediately
            this.updateVoiceCounter();
            
            // Restart the entire audio engine
            await this.restartAudioEngine();
            
            // Restore button
            panicButton.disabled = false;
            panicButton.textContent = '🆘 PANIC / STOP ALL 🆘';
            panicButton.style.filter = 'brightness(1)';
            
        } catch (error) {
            console.error('Panic stop failed:', error);
            
            // Restore button even if restart failed
            panicButton.disabled = false;
            panicButton.textContent = '❌ RETRY PANIC ❌';
            panicButton.style.filter = 'brightness(1)';
            
            // Try to clear notes manually as fallback
            this.activeNotes.clear();
            this.updateVoiceCounter();
        }
    }
}

// Initialize the synthesizer when the page loads
document.addEventListener('DOMContentLoaded', () => {
    const synth = new PsychedelicFMSynth();
    
    // Add some visual feedback for active synthesis
    setInterval(() => {
        if (synth.activeNotes.size > 0) {
            document.body.style.filter = `hue-rotate(${Date.now() % 3600 / 10}deg)`;
        } else {
            document.body.style.filter = 'hue-rotate(0deg)';
        }
    }, 50);
});