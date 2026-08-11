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
  const peersRef = useRef({});       // { userId: RTCPeerConnection }
  const channelRef = useRef(null);
  const audioRefs = useRef({});      // { userId: HTMLAudioElement }

  const getOrCreatePeer = useCallback((peerId) => {
    if (peersRef.current[peerId]) return peersRef.current[peerId];

    const pc = new RTCPeerConnection(ICE_SERVERS);

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        channelRef.current?.send({
          type: 'broadcast',
          event: 'voice_signal',
          payload: { type: 'ice', from: userId, to: peerId, candidate: e.candidate },
        });
      }
    };

    pc.ontrack = (e) => {
      if (!audioRefs.current[peerId]) {
        const audio = new Audio();
        audio.autoplay = true;
        audioRefs.current[peerId] = audio;
      }
      audioRefs.current[peerId].srcObject = e.streams[0];
      setActiveSpeakers((prev) => prev.includes(peerId) ? prev : [...prev, peerId]);
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
        setActiveSpeakers((prev) => prev.filter((id) => id !== peerId));
        delete peersRef.current[peerId];
        delete audioRefs.current[peerId];
      }
    };

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => {
        pc.addTrack(track, localStreamRef.current);
      });
    }

    peersRef.current[peerId] = pc;
    return pc;
  }, [userId]);

  // Setup signaling channel
  useEffect(() => {
    if (!roomId || !userId) return;

    const channel = supabase.channel(`voice:${roomId}`, {
      config: { broadcast: { self: false } },
    });

    channel.on('broadcast', { event: 'voice_signal' }, async (payload) => {
      const signal = payload.payload;
      if (!signal || signal.to !== userId) return;

      const pc = getOrCreatePeer(signal.from);

      if (signal.type === 'offer') {
        await pc.setRemoteDescription(new RTCSessionDescription(signal.offer));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        channel.send({
          type: 'broadcast',
          event: 'voice_signal',
          payload: { type: 'answer', from: userId, to: signal.from, answer },
        });
      } else if (signal.type === 'answer') {
        await pc.setRemoteDescription(new RTCSessionDescription(signal.answer));
      } else if (signal.type === 'ice') {
        await pc.addIceCandidate(new RTCIceCandidate(signal.candidate)).catch(() => {});
      } else if (signal.type === 'join') {
        // New peer joined — initiate offer if we have mic
        if (localStreamRef.current) {
          const newPc = getOrCreatePeer(signal.from);
          const offer = await newPc.createOffer();
          await newPc.setLocalDescription(offer);
          channel.send({
            type: 'broadcast',
            event: 'voice_signal',
            payload: { type: 'offer', from: userId, to: signal.from, offer },
          });
        }
      }
    });

    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        setIsConnected(true);
        // Announce presence to existing peers
        channel.send({
          type: 'broadcast',
          event: 'voice_signal',
          payload: { type: 'join', from: userId, to: '*' },
        });
      }
    });

    channelRef.current = channel;

    return () => {
      supabase.removeChannel(channel);
      channelRef.current = null;
      setIsConnected(false);
    };
  }, [roomId, userId, getOrCreatePeer]);

  const startTalking = useCallback(async () => {
    setMicError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      localStreamRef.current = stream;

      // Mute by default — only unmute when holding
      stream.getAudioTracks().forEach((t) => { t.enabled = true; });

      // Add track to all existing peers
      Object.entries(peersRef.current).forEach(async ([peerId, pc]) => {
        stream.getTracks().forEach((track) => pc.addTrack(track, stream));
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        channelRef.current?.send({
          type: 'broadcast',
          event: 'voice_signal',
          payload: { type: 'offer', from: userId, to: peerId, offer },
        });
      });

      setIsTalking(true);
    } catch (err) {
      setMicError('تعذّر الوصول للميكروفون. تأكد من منح الإذن.');
      console.error('[voice startTalking]', err);
    }
  }, [userId]);

  const stopTalking = useCallback(() => {
    if (localStreamRef.current) {
      localStreamRef.current.getAudioTracks().forEach((t) => { t.enabled = false; });
    }
    setIsTalking(false);
  }, []);

  const cleanup = useCallback(() => {
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    Object.values(peersRef.current).forEach((pc) => pc.close());
    peersRef.current = {};
    Object.values(audioRefs.current).forEach((audio) => { audio.srcObject = null; });
    audioRefs.current = {};
    setIsTalking(false);
    setActiveSpeakers([]);
  }, []);

  useEffect(() => () => cleanup(), [cleanup]);

  return { isTalking, activeSpeakers, micError, isConnected, startTalking, stopTalking };
}
