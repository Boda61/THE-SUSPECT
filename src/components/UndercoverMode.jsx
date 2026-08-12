import { useState, useEffect } from 'react';
import { ACTION_CARDS } from '../data/cases';
import { supabase } from '../lib/supabase';
import { playTimerTickSound, playVictorySound } from '../utils/soundEffects';

export default function UndercoverMode({
  caseData,
  myRole,
  mySecretWord,
  players,
  currentUserId,
  roomId,
  phaseStartedAt,
  onBuzzerTrigger,
  onFinalGuessSubmit
}) {
  const [pitchIndex, setPitchIndex] = useState(0);
  const [timerSeconds, setTimerSeconds] = useState(30);
  const [usedCard, setUsedCard] = useState(null);
  const [activeActionModal, setActiveActionModal] = useState(null);
  const [actionTargetUser, setActionTargetUser] = useState(null);
  const [lieDetectorAnswer, setLieDetectorAnswer] = useState(null);
  const [showEscapeModal, setShowEscapeModal] = useState(false);
  const [escapeInput, setEscapeInput] = useState('');
  const [escapeResult, setEscapeResult] = useState(null);
  const [submittingEscape, setSubmittingEscape] = useState(false);

  const isSuspect = myRole === 'suspect';
  const currentPitchPlayer = players[pitchIndex % (players.length || 1)];

  // Pitch timer: derived from phaseStartedAt (server timestamp) per-turn
  // Each turn is 30s. We track pitchIndex to know which 30s window we're in.
  useEffect(() => {
    if (!phaseStartedAt) {
      // Fallback: local countdown if no server timestamp
      if (timerSeconds <= 0) return;
      const interval = setInterval(() => {
        setTimerSeconds((prev) => {
          if (prev <= 5) playTimerTickSound();
          return prev - 1;
        });
      }, 1000);
      return () => clearInterval(interval);
    }
    // Calculate remaining seconds for current pitch turn
    const calcRemaining = () => {
      const elapsed = (Date.now() - new Date(phaseStartedAt).getTime()) / 1000;
      const turnElapsed = elapsed % 30;
      return Math.max(0, Math.floor(30 - turnElapsed));
    };
    setTimerSeconds(calcRemaining());
    const interval = setInterval(() => {
      const remaining = calcRemaining();
      if (remaining <= 5) playTimerTickSound();
      setTimerSeconds(remaining);
    }, 1000);
    return () => clearInterval(interval);
  }, [phaseStartedAt, pitchIndex]);

  const handleNextPitch = () => {
    setPitchIndex((prev) => prev + 1);
    setTimerSeconds(30);
  };

  const handleUseActionCard = (card) => {
    setUsedCard(card.id);
    setActiveActionModal(card);
  };

  const handleEscapeGuess = async () => {
    if (!escapeInput.trim() || submittingEscape) return;
    setSubmittingEscape(true);
    try {
      const { data, error } = await supabase.rpc('submit_final_escape_guess', {
        p_room_id: roomId,
        p_guess: escapeInput.trim(),
      });
      if (error) {
        setEscapeResult(`❌ ${error.message}`);
        return;
      }
      const isCorrect = data?.is_correct === true;
      if (isCorrect) playVictorySound();
      setEscapeResult(
        isCorrect
          ? 'نجحت في الهروب! 🎉 تخمينك صحيح 100%'
          : 'فشلت محاولة الهروب! ❌ التخمين غير صحيح'
      );
      onFinalGuessSubmit && onFinalGuessSubmit(isCorrect);
    } catch (err) {
      setEscapeResult('❌ حدث خطأ. حاول مرة أخرى.');
    } finally {
      setSubmittingEscape(false);
    }
  };

  return (
    <div className="w-full max-w-4xl mx-auto space-y-6">
      {/* Banner / Header */}
      <div className="bg-gradient-to-r from-purple-900/80 via-slate-900 to-amber-900/80 p-6 rounded-2xl border border-amber-500/30 shadow-2xl backdrop-blur-md text-center relative overflow-hidden">
        <div className="absolute -top-10 -right-10 w-32 h-32 bg-amber-500/10 rounded-full blur-2xl pointer-events-none"></div>
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500/20 text-amber-300 text-xs font-semibold mb-3 border border-amber-500/30">
          🔥 طور المشتبه الخفي (Undercover Speed Mode)
        </div>
        <h2 className="text-2xl md:text-3xl font-extrabold text-white tracking-wide">
          قضية: <span className="text-amber-400">{caseData?.title}</span>
        </h2>
        <p className="text-slate-300 text-sm mt-1 max-w-xl mx-auto">
          تحدث بحذر! وصف كلمتك بجملة سريعة بدون ما تفصح عنها.. المشتبه فيه بيننا وبيحاول يمثل!
        </p>
      </div>

      {/* Secret Word Card */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="md:col-span-2 bg-slate-900/90 border border-slate-800 rounded-2xl p-6 shadow-xl relative flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between border-b border-slate-800 pb-3 mb-4">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
                بطاقتك السرية الخاصة
              </span>
              <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold ${
                isSuspect
                  ? 'bg-rose-500/20 text-rose-400 border border-rose-500/40'
                  : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
              }`}>
                {isSuspect ? '🕵️ أنت المشتبه فيه (Suspect)' : '🔍 أنت محقق (Detective)'}
              </span>
            </div>

            <div className="text-center my-6 space-y-2">
              <span className="text-slate-400 text-xs block">كلمتك السرية للجولة:</span>
              <div className="inline-block bg-gradient-to-r from-amber-500/10 via-amber-500/20 to-amber-500/10 border-2 border-amber-500/40 px-8 py-3 rounded-xl shadow-inner">
                <span className="text-2xl md:text-3xl font-black text-amber-300 tracking-wider">
                  {mySecretWord}
                </span>
              </div>
              {isSuspect && (
                <p className="text-rose-400 text-xs font-medium mt-2 animate-pulse">
                  ⚠️ كلمتك قد تكون مختلفة قليلاً عن بقية المحققين! مثل وظاهِر كأنك تعرف كلمتهم.
                </p>
              )}
            </div>
          </div>

          {/* Useful Undercover Hints */}
          {caseData?.undercover_hints && (
            <div className="bg-slate-950/60 rounded-xl p-3 border border-slate-800/80">
              <span className="text-xs font-semibold text-slate-400 block mb-1">💡 أفكار لمساعدتك في التلميح:</span>
              <ul className="text-xs text-slate-300 space-y-1 list-disc list-inside">
                {caseData.undercover_hints.map((hint, i) => (
                  <li key={i}>{hint}</li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Quick Pitch Turn Counter */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 shadow-xl flex flex-col items-center justify-between text-center">
          <div className="w-full">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block mb-2">
              الدور الحالي للوصف ⏱️
            </span>
            <div className="w-16 h-16 rounded-full bg-amber-500/10 border-2 border-amber-500/40 mx-auto flex items-center justify-center text-xl font-bold text-amber-400 shadow-inner mb-3">
              {timerSeconds}s
            </div>
            <div className="bg-slate-800/80 px-4 py-2 rounded-xl border border-slate-700">
              <span className="text-xs text-slate-400 block">دور اللاعب:</span>
              <span className="text-base font-bold text-white">
                {currentPitchPlayer?.display_name || 'في انتظار اللاعبين...'}
              </span>
            </div>
          </div>

          <button
            onClick={handleNextPitch}
            className="w-full mt-4 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-slate-950 font-bold py-2.5 px-4 rounded-xl shadow-lg transition transform active:scale-95 text-xs flex items-center justify-center gap-1.5"
          >
            <span>التالي (Next Pitch)</span> ➡️
          </button>
        </div>
      </div>

      {/* Action Cards & Interactive Tools */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 shadow-xl">
        <div className="flex items-center justify-between mb-4 border-b border-slate-800 pb-3">
          <h3 className="text-base font-bold text-white flex items-center gap-2">
            <span>⚡ كروت التحدي والمواجهة السريعة</span>
          </h3>
          <span className="text-xs text-slate-400">استخدم قدرتك السرية لجلب الشكوك!</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
          {ACTION_CARDS.map((card) => {
            const isUsed = usedCard === card.id;
            return (
              <div
                key={card.id}
                className={`p-4 rounded-xl border transition-all flex flex-col justify-between ${
                  isUsed
                    ? 'bg-slate-950/40 border-slate-800 opacity-50 cursor-not-allowed'
                    : 'bg-slate-800/50 border-slate-700/70 hover:border-amber-500/50 hover:bg-slate-800'
                }`}
              >
                <div>
                  <div className="text-2xl mb-1">{card.icon}</div>
                  <h4 className="text-sm font-bold text-amber-300">{card.name}</h4>
                  <p className="text-xs text-slate-400 mt-1 leading-relaxed">{card.description}</p>
                </div>
                <button
                  disabled={isUsed}
                  onClick={() => handleUseActionCard(card)}
                  className={`mt-3 w-full py-1.5 px-3 rounded-lg text-xs font-bold transition ${
                    isUsed
                      ? 'bg-slate-800 text-slate-600'
                      : 'bg-amber-500/20 text-amber-300 border border-amber-500/30 hover:bg-amber-500/30'
                  }`}
                >
                  {isUsed ? 'تم الاستخدام' : 'تفعيل الكارت'}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Action Card Modal (Lie Detector or Objection) */}
      {activeActionModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-amber-500/40 rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl relative">
            <button
              onClick={() => setActiveActionModal(null)}
              className="absolute top-4 left-4 text-slate-400 hover:text-white"
            >
              ✕
            </button>
            <div className="text-center">
              <span className="text-3xl block mb-2">{activeActionModal.icon}</span>
              <h3 className="text-lg font-bold text-amber-300">{activeActionModal.name}</h3>
              <p className="text-xs text-slate-300 mt-1">{activeActionModal.description}</p>
            </div>

            {activeActionModal.id === 'card-lie-detector' && (
              <div className="space-y-3 pt-2">
                <label className="text-xs text-slate-400 block">اختر اللاعب المراد استجوابه:</label>
                <select
                  onChange={(e) => setActionTargetUser(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl p-2 text-xs text-white"
                >
                  <option value="">-- اختر لاعباً --</option>
                  {players.filter(p => p.user_id !== currentUserId).map(p => (
                    <option key={p.id} value={p.user_id}>{p.display_name}</option>
                  ))}
                </select>
                <button
                  onClick={() => setLieDetectorAnswer(Math.random() > 0.5 ? 'صدق 🟢 (تلميحه متوافق)' : 'كذب 🔴 (تلميحه مشبوه!)')}
                  disabled={!actionTargetUser}
                  className="w-full bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold py-2 rounded-xl text-xs"
                >
                  فحص كاشف الكذب
                </button>
                {lieDetectorAnswer && (
                  <div className="p-3 bg-slate-950 rounded-xl text-center text-xs font-bold text-amber-300 border border-amber-500/30">
                    نتيجة الفحص: {lieDetectorAnswer}
                  </div>
                )}
              </div>
            )}

            {activeActionModal.id === 'card-objection' && (
              <div className="text-center space-y-3 pt-2">
                <p className="text-xs text-slate-300">
                  هل تريد إيقاف المناقشة وفتح مواجهة مباشرة مدتها 20 ثانية؟
                </p>
                <button
                  onClick={() => {
                    setActiveActionModal(null);
                    onBuzzerTrigger && onBuzzerTrigger();
                  }}
                  className="w-full bg-rose-600 hover:bg-rose-700 text-white font-bold py-2.5 rounded-xl text-xs shadow-lg"
                >
                  🛑 تفعيل الاعتراض المباشر الآن!
                </button>
              </div>
            )}

            {activeActionModal.id === 'card-word-clue' && (
              <div className="p-3 bg-slate-950 rounded-xl text-center text-xs text-amber-300 border border-amber-500/30">
                تلميح إضافي: {caseData?.description || 'لا يوجد تلميح إضافي.'}
              </div>
            )}

            {activeActionModal.id === 'card-swap-hint' && (
              <div className="p-3 bg-slate-950 rounded-xl text-center text-xs text-emerald-400 border border-emerald-500/30">
                تم إضافة شارة "مشتبه محتمل" على اسمك لزيادة التمويه في الجولة!
              </div>
            )}
          </div>
        </div>
      )}

      {/* Suspect Final Escape Button (Visible for suspect) */}
      {isSuspect && (
        <div className="bg-slate-900/90 border border-rose-500/30 p-4 rounded-2xl flex items-center justify-between flex-wrap gap-3">
          <div>
            <h4 className="text-sm font-bold text-rose-300">🏃‍♂️ محاولة الهروب الأخيرة من التهمة</h4>
            <p className="text-xs text-slate-400">لو اتكشفت أو حاسس إنهم هيصوتوا ضدك، خمّن كلمة المحققين الأصلية واهرب فوراً!</p>
          </div>
          <button
            onClick={() => setShowEscapeModal(true)}
            className="bg-gradient-to-r from-rose-600 to-amber-600 hover:from-rose-700 hover:to-amber-700 text-white font-extrabold px-5 py-2 rounded-xl text-xs shadow-lg transition transform active:scale-95"
          >
            🏃‍♂️ تنفيذ محاولة الهروب!
          </button>
        </div>
      )}

      {/* Final Escape Modal */}
      {showEscapeModal && (
        <div className="fixed inset-0 bg-black/85 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border-2 border-rose-500 rounded-3xl max-w-md w-full p-6 text-center space-y-4 shadow-2xl relative">
            <button
              onClick={() => setShowEscapeModal(false)}
              className="absolute top-4 left-4 text-slate-400 hover:text-white"
            >
              ✕
            </button>
            <div className="w-16 h-16 rounded-full bg-rose-500/20 border-2 border-rose-500 mx-auto flex items-center justify-center text-3xl">
              🏃‍♂️
            </div>
            <h3 className="text-xl font-black text-white">محاولة الهروب الأخيرة!</h3>
            <p className="text-xs text-slate-300">
              خمّن الكلمة السرية الأصلية للمحققين في هذه القضية. لو صح هتهرب وتكسب نقط الجولة!
            </p>

            <input
              type="text"
              placeholder="اكتب الكلمة المتوقعة هنا..."
              value={escapeInput}
              onChange={(e) => setEscapeInput(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 rounded-xl p-3 text-center text-sm font-bold text-amber-300 placeholder-slate-500 focus:border-amber-500 outline-none"
            />

            <div className="flex gap-2">
              <button
                onClick={handleEscapeGuess}
                disabled={submittingEscape || !!escapeResult}
                className="flex-1 bg-amber-500 hover:bg-amber-600 text-slate-950 font-extrabold py-2.5 rounded-xl text-xs transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {submittingEscape ? 'جاري التحقق...' : 'تقديم التخمين والهروب 🔓'}
              </button>
              <button
                onClick={() => setShowEscapeModal(false)}
                className="bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold px-4 rounded-xl text-xs"
              >
                إلغاء
              </button>
            </div>

            {escapeResult && (
              <div className="p-3 bg-slate-950 border border-amber-500/40 rounded-xl text-xs font-bold text-amber-300 mt-2">
                {escapeResult}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
