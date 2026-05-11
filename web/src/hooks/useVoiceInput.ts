import { useState, useRef, useEffect, useCallback } from 'react';

interface UseVoiceInputReturn {
  transcript: string;
  interimTranscript: string;
  isListening: boolean;
  startListening: () => void;
  stopListening: () => void;
  clearTranscript: () => void;
  error: string | null;
}

export function useVoiceInput(): UseVoiceInputReturn {
  const [transcript, setTranscript] = useState('');
  const [interimTranscript, setInterimTranscript] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);

  useEffect(() => {
    // Check if browser supports Web Speech API
    const SpeechRecognition = window.SpeechRecognition || (window as any).webkitSpeechRecognition;
    
    if (!SpeechRecognition) {
      setError('Speech recognition is not supported in this browser');
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let interim = '';
      let final = '';

      // Process all results
      for (let i = 0; i < event.results.length; i++) {
        const result = event.results[i];
        const text = result[0].transcript;
        
        if (result.isFinal) {
          final += text + ' ';
        } else {
          interim += text;
        }
      }

      // Set the final transcript (accumulated final results)
      if (final) {
        setTranscript(final.trim());
      }
      
      // Set interim transcript (temporary, will be replaced)
      setInterimTranscript(interim);
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      // The 'network' error fires when the browser's speech service can't
      // reach Google/Apple's recognition backend. Translate it into the
      // same plain-English message the rest of the app uses so the
      // marketer doesn't see jargon mid-visit.
      if (event.error === 'network') {
        setError("Dictation lost service. Type your notes — they'll save here.");
      } else if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        setError('Microphone permission was denied. Enable it in your browser settings to use dictation.');
      } else if (event.error === 'no-speech') {
        // Common when the marketer takes a moment to think. Don't alarm them.
        setError(null);
      } else {
        setError(`Dictation error: ${event.error}`);
      }
      setIsListening(false);
    };

    recognition.onend = () => {
      setIsListening(false);
      // Move any remaining interim to final when stopping
      setInterimTranscript('');
    };

    recognitionRef.current = recognition;

    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
    };
  }, []);

  const startListening = useCallback(() => {
    if (recognitionRef.current && !isListening) {
      // Web Speech API recognition is cloud-based on Chrome and most Android
      // browsers; iOS Safari can do on-device but only on iOS 17+. Either
      // way, the kindest UX when offline is to fail fast with an
      // actionable message instead of a silent dead mic.
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        setError("Dictation needs internet. Type your notes — they'll save here.");
        setIsListening(false);
        return;
      }
      setError(null);
      setInterimTranscript('');
      setIsListening(true);
      try {
        recognitionRef.current.start();
      } catch (err: any) {
        setError(`Failed to start: ${err.message}`);
        setIsListening(false);
      }
    }
  }, [isListening]);

  const stopListening = useCallback(() => {
    if (recognitionRef.current && isListening) {
      recognitionRef.current.stop();
      setIsListening(false);
      setInterimTranscript('');
    }
  }, [isListening]);

  const clearTranscript = useCallback(() => {
    setTranscript('');
    setInterimTranscript('');
  }, []);

  return {
    transcript,
    interimTranscript,
    isListening,
    startListening,
    stopListening,
    clearTranscript,
    error
  };
}

// Types are declared in src/types/speech-recognition.d.ts
