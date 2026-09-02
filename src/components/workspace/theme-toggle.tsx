"use client";

import { Moon, Sun } from "lucide-react";
import { useState, useSyncExternalStore } from "react";

type Theme = "dark" | "light";

function applyTheme(theme: Theme): void {
  document.documentElement.classList.toggle("dark", theme === "dark");
  document.documentElement.style.colorScheme = theme;
  localStorage.setItem("docchat-theme", theme);
}

function subscribeToClient(onStoreChange: () => void): () => void {
  const timeoutId = window.setTimeout(onStoreChange, 0);
  return () => window.clearTimeout(timeoutId);
}

export function ThemeToggle() {
  const isClient = useSyncExternalStore(
    subscribeToClient,
    () => true,
    () => false,
  );
  const [selectedTheme, setSelectedTheme] = useState<Theme | null>(null);
  const isDark = selectedTheme
    ? selectedTheme === "dark"
    : isClient && document.documentElement.classList.contains("dark");

  return (
    <button
      type="button"
      onClick={() => {
        const nextTheme = isDark ? "light" : "dark";
        applyTheme(nextTheme);
        setSelectedTheme(nextTheme);
      }}
      className="grid size-9 place-items-center rounded-xl border border-slate-200 bg-white text-slate-600 shadow-sm transition-colors hover:bg-slate-50 hover:text-slate-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-950 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white dark:focus-visible:outline-slate-200"
      aria-label={isDark ? "Use light theme" : "Use dark theme"}
      title={isDark ? "Use light theme" : "Use dark theme"}
    >
      {isDark ? (
        <Sun size={17} aria-hidden="true" />
      ) : (
        <Moon size={17} aria-hidden="true" />
      )}
    </button>
  );
}
