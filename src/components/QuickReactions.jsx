import { useState, useEffect } from 'react';

const REACTIONS = [
  { id: 'liar', emoji: '🤥', label: 'كذاب!' },
  { id: 'objection', emoji: '🛑', label: 'اعتراض!' },
  { id: 'suspect', emoji: '😱', label: 'مشتبه فيه!' },
  { id: 'detective', emoji: '🕵️', label: 'محقق متمكن!' },
  { id: 'clue', emoji: '💡', label: 'فهمتك!' },
  { id: 'laugh', emoji: '😂', label: 'ههههه' },
];

export default function QuickReactions({ onSendReaction, activeReactions = [] }) {
  const [floatingList, setFloatingList] = useState([]);

  useEffect(() => {
    if (!activeReactions.length) return;
    const latest = activeReactions[activeReactions.length - 1];
    setFloatingList((prev) => [...prev.slice(-4), latest]);

    const timer = setTimeout(() => {
      setFloatingList((prev) => prev.filter((r) => r.id !== latest.id));
    }, 2500);

    return () => clearTimeout(timer);
  }, [activeReactions]);

  return (
    <div className="relative w-full">
      {/* Floating Reaction Banners */}
      <div className="fixed top-24 right-6 z-50 flex flex-col gap-2 pointer-events-none">
        {floatingList.map((item) => (
          <div
            key={item.id || Math.random()}
            className="bg-slate-900/90 border border-amber-500/50 text-white px-4 py-2 rounded-2xl shadow-2xl backdrop-blur-md flex items-center gap-2 text-sm font-bold animate-bounce"
          >
            <span className="text-xl">{item.emoji}</span>
            <span className="text-amber-300">{item.userName}:</span>
            <span className="text-slate-100">{item.label}</span>
          </div>
        ))}
      </div>

      {/* Reaction Buttons Bar */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-3 shadow-lg flex items-center justify-between gap-2 overflow-x-auto">
        <span className="text-xs font-bold text-slate-400 whitespace-nowrap pl-2">
          تفاعل سريع ⚡:
        </span>
        <div className="flex items-center gap-2">
          {REACTIONS.map((r) => (
            <button
              key={r.id}
              onClick={() => onSendReaction && onSendReaction(r)}
              className="bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700 text-white px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition transform active:scale-90 hover:border-amber-500/40"
            >
              <span className="text-sm">{r.emoji}</span>
              <span className="whitespace-nowrap text-slate-300">{r.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
