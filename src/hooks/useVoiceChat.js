import { useEffect, useRef, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';

const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

export function useVoiceChat(roomId, userId) {
  const [isTalking, setIsTalking] = useState(false);
  const [activeSpeakers, setActiveSpeakers] = useState([]);
  const [micError, setMicError] = useState(null);
  const [isConnected, setIsConnected] = useState(false);

  const localStreamRef = useRef(null);
  const peersRef = useRef({});
  const channelRef = useRef(null);
  const audioRefs = useRef({});
  const speakerTimersRef = useRef({});

  const sendSignal = useCallback((payload) => {
    channelRef.current?.send({ type: 'broadcast', event: 'voice_signal', payload });
  }, []);

  const createPeer = useCallback((peerId) => {
    if (peersRef.current[peerId]) return peersRef.current[peerId];

    const pc = new RTCPeerConnection(ICE_SERVERS);

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        sendSignal({ type: 'ice', from: userId, to: peerId, candidate: e.candidate });
      }
    };

    pc.ontrack = (e) => {
      let audio = audioRefs.current[peerId];
      if (!audio) {
        audio = new Audio();
        audio.autoplay = true;
        audioRefs.current[peerId] = audio;
      }
      audio.srcObject = e.streams[0];

      // Detect actual speech using AudioContext
      try {
        const ctx = new AudioContext();
        const source = ctx.createMediaStreamSource(e.streams[0]);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        source.connect(analyser);
        const data = new Uint8Array(analyser.frequencyBinCount);

        const detect = () => {
          if (!peersRef.current[peerId]) return;
          analyser.getByteFrequencyData(data);
          const avg = data.reduce((a, b) => a + b, 0) / data.length;
          if (avg > 10) {
            setActiveSpeakers((prev) => prev.includes(peerId) ? prev : [...prev, peerId]);
            clearTimeout(speakerTimersRef.current[peerId]);
            speakerTimersRef.current[peerId] = setTimeout(() => {
              setActiveSpeakers((prev) => prev.filter((id) => id !== peerId));
            }, 1500);
          }
          requestAnimationFrame(detect);
        };
        detect();
      } catch (_) {}
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        setActiveSpeakers((prev) => prev.filter((id) => id !== peerId));
        delete peersRef.current[peerId];
        if (audioRefs.current[peerId]) {
          audioRefs.current[peerId].srcObject = null;
          delete audioRefs.current[peerId];
        }
      }
    };

    // Add local tracks if mic is already open
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => {
        pc.addTrack(track, localStreamRef.current);
      });
    }

    peersRef.current[peerId] = pc;
    return pc;
  }, [userId, sendSignal]);

  // Init mic once on mount — muted until push-to-talk
  useEffect(() => {
    if (!userId) return;
    navigator.mediaDevices.getUserMedia({ audio: true, video: false })
      .then((stream) => {
        stream.getAudioTracks().forEach((t) => { t.enabled = false; });
        localStreamRef.current = stream;
      })
      .catch((err) => {
        console.error('[voice mic init]', err);
      });
    return () => {
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    };
  }, [userId]);

  // Signaling channel
  useEffect(() => {
    if (!roomId || !userId) return;

    const channel = supabase.channel(`voice:${roomId}`, {
      config: { broadcast: { self: false } },
    });

    channel.on('broadcast', { event: 'voice_signal' }, async (payload) => {
      const signal = payload.payload;
      if (!signal) return;

      // join is broadcast to all — everyone creates a peer for the new joiner
      if (signal.type === 'join' && signal.from !== userId) {
        const pc = createPeer(signal.from);
        if (localStreamRef.current) {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          sendSignal({ type: 'offer', from: userId, to: signal.from, offer });
        }
        return;
      }

      // All other signals are directed
      if (signal.to !== userId) return;

      const pc = createPeer(signal.from);

      if (signal.type === 'offer') {
        await pc.setRemoteDescription(new RTCSessionDescription(signal.offer));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        sendSignal({ type: 'answer', from: userId, to: signal.from, answer });
      } else if (signal.type === 'answer') {
        if (pc.signalingState !== 'stable') {
          await pc.setRemoteDescription(new RTCSessionDescription(signal.answer));
        }
      } else if (signal.type === 'ice') {
        await pc.addIceCandidate(new RTCIceCandidate(signal.candidate)).catch(() => {});
      }
    });

    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        setIsConnected(true);
        // Announce to all existing peers — no `to` filter needed for join
        sendSignal({ type: 'join', from: userId });
      }
    });

    channelRef.current = channel;

    return () => {
      supabase.removeChannel(channel);
      channelRef.current = null;
      setIsConnected(false);
    };
  }, [roomId, userId, createPeer, sendSignal]);

  const startTalking = useCallback(() => {
    if (!localStreamRef.current) {
      setMicError('الميكروفون غير متاح. تأكد من منح الإذن وأعد تحميل الصفحة.');
      return;
    }
    localStreamRef.current.getAudioTracks().forEach((t) => { t.enabled = true; });
    setIsTalking(true);
    setMicError(null);
  }, []);

  const stopTalking = useCallback(() => {
    localStreamRef.current?.getAudioTracks().forEach((t) => { t.enabled = false; });
    setIsTalking(false);
  }, []);

  const cleanup = useCallback(() => {
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    Object.values(peersRef.current).forEach((pc) => pc.close());
    peersRef.current = {};
    Object.values(audioRefs.current).forEach((a) => { a.srcObject = null; });
    audioRefs.current = {};
    Object.values(speakerTimersRef.current).forEach(clearTimeout);
    speakerTimersRef.current = {};
    setIsTalking(false);
    setActiveSpeakers([]);
  }, []);

  useEffect(() => () => cleanup(), [cleanup]);

  return { isTalking, activeSpeakers, micError, isConnected, startTalking, stopTalking };
}
