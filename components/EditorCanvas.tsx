"use client";

import { useEffect, useRef, useCallback, useImperativeHandle, forwardRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

interface EditorCanvasProps {
    originalImage: string | null;
    wheelLayer: string | null;
    paintLayer: string | null;
    wheelVisible: boolean;
    paintVisible: boolean;
    wheelMask?: string | null;
    bodyMask?: string | null;
    highlightType?: "wheel" | "paint" | null;
}

export interface EditorCanvasHandle {
    exportImage: (format?: "png" | "jpeg", quality?: number) => string | null;
}

const EditorCanvas = forwardRef<EditorCanvasHandle, EditorCanvasProps>(({
    originalImage,
    wheelLayer,
    paintLayer,
    wheelVisible,
    paintVisible,
    wheelMask,
    bodyMask,
    highlightType
}, ref) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const [showShine, setShowShine] = useState(false);
    const [canvasDimensions, setCanvasDimensions] = useState({ width: 0, height: 0 });

    // Trigger shine animation when highlightType changes
    useEffect(() => {
        if (highlightType) {
            setShowShine(true);
            const timer = setTimeout(() => setShowShine(false), 600);
            return () => clearTimeout(timer);
        }
    }, [highlightType]);

    // Expose export function to parent
    useImperativeHandle(ref, () => ({
        exportImage: (format = "png", quality = 0.95) => {
            if (!canvasRef.current) return null;
            const mimeType = format === "jpeg" ? "image/jpeg" : "image/png";
            return canvasRef.current.toDataURL(mimeType, quality);
        }
    }));

    // Cache loaded images to prevent flicker on re-composite
    const imageCache = useRef<Map<string, HTMLImageElement>>(new Map());
    const compositeIdRef = useRef(0);

    const loadImage = useCallback((src: string): Promise<HTMLImageElement> => {
        // Return cached image if available
        const cached = imageCache.current.get(src);
        if (cached) {
            return Promise.resolve(cached);
        }

        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                imageCache.current.set(src, img);
                resolve(img);
            };
            img.onerror = reject;
            img.src = src;
        });
    }, []);

    // Composite layers whenever inputs change
    useEffect(() => {
        if (!originalImage || !canvasRef.current) return;

        const canvas = canvasRef.current;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        // Track this composite operation
        const compositeId = ++compositeIdRef.current;

        const composite = async () => {
            try {
                // Load original image first to get dimensions
                const originalImg = await loadImage(originalImage);

                // Check if this composite is still current (prevents race conditions)
                if (compositeId !== compositeIdRef.current) {
                    console.log("[Canvas] Composite cancelled - newer composite started");
                    return;
                }

                // Set canvas size to match original (only if different)
                if (canvas.width !== originalImg.naturalWidth || canvas.height !== originalImg.naturalHeight) {
                    canvas.width = originalImg.naturalWidth;
                    canvas.height = originalImg.naturalHeight;
                    setCanvasDimensions({ width: originalImg.naturalWidth, height: originalImg.naturalHeight });
                }

                // Pre-load all layers BEFORE clearing canvas (prevents flicker)
                const [wheelImg, paintImg] = await Promise.all([
                    wheelLayer && wheelVisible ? loadImage(wheelLayer) : Promise.resolve(null),
                    paintLayer && paintVisible ? loadImage(paintLayer) : Promise.resolve(null),
                ]);

                // Check again after loading
                if (compositeId !== compositeIdRef.current) {
                    console.log("[Canvas] Composite cancelled after loading - newer composite started");
                    return;
                }

                // NOW clear and draw everything (all images are loaded)
                ctx.clearRect(0, 0, canvas.width, canvas.height);

                // Draw original image as base
                ctx.drawImage(originalImg, 0, 0);

                // Overlay wheel layer FIRST (paint will cover any body bleed)
                if (wheelImg) {
                    ctx.drawImage(wheelImg, 0, 0, canvas.width, canvas.height);
                    console.log("[Canvas] Drew wheel layer");
                }

                // Overlay paint layer on TOP (covers body, preserves original wheels underneath)
                if (paintImg) {
                    ctx.drawImage(paintImg, 0, 0, canvas.width, canvas.height);
                    console.log("[Canvas] Drew paint layer");
                }

                console.log("[Canvas] Composite complete", {
                    hasWheel: !!wheelImg,
                    hasPaint: !!paintImg,
                    wheelVisible,
                    paintVisible
                });
            } catch (error) {
                console.error("[Canvas] Compositing failed:", error);
            }
        };

        composite();
    }, [originalImage, wheelLayer, paintLayer, wheelVisible, paintVisible, loadImage]);

    // Clean up cache when original image changes (new upload)
    useEffect(() => {
        return () => {
            // Keep cache size reasonable - clear if over 20 entries
            if (imageCache.current.size > 20) {
                imageCache.current.clear();
            }
        };
    }, [originalImage]);

    if (!originalImage) {
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
        <motion.div
            ref={containerRef}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="relative inline-block rounded-2xl overflow-hidden shadow-2xl"
        >
            <canvas
                ref={canvasRef}
                className="max-w-full max-h-[80vh] w-auto h-auto block"
            />

            {/* Quick shine sweep animation */}
            <AnimatePresence>
                {showShine && (
                    <motion.div
                        className="absolute inset-0 pointer-events-none overflow-hidden"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.1 }}
                    >
                        {/* Primary shine */}
                        <motion.div
                            className="absolute inset-0"
                            style={{
                                background: "linear-gradient(105deg, transparent 0%, transparent 40%, rgba(255,255,255,0.6) 45%, rgba(255,255,255,0.9) 50%, rgba(255,255,255,0.6) 55%, transparent 60%, transparent 100%)",
                            }}
                            initial={{ x: "-100%" }}
                            animate={{ x: "100%" }}
                            transition={{ duration: 0.5, ease: "easeOut" }}
                        />
                        {/* Secondary shine - 3x wider, 50% slower, 30% less opaque */}
                        <motion.div
                            className="absolute inset-0"
                            style={{
                                background: "linear-gradient(105deg, transparent 0%, transparent 20%, rgba(255,255,255,0.2) 35%, rgba(255,255,255,0.35) 50%, rgba(255,255,255,0.2) 65%, transparent 80%, transparent 100%)",
                            }}
                            initial={{ x: "-100%" }}
                            animate={{ x: "100%" }}
                            transition={{ duration: 0.75, ease: "easeOut", delay: 0.12 }}
                        />
                    </motion.div>
                )}
            </AnimatePresence>
        </motion.div>
    );
});

EditorCanvas.displayName = "EditorCanvas";

export default EditorCanvas;
