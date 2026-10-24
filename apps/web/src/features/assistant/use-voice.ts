import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { AssistantAbilities } from '@shoppos/shared';
import { api, ApiError } from '@/lib/api';
import { safeStorage } from '@/lib/storage';

/** Can the assistant use an AI, and read voice messages? (Anyone signed in may know.) */
export const useAbilities = () =>
  useQuery({
    queryKey: ['assistant-abilities'],
    queryFn: () => api.get<AssistantAbilities>('/assistant/abilities'),
    staleTime: 60_000,
    retry: false,
    meta: { silent: true },
  });

/** Languages the browser's own speech recognition can listen for. */
export const VOICE_LANGUAGES = [
  { id: 'en-US', label: 'English' },
  { id: 'si-LK', label: 'සිංහල' },
  { id: 'ta-LK', label: 'தமிழ்' },
] as const;
const LANG_KEY = 'pos-voice-language';

interface Recognition {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}
type RecognitionClass = new () => Recognition;
const browserRecognition = (): RecognitionClass | undefined =>
  (window as unknown as { SpeechRecognition?: RecognitionClass }).SpeechRecognition ??
  (window as unknown as { webkitSpeechRecognition?: RecognitionClass }).webkitSpeechRecognition;

/** Longest voice message (the server takes about two minutes). */
const MAX_SECONDS = 90;

function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/**
 * Voice messages. With the free Groq key the recording is turned into text by Groq's Whisper
 * (any language, detected by itself); otherwise Chrome / Edge listen in the chosen language.
 * Both need internet; typing always works.
 */
export function useVoice(onText: (text: string) => void) {
  const { data: abilities } = useAbilities();
  const mode: 'ai' | 'browser' | null =
    typeof window === 'undefined'
      ? null
      : abilities?.voice && typeof MediaRecorder !== 'undefined' && navigator.mediaDevices
        ? 'ai'
        : browserRecognition()
          ? 'browser'
          : null;
  const [state, setState] = useState<'idle' | 'recording' | 'working'>('idle');
  const [seconds, setSeconds] = useState(0);
  const [language, setLanguageState] = useState(
    () =>
      safeStorage.get(LANG_KEY) ??
      (navigator.language.startsWith('si')
        ? 'si-LK'
        : navigator.language.startsWith('ta')
          ? 'ta-LK'
          : 'en-US'),
  );
  const recorder = useRef<MediaRecorder | null>(null);
  const recognition = useRef<Recognition | null>(null);
  const keep = useRef(true);
  const timer = useRef<number | undefined>(undefined);
  const onTextRef = useRef(onText);
  useEffect(() => {
    onTextRef.current = onText;
  });

  const setLanguage = (id: string) => {
    safeStorage.set(LANG_KEY, id);
    setLanguageState(id);
  };

  const clearTimer = () => {
    window.clearInterval(timer.current);
    timer.current = undefined;
  };

  const stop = useCallback((send = true) => {
    keep.current = send;
    clearTimer();
    if (recorder.current?.state === 'recording') recorder.current.stop();
    if (recognition.current) {
      if (send) recognition.current.stop();
      else recognition.current.abort();
    }
  }, []);

  // Stop listening when the chat closes.
  useEffect(() => () => stop(false), [stop]);

  async function start() {
    if (state !== 'idle') return;
    if (!mode) {
      toast.info('Voice needs the free Groq key (Settings → Assistant), or Chrome or Edge.');
      return;
    }
    keep.current = true;
    setSeconds(0);
    if (mode === 'browser') {
      const Rec = browserRecognition()!;
      const rec = new Rec();
      rec.lang = language;
      rec.interimResults = false;
      rec.maxAlternatives = 1;
      rec.onresult = (e) => {
        const text = Array.from(e.results)
          .map((r) => r[0]?.transcript ?? '')
          .join(' ')
          .trim();
        if (text && keep.current) onTextRef.current(text);
      };
      rec.onerror = (e) => {
        if (e.error === 'not-allowed') toast.error('Allow the microphone to send voice messages.');
        else if (e.error === 'network') toast.error('Voice needs internet. You can still type.');
        else if (e.error !== 'aborted' && e.error !== 'no-speech')
          toast.error('Could not hear that. Please try again.');
      };
      rec.onend = () => {
        clearTimer();
        recognition.current = null;
        setState('idle');
      };
      recognition.current = rec;
      rec.start();
    } else {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch {
        toast.error('Allow the microphone to send voice messages.');
        return;
      }
      const type = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/ogg;codecs=opus',
        'audio/mp4',
      ].find((t) => MediaRecorder.isTypeSupported(t));
      const rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        recorder.current = null;
        if (!keep.current || !chunks.length) {
          setState('idle');
          return;
        }
        setState('working');
        try {
          const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
          const { text } = await api.post<{ text: string }>('/assistant/voice', {
            audio: await toBase64(blob),
            type: blob.type,
          });
          if (text) onTextRef.current(text);
          else toast.info('I did not hear anything. Please try again.');
        } catch (err) {
          toast.error(err instanceof ApiError ? err.message : 'Could not read the voice message.');
        } finally {
          setState('idle');
        }
      };
      recorder.current = rec;
      rec.start();
    }
    setState('recording');
    timer.current = window.setInterval(
      () =>
        setSeconds((s) => {
          if (s + 1 >= MAX_SECONDS) stop(true);
          return s + 1;
        }),
      1000,
    );
  }

  return { mode, state, seconds, start, stop, language, setLanguage };
}

/** Read an answer aloud with the computer's voices (Sinhala and Tamil when Windows has them). */
export function speak(text: string, onEnd?: () => void) {
  const synth = window.speechSynthesis;
  if (!synth) {
    toast.info('This computer cannot read aloud.');
    return;
  }
  synth.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = /[඀-෿]/.test(text)
    ? 'si-LK'
    : /[஀-௿]/.test(text)
      ? 'ta-LK'
      : navigator.language || 'en-US';
  const voice = synth.getVoices().find((v) => v.lang.toLowerCase().startsWith(u.lang.slice(0, 2)));
  if (voice) u.voice = voice;
  u.rate = 1;
  u.onend = () => onEnd?.();
  u.onerror = () => onEnd?.();
  synth.speak(u);
}
