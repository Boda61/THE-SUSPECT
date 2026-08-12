import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import { CASES } from '../data/cases';

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

  const [myRole, setMyRole] = useState(null);
  const [activeCase] = useState(CASES[0]);

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

      // Initial leaderboard fetch
      const { data: lbData } = await supabase.rpc('get_room_leaderboard', {
        p_room_id: roomId,
      });
      if (!cancelled && lbData) setLeaderboard(lbData);
    };

    loadRoom();
    return () => { cancelled = true; };
  }, [roomId, user]);

  // Realtime subscription for room_players, rooms status, and round_scores
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
      .subscribe();

    channelRef.current = channel;

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [roomId, user, loading, fetchLeaderboard]);

  // Fetch private role whenever room enters game state
  useEffect(() => {
    if (!roomId || !user || room?.status === 'waiting') return;
    let cancelled = false;

    const fetchMyRole = async () => {
      const { data, error: roleError } = await supabase.rpc('get_my_role', {
        p_room_id: roomId,
      });
      if (!cancelled && !roleError && data) {
        setMyRole(data);
      }
    };

    fetchMyRole();
    return () => { cancelled = true; };
  }, [roomId, user, room?.status]);

  // Auto-advance from 'starting' to 'role_assignment' for host
  useEffect(() => {
    if (room?.status !== 'starting' || !room?.host_id || room.host_id !== user?.id) return;

    const timer = setTimeout(async () => {
      await supabase.rpc('advance_room_status', {
        p_room_id: roomId,
        p_next_status: 'role_assignment',
      });
    }, 2500);

    return () => clearTimeout(timer);
  }, [room?.status, room?.host_id, user?.id, roomId]);

  const handleStartGame = async () => {
    if (startingGame || room?.status !== 'waiting') return;
    setStartError(null);
    setStartingGame(true);

    const { error: rpcError } = await supabase.rpc('start_game', {
      p_room_id: roomId,
    });

    setStartingGame(false);

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
    }
  };

  const handleAdvanceToInvestigation = async () => {
    await supabase.rpc('advance_room_status', {
      p_room_id: roomId,
      p_next_status: 'investigation',
    });
  };

  const handleAdvanceToAccusation = async () => {
    await supabase.rpc('advance_room_status', {
      p_room_id: roomId,
      p_next_status: 'accusation',
    });
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

    const { data, error: rpcError } = await supabase.rpc('submit_accusation', {
      p_room_id: roomId,
      p_accused_user_id: selectedSuspect.user_id,
      p_accused_name: selectedSuspect.display_name,
      p_evidence_ids: selectedEvidence,
    });

    setSubmittingAccusation(false);
    setShowConfirmModal(false);

    if (rpcError) {
      setAccusationError('تعذّر تسجيل الاتهام. حاول مرة أخرى.');
      console.error('[submit_accusation]', rpcError);
    } else if (data) {
      setRoom((prev) => (prev ? { ...prev, status: 'results', accusation_data: data } : prev));
      fetchLeaderboard();
    }
  };

  const handleStartNextRound = async () => {
    if (startingNextRound) return;
    setStartingNextRound(true);

    const { error: rpcError } = await supabase.rpc('start_next_round', {
      p_room_id: roomId,
    });

    setStartingNextRound(false);

    if (rpcError) {
      console.error('[start_next_round]', rpcError);
    } else {
      setSelectedSuspect(null);
      setSelectedEvidence([]);
    }
  };

  const handleLeaveRoom = async () => {
    if (leaving) return;
    setLeaving(true);

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

    navigate('/');
  };

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
    investigation: 'التحقيق',
    accusation: 'توجيه الاتهام',
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
        <button
          onClick={handleLeaveRoom}
          className="btn btn-ghost btn-sm"
          disabled={leaving}
        >
          {leaving ? 'جاري المغادرة...' : 'مغادرة الغرفة →'}
        </button>
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

        {/* Phase: INVESTIGATION */}
        {(room?.status === 'investigation' || room?.status === 'in_game') && (
          <div className="lobby-body">
            <div className="glass-card case-card">
              <div className="case-header">
                <div>
                  <span style={{ fontSize: '0.75rem', letterSpacing: '1px', color: 'var(--text-muted)', fontWeight: 600 }}>ملف القضية النشطة</span>
                  <h3 className="case-title">{activeCase.title}</h3>
                </div>
                <span className="difficulty-badge">{activeCase.difficulty}</span>
              </div>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.9375rem', lineHeight: '1.7', marginBottom: '1.25rem' }}>{activeCase.description}</p>

              <h4 style={{ marginTop: '1.25rem', marginBottom: '0.75rem', fontSize: '0.9rem', color: 'var(--text-main)', fontWeight: 700 }}>
                🔍 الأدلة المكتشفة بالكامل ({activeCase.clues.length} أدلة)
              </h4>
              <div className="clue-list">
                {activeCase.clues.map((clue, idx) => {
                  const difficultyLabels = {
                    easy: { text: 'سهل', color: '#4ade80' },
                    medium: { text: 'متوسط', color: '#facc15' },
                    hard: { text: 'صعب', color: '#f87171' },
                    funny: { text: 'مضحك', color: '#c084fc' },
                  };
                  const diff = difficultyLabels[clue.difficulty] || { text: clue.difficulty, color: 'var(--text-muted)' };

                  return (
                    <div key={clue.id || idx} className="clue-item" style={{ flexDirection: 'column', gap: '0.4rem', alignItems: 'stretch' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>
                          دليل #{idx + 1} • {clue.category}
                        </span>
                        <span style={{ fontSize: '0.7rem', padding: '0.15rem 0.5rem', borderRadius: '999px', background: 'rgba(255,255,255,0.06)', color: diff.color, fontWeight: 700, border: `1px solid ${diff.color}40` }}>
                          {diff.text}
                        </span>
                      </div>
                      <span style={{ fontSize: '0.9375rem', lineHeight: '1.6', color: 'var(--text-main)' }}>{clue.text}</span>
                    </div>
                  );
                })}
              </div>

              {isHost ? (
                <div style={{ marginTop: '1.75rem' }}>
                  <button onClick={handleAdvanceToAccusation} className="btn btn-primary">
                    توجيه الاتهام النهائي ⚖️
                  </button>
                </div>
              ) : (
                <p style={{ marginTop: '1.5rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.875rem' }}>
                  ⏳ المحقق الرئيسي ينظر في الأدلة قبل الانتقال لاتهام الجاني...
                </p>
              )}
            </div>
          </div>
        )}

        {/* Phase: ACCUSATION */}
        {room?.status === 'accusation' && (
          <div className="lobby-body">
            <div className="glass-card">
              <h3 className="section-title">⚖️ توجيه الاتهام النهائي</h3>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginBottom: '1.5rem' }}>
                اختر اللاعب المشتبه به وحدد الأدلة المؤيدة للاتهام قبل استصدار الحكم.
              </p>

              {/* Suspect Selection */}
              <h4 style={{ fontSize: '0.9rem', color: 'var(--text-main)', marginBottom: '0.75rem' }}>
                1. اختر المتهم الرئيسي من اللاعبين:
              </h4>
              <div className="suspects-grid">
                {players.map((p) => {
                  const isSelected = selectedSuspect?.id === p.id;
                  return (
                    <div
                      key={p.id}
                      className={`suspect-card ${isSelected ? 'suspect-card-selected' : ''}`}
                      onClick={() => isHost && setSelectedSuspect(p)}
                    >
                      <div className="player-avatar">{p.display_name?.charAt(0)?.toUpperCase()}</div>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: '0.9375rem' }}>{p.display_name}</div>
                        {isSelected && <span style={{ fontSize: '0.75rem', color: 'var(--primary)', fontWeight: 700 }}>مُحدد كمتهم</span>}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Supporting Evidence Selection */}
              <h4 style={{ fontSize: '0.9rem', color: 'var(--text-main)', marginTop: '1.75rem', marginBottom: '0.75rem' }}>
                2. حدد الأدلة المؤيدة للاتهام (اختر دليليين على الأقل):
              </h4>
              <div className="clue-list">
                {activeCase.clues.map((clue, idx) => {
                  const clueKey = clue.id || `c${idx+1}`;
                  const isSelected = selectedEvidence.includes(clueKey);

                  return (
                    <div
                      key={clueKey}
                      className={`clue-item clue-selectable ${isSelected ? 'clue-selected' : ''}`}
                      onClick={() => isHost && toggleEvidenceSelection(clueKey)}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontWeight: 600, fontSize: '0.85rem' }}>
                          {isSelected ? '✅ دليل مؤيد' : '⬜ اضغط للااختيار'} • {clue.category}
                        </span>
                      </div>
                      <span style={{ fontSize: '0.9rem', color: 'var(--text-main)' }}>{clue.text}</span>
                    </div>
                  );
                })}
              </div>

              {accusationError && (
                <div className="error-message" role="alert" style={{ marginTop: '1rem' }}>
                  {accusationError}
                </div>
              )}

              {isHost ? (
                <div style={{ marginTop: '1.75rem' }}>
                  <button
                    onClick={() => setShowConfirmModal(true)}
                    className="btn btn-primary"
                    disabled={!selectedSuspect || selectedEvidence.length < 1}
                  >
                    تأكيد الاتهام وإصدار الحكم ⚖️
                  </button>
                </div>
              ) : (
                <p style={{ marginTop: '1.5rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.875rem' }}>
                  ⏳ المحقق الرئيسي يقوم الآن بمراجعة الأدلة وتحديد المتهم...
                </p>
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
          <div className="glass-card" style={{ maxWidth: '440px', width: '100%', textAlignment: 'center' }}>
            <h3 style={{ fontSize: '1.35rem', marginBottom: '0.75rem' }}>⚖️ تأكيد الاتهام النهائي</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9375rem', marginBottom: '1.25rem' }}>
              هل أنت متأكد من توجيه الاتهام رسمياً للاعب <strong style={{ color: 'var(--primary)' }}>{selectedSuspect?.display_name}</strong> بموجب الأدلة المختارة؟
            </p>
            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button
                onClick={handleSubmitAccusation}
                className="btn btn-primary"
                disabled={submittingAccusation}
              >
                {submittingAccusation ? 'جاري إصدار الحكم...' : 'نعم، أؤكد الاتهام'}
              </button>
              <button
                onClick={() => setShowConfirmModal(false)}
                className="btn btn-secondary"
                disabled={submittingAccusation}
              >
                إلغاء
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
