import React, { useState, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import {
  Search, Brain, Users, Package, Wallet, HandHeart, Sparkles,
  AlertTriangle, BookOpen, Eye, Store,
} from "lucide-react";
import { formatDate } from "@/lib/khataUtils";

const categories = [
  { key: "all", label: "Sab", icon: Brain },
  { key: "transaction", label: "Paisa", icon: Wallet },
  { key: "commitment", label: "Waaday", icon: HandHeart },
  { key: "decision", label: "Faislay", icon: Sparkles },
  { key: "problem", label: "Maslay", icon: AlertTriangle },
  { key: "market", label: "Market", icon: Eye },
  { key: "rule", label: "Rules", icon: BookOpen },
  { key: "stock", label: "Maal", icon: Package },
  { key: "onboarding", label: "Business", icon: Store },
];

export default function Memory() {
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState("all");

  const { data: memories, isLoading } = useQuery({
    queryKey: ["business-memories"],
    queryFn: () => base44.entities.BusinessMemory.list("-created_date", 500),
  });

  const filtered = useMemo(() => {
    if (!memories) return [];
    return memories.filter(m => {
      const catMatch = activeCategory === "all" || m.category === activeCategory;
      const q = search.toLowerCase();
      const searchMatch = !search ||
        (m.raw_text && m.raw_text.toLowerCase().includes(q)) ||
        (m.summary && m.summary.toLowerCase().includes(q)) ||
        (m.related_party_name && m.related_party_name.toLowerCase().includes(q)) ||
        (m.related_item && m.related_item.toLowerCase().includes(q));
      return catMatch && searchMatch;
    });
  }, [memories, activeCategory, search]);

  const byDate = {};
  filtered.forEach(m => {
    const date = m.memory_date || (m.created_date || "").slice(0, 10);
    if (!byDate[date]) byDate[date] = [];
    byDate[date].push(m);
  });
  const sortedDates = Object.keys(byDate).sort((a, b) => b.localeCompare(a));

  return (
    <div className="px-4 lg:px-8 py-4 lg:py-6 max-w-3xl mx-auto pb-20 lg:pb-8">
      <h1 className="text-2xl font-bold text-slate-900 font-display mb-1">Yaad</h1>
      <p className="text-slate-500 text-sm mb-4">PakKhata ko kya yaad hai</p>

      {/* Search */}
      <div className="relative mb-3">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Yaad dhoondhein... (e.g. 'Aslam payment')"
          className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 text-sm outline-none focus:border-emerald-400 bg-white"
        />
      </div>

      {/* Category filters */}
      <div className="flex gap-2 overflow-x-auto pb-2 mb-4 -mx-4 px-4 lg:mx-0 lg:px-0 scrollbar-hide">
        {categories.map(cat => {
          const Icon = cat.icon;
          const isActive = activeCategory === cat.key;
          return (
            <button
              key={cat.key}
              onClick={() => setActiveCategory(cat.key)}
              className={`flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                isActive ? "bg-slate-900 text-white" : "bg-white border border-slate-200 text-slate-600"
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {cat.label}
            </button>
          );
        })}
      </div>

      {/* Memories */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <div className="w-8 h-8 border-4 border-slate-200 border-t-emerald-600 rounded-full animate-spin"></div>
        </div>
      ) : sortedDates.length === 0 ? (
        <div className="text-center py-12 text-sm text-slate-400">
          {search ? "Kuch nahi mila. Doosre words try karein." : "Abhi tak koi yaad nahi hai. Bolen to PakKhata yaad rakhega."}
        </div>
      ) : (
        sortedDates.map(date => (
          <div key={date} className="mb-5">
            <div className="flex items-center gap-2 mb-2 px-1">
              <div className="w-2 h-2 rounded-full bg-emerald-500"></div>
              <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wide">{formatDate(date)}</h2>
            </div>
            <div className="space-y-2">
              {byDate[date].map(m => (
                <MemoryCard key={m.id} memory={m} />
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

function MemoryCard({ memory }) {
  const [showSource, setShowSource] = useState(false);

  const categoryColors = {
    transaction: "text-emerald-600 bg-emerald-50",
    commitment: "text-amber-600 bg-amber-50",
    decision: "text-emerald-600 bg-emerald-50",
    problem: "text-rose-600 bg-rose-50",
    market: "text-cyan-600 bg-cyan-50",
    rule: "text-slate-600 bg-slate-50",
    stock: "text-blue-600 bg-blue-50",
    onboarding: "text-purple-600 bg-purple-50",
    query: "text-slate-500 bg-slate-50",
    advice: "text-emerald-600 bg-emerald-50",
    other: "text-slate-500 bg-slate-50",
  };

  return (
    <div className="rounded-2xl bg-white border border-slate-200/70 p-3">
      <div className="flex items-start gap-2.5">
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${categoryColors[memory.category] || categoryColors.other}`}>
          <Brain className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-slate-900">{memory.summary}</p>
          {memory.related_party_name && (
            <p className="text-xs text-slate-400 mt-0.5">{memory.related_party_name}{memory.related_item ? ` · ${memory.related_item}` : ""}</p>
          )}
          <div className="flex items-center gap-2 mt-1">
            <span className="text-[10px] text-slate-400 capitalize">{memory.category}</span>
            {memory.amount != null && (
              <span className="text-[10px] font-medium text-slate-500">Rs {Number(memory.amount).toLocaleString()}</span>
            )}
          </div>
        </div>
      </div>
      <button
        onClick={() => setShowSource(!showSource)}
        className="mt-2 text-[10px] text-emerald-600 hover:text-emerald-700 font-medium"
      >
        {showSource ? "Chhupayen" : "Maine ye kya bola tha?"}
      </button>
      {showSource && memory.raw_text && (
        <div className="mt-1.5 px-3 py-2 rounded-lg bg-slate-50 border border-slate-100">
          <p className="text-xs text-slate-500 italic">"{memory.raw_text}"</p>
        </div>
      )}
    </div>
  );
}