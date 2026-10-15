import Image from "next/image";
import { ShieldCheck } from "lucide-react";

import { DocumentSelectionWorkspace } from "./document-selection-workspace";
import { ThemeToggle } from "./theme-toggle";

function BrandLogo() {
  return (
    <div className="flex min-w-0 items-center gap-2.5" aria-label="CNOM · Assistant documentaire">
      <span className="grid h-8 w-7 shrink-0 place-items-center sm:h-9 sm:w-8">
        <Image
          src="/cnom-logo.png"
          alt="Comité National Olympique Marocain"
          width={436}
          height={508}
          className="h-full w-auto object-contain dark:brightness-0 dark:invert"
          priority
        />
      </span>
      <div className="min-w-0">
        <p className="text-[11px] font-medium leading-4 text-slate-600 dark:text-slate-300 sm:text-xs">Comité National Olympique Marocain</p>
        <p className="mt-0.5 text-sm font-semibold tracking-tight text-slate-950 dark:text-white sm:text-base">Assistant documentaire</p>
      </div>
    </div>
  );
}

function WorkspaceHeader() {
  return (
    <header className="cnom-header flex min-h-14 shrink-0 items-center justify-between gap-3 border-b border-slate-200/80 bg-white px-4 py-2 dark:border-slate-800 dark:bg-slate-950 sm:min-h-16 sm:px-6">
      <BrandLogo />

      <div className="flex items-center gap-3">
        <div className="hidden items-center gap-2 text-xs font-medium text-slate-500 dark:text-slate-400 sm:flex">
          <ShieldCheck size={15} aria-hidden="true" />
          Espace documentaire privé
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
