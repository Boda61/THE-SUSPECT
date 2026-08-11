import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';

export default function SuspectHQ({ roomId, currentRound }) {
  const [data, setData] = useState({ alibi: null, defenses: [], interrogations: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [alibiInput, setAlibiInput] = useState('');
  const [savingAlibi, setSavingAlibi] = useState(false);

  const [defenseInputs, setDefenseInputs] = useState({});
  const [savingDefenses, setSavingDefenses] = useState({});

  const [interrogationResponses, setInterrogationResponses] = useState({});
  const [savingResponses, setSavingResponses] = useState({});

  const fetchHQData = useCallback(async () => {
    try {
      const { data: hqData, error: rpcError } = await supabase.rpc('get_suspect_hq', {
        p_room_id: roomId
      });
      if (rpcError) throw rpcError;
      if (hqData) {
        setData(hqData);
        if (hqData.alibi) {
          setAlibiInput(hqData.alibi.text);
        }
      }
    } catch (err) {
      console.error('[get_suspect_hq]', err);
      setError('فشل تحميل بيانات المقر السري.');
    } finally {
      setLoading(false);
    }
  }, [roomId]);

  useEffect(() => {
    fetchHQData();
  }, [fetchHQData]);

  // Subscribe to updates (interrogations from detectives might come in real-time)
  useEffect(() => {
    const channel = supabase.channel(`suspect_hq:${roomId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'interrogation_sessions', filter: `room_id=eq.${roomId}` }, fetchHQData)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [roomId, fetchHQData]);

  const handleSaveAlibi = async (isPublished = false) => {
    if (!alibiInput.trim()) return;
    setSavingAlibi(true);
    try {
      const { data: hqData, error } = await supabase.rpc('submit_suspect_alibi', {
        p_room_id: roomId,
        p_alibi_text: alibiInput,
        p_is_published: isPublished
      });
      if (error) throw error;
      if (hqData) setData(hqData);
      
      // If publishing, tell the room
      if (isPublished) {
        supabase.channel(`lobby:${roomId}`).send({
          type: 'broadcast',
          event: 'room_action',
          payload: { type: 'suspect_public_update' },
        });
      }
    } catch (err) {
      console.error(err);
      alert('حدث خطأ أثناء حفظ العذر.');
    } finally {
      setSavingAlibi(false);
    }
  };

  const handleSaveDefense = async (clueId, isPublished = false) => {
    const dText = defenseInputs[clueId];
    if (!dText || !dText.trim()) return;
    
    setSavingDefenses(prev => ({ ...prev, [clueId]: true }));
    try {
      const { data: hqData, error } = await supabase.rpc('submit_suspect_defense', {
        p_room_id: roomId,
        p_clue_id: clueId,
        p_defense_text: dText,
        p_is_published: isPublished
      });
      if (error) throw error;
      if (hqData) setData(hqData);

      if (isPublished) {
        supabase.channel(`lobby:${roomId}`).send({
          type: 'broadcast',
          event: 'room_action',
          payload: { type: 'suspect_public_update' },
        });
      }
    } catch (err) {
      console.error(err);
      alert('حدث خطأ أثناء حفظ الدفاع.');
    } finally {
      setSavingDefenses(prev => ({ ...prev, [clueId]: false }));
    }
  };

  const handleSubmitResponse = async (sessionId) => {
    const rText = interrogationResponses[sessionId];
    if (!rText || !rText.trim()) return;

    setSavingResponses(prev => ({ ...prev, [sessionId]: true }));
    try {
      const { data: hqData, error } = await supabase.rpc('submit_interrogation_response', {
        p_session_id: sessionId,
        p_response_text: rText
      });
      if (error) throw error;
      if (hqData) setData(hqData);

      // Notify detectives
      supabase.channel(`lobby:${roomId}`).send({
        type: 'broadcast',
        event: 'room_action',
        payload: { type: 'suspect_interrogation_answered' },
      });
    } catch (err) {
      console.error(err);
      alert('حدث خطأ أثناء إرسال الرد.');
    } finally {
      setSavingResponses(prev => ({ ...prev, [sessionId]: false }));
    }
  };

  if (loading) return <div style={{ padding: '1rem', color: 'var(--text-muted)' }}>جاري تحميل المقر السري...</div>;
  if (error) return <div style={{ padding: '1rem', color: '#f87171' }}>{error}</div>;

  const isAlibiPublished = data.alibi?.is_published;

  return (
    <div className="suspect-hq" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      
      {/* Alibi Section */}
      <div className="glass-card" style={{ padding: '1.5rem', border: '1px solid rgba(248,113,113,0.3)', background: 'rgba(248,113,113,0.05)' }}>
        <h3 style={{ fontSize: '1.2rem', color: '#f87171', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span>🎭</span> تجهيز العذر (Alibi)
        </h3>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '1rem' }}>
          أين كنت وقت الجريمة؟ قم بتجهيز قصتك هنا. بمجرد النشر، سيتمكن المحققون من قراءتها ولن تتمكن من تغييرها لاحقاً!
        </p>
        
        <textarea
          className="input-field"
          style={{ minHeight: '100px', marginBottom: '1rem', background: 'rgba(0,0,0,0.4)', opacity: isAlibiPublished ? 0.6 : 1 }}
          placeholder="اكتب عذرك هنا (مثال: كنت في مكتبي أرتب الأوراق ولم أسمع شيئاً)..."
          value={alibiInput}
          onChange={(e) => setAlibiInput(e.target.value)}
          disabled={isAlibiPublished || savingAlibi}
        />
        
        <div style={{ display: 'flex', gap: '0.75rem' }}>
          {!isAlibiPublished ? (
            <>
              <button 
                className="btn btn-secondary" 
                onClick={() => handleSaveAlibi(false)} 
                disabled={savingAlibi || !alibiInput.trim()}
              >
                {savingAlibi ? 'جاري الحفظ...' : '💾 حفظ كمسودة'}
              </button>
              <button 
                className="btn btn-primary" 
                onClick={() => {
                  if(window.confirm('هل أنت متأكد من النشر؟ لن تتمكن من تعديل العذر بعد النشر وسيراها جميع المحققين!')) {
                    handleSaveAlibi(true);
                  }
                }} 
                disabled={savingAlibi || !alibiInput.trim()}
                style={{ background: '#f87171', color: '#fff', border: 'none' }}
              >
                📢 نشر للمحققين
              </button>
            </>
          ) : (
            <div style={{ padding: '0.5rem 1rem', background: 'rgba(74,222,128,0.15)', color: '#4ade80', borderRadius: 'var(--radius-sm)', fontWeight: 600 }}>
              ✅ تم نشر العذر للمحققين. التزم بقصتك!
            </div>
          )}
        </div>
      </div>

      {/* Interrogation Section */}
      <div className="glass-card" style={{ padding: '1.5rem' }}>
        <h3 style={{ fontSize: '1.2rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span>🗣️</span> غرفة الاستجواب
        </h3>
        {data.interrogations?.length === 0 ? (
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>لا توجد أسئلة من المحققين حتى الآن.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {data.interrogations.map(q => (
              <div key={q.id} style={{ background: 'rgba(255,255,255,0.05)', padding: '1rem', borderRadius: 'var(--radius-md)' }}>
                <p style={{ color: 'var(--primary)', fontWeight: 600, fontSize: '0.85rem', marginBottom: '0.3rem' }}>سؤال من المحققين:</p>
                <p style={{ fontSize: '1rem', marginBottom: '1rem' }}>"{q.question_text}"</p>
                
                {q.is_answered ? (
                  <div style={{ padding: '0.75rem', background: 'rgba(74,222,128,0.1)', borderLeft: '4px solid #4ade80', borderRadius: 'var(--radius-sm)' }}>
                    <span style={{ fontSize: '0.75rem', color: '#4ade80', fontWeight: 600, display: 'block', marginBottom: '0.2rem' }}>ردك:</span>
                    <p style={{ fontSize: '0.95rem' }}>"{q.response_text}"</p>
                  </div>
                ) : (
                  <div>
                    <textarea
                      className="input-field"
                      style={{ minHeight: '60px', marginBottom: '0.75rem' }}
                      placeholder="اكتب ردك هنا بحذر..."
                      value={interrogationResponses[q.id] || ''}
                      onChange={(e) => setInterrogationResponses(prev => ({ ...prev, [q.id]: e.target.value }))}
                      disabled={savingResponses[q.id]}
                    />
                    <button 
                      className="btn btn-primary btn-sm"
                      onClick={() => handleSubmitResponse(q.id)}
                      disabled={savingResponses[q.id] || !interrogationResponses[q.id]?.trim()}
                    >
                      {savingResponses[q.id] ? 'جاري الإرسال...' : 'إرسال الرد'}
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

    </div>
  );
}
