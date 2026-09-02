import Image from "next/image";
import { ShieldCheck } from "lucide-react";

import { DocumentSelectionWorkspace } from "./document-selection-workspace";
import { ThemeToggle } from "./theme-toggle";

function BrandLogo() {
  return (
    <div className="flex shrink-0 items-center gap-2" aria-label="Smartly.ai">
      <Image
        src="/smartly-ai-mark.png"
        alt=""
        width={87}
        height={80}
        className="h-8 w-auto shrink-0 sm:h-9"
        priority
      />
      <span className="text-lg font-semibold tracking-tight text-slate-950 dark:text-white sm:text-xl">
        Smartly.ai
      </span>
    </div>
  );
}

function WorkspaceHeader() {
  return (
    <header className="flex h-16 shrink-0 items-center justify-between border-b border-slate-200/80 bg-white px-4 dark:border-slate-800 dark:bg-slate-950 sm:px-6">
      <BrandLogo />

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
