import { useState, useRef, useEffect, useCallback } from 'react';
import { fixBakeryTerms, joinFinalPhrases } from '../utils/voiceParser';

interface UseVoiceInputReturn {
  transcript: string;
  interimTranscript: string;
  isListening: boolean;
  startListening: () => void;
  stopListening: () => void;
  clearTranscript: () => void;
  error: string | null;
}

// Words still being spoken update the screen at most this often. Every update
// re-renders the form (or the whole Contacts page), which made slower phones
// lag several times a second while someone talked.
const INTERIM_UPDATE_MS = 200;
// If the browser never confirms the mic stopped, give up on it after this.
const STOP_TIMEOUT_MS = 2000;

function speechRecognitionClass(): (new () => SpeechRecognition) | null {
  if (typeof window === 'undefined') return null;
  return window.SpeechRecognition || (window as any).webkitSpeechRecognition || null;
}

export function useVoiceInput(): UseVoiceInputReturn {
  const [transcript, setTranscript] = useState('');
  const [interimTranscript, setInterimTranscript] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The recognizer for the current dictation. Each tap of the mic gets a new
  // one: phones (iPhones especially) don't reliably start a used one again,
  // and some never report that the last one ended.
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  // Text heard so far in the current dictation. Kept in refs so the words
  // still being processed when the mic stops can be saved, not dropped.
  const sessionFinalRef = useRef('');
  const sessionInterimRef = useRef('');
  const interimTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimers = () => {
    if (interimTimerRef.current) clearTimeout(interimTimerRef.current);
    if (stopTimerRef.current) clearTimeout(stopTimerRef.current);
    interimTimerRef.current = null;
    stopTimerRef.current = null;
  };

  /** Ends this recognizer's dictation once, keeping what it heard. Events from older ones are ignored. */
  const finish = useCallback((recognition: SpeechRecognition) => {
    if (recognitionRef.current !== recognition) return;
    recognitionRef.current = null;
    clearTimers();
    recognition.onresult = null;
    recognition.onerror = null;
    recognition.onend = null;
    setIsListening(false);
    // Phones often stop without ever finalizing the last words, so keep
    // whatever was still in progress as part of the transcript.
    const kept = [sessionFinalRef.current, sessionInterimRef.current].filter(Boolean).join(' ');
    if (kept) setTranscript(kept);
    setInterimTranscript('');
    sessionFinalRef.current = '';
    sessionInterimRef.current = '';
  }, []);

  useEffect(() => {
    if (!speechRecognitionClass()) setError('Speech recognition is not supported in this browser');
    return () => {
      // Leaving the screen: turn the mic off and ignore anything it still sends.
      const recognition = recognitionRef.current;
      recognitionRef.current = null;
      clearTimers();
      if (recognition) {
        recognition.onresult = null;
        recognition.onerror = null;
        recognition.onend = null;
        try { recognition.abort(); } catch { /* already stopped */ }
      }
    };
  }, []);

  const startListening = useCallback(() => {
    const SpeechRecognition = speechRecognitionClass();
    if (!SpeechRecognition) {
      setError('Speech recognition is not supported in this browser');
      return;
    }
    // Web Speech API recognition is cloud-based on Chrome and most Android
    // browsers; iOS Safari can do on-device but only on iOS 17+. Either
    // way, the kindest UX when offline is to fail fast with an
    // actionable message instead of a silent dead mic.
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setError("Dictation needs internet. Type your notes — they'll save here.");
      setIsListening(false);
      return;
    }

    // A previous dictation that never reported ending: drop it now rather
    // than wait for it. Starting has to happen right here, inside the tap,
    // or iPhones may refuse the mic.
    const previous = recognitionRef.current;
    if (previous) {
      finish(previous);
      try { previous.abort(); } catch { /* already stopped */ }
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      if (recognitionRef.current !== recognition) return;
      const finals: string[] = [];
      let interim = '';
      for (let i = 0; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) finals.push(result[0].transcript);
        else interim += result[0].transcript;
      }

      const final = fixBakeryTerms(joinFinalPhrases(finals));
      const interimText = fixBakeryTerms(interim.trim());
      const finalChanged = final !== sessionFinalRef.current;
      sessionFinalRef.current = final;
      sessionInterimRef.current = interimText;

      if (finalChanged) {
        // Finished words show right away, along with whatever is in progress.
        if (interimTimerRef.current) clearTimeout(interimTimerRef.current);
        interimTimerRef.current = null;
        setTranscript(final);
        setInterimTranscript(interimText);
      } else if (!interimTimerRef.current) {
        interimTimerRef.current = setTimeout(() => {
          interimTimerRef.current = null;
          setInterimTranscript(sessionInterimRef.current);
        }, INTERIM_UPDATE_MS);
      }
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      if (recognitionRef.current !== recognition) return;
      // The 'network' error fires when the browser's speech service can't
      // reach Google/Apple's recognition backend. Translate it into the
      // same plain-English message the rest of the app uses so the
      // marketer doesn't see jargon mid-visit.
      if (event.error === 'network') {
        setError("Dictation lost service. Type your notes — they'll save here.");
      } else if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        setError('Microphone permission was denied. Enable it in your browser settings to use dictation.');
      } else if (event.error === 'no-speech' || event.error === 'aborted') {
        // Common when the marketer takes a moment to think, or when we
        // stopped it ourselves. Don't alarm them.
        setError(null);
      } else {
        setError(`Dictation error: ${event.error}`);
      }
      // Some phones never send "end" after an error, so end it here.
      finish(recognition);
    };

    recognition.onend = () => finish(recognition);

    setError(null);
    // Each dictation starts fresh; the form already kept the earlier text.
    sessionFinalRef.current = '';
    sessionInterimRef.current = '';
    setTranscript('');
    setInterimTranscript('');
    recognitionRef.current = recognition;
    try {
      recognition.start();
      setIsListening(true);
    } catch (err: any) {
      recognitionRef.current = null;
      setError(`Failed to start: ${err.message}`);
      setIsListening(false);
    }
  }, [finish]);

  const stopListening = useCallback(() => {
    const recognition = recognitionRef.current;
    setIsListening(false);
    if (!recognition) return;
    // Don't clear the in-progress words here: the browser may still send
    // them as final, and finishing keeps them if it doesn't.
    try { recognition.stop(); } catch { /* already stopped */ }
    if (stopTimerRef.current) clearTimeout(stopTimerRef.current);
    stopTimerRef.current = setTimeout(() => {
      // Some phones never confirm the mic stopped; finish it ourselves so
      // the next tap starts cleanly.
      stopTimerRef.current = null;
      if (recognitionRef.current !== recognition) return;
      finish(recognition);
      try { recognition.abort(); } catch { /* already stopped */ }
    }, STOP_TIMEOUT_MS);
  }, [finish]);

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
