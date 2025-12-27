"use client";

import FileUpload from "@/components/FileUpload";

export default function StudioPage() {
  return (
    <div className="min-h-screen hero-gradient">
      <header className="border-b border-zinc-800">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <a href="/" className="flex items-center gap-3 w-fit hover:opacity-80 transition-opacity">
            <div className="text-3xl">🏎</div>
            <h1 className="text-2xl font-bold tracking-tight">
              Tuner<span className="text-red-500">AI</span>
            </h1>
          </a>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-20">
        <div className="text-center space-y-8 mb-12">
          <h2 className="text-4xl font-bold">Upload Your Car</h2>
          <p className="text-zinc-400 max-w-xl mx-auto">
            Upload a photo of your car to start customizing. Best results with side-angle shots in good lighting.
          </p>
        </div>

        <FileUpload />
      </main>
    </div>
  );
}
