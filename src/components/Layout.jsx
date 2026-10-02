import React from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import Sidebar from "@/components/Sidebar";
import BottomNav from "@/components/BottomNav";

const titles = {
  "/": "Today",
  "/parties": "Khata",
  "/memory": "Memory",
  "/stock": "Stock",
  "/money": "Money",
  "/timeline": "Timeline",
  "/learn": "Learn",
  "/mandi": "Mandi Engine",
  "/reminders": "Reminders",
};

export default function Layout() {
  const location = useLocation();
  const navigate = useNavigate();
  const title = titles[location.pathname] || "PakKhata";

  return (
    <div className="flex min-h-screen bg-slate-50/50">
      <Sidebar onQuickAdd={() => navigate("/")} />
      <div className="flex-1 flex flex-col min-w-0">
        <header className="lg:hidden sticky top-0 z-30 bg-white border-b border-slate-200/60 px-4 py-3">
          <h1 className="font-display text-lg font-bold tracking-tight text-slate-900">
            {title}
          </h1>
        </header>
        <main className="flex-1 pb-20 lg:pb-0">
          <Outlet />
        </main>
      </div>
      <BottomNav onQuickAdd={() => navigate("/")} />
    </div>
  );
}