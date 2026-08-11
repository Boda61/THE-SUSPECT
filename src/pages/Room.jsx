import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import { CASES } from '../data/cases';
import SuspectHQ from '../components/SuspectHQ';

export default function Room() {
  const { roomCode: roomId } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [room, setRoom] = useState(null);
  const [players, setPlayers] = useState([]);
  const [leaderboard, setLeaderboard] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [leaving, setLeaving] = useState(false);
  const [startingGame, setStartingGame] = useState(false);
  const [startError, setStartError] = useState(null);

  // Accusation & Verdict state
  const [selectedSuspect, setSelectedSuspect] = useState(null);
  const [selectedEvidence, setSelectedEvidence] = useState([]);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [submittingAccusation, setSubmittingAccusation] = useState(false);
  const [startingNextRound, setStartingNextRound] = useState(false);
  const [accusationError, setAccusationError] = useState(null);

  // Voting phase state
  const [myVotedSuspectId, setMyVotedSuspectId] = useState(null);
  const [votingSummary, setVotingSummary] = useState({ total_players: 0, votes_count: 0, tally: [] });
  const [submittingVote, setSubmittingVote] = useState(false);
  const [voteError, setVoteError] = useState(null);

  // Realtime Chat / Discussion state
  const [messages, setMessages] = useState([]);
  const [newMessageText, setNewMessageText] = useState('');
  const [sendingMsg, setSendingMsg] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const chatBottomRef = useRef(null);

  const [myRole, setMyRole] = useState(null);
  const [activeCase] = useState(CASES[0]);

  // Interactive Investigation state
  const [activeTab, setActiveTab] = useState('scene');
  const [investigationProgress, setInvestigationProgress] = useState({
    searched_locations: [],
    discovered_clues: [],
    solved_puzzles: [],
    made_connections: [],
    recorded_contradictions: [],
  });
  const [inspectedLocation, setInspectedLocation] = useState(null);
  const [selectedBoardClues, setSelectedBoardClues] = useState([]);
  const [activePuzzle, setActivePuzzle] = useState(null);
  const [puzzleAnswerInput, setPuzzleAnswerInput] = useState('');
  const [puzzleError, setPuzzleError] = useState(null);
  const [buildMotive, setBuildMotive] = useState('');
  const [buildOpportunity, setBuildOpportunity] = useState('');
  const [investigationTimeLeft, setInvestigationTimeLeft] = useState(null);

  // Public Suspect HQ Data (For Detectives)
  const [publicSuspectData, setPublicSuspectData] = useState({ alibi: null, defenses: [], interrogations: [] });
  const [newQuestionText, setNewQuestionText] = useState('');
  const [sendingQuestion, setSendingQuestion] = useState(false);

  const channelRef = useRef(null);

  const fetchLeaderboard = useCallback(async () => {
    if (!roomId) return;
    const { data, error: lbError } = await supabase.rpc('get_room_leaderboard', {
      p_room_id: roomId,
    });
    if (!lbError && data) {
      setLeaderboard(data);
    }
  }, [roomId]);

  const fetchMessages = useCallback(async () => {
    if (!roomId) return;
    const { data } = await supabase
      .from('room_messages')
      .select('id, user_id, display_name, message, created_at, round_number')
      .eq('room_id', roomId)
      .order('created_at', { ascending: true });
    if (data) setMessages(data);
  }, [roomId]);

  const fetchVotingSummary = useCallback(async () => {
    if (!roomId) return;
    const { data } = await supabase.rpc('get_room_votes_summary', { p_room_id: roomId });
    if (data) {
      setVotingSummary(data);
      if (data.my_vote_suspect_id) {
        setMyVotedSuspectId(data.my_vote_suspect_id);
      }
    }
  }, [roomId]);

  useEffect(() => {
    if (!user || !roomId) return;
    let cancelled = false;

    const loadRoom = async () => {
      const { data: roomData, error: roomError } = await supabase
        .from('rooms')
        .select('id, code, host_id, status, current_round, accusation_data')
        .eq('id', roomId)
        .single();

      if (cancelled) return;
      if (roomError || !roomData) {
        setError('الغرفة غير موجودة أو لا تملك صلاحية الوصول.');
        setLoading(false);
        return;
      }
      setRoom(roomData);
      document.title = `غرفة ${roomData.code} | The Suspect`;

      const { data: playersData, error: playersError } = await supabase
        .from('room_players')
        .select('id, room_id, user_id, display_name, is_connected, role')
        .eq('room_id', roomId);

      if (cancelled) return;
      if (playersError) {
        setError('تعذّر تحميل قائمة اللاعبين.');
        setLoading(false);
        return;
      }
      setPlayers(playersData || []);
      setLoading(false);

      // Initial fetches
      fetchLeaderboard();
      fetchMessages();
      fetchVotingSummary();
    };

    loadRoom();
    return () => { cancelled = true; };
  }, [roomId, user, fetchLeaderboard, fetchMessages, fetchVotingSummary]);

  useEffect(() => {
    if (chatBottomRef.current && isChatOpen) {
      chatBottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isChatOpen]);

  // Realtime subscription for room_players, rooms status, round_scores, room_messages, and room_votes
  useEffect(() => {
    if (!roomId || !user || loading) return;

    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
    }

    const channel = supabase
      .channel(`lobby:${roomId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'room_players',
          filter: `room_id=eq.${roomId}`,
        },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            setPlayers((prev) => {
              if (prev.some((p) => p.id === payload.new.id)) return prev;
              return [...prev, payload.new];
            });
          } else if (payload.eventType === 'DELETE') {
            setPlayers((prev) => prev.filter((p) => p.id !== payload.old.id));
          } else if (payload.eventType === 'UPDATE') {
            setPlayers((prev) =>
              prev.map((p) => (p.id === payload.new.id ? payload.new : p))
            );
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'rooms',
          filter: `id=eq.${roomId}`,
        },
        (payload) => {
          if (payload.new) {
            setRoom((prev) => (prev ? { ...prev, ...payload.new } : prev));
            if (payload.new.status === 'results') {
              fetchLeaderboard();
            }
            if (payload.new.status === 'voting') {
              fetchVotingSummary();
            }
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'round_scores',
          filter: `room_id=eq.${roomId}`,
        },
        () => {
          fetchLeaderboard();
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'room_messages',
          filter: `room_id=eq.${roomId}`,
        },
        (payload) => {
          if (payload.new) {
            setMessages((prev) => {
              if (prev.some((m) => m.id === payload.new.id)) return prev;
              return [...prev, payload.new];
            });
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'room_votes',
          filter: `room_id=eq.${roomId}`,
        },
        () => {
          fetchVotingSummary();
        }
      )
      .on('broadcast', { event: 'room_action' }, (payload) => {
        if (payload?.payload) {
          const { status, current_round, accusation_data, fetchLb, fetchVotes } = payload.payload;
          setRoom((prev) => {
            if (!prev) return prev;
            const updated = { ...prev };
            if (status) updated.status = status;
            if (current_round !== undefined) updated.current_round = current_round;
            if (accusation_data !== undefined) updated.accusation_data = accusation_data;
            return updated;
          });
          if (fetchLb) fetchLeaderboard();
          if (fetchVotes) fetchVotingSummary();
        }
      })
      .subscribe();

    channelRef.current = channel;

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [roomId, user, loading, fetchLeaderboard, fetchVotingSummary]);

  const broadcastRoomAction = (payload = {}) => {
    channelRef.current?.send({
      type: 'broadcast',
      event: 'room_action',
      payload,
    });
  };

  // Polling fallback to keep players synced if Realtime WebSocket drops or delays
  useEffect(() => {
    if (!roomId || !user || loading) return;

    const interval = setInterval(async () => {
      try {
        const { data: latestRoom } = await supabase
          .from('rooms')
          .select('id, code, host_id, status, current_round, accusation_data')
          .eq('id', roomId)
          .single();

        if (latestRoom) {
          setRoom((prev) => {
            if (!prev) return latestRoom;
            if (
              prev.status !== latestRoom.status ||
              prev.current_round !== latestRoom.current_round ||
              JSON.stringify(prev.accusation_data) !== JSON.stringify(latestRoom.accusation_data)
            ) {
              return { ...prev, ...latestRoom };
            }
            return prev;
          });
        }

        const { data: latestPlayers } = await supabase
          .from('room_players')
          .select('id, room_id, user_id, display_name, is_connected, role')
          .eq('room_id', roomId);

        if (latestPlayers && latestPlayers.length > 0) {
          setPlayers(latestPlayers);
        }
      } catch (pollErr) {
        console.error('[Room polling error]', pollErr);
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [roomId, user, loading]);

  // Fetch private role whenever room enters game state
  useEffect(() => {
    if (!roomId || !user || room?.status === 'waiting') return;
    let cancelled = false;

    const fetchMyRole = async () => {
      try {
        const { data, error: roleError } = await supabase.rpc('get_my_role', {
          p_room_id: roomId,
        });
        if (!cancelled && !roleError && data) {
          setMyRole(data);
        }
      } catch (err) {
        console.error('[fetchMyRole]', err);
      }
    };

    fetchMyRole();
    return () => { cancelled = true; };
  }, [roomId, user, room?.status]);

  // Auto-advance from 'starting' to 'role_assignment' for host
  useEffect(() => {
    if (room?.status !== 'starting' || !room?.host_id || room.host_id !== user?.id) return;

    const timer = setTimeout(async () => {
      const { error: rpcError } = await supabase.rpc('advance_room_status', {
        p_room_id: roomId,
        p_next_status: 'role_assignment',
      });
      if (!rpcError) {
        setRoom((prev) => (prev ? { ...prev, status: 'role_assignment' } : prev));
        broadcastRoomAction({ status: 'role_assignment' });
      }
    }, 2500);

    return () => clearTimeout(timer);
  }, [room?.status, room?.host_id, user?.id, roomId]);

  const handleStartGame = async () => {
    if (startingGame || room?.status !== 'waiting') return;
    setStartError(null);
    setStartingGame(true);

    try {
      const { error: rpcError } = await supabase.rpc('start_game', {
        p_room_id: roomId,
      });

      if (rpcError) {
        const friendlyErrors = {
          'Only the host can start the game': 'فقط المضيف يمكنه بدء اللعبة.',
          'Room is not in waiting status': 'التحقيق بدأ بالفعل.',
          'No connected players in room': 'لا يمكن بدء اللعبة بدون لاعبين متصلين.',
        };
        const matchedMsg = Object.keys(friendlyErrors).find((k) =>
          rpcError.message?.includes(k)
        );
        setStartError(matchedMsg ? friendlyErrors[matchedMsg] : 'فشل بدء اللعبة. حاول مرة أخرى.');
        console.error('[start_game]', rpcError);
      } else {
        setRoom((prev) => (prev ? { ...prev, status: 'starting' } : prev));
        broadcastRoomAction({ status: 'starting' });
      }
    } catch (err) {
      setStartError('حدث خطأ غير متوقع عند بدء اللعبة. حاول مرة أخرى.');
      console.error('[start_game exception]', err);
    } finally {
      setStartingGame(false);
    }
  };

  const handleAdvanceToInvestigation = async () => {
    setRoom((prev) => (prev ? { ...prev, status: 'investigation' } : prev));
    broadcastRoomAction({ status: 'investigation' });
    try {
      const { error: rpcError } = await supabase.rpc('advance_room_status', {
        p_room_id: roomId,
        p_next_status: 'investigation',
      });
      if (rpcError) {
        console.error('[advance_room_status investigation]', rpcError);
      }
    } catch (err) {
      console.error('[advance_room_status investigation exception]', err);
    }
  };

  const handleAdvanceToVoting = async () => {
    setRoom((prev) => (prev ? { ...prev, status: 'voting' } : prev));
    broadcastRoomAction({ status: 'voting' });
    try {
      const { error: rpcError } = await supabase.rpc('advance_room_status', {
        p_room_id: roomId,
        p_next_status: 'voting',
      });
      if (rpcError) {
        console.error('[advance_room_status voting]', rpcError);
      }
    } catch (err) {
      console.error('[advance_room_status voting exception]', err);
    }
  };

  const handleAdvanceToAccusation = async () => {
    setRoom((prev) => (prev ? { ...prev, status: 'accusation' } : prev));
    broadcastRoomAction({ status: 'accusation' });
    try {
      const { error: rpcError } = await supabase.rpc('advance_room_status', {
        p_room_id: roomId,
        p_next_status: 'accusation',
      });
      if (rpcError) {
        console.error('[advance_room_status accusation]', rpcError);
      }
    } catch (err) {
      console.error('[advance_room_status accusation exception]', err);
    }
  };

  const handleVoteSuspect = async (suspectPlayer) => {
    if (submittingVote || suspectPlayer.user_id === user?.id) return;
    setVoteError(null);
    setSubmittingVote(true);

    try {
      const { data, error: rpcError } = await supabase.rpc('submit_vote', {
        p_room_id: roomId,
        p_suspect_user_id: suspectPlayer.user_id,
        p_suspect_name: suspectPlayer.display_name,
      });

      if (rpcError) {
        setVoteError('فشل تسجيل التصويت. تأكد أنك لا تصوت لنفسك.');
        console.error('[submit_vote]', rpcError);
      } else if (data) {
        setMyVotedSuspectId(suspectPlayer.user_id);
        fetchVotingSummary();
        broadcastRoomAction({ type: 'vote_submitted', fetchVotes: true });
      }
    } catch (err) {
      setVoteError('حدث خطأ أثناء التصويت.');
      console.error('[submit_vote exception]', err);
    } finally {
      setSubmittingVote(false);
    }
  };

  const handleSendMessage = async (e) => {
    e.preventDefault();
    if (sendingMsg || !newMessageText.trim()) return;
    setSendingMsg(true);

    try {
      const text = newMessageText.trim();
      setNewMessageText('');
      const { error: rpcError } = await supabase.rpc('send_room_message', {
        p_room_id: roomId,
        p_message: text,
      });
      if (rpcError) {
        console.error('[send_room_message]', rpcError);
      } else {
        broadcastRoomAction({ type: 'chat_message' });
      }
    } catch (err) {
      console.error('[send_room_message exception]', err);
    } finally {
      setSendingMsg(false);
    }
  };

  const toggleEvidenceSelection = (clueId) => {
    setSelectedEvidence((prev) =>
      prev.includes(clueId) ? prev.filter((id) => id !== clueId) : [...prev, clueId]
    );
  };

  const handleSubmitAccusation = async () => {
    if (submittingAccusation || !selectedSuspect) return;
    setAccusationError(null);
    setSubmittingAccusation(true);

    try {
      const { data, error: rpcError } = await supabase.rpc('submit_accusation', {
        p_room_id: roomId,
        p_accused_user_id: selectedSuspect.user_id,
        p_accused_name: selectedSuspect.display_name,
        p_evidence_ids: selectedEvidence,
      });

      if (rpcError) {
        const isNotHost = rpcError.message?.includes('Only the host');
        setAccusationError(
          isNotHost
            ? 'فقط مضيف الغرفة (المحقق الرئيسي) يمكنه تأكيد الاتهام النهائي وإصدار الحكم.'
            : 'تعذّر تسجيل الاتهام. حاول مرة أخرى.'
        );
        console.error('[submit_accusation]', rpcError);
      } else if (data) {
        setShowConfirmModal(false);
        setRoom((prev) => (prev ? { ...prev, status: 'results', accusation_data: data } : prev));
        broadcastRoomAction({ status: 'results', accusation_data: data, fetchLb: true });
        fetchLeaderboard();
      }
    } catch (err) {
      setAccusationError('حدث خطأ أثناء تسجيل الاتهام. حاول مرة أخرى.');
      console.error('[submit_accusation exception]', err);
    } finally {
      setSubmittingAccusation(false);
    }
  };

  const handleStartNextRound = async () => {
    if (startingNextRound) return;
    setStartingNextRound(true);

    try {
      const { error: rpcError } = await supabase.rpc('start_next_round', {
        p_room_id: roomId,
      });

      if (rpcError) {
        console.error('[start_next_round]', rpcError);
      } else {
        setSelectedSuspect(null);
        setSelectedEvidence([]);
        setMyVotedSuspectId(null);
        const nextRound = (room?.current_round || 1) + 1;
        setRoom((prev) => (prev ? { ...prev, status: 'waiting', current_round: nextRound } : prev));
        broadcastRoomAction({ status: 'waiting', current_round: nextRound, fetchLb: true });
      }
    } catch (err) {
      console.error('[start_next_round exception]', err);
    } finally {
      setStartingNextRound(false);
    }
  };

  const handleLeaveRoom = async () => {
    if (leaving) return;
    setLeaving(true);

    try {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }

      const { error: rpcError } = await supabase.rpc('leave_room', {
        p_room_id: roomId,
      });

      if (rpcError) {
        console.error('[leave_room]', rpcError);
      }
    } catch (err) {
      console.error('[leave_room exception]', err);
    } finally {
      navigate('/');
    }
  };

  // — Interactive Investigation Handlers —

  const fetchInvestigationProgress = useCallback(async () => {
    if (!roomId || !room?.current_round) return;
    try {
      const { data } = await supabase.rpc('get_investigation_progress', {
        p_room_id: roomId,
        p_round_number: room.current_round,
      });
      if (data) setInvestigationProgress(data);
    } catch (err) {
      console.error('[get_investigation_progress]', err);
    }
  }, [roomId, room?.current_round]);

  const fetchPublicSuspectData = useCallback(async () => {
    if (!roomId || myRole === 'suspect') return;
    try {
      const { data } = await supabase.rpc('get_public_suspect_data', {
        p_room_id: roomId,
      });
      if (data) setPublicSuspectData(data);
    } catch (err) {
      console.error('[get_public_suspect_data]', err);
    }
  }, [roomId, myRole]);

  useEffect(() => {
    if (!roomId || myRole === 'suspect') return;
    const channel = supabase.channel(`public_hq:${roomId}`)
      .on('broadcast', { event: 'room_action' }, (payload) => {
        const type = payload?.payload?.type;
        if (
          type === 'suspect_public_update' || 
          type === 'suspect_interrogation_answered' || 
          type === 'interrogation_question'
        ) {
          fetchPublicSuspectData();
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [roomId, myRole, fetchPublicSuspectData]);

  // Sync investigation progress on investigation phase start
  useEffect(() => {
    if (room?.status === 'investigation') {
      const timer = setTimeout(() => {
        fetchInvestigationProgress();
        fetchPublicSuspectData();
        setInvestigationTimeLeft(300);
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [room?.status, fetchInvestigationProgress, fetchPublicSuspectData]);

  const handleAskQuestion = async () => {
    if (!newQuestionText.trim() || sendingQuestion) return;
    setSendingQuestion(true);
    try {
      const { error: rpcError } = await supabase.rpc('submit_interrogation_question', {
        p_room_id: roomId,
        p_question_text: newQuestionText.trim()
      });
      if (rpcError) throw rpcError;
      setNewQuestionText('');
      fetchPublicSuspectData();
      broadcastRoomAction({ type: 'interrogation_question' });
    } catch (err) {
      console.error('[submit_interrogation_question]', err);
      alert('فشل إرسال السؤال');
    } finally {
      setSendingQuestion(false);
    }
  };

  // Investigation timer countdown
  useEffect(() => {
    if (room?.status !== 'investigation' || investigationTimeLeft === null) return;
    if (investigationTimeLeft <= 0) return;

    const timer = setInterval(() => {
      setInvestigationTimeLeft((prev) => (prev !== null && prev > 0 ? prev - 1 : 0));
    }, 1000);

    return () => clearInterval(timer);
  }, [room?.status, investigationTimeLeft]);

  const handleSearchLocation = async (loc) => {
    // Open inspection modal immediately
    setInspectedLocation(loc);

    // Optimistically record searched location in UI
    setInvestigationProgress((prev) => {
      const currentLocs = prev.searched_locations || [];
      if (currentLocs.includes(loc.id)) return prev;
      return { ...prev, searched_locations: [...currentLocs, loc.id] };
    });

    try {
      const { data } = await supabase.rpc('search_location', {
        p_room_id: roomId,
        p_round_number: room?.current_round || 1,
        p_location_id: loc.id,
      });
      if (data) {
        setInvestigationProgress(data);
        broadcastRoomAction({ type: 'investigation_update' });
      }
    } catch (err) {
      console.error('[search_location]', err);
    }
  };

  const handleSolvePuzzle = async (puzzle) => {
    if (!puzzleAnswerInput.trim()) return;
    setPuzzleError(null);
    try {
      const { data, error: rpcErr } = await supabase.rpc('solve_clue_puzzle', {
        p_room_id: roomId,
        p_round_number: room?.current_round || 1,
        p_puzzle_id: puzzle.id,
        p_answer: puzzleAnswerInput.trim(),
      });
      if (rpcErr) {
        setPuzzleError('إجابة خاطئة. حاول مرة أخرى!');
      } else if (data) {
        setInvestigationProgress(data);
        setActivePuzzle(null);
        setPuzzleAnswerInput('');
        broadcastRoomAction({ type: 'investigation_update' });
      }
    } catch (err) {
      setPuzzleError('حدث خطأ. حاول مجدداً.');
      console.error('[solve_clue_puzzle]', err);
    }
  };

  const handleAttemptConnection = async () => {
    if (selectedBoardClues.length < 2) return;
    const [clue1Id, clue2Id] = selectedBoardClues;
    const connection = (activeCase.connections || []).find(
      (c) => c.clue_ids?.includes(clue1Id) && c.clue_ids?.includes(clue2Id)
    );
    if (!connection) {
      setSelectedBoardClues([]);
      return;
    }
    try {
      const { data } = await supabase.rpc('create_clue_connection', {
        p_room_id: roomId,
        p_round_number: room?.current_round || 1,
        p_connection_id: connection.id,
        p_clue1_id: clue1Id,
        p_clue2_id: clue2Id,
      });
      if (data) {
        setInvestigationProgress(data);
        broadcastRoomAction({ type: 'investigation_update' });
      }
    } catch (err) {
      console.error('[create_clue_connection]', err);
    } finally {
      setSelectedBoardClues([]);
    }
  };

  const handleRecordContradiction = async (contradiction) => {
    if (investigationProgress.recorded_contradictions?.includes(contradiction.id)) return;
    try {
      const { data } = await supabase.rpc('record_contradiction', {
        p_room_id: roomId,
        p_round_number: room?.current_round || 1,
        p_contradiction_id: contradiction.id,
        p_suspect_id: contradiction.suspect_id,
        p_description: contradiction.description,
      });
      if (data) {
        setInvestigationProgress(data);
        broadcastRoomAction({ type: 'investigation_update' });
      }
    } catch (err) {
      console.error('[record_contradiction]', err);
    }
  };

  const formatTime = (seconds) => {
    if (seconds === null) return '';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  // Derived: which clues are currently accessible/discovered
  const discoveredCluesList = (activeCase?.clues || []).filter((clue) => {
    if (!clue.location_id) return true;
    const isLocSearched = investigationProgress.searched_locations?.includes(clue.location_id);
    if (!isLocSearched) return false;
    if (clue.requires_puzzle) {
      return investigationProgress.solved_puzzles?.includes(clue.puzzle_id);
    }
    return true;
  });

  const discoveredConnectionsList = (activeCase?.connections || []).filter((conn) =>
    investigationProgress.made_connections?.includes(conn.id)
  );

  // — Render states —

  if (loading) {
    return (
      <div className="loader-container">
        <div className="spinner"></div>
        <p className="loader-text">جاري تحميل الغرفة...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="page-wrapper">
        <header className="app-header">
          <div className="logo">المشتبه به</div>
        </header>
        <main className="error-page">
          <div className="glass-card error-card">
            <div className="error-icon">⚠️</div>
            <h2>حدث خطأ!</h2>
            <p>{error}</p>
            <button onClick={() => navigate('/')} className="btn btn-primary">
              العودة للرئيسية
            </button>
          </div>
        </main>
      </div>
    );
  }

  const isHost = room?.host_id === user?.id;
  const currentRoundNumber = room?.current_round || 1;
  const myLeaderboardRow = leaderboard.find((row) => row.user_id === user?.id);

  const copyCode = () => {
    if (room?.code) navigator.clipboard.writeText(room.code);
  };

  const statusLabels = {
    waiting: 'في الانتظار',
    starting: 'بدء اللعبة',
    role_assignment: 'توزيع الأدوار',
    investigation: 'التحقيق والدردشة',
    voting: 'التصويت السري',
    accusation: 'توجيه الاتهام النهائي',
    verdict: 'صدور الحكم',
    results: 'النتيجة وسباق النقاط',
    in_game: 'جارٍ اللعب',
    finished: 'انتهت اللعبة',
    closed: 'مغلقة',
  };

  const statusClass =
    room?.status === 'waiting'
      ? 'status-waiting'
      : 'status-starting';

  const getRankMedal = (rank) => {
    if (rank === 1) return '🥇';
    if (rank === 2) return '🥈';
    if (rank === 3) return '🥉';
    return `#${rank}`;
  };

  return (
    <div className="page-wrapper">
      <header className="app-header">
        <div className="logo">المشتبه به</div>
        <div className="header-right" style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          <button
            onClick={() => setIsChatOpen(!isChatOpen)}
            className="btn btn-ghost btn-sm"
            style={{ position: 'relative' }}
          >
            💬 غرف التحقيق ({messages.length})
          </button>
          <button
            onClick={handleLeaveRoom}
            className="btn btn-ghost btn-sm"
            disabled={leaving}
          >
            {leaving ? 'جاري المغادرة...' : 'مغادرة الغرفة →'}
          </button>
        </div>
      </header>

      <main className="lobby-main">
        <div className="lobby-header">
          <div>
            <h2 className="lobby-title">صالة التحقيق • الجولة {currentRoundNumber}</h2>
            <p className="lobby-status">
              الحالة:{' '}
              <span className={`status-badge ${statusClass}`}>
                {statusLabels[room?.status] || room?.status}
              </span>
            </p>
          </div>

          <button
            className="room-code-btn"
            onClick={copyCode}
            title="اضغط لنسخ كود الغرفة"
            aria-label="نسخ كود الغرفة"
          >
            <span className="room-code-label">كود الغرفة</span>
            <span className="room-code-value" dir="ltr">{room?.code}</span>
            <span className="room-code-copy">📋 انسخ</span>
          </button>
        </div>

        {/* Realtime Chat Drawer / Panel */}
        {isChatOpen && (
          <div className="glass-card" style={{ marginBottom: '1.5rem', padding: '1.25rem', border: '1px solid var(--primary)30' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '0.5rem' }}>
              <h3 style={{ fontSize: '1rem', fontWeight: 700 }}>💬 غرفة المناقشة الفورية والتحقيق</h3>
              <button onClick={() => setIsChatOpen(false)} className="btn btn-ghost btn-sm">إغلاق ✖</button>
            </div>

            <div style={{ maxHeight: '220px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.6rem', paddingRight: '0.25rem', marginBottom: '1rem' }}>
              {messages.length === 0 ? (
                <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', textAlign: 'center', margin: '1rem 0' }}>
                  لا توجد رسائل بعد. ابدأ مناقشة الأدلة والشكوك مع المحققين!
                </p>
              ) : (
                messages.map((msg) => {
                  const isMe = msg.user_id === user?.id;
                  return (
                    <div
                      key={msg.id}
                      style={{
                        alignSelf: isMe ? 'flex-end' : 'flex-start',
                        background: isMe ? 'rgba(99, 102, 241, 0.2)' : 'rgba(255,255,255,0.05)',
                        border: isMe ? '1px solid rgba(99, 102, 241, 0.4)' : '1px solid rgba(255,255,255,0.08)',
                        padding: '0.5rem 0.85rem',
                        borderRadius: 'var(--radius-md)',
                        maxWidth: '82%',
                      }}
                    >
                      <div style={{ fontSize: '0.725rem', color: isMe ? 'var(--primary)' : 'var(--text-muted)', fontWeight: 700, marginBottom: '0.15rem' }}>
                        {msg.display_name} {isMe && '(أنت)'}
                      </div>
                      <div style={{ fontSize: '0.9rem', color: 'var(--text-main)', lineHeight: '1.4' }}>{msg.message}</div>
                    </div>
                  );
                })
              )}
              <div ref={chatBottomRef} />
            </div>

            <form onSubmit={handleSendMessage} style={{ display: 'flex', gap: '0.5rem' }}>
              <input
                type="text"
                className="input-field"
                placeholder="اكتب رسالتك للمحققين..."
                value={newMessageText}
                onChange={(e) => setNewMessageText(e.target.value)}
                maxLength={300}
                style={{ flex: 1 }}
              />
              <button type="submit" className="btn btn-primary btn-sm" disabled={sendingMsg || !newMessageText.trim()}>
                إرسال 📩
              </button>
            </form>
          </div>
        )}

        {/* Phase: STARTING */}
        {room?.status === 'starting' && (
          <div className="cinematic-container">
            <div className="spinner" style={{ width: '48px', height: '48px' }}></div>
            <h3 style={{ fontSize: '1.75rem', fontWeight: 800 }}>جاري بدء الجولة {currentRoundNumber}...</h3>
            <p style={{ color: 'var(--text-muted)' }}>يتم الآن استرداد ملفات القضية السرية وتوزيعها على المحققين.</p>
          </div>
        )}

        {/* Phase: ROLE ASSIGNMENT */}
        {room?.status === 'role_assignment' && (
          <div className="cinematic-container">
            <div
              className={`role-card ${
                myRole === 'suspect' ? 'role-card-suspect' : 'role-card-detective'
              }`}
            >
              <div className="role-icon">
                {myRole === 'suspect' ? '🕵️' : '🔎'}
              </div>
              <h2
                className={
                  myRole === 'suspect' ? 'role-title-suspect' : 'role-title-detective'
                }
              >
                {myRole === 'suspect' ? 'أنت المشتبه به' : 'أنت محقق'}
              </h2>
              <p className="role-tagline">
                {myRole === 'suspect'
                  ? 'اندمج مع الآخرين. اخدع المحققين. لا تنكشف.'
                  : 'حلّل الأدلة. اكشف الحقيقة. حدّد المشتبه به.'}
              </p>
              {isHost && (
                <button
                  onClick={handleAdvanceToInvestigation}
                  className="btn btn-primary"
                  style={{ marginTop: '1rem' }}
                >
                  الانتقال لملف القضية ←
                </button>
              )}
            </div>
          </div>
        )}

        {/* Phase: INVESTIGATION — Interactive Detective HQ */}
        {(room?.status === 'investigation' || room?.status === 'in_game') && activeCase && (
          <div className="lobby-body">
            {myRole === 'suspect' ? (
              <SuspectHQ roomId={roomId} currentRound={room?.current_round || 1} />
            ) : (
            <div className="glass-card case-card">
              <div className="case-header">
                <div>
                  <span style={{ fontSize: '0.75rem', letterSpacing: '1px', color: 'var(--text-muted)', fontWeight: 600 }}>ملف القضية النشطة</span>
                  <h3 className="case-title">{activeCase.title}</h3>
                </div>
                <span className="difficulty-badge">{activeCase.difficulty}</span>
              </div>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', lineHeight: '1.6', marginBottom: '1rem' }}>{activeCase.description}</p>

              {/* Timer */}
              {investigationTimeLeft !== null && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem', padding: '0.6rem 1rem', background: investigationTimeLeft < 60 ? 'rgba(248,113,113,0.12)' : 'rgba(99,102,241,0.1)', borderRadius: 'var(--radius-md)', border: investigationTimeLeft < 60 ? '1px solid #f8717140' : '1px solid rgba(99,102,241,0.2)' }}>
                  <span>⏱️</span>
                  <span style={{ fontWeight: 700, color: investigationTimeLeft < 60 ? '#f87171' : 'var(--primary)', fontSize: '1rem' }}>
                    وقت التحقيق: {formatTime(investigationTimeLeft)}
                  </span>
                </div>
              )}

              {/* Quick How to Investigate Guidance Banner */}
              <div style={{ padding: '0.75rem 1rem', background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.2)', borderRadius: 'var(--radius-md)', marginBottom: '1.25rem', fontSize: '0.825rem', color: 'var(--text-main)', lineHeight: '1.5' }}>
                <strong style={{ color: 'var(--primary)', display: 'block', marginBottom: '0.2rem' }}>💡 كيف تحقّق في هذه القضية؟</strong>
                1. 🔎 <strong>فتّش مسرح الجريمة</strong> لاكتشاف أدلة. | 2. 📌 <strong>اربط الأدلة</strong> في اللوحة وفك الألغاز. | 3. 🗣️ <strong>سجّل التناقضات</strong> من أقوال المشتبه بهم. | 4. 📋 <strong>ابنِ ملف الاتهام</strong>.
              </div>

              {/* Progress Bar */}
              <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', padding: '0.6rem 1rem', background: 'rgba(255,255,255,0.03)', borderRadius: 'var(--radius-md)', fontSize: '0.82rem', marginBottom: '1.25rem' }}>
                <span>🔍 أماكن مُفتشة: <strong>{investigationProgress.searched_locations?.length || 0}/{(activeCase.locations || []).length}</strong></span>
                <span>💡 أدلة: <strong>{discoveredCluesList.length}/{(activeCase.clues || []).length}</strong></span>
                <span>✨ ترابطات: <strong>{discoveredConnectionsList.length}/{(activeCase.connections || []).length}</strong></span>
              </div>

              {/* Tab Navigation */}
              <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
                {[
                  ['scene', '🔎 مسرح الجريمة'],
                  ['board', '📌 لوحة الأدلة'],
                  ['interrogation', '🗣️ استجواب'],
                  ['case', '📋 بناء الاتهام'],
                ].map(([tab, label]) => (
                  <button
                    key={tab}
                    className={`btn btn-sm ${activeTab === tab ? 'btn-primary' : 'btn-ghost'}`}
                    onClick={() => setActiveTab(tab)}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {/* TAB 1: Crime Scene */}
              {activeTab === 'scene' && (
                <div>
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginBottom: '1rem' }}>اضغط على أي مكان لتفتيشه واكتشاف الأدلة المخفية.</p>
                  <div className="suspects-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))' }}>
                    {(activeCase.locations || []).map((loc) => {
                      const isSearched = investigationProgress.searched_locations?.includes(loc.id);
                      return (
                        <div
                          key={loc.id}
                          className={`glass-card ${isSearched ? 'clue-selected' : ''}`}
                          style={{ padding: '1rem', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: '0.4rem', border: isSearched ? '1px solid #4ade8050' : '1px solid rgba(255,255,255,0.08)' }}
                          onClick={() => handleSearchLocation(loc)}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontSize: '1.6rem' }}>{loc.icon}</span>
                            {isSearched
                              ? <span style={{ fontSize: '0.72rem', color: '#4ade80', fontWeight: 700 }}>✅ تم التفتيش</span>
                              : <span style={{ fontSize: '0.72rem', color: 'var(--primary)', fontWeight: 700 }}>🔍 اضغط للتفتيش</span>
                            }
                          </div>
                          <h4 style={{ fontWeight: 700, fontSize: '0.95rem' }}>{loc.name}</h4>
                          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', lineHeight: '1.4' }}>{loc.description}</p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* TAB 2: Evidence Board */}
              {activeTab === 'board' && (
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                    <h3 className="section-title">📌 لوحة الأدلة والترابط</h3>
                    <button
                      onClick={handleAttemptConnection}
                      className="btn btn-primary btn-sm"
                      disabled={selectedBoardClues.length < 2}
                    >
                      🔗 ربط الأدلة ({selectedBoardClues.length}/2)
                    </button>
                  </div>
                  {discoveredCluesList.length === 0 ? (
                    <div className="empty-state"><p>🔍 فتش مسرح الجريمة أولاً لاكتشاف أدلة.</p></div>
                  ) : (
                    <div className="clue-list">
                      {discoveredCluesList.map((clue) => {
                        const isSelected = selectedBoardClues.includes(clue.id);
                        return (
                          <div
                            key={clue.id}
                            className={`clue-item clue-selectable ${isSelected ? 'clue-selected' : ''}`}
                            onClick={() => setSelectedBoardClues((prev) =>
                              prev.includes(clue.id)
                                ? prev.filter((id) => id !== clue.id)
                                : prev.length < 2 ? [...prev, clue.id] : prev
                            )}
                          >
                            <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
                              <span style={{ fontWeight: 700, fontSize: '0.88rem' }}>
                                {isSelected ? '✅ ' : '⬜ '}{clue.title || clue.text?.substring(0, 40)}
                              </span>
                              <span style={{ fontSize: '0.73rem', color: 'var(--text-muted)' }}>{clue.category}</span>
                            </div>
                            <p style={{ fontSize: '0.83rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>{clue.text}</p>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {discoveredConnectionsList.length > 0 && (
                    <div style={{ marginTop: '1.25rem' }}>
                      <h4 style={{ fontSize: '0.88rem', marginBottom: '0.6rem', color: '#4ade80', fontWeight: 700 }}>✨ الترابطات المكتشفة ({discoveredConnectionsList.length}):</h4>
                      {discoveredConnectionsList.map((conn) => (
                        <div key={conn.id} style={{ padding: '0.7rem 1rem', background: 'rgba(74,222,128,0.1)', border: '1px solid #4ade8040', borderRadius: 'var(--radius-md)', marginBottom: '0.4rem' }}>
                          <strong style={{ color: '#4ade80', fontSize: '0.88rem' }}>{conn.title}</strong>
                          <p style={{ fontSize: '0.83rem', color: 'var(--text-main)', marginTop: '0.2rem' }}>{conn.description}</p>
                        </div>
                      ))}
                    </div>
                  )}
                  {(activeCase.clues || []).filter((c) => c.requires_puzzle && !investigationProgress.solved_puzzles?.includes(c.puzzle_id)).length > 0 && (
                    <div style={{ marginTop: '1.25rem' }}>
                      <h4 style={{ fontSize: '0.88rem', marginBottom: '0.6rem', color: '#facc15', fontWeight: 700 }}>🧩 أدلة مقفولة بحاجة لحل لغز:</h4>
                      <div className="clue-list">
                        {(activeCase.clues || [])
                          .filter((c) => c.requires_puzzle && !investigationProgress.solved_puzzles?.includes(c.puzzle_id))
                          .map((lockedClue) => {
                            const puz = (activeCase.puzzles || []).find((p) => p.id === lockedClue.puzzle_id);
                            return (
                              <div key={lockedClue.id} className="clue-item" style={{ border: '1px dashed #facc1560', background: 'rgba(250,204,21,0.04)' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                                  <span style={{ fontWeight: 700, fontSize: '0.88rem', color: '#facc15' }}>🔒 {lockedClue.title}</span>
                                  <button
                                    onClick={() => { setActivePuzzle(puz); setPuzzleError(null); setPuzzleAnswerInput(''); }}
                                    className="btn btn-secondary btn-sm"
                                  >
                                    🧩 فك الشفرة
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* TAB 3: Interrogation */}
              {activeTab === 'interrogation' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                  
                  {/* Live Suspect Interrogation (Real Player) */}
                  <div className="glass-card" style={{ padding: '1.5rem', border: '1px solid rgba(99,102,241,0.3)' }}>
                    <h3 style={{ fontSize: '1.2rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--primary)' }}>
                      <span>🚨</span> استجواب المشتبه به (اللاعب)
                    </h3>
                    
                    {publicSuspectData?.alibi ? (
                      <div style={{ padding: '1rem', background: 'rgba(255,255,255,0.05)', borderRadius: 'var(--radius-md)', marginBottom: '1rem' }}>
                        <h4 style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>عذر المشتبه به (Alibi):</h4>
                        <p style={{ fontSize: '1rem', lineHeight: '1.5', fontStyle: 'italic' }}>"{publicSuspectData.alibi.text}"</p>
                      </div>
                    ) : (
                      <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '1rem' }}>لم يقم المشتبه به بنشر عذره بعد.</p>
                    )}

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginBottom: '1.5rem' }}>
                      <h4 style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>سجل الاستجوابات:</h4>
                      {(publicSuspectData?.interrogations || []).length === 0 ? (
                        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>لم يتم توجيه أي أسئلة بعد.</p>
                      ) : (
                        publicSuspectData.interrogations.map(q => (
                          <div key={q.id} style={{ padding: '0.75rem', background: 'rgba(0,0,0,0.2)', borderRadius: 'var(--radius-md)' }}>
                            <p style={{ fontSize: '0.9rem', marginBottom: '0.4rem' }}><strong>سؤال:</strong> {q.question_text}</p>
                            {q.is_answered ? (
                              <p style={{ fontSize: '0.95rem', color: '#4ade80' }}><strong>رد المشتبه به:</strong> "{q.response_text}"</p>
                            ) : (
                              <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>⏳ بانتظار رد المشتبه به...</p>
                            )}
                          </div>
                        ))
                      )}
                    </div>

                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <input
                        type="text"
                        className="input-field"
                        placeholder="وجه سؤالاً للمشتبه به (مثال: أين كنت وقت وقوع الجريمة؟)..."
                        value={newQuestionText}
                        onChange={(e) => setNewQuestionText(e.target.value)}
                        disabled={sendingQuestion}
                        style={{ flex: 1 }}
                      />
                      <button
                        className="btn btn-primary"
                        onClick={handleAskQuestion}
                        disabled={sendingQuestion || !newQuestionText.trim()}
                      >
                        {sendingQuestion ? 'جاري الإرسال...' : 'إرسال سؤال 📨'}
                      </button>
                    </div>
                  </div>

                  {/* Static Case Interrogations */}
                  <div>
                    <h3 style={{ fontSize: '1.1rem', marginBottom: '1rem', color: 'var(--text-main)' }}>أقوال الشهود والمشتبه بهم الآخرين</h3>
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginBottom: '1.25rem' }}>راجع الأقوال واضغط على أي تناقض لتسجيله.</p>
                    {(activeCase.interrogations || []).map((interr) => (
                    <div key={interr.suspect_id} className="glass-card" style={{ marginBottom: '1rem', padding: '1rem' }}>
                      <h4 style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: '0.65rem', color: 'var(--primary)' }}>👤 {interr.suspect_name}</h4>
                      {(interr.statements || []).map((stmt, idx) => (
                        <div key={idx} style={{ padding: '0.5rem 0.85rem', background: 'rgba(255,255,255,0.04)', borderRadius: 'var(--radius-sm)', marginBottom: '0.35rem', borderLeft: '3px solid rgba(99,102,241,0.4)' }}>
                          <p style={{ fontSize: '0.86rem', color: 'var(--text-main)', lineHeight: '1.5' }}>"{stmt}"</p>
                        </div>
                      ))}
                      {(interr.contradictions || []).map((contra) => {
                        const isRec = investigationProgress.recorded_contradictions?.includes(contra.id);
                        return (
                          <div
                            key={contra.id}
                            style={{ marginTop: '0.45rem', padding: '0.55rem 0.85rem', background: isRec ? 'rgba(248,113,113,0.12)' : 'rgba(255,255,255,0.02)', borderRadius: 'var(--radius-sm)', border: isRec ? '1px solid #f8717135' : '1px dashed rgba(248,113,113,0.28)', cursor: isRec ? 'default' : 'pointer' }}
                            onClick={() => !isRec && handleRecordContradiction(contra)}
                          >
                            <span style={{ fontSize: '0.73rem', fontWeight: 700, color: '#f87171' }}>{isRec ? '✅ تناقض مسجل: ' : '⚠️ اضغط لتسجيل: '}</span>
                            <span style={{ fontSize: '0.83rem', color: 'var(--text-main)' }}>{contra.description}</span>
                          </div>
                        );
                      })}
                    </div>
                  ))}
                  {(activeCase.interrogations || []).length === 0 && (
                    <div className="empty-state"><p>لا توجد استجوابات متاحة في هذه القضية.</p></div>
                  )}
                </div>
              )}

              {/* TAB 4: Build Case */}
              {activeTab === 'case' && (
                <div>
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginBottom: '1.25rem' }}>اختر المتهم، الدافع، الفرصة، والأدلة لبناء ملف الاتهام النهائي.</p>

                  <h4 style={{ fontSize: '0.88rem', marginBottom: '0.5rem' }}>1. المتهم المشتبه به:</h4>
                  <div className="suspects-grid" style={{ marginBottom: '1.25rem' }}>
                    {players.map((p) => {
                      const isMe = p.user_id === user?.id;
                      const isSelected = selectedSuspect?.user_id === p.user_id;
                      return (
                        <div
                          key={p.id}
                          className={`suspect-card ${isSelected ? 'suspect-card-selected' : ''}`}
                          style={{ opacity: isMe ? 0.6 : 1, cursor: isMe ? 'not-allowed' : 'pointer' }}
                          onClick={() => !isMe && setSelectedSuspect(p)}
                        >
                          <div className="player-avatar">{p.display_name?.charAt(0)?.toUpperCase()}</div>
                          <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{p.display_name} {isMe && '(أنت)'}</div>
                        </div>
                      );
                    })}
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.25rem' }}>
                    <div>
                      <label style={{ fontSize: '0.83rem', fontWeight: 600, display: 'block', marginBottom: '0.3rem' }}>2. الدافع (Motive):</label>
                      <input type="text" className="input-field" placeholder="مثال: الدافع المالي..." value={buildMotive} onChange={(e) => setBuildMotive(e.target.value)} />
                    </div>
                    <div>
                      <label style={{ fontSize: '0.83rem', fontWeight: 600, display: 'block', marginBottom: '0.3rem' }}>3. الفرصة (Opportunity):</label>
                      <input type="text" className="input-field" placeholder="مثال: الساعة 10:00 مساءً..." value={buildOpportunity} onChange={(e) => setBuildOpportunity(e.target.value)} />
                    </div>
                  </div>

                  <h4 style={{ fontSize: '0.88rem', marginBottom: '0.5rem' }}>4. الأدلة المساندة:</h4>
                  {discoveredCluesList.length === 0 ? (
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1rem' }}>لم تُكتشف أدلة بعد. فتش مسرح الجريمة أولاً.</p>
                  ) : (
                    <div className="clue-list" style={{ marginBottom: '1.25rem' }}>
                      {discoveredCluesList.map((clue) => {
                        const isSel = selectedEvidence.includes(clue.id);
                        return (
                          <div
                            key={clue.id}
                            className={`clue-item clue-selectable ${isSel ? 'clue-selected' : ''}`}
                            onClick={() => toggleEvidenceSelection(clue.id)}
                          >
                            <span style={{ fontWeight: 600, fontSize: '0.85rem' }}>
                              {isSel ? '✅ ' : '⬜ '}{clue.title || clue.text?.substring(0, 50)}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {isHost && (
                    <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                      <button onClick={handleAdvanceToVoting} className="btn btn-primary">الانتقال للتصويت 🗳️</button>
                      <button
                        onClick={() => setShowConfirmModal(true)}
                        className="btn btn-secondary"
                        disabled={!selectedSuspect || selectedEvidence.length < 1}
                      >
                        تأكيد الاتهام النهائي ⚖️
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
            )}
          </div>
        )}

        {/* Puzzle Solving Modal */}
        {activePuzzle && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem' }}>
            <div className="glass-card" style={{ maxWidth: '420px', width: '100%' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                <h3 style={{ fontSize: '1.15rem', fontWeight: 800 }}>🧩 {activePuzzle.title}</h3>
                <button onClick={() => setActivePuzzle(null)} className="btn btn-ghost btn-sm">✖</button>
              </div>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', marginBottom: '1rem', lineHeight: '1.5' }}>{activePuzzle.hint}</p>
              {puzzleError && <div className="error-message" role="alert" style={{ marginBottom: '0.75rem' }}>{puzzleError}</div>}
              <input
                type="text"
                className="input-field"
                placeholder="أدخل الإجابة هنا..."
                value={puzzleAnswerInput}
                onChange={(e) => setPuzzleAnswerInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSolvePuzzle(activePuzzle)}
                style={{ marginBottom: '1rem' }}
              />
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button onClick={() => handleSolvePuzzle(activePuzzle)} className="btn btn-primary" style={{ flex: 1 }}>فك الشفرة 🔓</button>
                <button onClick={() => setActivePuzzle(null)} className="btn btn-secondary">إلغاء</button>
              </div>
            </div>
          </div>
        )}


        {/* Phase: VOTING */}
        {room?.status === 'voting' && (
          <div className="lobby-body">
            <div className="glass-card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '1rem' }}>
                <h3 className="section-title">🗳️ مرحلة التصويت السري</h3>
                <span className="difficulty-badge" style={{ background: 'rgba(99,102,241,0.2)', color: 'var(--primary)' }}>
                  اصوات المحققين: {votingSummary.votes_count} / {votingSummary.total_players}
                </span>
              </div>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginBottom: '1.5rem' }}>
                صوّت سراً للاعب الذي تتوقع أنه المشتبه به. لا يمكنك التصويت لنفسك.
              </p>

              {voteError && (
                <div className="error-message" role="alert" style={{ marginBottom: '1rem' }}>
                  {voteError}
                </div>
              )}

              <div className="suspects-grid">
                {players.map((p) => {
                  const isMe = p.user_id === user?.id;
                  const isMyVoted = myVotedSuspectId === p.user_id;

                  return (
                    <div
                      key={p.id}
                      className={`suspect-card ${isMyVoted ? 'suspect-card-selected' : ''}`}
                      style={{ opacity: isMe ? 0.6 : 1, cursor: isMe ? 'not-allowed' : 'pointer' }}
                      onClick={() => !isMe && handleVoteSuspect(p)}
                    >
                      <div className="player-avatar">{p.display_name?.charAt(0)?.toUpperCase()}</div>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: '0.9375rem' }}>
                          {p.display_name} {isMe && '(أنت)'}
                        </div>
                        {isMyVoted ? (
                          <span style={{ fontSize: '0.75rem', color: '#4ade80', fontWeight: 700 }}>✅ صوتك الحالي</span>
                        ) : isMe ? (
                          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>لا يمكنك التصويت لنفسك</span>
                        ) : (
                          <span style={{ fontSize: '0.75rem', color: 'var(--primary)' }}>اضغط للتصويت 🗳️</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {isHost && (
                <div style={{ marginTop: '1.75rem' }}>
                  <button onClick={handleAdvanceToAccusation} className="btn btn-primary">
                    اعتماد النتيجة والتأكيد النهائي ⚖️
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Phase: RESULTS / VERDICT & ROUND LEADERBOARD */}
        {room?.status === 'results' && (
          <div className="lobby-body">
            {room.accusation_data && (
              <>
                <div className={`verdict-banner ${room.accusation_data.is_correct ? 'verdict-success' : 'verdict-failure'}`}>
                  <div style={{ fontSize: '3.5rem', marginBottom: '0.5rem' }}>
                    {room.accusation_data.is_correct ? '🎉' : '❌'}
                  </div>
                  <h2 style={{ fontSize: '1.85rem', fontWeight: 800, marginBottom: '0.5rem' }}>
                    {room.accusation_data.is_correct ? 'تم كشف المشتبه به بنجاح!' : 'هرب المشتبه به! الاتهام كان خاطئاً'}
                  </h2>
                  <p style={{ color: 'var(--text-muted)', fontSize: '1rem' }}>
                    {room.accusation_data.is_correct
                      ? 'نجح الفريق في تحليل الأدلة والوصول للجاني الحقيقي.'
                      : 'المشتبه به نجح في خداع المحققين والهروب من العدالة.'}
                  </p>
                </div>

                {/* Personal Score Summary Box */}
                {myLeaderboardRow && (
                  <div className="leaderboard-summary">
                    <div className="summary-box">
                      <div className="summary-box-label">جولة {currentRoundNumber}</div>
                      <div className="summary-box-value" style={{ color: myLeaderboardRow.round_points >= 0 ? '#4ade80' : '#f87171' }}>
                        {myLeaderboardRow.round_points >= 0 ? `+${myLeaderboardRow.round_points}` : myLeaderboardRow.round_points}
                      </div>
                    </div>
                    <div className="summary-box">
                      <div className="summary-box-label">السكور التراكمي</div>
                      <div className="summary-box-value">{myLeaderboardRow.total_points}</div>
                    </div>
                    <div className="summary-box">
                      <div className="summary-box-label">مركزك الحالي</div>
                      <div className="summary-box-value" style={{ color: 'var(--primary)' }}>
                        {getRankMedal(myLeaderboardRow.rank)}
                      </div>
                    </div>
                  </div>
                )}

                {/* Round Leaderboard Table */}
                <div className="glass-card leaderboard-card">
                  <h3 className="section-title">🏆 جدول ترتيب الجولة {currentRoundNumber}</h3>
                  <div className="leaderboard-table-container">
                    <table className="leaderboard-table">
                      <thead>
                        <tr>
                          <th>الترتيب</th>
                          <th>اللاعب</th>
                          <th>الدور</th>
                          <th>نقاط الجولة</th>
                          <th>المجموع الكلي</th>
                        </tr>
                      </thead>
                      <tbody>
                        {leaderboard.map((row) => {
                          const isMe = row.user_id === user?.id;
                          const roundPtsClass = row.round_points > 0 ? 'pts-positive' : row.round_points < 0 ? 'pts-negative' : 'pts-neutral';

                          return (
                            <tr key={row.user_id} className={`leaderboard-row ${isMe ? 'leaderboard-row-me' : ''}`}>
                              <td>
                                <span className="rank-badge">{getRankMedal(row.rank)}</span>
                              </td>
                              <td style={{ fontWeight: 600 }}>
                                {row.display_name} {isMe && <span className="you-badge">(أنت)</span>}
                              </td>
                              <td style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                                {row.role === 'suspect' ? '🕵️ المشتبه به' : '🔎 محقق'}
                              </td>
                              <td className={roundPtsClass}>
                                {row.round_points > 0 ? `+${row.round_points}` : row.round_points}
                              </td>
                              <td style={{ fontWeight: 800, fontSize: '1.05rem' }}>
                                {row.total_points}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="glass-card" style={{ marginTop: '1.5rem', marginBottom: '1.5rem' }}>
                  <h3 className="section-title">📋 تفاصيل اتهام الجولة {currentRoundNumber}</h3>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginTop: '1rem' }}>
                    <div style={{ padding: '1rem', background: 'rgba(255,255,255,0.03)', borderRadius: 'var(--radius-md)' }}>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>المتهم من قِبل المحقق:</span>
                      <h4 style={{ fontSize: '1.1rem', marginTop: '0.2rem' }}>{room.accusation_data.accused_name}</h4>
                    </div>
                    <div style={{ padding: '1rem', background: 'rgba(255,255,255,0.03)', borderRadius: 'var(--radius-md)' }}>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>الجاني الحقيقي:</span>
                      <h4 style={{ fontSize: '1.1rem', marginTop: '0.2rem', color: 'var(--primary)' }}>
                        {room.accusation_data.actual_suspect_name || 'غير معروف'}
                      </h4>
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem', flexWrap: 'wrap' }}>
                  {isHost && (
                    <button
                      onClick={handleStartNextRound}
                      className="btn btn-primary"
                      disabled={startingNextRound}
                    >
                      {startingNextRound ? 'جاري بدء الجولة...' : `🎮 بدء الجولة رقم ${currentRoundNumber + 1}`}
                    </button>
                  )}
                  <button onClick={() => navigate('/')} className="btn btn-secondary">
                    🏠 العودة لرئيسية المقر
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {/* Phase: WAITING (Default Lobby View) */}
        {room?.status === 'waiting' && (
          <div className="lobby-body">
            {/* Display accumulated leaderboard in lobby if rounds have been played */}
            {currentRoundNumber > 1 && leaderboard.length > 0 && (
              <div className="glass-card leaderboard-card">
                <h3 className="section-title">🏆 الترتيب التراكمي للغرفة (بعد {currentRoundNumber - 1} جولات)</h3>
                <div className="leaderboard-table-container">
                  <table className="leaderboard-table">
                    <thead>
                      <tr>
                        <th>الترتيب</th>
                        <th>اللاعب</th>
                        <th>المجموع الكلي</th>
                      </tr>
                    </thead>
                    <tbody>
                      {leaderboard.map((row) => {
                        const isMe = row.user_id === user?.id;
                        return (
                          <tr key={row.user_id} className={`leaderboard-row ${isMe ? 'leaderboard-row-me' : ''}`}>
                            <td>
                              <span className="rank-badge">{getRankMedal(row.rank)}</span>
                            </td>
                            <td style={{ fontWeight: 600 }}>
                              {row.display_name} {isMe && <span className="you-badge">(أنت)</span>}
                            </td>
                            <td style={{ fontWeight: 800, fontSize: '1.05rem', color: 'var(--primary)' }}>
                              {row.total_points} نقطة
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div className="glass-card players-card">
              <h3 className="section-title">
                المحققون{' '}
                <span className="player-count">{players.length}</span>
              </h3>

              {players.length === 0 ? (
                <div className="empty-state">
                  <p>في انتظار اللاعبين للانضمام...</p>
                </div>
              ) : (
                <ul className="player-list" aria-label="اللاعبون في الغرفة">
                  {players.map((player) => {
                    const isPlayerHost = player.user_id === room?.host_id;
                    const isMe = player.user_id === user?.id;

                    return (
                      <li key={player.id} className="player-item">
                        <div className="player-info">
                          <div className="player-avatar" aria-hidden="true">
                            {player.display_name?.charAt(0)?.toUpperCase() ?? '؟'}
                          </div>
                          <div>
                            <span className="player-name">
                              {player.display_name}
                              {isMe && (
                                <span className="you-badge" aria-label="هذا أنت">
                                  {' '}(أنت)
                                </span>
                              )}
                            </span>
                          </div>
                        </div>
                        {isPlayerHost && (
                          <span className="host-badge" aria-label="مضيف الغرفة">
                            مضيف
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {isHost && (
              <div className="host-controls glass-card">
                <h3 className="section-title">تحكمات المضيف</h3>
                <p className="host-hint">
                  ابدأ الجولة {currentRoundNumber} عندما يكون كل المحققين جاهزين.
                </p>
                {startError && (
                  <div className="error-message" role="alert">
                    {startError}
                  </div>
                )}
                <button
                  onClick={handleStartGame}
                  className="btn btn-primary"
                  disabled={startingGame || room?.status !== 'waiting'}
                >
                  {startingGame ? (
                    <span className="btn-loading">
                      <span className="btn-spinner"></span>
                      جاري بدء الجولة...
                    </span>
                  ) : (
                    `بدء الجولة ${currentRoundNumber}`
                  )}
                </button>
              </div>
            )}
          </div>
        )}
      </main>

      {/* Confirmation Modal for Accusation */}
      {showConfirmModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem' }}>
          <div className="glass-card" style={{ maxWidth: '440px', width: '100%', textAlign: 'center' }}>
            <h3 style={{ fontSize: '1.35rem', marginBottom: '0.75rem' }}>⚖️ تأكيد الاتهام النهائي</h3>
            {accusationError && (
              <div className="error-message" role="alert" style={{ marginBottom: '1rem' }}>
                {accusationError}
              </div>
            )}
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9375rem', marginBottom: '1rem' }}>
              هل أنت متأكد من توجيه الاتهام رسمياً للاعب <strong style={{ color: 'var(--primary)' }}>{selectedSuspect?.display_name}</strong> بموجب الأدلة المختارة؟
            </p>

            {!isHost && (
              <div style={{ padding: '0.6rem 0.85rem', background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.25)', borderRadius: 'var(--radius-md)', fontSize: '0.8rem', color: 'var(--text-main)', marginBottom: '1.25rem', textAlign: 'right' }}>
                👑 <strong>ملاحظة للمحققين:</strong> يمكنك تجهيز ملف الاتهام، ومضيف الغرفة (المحقق الرئيسي) هو المعني بتأكيد الاعتماد النهائي لإصدار الحكم.
              </div>
            )}

            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button
                onClick={handleSubmitAccusation}
                className="btn btn-primary"
                disabled={submittingAccusation || !isHost}
              >
                {submittingAccusation ? 'جاري إصدار الحكم...' : !isHost ? 'المضيف فقط يعتمد الاتهام 🔒' : 'نعم، أؤكد الاتهام'}
              </button>
              <button
                onClick={() => { setShowConfirmModal(false); setAccusationError(null); }}
                className="btn btn-secondary"
                disabled={submittingAccusation}
              >
                إلغاء
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Inspection Results Modal */}
      {inspectedLocation && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem' }}>
          <div className="glass-card" style={{ maxWidth: '480px', width: '100%', border: '1px solid #4ade8050' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.85rem', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '0.6rem' }}>
              <h3 style={{ fontSize: '1.2rem', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{ fontSize: '1.5rem' }}>{inspectedLocation.icon}</span>
                <span>نتيجة تفتيش {inspectedLocation.name}</span>
              </h3>
              <button onClick={() => setInspectedLocation(null)} className="btn btn-ghost btn-sm">✖</button>
            </div>

            <p style={{ color: '#4ade80', fontSize: '0.88rem', fontWeight: 700, marginBottom: '0.85rem' }}>
              ✅ تم تفتيش المكان بنجاح! إليك الأدلة المعثور عليها:
            </p>

            <div className="clue-list" style={{ marginBottom: '1.25rem' }}>
              {(activeCase?.clues || [])
                .filter((c) => c.location_id === inspectedLocation.id)
                .map((clue, idx) => (
                  <div key={clue.id || idx} className="clue-item" style={{ flexDirection: 'column', gap: '0.3rem', alignItems: 'stretch', background: 'rgba(74,222,128,0.06)', border: '1px solid #4ade8030' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                      <span style={{ fontSize: '0.78rem', color: '#4ade80', fontWeight: 700 }}>
                        🔎 دليل مُميز: {clue.title || `دليل #${idx + 1}`}
                      </span>
                      <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{clue.category}</span>
                    </div>
                    <p style={{ fontSize: '0.88rem', color: 'var(--text-main)', lineHeight: '1.5' }}>{clue.text}</p>
                    {clue.requires_puzzle && !investigationProgress.solved_puzzles?.includes(clue.puzzle_id) && (
                      <span style={{ fontSize: '0.75rem', color: '#facc15', fontWeight: 700, marginTop: '0.2rem' }}>
                        🔒 الدليل بحاجة لفك الشفرة من لوحة الأدلة!
                      </span>
                    )}
                  </div>
                ))}
              {(activeCase?.clues || []).filter((c) => c.location_id === inspectedLocation.id).length === 0 && (
                <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>لا توجد أدلة إضافية في هذا المكان.</p>
              )}
            </div>

            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button
                onClick={() => {
                  setInspectedLocation(null);
                  setActiveTab('board');
                }}
                className="btn btn-primary"
                style={{ flex: 1 }}
              >
                الذهاب للوحة الأدلة 📌
              </button>
              <button
                onClick={() => setInspectedLocation(null)}
                className="btn btn-secondary"
              >
                إغلاق
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
