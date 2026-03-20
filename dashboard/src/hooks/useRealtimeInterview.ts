import { useState, useRef, useCallback } from "react";
import { api } from "../api/client";

export type InterviewStatus = "idle" | "connecting" | "active" | "processing" | "done" | "error";

interface TranscriptEntry {
  role: "user" | "assistant";
  text: string;
  timestamp: number;
}

interface UseRealtimeInterviewReturn {
  status: InterviewStatus;
  elapsed: number;
  transcript: TranscriptEntry[];
  error: string | null;
  start: (preInfo?: { name?: string; role?: string; company?: string; bio?: string }) => Promise<void>;
  stop: () => void;
}

export function useRealtimeInterview(): UseRealtimeInterviewReturn {
  const [status, setStatus] = useState<InterviewStatus>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval>>(undefined);
  const startTimeRef = useRef<number>(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const cleanup = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (dcRef.current) {
      dcRef.current.close();
      dcRef.current = null;
    }
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    if (audioRef.current) {
      audioRef.current.srcObject = null;
      audioRef.current = null;
    }
  }, []);

  const start = useCallback(async (preInfo?: { name?: string; role?: string; company?: string; bio?: string }) => {
    setError(null);
    setTranscript([]);
    setElapsed(0);
    setStatus("connecting");

    try {
      // Request mic permission
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch {
        setError("Microphone access is required for the voice interview. Please allow microphone access and try again.");
        setStatus("error");
        return;
      }
      streamRef.current = stream;

      // Get ephemeral token from our server
      const session = await api.createInterviewSession(preInfo);

      // Set up WebRTC
      const pc = new RTCPeerConnection();
      pcRef.current = pc;

      // Play remote audio
      const audio = document.createElement("audio");
      audio.autoplay = true;
      audioRef.current = audio;
      pc.ontrack = (e) => { audio.srcObject = e.streams[0]; };

      // Add local mic track
      pc.addTrack(stream.getTracks()[0]);

      // Data channel for events
      const dc = pc.createDataChannel("oai-events");
      dcRef.current = dc;

      dc.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          // Capture transcript from conversation events
          if (msg.type === "response.audio_transcript.done" && msg.transcript) {
            setTranscript((prev) => [...prev, { role: "assistant", text: msg.transcript, timestamp: Date.now() }]);
          }
          if (msg.type === "conversation.item.input_audio_transcription.completed" && msg.transcript) {
            setTranscript((prev) => [...prev, { role: "user", text: msg.transcript, timestamp: Date.now() }]);
          }
        } catch {
          // ignore non-JSON messages
        }
      };

      // Create offer
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      // Connect to OpenAI Realtime
      const sdpResponse = await fetch("https://api.openai.com/v1/realtime/calls", {
        method: "POST",
        body: offer.sdp,
        headers: {
          Authorization: `Bearer ${session.client_secret}`,
          "Content-Type": "application/sdp",
        },
      });

      if (!sdpResponse.ok) {
        throw new Error("Failed to connect to OpenAI Realtime API");
      }

      const answer = { type: "answer" as const, sdp: await sdpResponse.text() };
      await pc.setRemoteDescription(answer);

      // Start timer
      startTimeRef.current = Date.now();
      timerRef.current = setInterval(() => {
        setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000));
      }, 1000);

      setStatus("active");

      // Send session update to enable input audio transcription
      dc.onopen = () => {
        dc.send(JSON.stringify({
          type: "session.update",
          session: {
            input_audio_transcription: {
              model: "gpt-4o-mini-transcribe",
            },
          },
        }));
      };
    } catch (err: any) {
      setError(err.message ?? "Failed to start interview");
      setStatus("error");
      cleanup();
    }
  }, [cleanup]);

  const stop = useCallback(() => {
    cleanup();
    setStatus("done");
  }, [cleanup]);

  return { status, elapsed, transcript, error, start, stop };
}
