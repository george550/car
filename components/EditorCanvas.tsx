"use client";

import { motion } from "framer-motion";
import Image from "next/image";

interface EditorCanvasProps {
    imageSrc: string | null;
}

export default function EditorCanvas({ imageSrc }: EditorCanvasProps) {
    if (!imageSrc) {
        return (
            <div className="w-full h-full flex items-center justify-center bg-zinc-900/50 rounded-2xl border border-zinc-800 border-dashed">
                <div className="text-center space-y-2">
                    <div className="text-4xl opacity-50">🖼️</div>
                    <p className="text-zinc-500">No image loaded</p>
                </div>
            </div>
        );
    }

    return (
        <div className="relative w-full h-full bg-zinc-900 rounded-2xl overflow-hidden border border-zinc-800 shadow-2xl">
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="relative w-full h-full flex items-center justify-center"
            >
                <Image
                    src={imageSrc}
                    alt="Editor Canvas"
                    fill
                    className="object-contain"
                    unoptimized
                />

                {/* Placeholder for overlays/masks */}
                <div className="absolute inset-0 pointer-events-none">
                    {/* Future: SVG overlays for wheels, stickers, etc. */}
                </div>
            </motion.div>

            {/* Canvas Controls Overlay (e.g., zoom, pan - placeholder) */}
            <div className="absolute bottom-4 right-4 flex gap-2">
                <button className="bg-black/50 backdrop-blur p-2 rounded-lg text-white hover:bg-black/70 transition-colors">
                    🔍
                </button>
            </div>
        </div>
    );
}
