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

export function useVoiceInput(): UseVoiceInputReturn {
  const [transcript, setTranscript] = useState('');
  const [interimTranscript, setInterimTranscript] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  // Text heard so far in the current dictation session. Kept in refs so the
  // words still being processed when the mic stops can be saved, not dropped.
  const sessionFinalRef = useRef('');
  const sessionInterimRef = useRef('');
  // True from start() until the browser's onend: the mic is running or still
  // shutting down, and start() would throw if called again.
  const activeRef = useRef(false);
  // A tap on the mic while the last session was still shutting down.
  const restartRef = useRef(false);
  const interimTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Ends a session once: from the browser's onend, or from the stop timeout.
  const finishRef = useRef<() => void>(() => {});

  const clearTimers = () => {
    if (interimTimerRef.current) clearTimeout(interimTimerRef.current);
    if (stopTimerRef.current) clearTimeout(stopTimerRef.current);
    interimTimerRef.current = null;
    stopTimerRef.current = null;
  };

  const beginSession = useCallback(() => {
    const recognition = recognitionRef.current;
    if (!recognition) return;
    setError(null);
    // Each session starts fresh; the form already kept the earlier text.
    sessionFinalRef.current = '';
    sessionInterimRef.current = '';
    setTranscript('');
    setInterimTranscript('');
    try {
      recognition.start();
      activeRef.current = true;
      setIsListening(true);
    } catch (err: any) {
      setError(`Failed to start: ${err.message}`);
      setIsListening(false);
    }
  }, []);

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
      setIsListening(false);
    };

    finishRef.current = () => {
      if (!activeRef.current) return;
      clearTimers();
      activeRef.current = false;
      setIsListening(false);
      // Phones often stop without ever finalizing the last words, so keep
      // whatever was still in progress as part of the transcript.
      const kept = [sessionFinalRef.current, sessionInterimRef.current].filter(Boolean).join(' ');
      if (kept) setTranscript(kept);
      setInterimTranscript('');
      sessionFinalRef.current = '';
      sessionInterimRef.current = '';
      if (restartRef.current) {
        restartRef.current = false;
        // Let React apply the kept text before the next session clears it.
        setTimeout(beginSession, 0);
      }
    };
    recognition.onend = () => finishRef.current();

    recognitionRef.current = recognition;

    return () => {
      clearTimers();
      restartRef.current = false;
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      if (activeRef.current) recognition.abort();
      activeRef.current = false;
      recognitionRef.current = null;
    };
  }, [beginSession]);

  const startListening = useCallback(() => {
    if (!recognitionRef.current) return;
    // Web Speech API recognition is cloud-based on Chrome and most Android
    // browsers; iOS Safari can do on-device but only on iOS 17+. Either
    // way, the kindest UX when offline is to fail fast with an
    // actionable message instead of a silent dead mic.
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setError("Dictation needs internet. Type your notes — they'll save here.");
      setIsListening(false);
      return;
    }
    if (activeRef.current) {
      // The last session is still shutting down; start again once it has.
      restartRef.current = true;
      setIsListening(true);
      return;
    }
    beginSession();
  }, [beginSession]);

  const stopListening = useCallback(() => {
    const recognition = recognitionRef.current;
    restartRef.current = false;
    setIsListening(false);
    if (!recognition || !activeRef.current) return;
    // Don't clear the in-progress words here: the browser may still send
    // them as final, and onend keeps them if it doesn't.
    recognition.stop();
    if (stopTimerRef.current) clearTimeout(stopTimerRef.current);
    stopTimerRef.current = setTimeout(() => {
      // Some phones never fire onend after stop(); force it so the mic
      // doesn't stay stuck and the next tap works.
      stopTimerRef.current = null;
      if (!activeRef.current) return;
      recognition.abort();
      finishRef.current();
    }, STOP_TIMEOUT_MS);
  }, []);

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
