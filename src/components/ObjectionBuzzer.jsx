import { useState, useEffect } from 'react';

export default function ObjectionBuzzer({
  players,
  currentUserId,
  roomId,
  onBuzzerTriggered,
  activeBuzzerState,
  objectionStartedAt,
  suspicionScores,
  onAdjustSuspicion,
  onCloseBuzzer
}) {
  const [objectionTimeLeft, setObjectionTimeLeft] = useState(20);

  // Server-authoritative 20s confrontation timer
  useEffect(() => {
    if (!activeBuzzerState) return;

    const calcRemaining = () => {
      if (!objectionStartedAt) return 20;
      const elapsed = (Date.now() - new Date(objectionStartedAt).getTime()) / 1000;
      return Math.max(0, Math.floor(20 - elapsed));
    };

    setObjectionTimeLeft(calcRemaining());
    const timer = setInterval(() => {
      const remaining = calcRemaining();
      setObjectionTimeLeft(remaining);
      if (remaining <= 0) {
        clearInterval(timer);
        onCloseBuzzer && onCloseBuzzer();
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [activeBuzzerState, objectionStartedAt, onCloseBuzzer]);

  return (
    <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-800 pb-3">
        <div>
          <h3 className="text-base font-bold text-white flex items-center gap-2">
            <span>🛑 زر الاعتراض المباشر ومقياس الشك (Buzzer & Suspicion Meter)</span>
          </h3>
          <p className="text-xs text-slate-400 mt-0.5">
            قيم نسبة شكوكك حول كل لاعب مباشرة، أو اضغط اعتراض لإيقاف الجولة واستجواب لاعب خائن!
          </p>
        </div>

        {/* Global Objection Buzzer Button */}
        <button
          onClick={onBuzzerTriggered}
          className="bg-gradient-to-r from-rose-600 to-rose-700 hover:from-rose-700 hover:to-rose-800 text-white font-extrabold px-5 py-2.5 rounded-xl shadow-lg shadow-rose-600/30 transition transform active:scale-95 text-xs flex items-center gap-2 animate-bounce"
        >
          <span className="text-base">🛑</span>
          <span>اعتراض مباشر! (OBJECTION)</span>
        </button>
      </div>

      {/* Players Live Suspicion List */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
        {players.map((p) => {
          const score = suspicionScores[p.user_id] ?? 50;
          const isSelf = p.user_id === currentUserId;

          return (
            <div
              key={p.id}
              className={`p-4 rounded-xl border flex flex-col justify-between space-y-3 ${
                isSelf
                  ? 'bg-slate-950/60 border-slate-800'
                  : 'bg-slate-800/40 border-slate-700/60 hover:border-slate-600'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold text-white flex items-center gap-2">
                  <span>👤 {p.display_name}</span>
                  {isSelf && <span className="text-[10px] text-amber-400 font-normal">(أنت)</span>}
                </span>
                <span
                  className={`text-xs font-black px-2 py-0.5 rounded-md ${
                    score > 70
                      ? 'bg-rose-500/20 text-rose-400 border border-rose-500/40'
                      : score < 30
                      ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                      : 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                  }`}
                >
                  شك: {score}%
                </span>
              </div>

              {/* Progress Bar */}
              <div className="w-full bg-slate-950 rounded-full h-2 overflow-hidden border border-slate-800">
                <div
                  className={`h-full transition-all duration-300 ${
                    score > 70 ? 'bg-rose-500' : score < 30 ? 'bg-emerald-500' : 'bg-amber-500'
                  }`}
                  style={{ width: `${score}%` }}
                ></div>
              </div>

              {/* Buttons to adjust suspicion */}
              {!isSelf && (
                <div className="flex items-center justify-between gap-2 pt-1">
                  <button
                    onClick={() => onAdjustSuspicion && onAdjustSuspicion(p.user_id, -10)}
                    className="flex-1 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 py-1 rounded-lg text-[11px] font-bold transition"
                  >
                    مضمون 🟢 (-10%)
                  </button>
                  <button
                    onClick={() => onAdjustSuspicion && onAdjustSuspicion(p.user_id, +10)}
                    className="flex-1 bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/30 py-1 rounded-lg text-[11px] font-bold transition"
                  >
                    مشبوه 🔴 (+10%)
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Active Objection Overlay Modal */}
      {activeBuzzerState && (
        <div className="fixed inset-0 bg-rose-950/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border-2 border-rose-500 rounded-3xl max-w-lg w-full p-8 text-center space-y-6 shadow-2xl relative overflow-hidden animate-pulse">
            <div className="w-20 h-20 rounded-full bg-rose-500/20 border-2 border-rose-500 mx-auto flex items-center justify-center text-4xl shadow-inner">
              🛑
            </div>
            <div>
              <span className="text-xs font-black tracking-widest text-rose-400 uppercase block mb-1">
                اعتراض مباشر في القاعة! OBJECTION!
              </span>
              <h2 className="text-2xl font-black text-white">
                تم تفعيل مواجهة الاستجواب المباشرة!
              </h2>
              <p className="text-xs text-slate-300 mt-2">
                انتبهوا! أحد المحققين قاطع الجولة لمساءلة المشتبه فيه فوراً. استخدموا الوقت في المواجهة المباشرة!
              </p>
            </div>

            <div className="bg-slate-950 border border-rose-500/40 p-4 rounded-2xl">
              <span className="text-xs text-slate-400 block mb-1">المتبقي على انتهاء الاعتراض:</span>
              <span className="text-4xl font-black text-rose-400">{objectionTimeLeft}s</span>
            </div>

            <button
              onClick={onCloseBuzzer}
              className="w-full bg-slate-800 hover:bg-slate-700 text-white font-bold py-2.5 rounded-xl text-xs transition border border-slate-700"
            >
              إنهاء الاعتراض والعودة للجولة
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
