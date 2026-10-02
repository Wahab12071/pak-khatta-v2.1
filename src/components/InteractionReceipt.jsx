import React, { useState } from "react";
import { Check, Brain, RefreshCw, Volume2, ChevronDown, ChevronUp, Eye } from "lucide-react";

export default function InteractionReceipt({ receipt, audioUrl, onPlayAudio, speaking }) {
  const [expanded, setExpanded] = useState(false);

  if (!receipt) return null;
  const hasContent = receipt.understood?.length || receipt.recorded?.length || receipt.remembered || receipt.impact?.length;
  if (!hasContent) return null;

  return (
    <div className="mt-2 rounded-xl border border-emerald-100 bg-white overflow-hidden w-full max-w-[92%]">
      {/* Voice player bar */}
      {audioUrl && (
        <button
          onClick={() => onPlayAudio(audioUrl)}
          className={`w-full flex items-center gap-2 px-3 py-2.5 transition-colors ${speaking ? "bg-emerald-500" : "bg-emerald-50 hover:bg-emerald-100"}`}
        >
          <div className={`w-7 h-7 rounded-full flex items-center justify-center ${speaking ? "bg-white/20" : "bg-emerald-100"}`}>
            <Volume2 className={`w-3.5 h-3.5 ${speaking ? "text-white" : "text-emerald-600"}`} />
          </div>
          <span className={`text-xs font-medium ${speaking ? "text-white" : "text-emerald-700"}`}>
            {speaking ? "Bol raha hoon..." : "▶ Suno"}
          </span>
          {speaking && (
            <div className="flex gap-0.5 ml-auto">
              <div className="w-1 h-3 bg-white/60 rounded-full animate-pulse" style={{ animationDelay: "0ms" }}></div>
              <div className="w-1 h-4 bg-white/60 rounded-full animate-pulse" style={{ animationDelay: "150ms" }}></div>
              <div className="w-1 h-2.5 bg-white/60 rounded-full animate-pulse" style={{ animationDelay: "300ms" }}></div>
              <div className="w-1 h-3.5 bg-white/60 rounded-full animate-pulse" style={{ animationDelay: "450ms" }}></div>
            </div>
          )}
        </button>
      )}

      {/* Recorded */}
      {receipt.recorded?.length > 0 && (
        <div className="px-3 py-2 border-t border-emerald-50">
          <div className="flex items-center gap-1.5 mb-1">
            <Check className="w-3 h-3 text-emerald-600" />
            <span className="text-[10px] font-semibold text-emerald-700 uppercase tracking-wide">Record hua</span>
          </div>
          {receipt.recorded.map((r, i) => (
            <div key={i} className="text-xs text-slate-600 ml-4 flex gap-1">
              <span className="text-slate-400 shrink-0">{r.label}:</span>
              <span className="font-medium truncate">{r.value}</span>
            </div>
          ))}
        </div>
      )}

      {/* Remembered */}
      {receipt.remembered && (
        <div className="px-3 py-2 border-t border-emerald-50">
          <div className="flex items-center gap-1.5 mb-1">
            <Brain className="w-3 h-3 text-amber-600" />
            <span className="text-[10px] font-semibold text-amber-700 uppercase tracking-wide">Yaad rakha</span>
          </div>
          <p className="text-xs text-slate-600 ml-4">{receipt.remembered}</p>
        </div>
      )}

      {/* Impact */}
      {receipt.impact?.length > 0 && (
        <div className="px-3 py-2 border-t border-emerald-50">
          <div className="flex items-center gap-1.5 mb-1">
            <RefreshCw className="w-3 h-3 text-blue-600" />
            <span className="text-[10px] font-semibold text-blue-700 uppercase tracking-wide">Business impact</span>
          </div>
          {receipt.impact.map((imp, i) => (
            <div key={i} className="text-xs text-slate-600 ml-4 flex justify-between">
              <span className="text-slate-400">{imp.label}</span>
              <span className="font-semibold tabular-nums">{imp.value}</span>
            </div>
          ))}
        </div>
      )}

      {/* Understood (expandable) */}
      {receipt.understood?.length > 0 && (
        <>
          <button
            onClick={() => setExpanded(!expanded)}
            className="w-full flex items-center gap-1.5 px-3 py-2 border-t border-emerald-50 text-slate-400 hover:bg-slate-50 transition-colors"
          >
            {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            <span className="text-[10px] font-medium uppercase tracking-wide">Samjha</span>
          </button>
          {expanded && (
            <div className="px-3 py-2 bg-slate-50/50 space-y-0.5">
              {receipt.understood.map((u, i) => (
                <div key={i} className="text-xs text-slate-500 flex justify-between">
                  <span className="text-slate-400">{u.label}</span>
                  <span className="font-medium">{u.value}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}