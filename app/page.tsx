"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import FileUpload from "@/components/FileUpload";

export default function Home() {
  const router = useRouter();
  const handleStartClick = () => {
    router.push("/editor");
  };

  return (
    <div className="min-h-screen hero-gradient">
      {/* Header */}
      <header className="border-b border-zinc-800">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            className="flex items-center gap-3 cursor-pointer"
            onClick={() => router.push("/")}
          >
            <div className="text-3xl">🏎</div>
            <h1 className="text-2xl font-bold tracking-tight">
              Tuner<span className="text-red-500">AI</span>
            </h1>
          </motion.div>
          <nav className="hidden md:flex items-center gap-8 text-sm">
            <a href="#" className="text-zinc-400 hover:text-white transition-colors">
              Gallery
            </a>
            <a href="#" className="text-zinc-400 hover:text-white transition-colors">
              How It Works
            </a>
            <a href="#" className="text-zinc-400 hover:text-white transition-colors">
              Pricing
            </a>
          </nav>
        </div>
      </header>

      {/* Hero Section */}
      <main className="max-w-7xl mx-auto px-6 py-20">
        <div className="text-center space-y-8">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <h2 className="text-6xl md:text-7xl font-bold tracking-tight mb-4">
              Your Dream Build,
              <br />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-red-500 via-orange-500 to-red-500">
                Visualized in Seconds
              </span>
            </h2>
            <p className="text-xl text-zinc-400 max-w-2xl mx-auto mt-6">
              Transform your car with AI-powered customization. Upload a photo, swap wheels,
              adjust stance, and see your vision come to life.
            </p>
          </motion.div>

          {/* Racing Stripe Divider */}
          <motion.div
            initial={{ scaleX: 0 }}
            animate={{ scaleX: 1 }}
            transition={{ duration: 0.8, delay: 0.3 }}
            className="racing-stripe max-w-2xl mx-auto"
          />

          {/* CTA Button */}
          <div className="pt-8">
            <button
              onClick={handleStartClick}
              className="bg-red-600 hover:bg-red-700 text-white px-12 py-4 rounded-full text-lg font-semibold transition-all hover:scale-105 hover:shadow-lg hover:shadow-red-600/50"
            >
              Start Customizing
            </button>
          </div>

          {/* Feature Grid */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.8, delay: 0.6 }}
            className="grid md:grid-cols-3 gap-8 pt-20"
          >
            <div className="bg-zinc-900/50 backdrop-blur border border-zinc-800 rounded-2xl p-8 hover:border-zinc-700 transition-colors">
              <div className="text-4xl mb-4">🎨</div>
              <h3 className="text-xl font-semibold mb-3">Instant Visualization</h3>
              <p className="text-zinc-400">
                See real-time modifications with AI-powered rendering. No guesswork, just results.
              </p>
            </div>

            <div className="bg-zinc-900/50 backdrop-blur border border-zinc-800 rounded-2xl p-8 hover:border-zinc-700 transition-colors">
              <div className="text-4xl mb-4">⚙️</div>
              <h3 className="text-xl font-semibold mb-3">Real Parts, Real Fitment</h3>
              <p className="text-zinc-400">
                Browse actual aftermarket parts with guaranteed fitment for your vehicle.
              </p>
            </div>

            <div className="bg-zinc-900/50 backdrop-blur border border-zinc-800 rounded-2xl p-8 hover:border-zinc-700 transition-colors">
              <div className="text-4xl mb-4">🛒</div>
              <h3 className="text-xl font-semibold mb-3">Shop Your Build</h3>
              <p className="text-zinc-400">
                One-click access to purchase every part you've customized.
              </p>
            </div>
          </motion.div>

          {/* Hero Cars Section */}
          <div className="pt-20">
            <h3 className="text-2xl font-semibold mb-8">Hero Platforms</h3>
            <div className="flex flex-wrap justify-center gap-4 text-sm">
              {["Porsche 911", "Tesla Model 3/Y", "Honda Civic Type R", "Mazda Miata", "VW GTI"].map((car, i) => (
                <motion.div
                  key={car}
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ duration: 0.3, delay: 0.8 + i * 0.1 }}
                  className="bg-zinc-800/50 border border-zinc-700 px-6 py-3 rounded-full hover:bg-zinc-800 transition-colors cursor-pointer"
                >
                  {car}
                </motion.div>
              ))}
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-zinc-800 mt-20">
        <div className="max-w-7xl mx-auto px-6 py-8 text-center text-zinc-500 text-sm">
          <p>© 2025 TunerAI. The Amazon of Car Customization.</p>
        </div>
      </footer>
    </div>
  );
}
