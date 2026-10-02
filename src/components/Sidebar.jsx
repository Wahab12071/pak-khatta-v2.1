import React from "react";
import { NavLink } from "react-router-dom";
import {
  LayoutDashboard,
  Users,
  Calculator,
  Bell,
  Mic,
  BookOpen,
  LogOut,
  Package,
  Wallet,
  History,
  GraduationCap,
  Brain,
} from "lucide-react";
import { base44 } from "@/api/base44Client";

const navItems = [
  { to: "/", label: "Today", icon: LayoutDashboard },
  { to: "/parties", label: "Khata", icon: Users },
  { to: "/memory", label: "Memory", icon: Brain },
  { to: "/stock", label: "Stock", icon: Package },
  { to: "/money", label: "Money", icon: Wallet },
  { to: "/timeline", label: "Timeline", icon: History },
  { to: "/learn", label: "Learn", icon: GraduationCap },
  { to: "/mandi", label: "Mandi", icon: Calculator },
  { to: "/reminders", label: "Reminders", icon: Bell },
];

export default function Sidebar({ onQuickAdd }) {
  const handleLogout = async () => {
    await base44.auth.logout();
    window.location.href = "/login";
  };

  return (
    <aside className="hidden lg:flex w-60 shrink-0 flex-col bg-white border-r border-slate-200/80 h-screen sticky top-0">
      <div className="px-5 py-5 border-b border-slate-100">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-600 to-emerald-800 flex items-center justify-center shadow-sm">
            <BookOpen className="w-5 h-5 text-white" strokeWidth={2.2} />
          </div>
          <div>
            <h1 className="font-display text-[15px] font-bold tracking-tight text-slate-900 leading-none">
              PakKhata
            </h1>
            <p className="text-[10px] text-slate-400 mt-1 tracking-wide uppercase">
              Bolo. Samjhega.
            </p>
          </div>
        </div>
      </div>

      <div className="px-4 py-4">
        <button
          onClick={onQuickAdd}
          className="w-full flex items-center justify-center gap-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium py-2.5 transition-all shadow-sm"
        >
          <Mic className="w-4 h-4" strokeWidth={2.5} />
          Bolo — Speak
        </button>
      </div>

      <nav className="flex-1 px-3 overflow-y-auto">
        <div className="space-y-0.5">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === "/"}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all ${
                    isActive
                      ? "bg-slate-900 text-white font-medium shadow-sm"
                      : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                  }`
                }
              >
                <Icon className="w-4.5 h-4.5" strokeWidth={2} />
                {item.label}
              </NavLink>
            );
          })}
        </div>
      </nav>

      <div className="px-3 py-3 border-t border-slate-100">
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-slate-500 hover:bg-slate-100 hover:text-slate-900 transition-all"
        >
          <LogOut className="w-4 h-4" strokeWidth={2} />
          Sign out
        </button>
      </div>
    </aside>
  );
}