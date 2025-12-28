"use client";

import FileUpload from "@/components/FileUpload";
import Link from "next/link";

export default function StudioPage() {
  return (
    <div className="min-h-screen hero-gradient">
      <header className="border-b border-zinc-800">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <a href="/" className="flex items-center gap-3 w-fit hover:opacity-80 transition-opacity">
            <div className="text-3xl">🏎</div>
            <h1 className="text-2xl font-bold tracking-tight">
              Tuner<span className="text-red-500">AI</span>
            </h1>
          </a>
          <Link
            href="/editor"
            className="bg-zinc-800 text-zinc-300 px-4 py-2 rounded-lg text-sm font-medium hover:bg-zinc-700 hover:text-white transition-all flex items-center gap-2"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
              <path fillRule="evenodd" d="M17 10a.75.75 0 0 1-.75.75H5.612l4.158 3.96a.75.75 0 1 1-1.04 1.08l-5.5-5.25a.75.75 0 0 1 0-1.08l5.5-5.25a.75.75 0 1 1 1.04 1.08L5.612 9.25H16.25A.75.75 0 0 1 17 10Z" clipRule="evenodd" />
            </svg>
            Back to Editor
          </Link>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-20">
        <FileUpload />
      </main>
    </div>
  );
}
