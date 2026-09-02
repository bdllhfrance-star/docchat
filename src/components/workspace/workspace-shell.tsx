import Image from "next/image";
import { ShieldCheck } from "lucide-react";

import { DocumentSelectionWorkspace } from "./document-selection-workspace";
import { ThemeToggle } from "./theme-toggle";

function BrandLogo() {
  return (
    <Image
      src="/smartly-ai-logo.png"
      alt="Smartly.ai"
      width={296}
      height={80}
      className="h-7 w-auto shrink-0 dark:rounded-lg dark:bg-white dark:px-1.5 dark:py-1 sm:h-8"
      priority
    />
  );
}

function WorkspaceHeader() {
  return (
    <header className="flex h-16 shrink-0 items-center justify-between border-b border-slate-200/80 bg-white px-4 dark:border-slate-800 dark:bg-slate-950 sm:px-6">
      <div className="flex min-w-0 items-center gap-3">
        <BrandLogo />
        <div className="min-w-0">
          <p className="truncate text-xs text-slate-500 dark:text-slate-400">
            Answers grounded in your documents
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <div className="hidden items-center gap-2 text-xs font-medium text-slate-500 dark:text-slate-400 sm:flex">
          <ShieldCheck size={15} aria-hidden="true" />
          Private workspace
        </div>
        <ThemeToggle />
      </div>
    </header>
  );
}

export function WorkspaceShell() {
  return (
    <div className="flex min-h-dvh flex-col bg-white text-slate-950 dark:bg-slate-950 dark:text-slate-100 lg:h-dvh lg:overflow-hidden">
      <WorkspaceHeader />
      <DocumentSelectionWorkspace />
    </div>
  );
}
