export default function Home() {
  return (
    <main className="grid min-h-screen place-items-center px-6 py-16">
      <section className="w-full max-w-2xl rounded-3xl border border-slate-200 bg-white p-8 shadow-sm sm:p-12">
        <p className="mb-4 text-sm font-semibold uppercase tracking-[0.2em] text-blue-700">
          Smartly.ai technical exercise
        </p>
        <h1 className="text-4xl font-semibold tracking-tight text-slate-950 sm:text-5xl">
          DocChat
        </h1>
        <p className="mt-5 max-w-xl text-lg leading-8 text-slate-600">
          Upload PDF documents and ask questions answered only from their
          content, with the supporting sources attached.
        </p>
        <div className="mt-8 inline-flex items-center gap-2 rounded-full bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-800">
          <span
            className="size-2 rounded-full bg-emerald-500"
            aria-hidden="true"
          />
          Workspace ready
        </div>
      </section>
    </main>
  );
}
