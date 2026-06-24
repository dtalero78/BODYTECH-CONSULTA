import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Dictado en vivo con la Web Speech API del navegador (Chrome/Edge).
 *
 * Transcribe el MICRÓFONO LOCAL (la voz del coach) en tiempo real y entrega el
 * texto final a un callback (que el componente usa para llenar el campo activo).
 * No captura el audio remoto del afiliado — para eso está la grabación
 * post-llamada que mezcla ambos.
 *
 * - `continuous` + auto-restart: Chrome corta tras silencios; reiniciamos solo.
 * - `interimResults`: expone un preview en vivo mientras se habla.
 */
type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((e: any) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: any) => void) | null;
};

export function useLiveDictation(opts?: { lang?: string }) {
  const lang = opts?.lang ?? 'es-CO';
  const SR: any =
    typeof window !== 'undefined'
      ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
      : undefined;
  const supported = !!SR;

  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const shouldListenRef = useRef(false);
  const onFinalRef = useRef<((text: string) => void) | null>(null);

  /** Define a dónde van los resultados finales (el componente lo actualiza). */
  const setOnFinal = useCallback((fn: ((text: string) => void) | null) => {
    onFinalRef.current = fn;
  }, []);

  useEffect(() => {
    if (!supported) return;
    const rec: SpeechRecognitionLike = new SR();
    rec.lang = lang;
    rec.continuous = true;
    rec.interimResults = true;

    rec.onresult = (e: any) => {
      let finalText = '';
      let interimText = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) finalText += res[0].transcript;
        else interimText += res[0].transcript;
      }
      if (finalText && onFinalRef.current) onFinalRef.current(finalText.trim());
      setInterim(interimText);
    };

    rec.onerror = (e: any) => {
      // 'no-speech'/'aborted' son recuperables (el onend reinicia). 'not-allowed'
      // o 'service-not-allowed' son fatales (permiso de micrófono denegado).
      if (e?.error === 'not-allowed' || e?.error === 'service-not-allowed') {
        shouldListenRef.current = false;
        setListening(false);
      }
    };

    rec.onend = () => {
      setInterim('');
      if (shouldListenRef.current) {
        // Reinicio defensivo (Chrome corta el reconocimiento tras pausas).
        try {
          rec.start();
        } catch {
          /* ya iniciado / en transición */
        }
      } else {
        setListening(false);
      }
    };

    recRef.current = rec;
    return () => {
      shouldListenRef.current = false;
      try {
        rec.abort();
      } catch {
        /* noop */
      }
      recRef.current = null;
    };
  }, [supported, lang, SR]);

  const start = useCallback(() => {
    if (!supported || !recRef.current) return;
    shouldListenRef.current = true;
    try {
      recRef.current.start();
      setListening(true);
    } catch {
      /* ya está escuchando */
    }
  }, [supported]);

  const stop = useCallback(() => {
    shouldListenRef.current = false;
    try {
      recRef.current?.stop();
    } catch {
      /* noop */
    }
    setListening(false);
  }, []);

  return { supported, listening, interim, start, stop, setOnFinal };
}
