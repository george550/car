"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import EditorCanvas, { EditorCanvasHandle } from "@/components/EditorCanvas";
import FileUpload from "@/components/FileUpload";
import { motion, AnimatePresence } from "framer-motion";

// Humorous loading messages for each selection
const LOADING_MESSAGES: Record<string, string[]> = {
    // Wheel selections
    "20-sputtering": [
        "Polishing chrome to mirror finish...",
        "Calibrating lattice spoke geometry...",
        "Teaching Pirelli tires to grip harder...",
    ],
    "19-hyper-silver": [
        "Applying hyper silver at ludicrous speed...",
        "Continental tires reporting for duty...",
        "Making 5-spoke design jealous of itself...",
    ],
    "19-diamond-cut": [
        "Diamonds are a car's best friend...",
        "Machining faces to perfection...",
        "Multi-spoke pattern looking sharp...",
    ],
    "18-diamond-cut": [
        "Double-spoke design incoming...",
        "Teaching 18 inches to punch above its weight...",
        "Pirelli rubber getting cozy...",
    ],
    // Paint selections
    "vik-black": [
        "Channeling the void...",
        "Making other cars feel underdressed...",
        "Achieving peak stealth mode...",
    ],
    "himalayan-gray": [
        "Summoning mountain vibes...",
        "Gray matter in full effect...",
        "Sophistication level: maximum...",
    ],
    "adriatic-blue": [
        "Bottling Mediterranean vibes...",
        "Ocean depth: checking...",
        "Making the sky jealous...",
    ],
    "cardiff-green": [
        "Channeling Welsh countryside energy...",
        "Teal appeal activated...",
        "Nature called, we answered...",
    ],
    "savile-silver": [
        "Tailoring this silver to perfection...",
        "Runway ready in 3... 2...",
        "Reflecting good life choices...",
    ],
    "uyuni-white": [
        "Pearl formation in progress...",
        "Purity levels off the charts...",
        "Salt flat vibes incoming...",
    ],
    "gold-coast": [
        "Mining for that bronze glow...",
        "Beach sunset energy loading...",
        "Luxury tan activated...",
    ],
    "makalu-gray": [
        "Flattening the curve (literally)...",
        "Matte finish: no fingerprints allowed...",
        "Stealth mode but make it fashion...",
    ],
};

// Component to cycle through loading messages
function LoadingMessages({ selectionId }: { selectionId: string | null }) {
    const [messageIndex, setMessageIndex] = useState(0);
    const messages = selectionId ? LOADING_MESSAGES[selectionId] || ["AI is modifying your build..."] : ["AI is modifying your build..."];

    useEffect(() => {
        setMessageIndex(0);
        const interval = setInterval(() => {
            setMessageIndex((prev) => (prev + 1) % messages.length);
        }, 2500);
        return () => clearInterval(interval);
    }, [selectionId, messages.length]);

    return (
        <AnimatePresence mode="wait">
            <motion.p
                key={messageIndex}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.3 }}
                className="text-zinc-400 text-sm mb-4 h-5"
            >
                {messages[messageIndex]}
            </motion.p>
        </AnimatePresence>
    );
}

export default function EditorPage() {
    const router = useRouter();
    const canvasRef = useRef<EditorCanvasHandle>(null);
    const [originalImage, setOriginalImage] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState("wheels");
    const [isProcessing, setIsProcessing] = useState(false);
    const [processingItem, setProcessingItem] = useState<string | null>(null);
    const [highlightType, setHighlightType] = useState<"wheel" | "paint" | null>(null);
    const [tooltip, setTooltip] = useState<{ text: string | null; top: number; title: string }>({ text: null, top: 0, title: "" });
    const [showExportMenu, setShowExportMenu] = useState(false);
    const [showImageZoom, setShowImageZoom] = useState(false);

    const EXPORT_SIZES = [
        { label: "Small", width: 1024, height: 768 },
        { label: "Medium", width: 1920, height: 1440 },
        { label: "Large", width: 3840, height: 2880 },
    ];

    // Layer-based storage: each modification is a transparent PNG layer
    const [wheelLayers, setWheelLayers] = useState<Record<string, string>>({});
    const [paintLayers, setPaintLayers] = useState<Record<string, string>>({});

    // Currently selected items
    const [selectedWheel, setSelectedWheel] = useState<string | null>(null);
    const [selectedPaint, setSelectedPaint] = useState<string | null>(null);

    // Visibility toggles - separate from selection (allows showing/hiding individual mods)
    const [wheelVisible, setWheelVisible] = useState(true);
    const [paintVisible, setPaintVisible] = useState(true);

    // Toggle to view original image (hides ALL mods)
    const [viewingOriginal, setViewingOriginal] = useState(false);

    // Wheel region mask from SAM3 - cached from FileUpload
    const [wheelMask, setWheelMask] = useState<string | null>(null);

    // Body mask state (for paint operations) - cached from FileUpload
    const [bodyMask, setBodyMask] = useState<string | null>(null);

    // Loading states for masks
    const [isLoadingWheelMask, setIsLoadingWheelMask] = useState(true);
    const [isLoadingBodyMask, setIsLoadingBodyMask] = useState(true);

    // Error state for displaying issues
    const [error, setError] = useState<string | null>(null);

    // Load masks from sessionStorage on mount - SAM3 only runs during upload, never in editor
    useEffect(() => {
        const storedImage = sessionStorage.getItem("tuner-ai-image");
        if (!storedImage || originalImage) return;

        setOriginalImage(storedImage);

        // Load cached masks from FileUpload
        const storedWheelMask = sessionStorage.getItem("tuner-ai-wheel-mask");
        const storedBodyMask = sessionStorage.getItem("tuner-ai-body-mask");

        if (storedWheelMask) {
            console.log("[Editor] Loading cached wheel mask");
            setWheelMask(storedWheelMask);
            setIsLoadingWheelMask(false);
            sessionStorage.removeItem("tuner-ai-wheel-mask");
        }
        if (storedBodyMask) {
            console.log("[Editor] Loading cached body mask");
            setBodyMask(storedBodyMask);
            setIsLoadingBodyMask(false);
            sessionStorage.removeItem("tuner-ai-body-mask");
        }

        // If detection is still in progress from FileUpload, wait for it
        if (sessionStorage.getItem("tuner-ai-detection-in-progress")) {
            console.log("[Editor] Waiting for FileUpload detection to complete...");
            waitForMasks();
        } else {
            // Detection not in progress - if masks aren't loaded, they failed
            if (!storedWheelMask) setIsLoadingWheelMask(false);
            if (!storedBodyMask) setIsLoadingBodyMask(false);
        }

        async function waitForMasks() {
            const maxWait = 60000;
            const pollInterval = 500;
            const startTime = Date.now();

            while (Date.now() - startTime < maxWait) {
                if (!sessionStorage.getItem("tuner-ai-detection-in-progress")) {
                    // Detection finished - load any new masks
                    const newWheelMask = sessionStorage.getItem("tuner-ai-wheel-mask");
                    const newBodyMask = sessionStorage.getItem("tuner-ai-body-mask");

                    if (newWheelMask) {
                        setWheelMask(newWheelMask);
                        sessionStorage.removeItem("tuner-ai-wheel-mask");
                    }
                    if (newBodyMask) {
                        setBodyMask(newBodyMask);
                        sessionStorage.removeItem("tuner-ai-body-mask");
                    }
                    setIsLoadingWheelMask(false);
                    setIsLoadingBodyMask(false);
                    console.log("[Editor] Masks loaded from FileUpload detection");
                    return;
                }
                await new Promise(r => setTimeout(r, pollInterval));
            }
            // Timeout - stop loading states
            setIsLoadingWheelMask(false);
            setIsLoadingBodyMask(false);
            console.log("[Editor] Timeout waiting for masks");
        }
    }, [originalImage]);

    // Get the current wheel layer (if selected and has layer)
    const currentWheelLayer = selectedWheel && !viewingOriginal ? wheelLayers[selectedWheel] || null : null;

    // Get the current paint layer (if selected and has layer)
    const currentPaintLayer = selectedPaint && !viewingOriginal ? paintLayers[selectedPaint] || null : null;

    const handleWheelClick = (wheel: { id: string; name: string; prompt: string }) => {
        if (isProcessing) return;
        if (isLoadingWheelMask) {
            setError("Please wait - detecting wheels...");
            return;
        }

        console.log("[handleWheelClick]", { wheelId: wheel.id, hasLayer: !!wheelLayers[wheel.id], currentSelected: selectedWheel, hasMask: !!wheelMask });

        // If clicking the currently selected wheel, toggle visibility
        if (selectedWheel === wheel.id) {
            console.log("[handleWheelClick] Toggling visibility");
            setWheelVisible(!wheelVisible);
            setViewingOriginal(false);
            return;
        }

        // Select new wheel
        setSelectedWheel(wheel.id);
        setWheelVisible(true);
        setViewingOriginal(false);

        // Check if layer already exists
        if (wheelLayers[wheel.id]) {
            console.log("[handleWheelClick] Using cached layer");
            return;
        }

        // Generate new layer
        console.log("[handleWheelClick] Generating new layer (mask ready:", !!wheelMask, ")");
        handleGenerateLayer(wheel.prompt, wheel.id, "wheel");
    };

    const handlePaintClick = (paint: { id: string; name: string; prompt: string }) => {
        if (isProcessing) return;
        if (isLoadingBodyMask) {
            setError("Please wait - detecting body...");
            return;
        }

        console.log("[handlePaintClick]", { paintId: paint.id, hasLayer: !!paintLayers[paint.id], currentSelected: selectedPaint, hasBodyMask: !!bodyMask });

        // If clicking the currently selected paint, toggle visibility
        if (selectedPaint === paint.id) {
            console.log("[handlePaintClick] Toggling visibility");
            setPaintVisible(!paintVisible);
            setViewingOriginal(false);
            return;
        }

        // Select new paint
        setSelectedPaint(paint.id);
        setPaintVisible(true);
        setViewingOriginal(false);

        // Check if layer already exists
        if (paintLayers[paint.id]) {
            console.log("[handlePaintClick] Using cached layer");
            return;
        }

        // Generate new layer
        console.log("[handlePaintClick] Generating new layer");
        handleGenerateLayer(paint.prompt, paint.id, "paint");
    };

    // Generate a layer (wheel or paint) and store it
    const handleGenerateLayer = async (prompt: string, itemId: string, layerType: "wheel" | "paint") => {
        if (!originalImage || isProcessing) return;

        setIsProcessing(true);
        setProcessingItem(itemId);
        setError(null);

        try {
            // Always use original image as base for layers (compositing handles stacking)
            const response = await fetch(originalImage);
            const blob = await response.blob();
            const fileType = blob.type || "image/png";
            const fileName = fileType === "image/jpeg" ? "input.jpg" : "input.png";
            const file = new File([blob], fileName, { type: fileType });

            const formData = new FormData();
            formData.append("image", file);

            // Choose endpoint based on layer type and mask availability
            let endpoint = "/api/process-car";  // Default fallback

            if (layerType === "wheel" && wheelMask) {
                // Use hybrid approach: Qwen with reference image + mask compositing
                // This gives accurate wheel designs AND pixel-perfect background
                endpoint = "/api/replace-wheels";
                formData.append("selectedWheel", itemId);
                formData.append("wheelMask", wheelMask);
                console.log("[handleGenerateLayer] Using HYBRID wheel replacement (Qwen + mask composite)");
            } else if (layerType === "wheel") {
                // Fallback to Qwen if no mask available
                formData.append("selectedWheel", itemId);
                formData.append("prompt", prompt);
                console.log("[handleGenerateLayer] Using Qwen (no wheel mask available)");
            } else if (layerType === "paint") {
                // Use color adjustment with SAM3 body mask
                // This applies a color tint without AI hallucination
                endpoint = "/api/paint-body";
                formData.append("selectedPaint", itemId);
                if (wheelMask) {
                    formData.append("wheelMask", wheelMask);
                }
                if (bodyMask) {
                    formData.append("bodyMask", bodyMask);
                }
                console.log("[handleGenerateLayer] Using color adjustment for paint", { hasBodyMask: !!bodyMask, hasWheelMask: !!wheelMask });
            }

            // Add timeout (3 minutes for inpainting which is slower)
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 180000);

            const res = await fetch(endpoint, {
                method: "POST",
                body: formData,
                signal: controller.signal,
            });

            clearTimeout(timeoutId);

            if (!res.ok) {
                const errorData = await res.json();
                console.error("API Error:", errorData);
                throw new Error(errorData.message || errorData.error || "Failed to generate layer");
            }

            const data = await res.json();
            console.log("[handleGenerateLayer] Response:", data);

            if (data.layerUrl) {
                // Store layer in appropriate state
                if (layerType === "wheel") {
                    setWheelLayers(prev => ({ ...prev, [itemId]: data.layerUrl }));
                    console.log("[handleGenerateLayer] Stored wheel layer:", itemId);
                } else {
                    setPaintLayers(prev => ({ ...prev, [itemId]: data.layerUrl }));
                    console.log("[handleGenerateLayer] Stored paint layer:", itemId);
                }
                // Trigger highlight animation
                setHighlightType(layerType);
                // Clear highlight after animation completes
                setTimeout(() => setHighlightType(null), 2500);
            } else {
                throw new Error("No layer returned from API");
            }

        } catch (error: any) {
            console.error("Layer generation failed:", error);

            let errorMessage = "Something went wrong";
            if (error?.name === "AbortError") {
                errorMessage = "Request timed out. Please try again.";
            } else if (error instanceof Error) {
                errorMessage = error.message;
            }

            setError(errorMessage);

            // Deselect on failure
            if (layerType === "wheel") {
                setSelectedWheel(null);
            } else {
                setSelectedPaint(null);
            }
        } finally {
            setIsProcessing(false);
            setProcessingItem(null);
        }
    };

    // Export the current canvas as an image at specified size
    const handleExport = (targetWidth: number, targetHeight: number) => {
        if (!canvasRef.current) {
            console.error("[Export] Canvas ref not available");
            return;
        }

        const dataUrl = canvasRef.current.exportImage("png");
        if (!dataUrl) {
            console.error("[Export] Failed to get canvas data");
            return;
        }

        // Create a temporary canvas to resize
        const img = new Image();
        img.onload = () => {
            // Calculate dimensions maintaining aspect ratio
            const aspectRatio = img.width / img.height;
            let finalWidth = targetWidth;
            let finalHeight = targetHeight;

            if (aspectRatio > targetWidth / targetHeight) {
                finalHeight = Math.round(targetWidth / aspectRatio);
            } else {
                finalWidth = Math.round(targetHeight * aspectRatio);
            }

            const tempCanvas = document.createElement("canvas");
            tempCanvas.width = finalWidth;
            tempCanvas.height = finalHeight;
            const ctx = tempCanvas.getContext("2d");

            if (ctx) {
                ctx.imageSmoothingEnabled = true;
                ctx.imageSmoothingQuality = "high";
                ctx.drawImage(img, 0, 0, finalWidth, finalHeight);

                const resizedDataUrl = tempCanvas.toDataURL("image/png");

                // Create download link
                const link = document.createElement("a");
                link.download = `tuner-ai-export-${finalWidth}x${finalHeight}-${Date.now()}.png`;
                link.href = resizedDataUrl;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);

                console.log(`[Export] Image downloaded at ${finalWidth}x${finalHeight}`);
            }
        };
        img.src = dataUrl;
        setShowExportMenu(false);
    };

    return (
        <div className="min-h-screen bg-black text-white flex flex-col h-screen overflow-hidden relative">
            {/* Header - Compact on mobile */}
            <header className="border-b border-zinc-800 bg-zinc-950 z-10">
                <div className="max-w-screen-2xl mx-auto px-3 md:px-6 h-14 md:h-16 flex items-center justify-between">
                    <div className="flex items-center gap-2 md:gap-6">
                        <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
                            <span className="text-lg md:text-xl">🏎</span>
                            <span className="font-bold text-sm md:text-base">Tuner<span className="text-red-500">AI</span></span>
                        </Link>
                        <div className="hidden md:block h-6 w-px bg-zinc-800" />
                        <h1 className="hidden md:block text-sm font-medium text-zinc-400">Editor</h1>
                    </div>

                    <div className="flex items-center gap-2 md:gap-4">
                        {/* Status indicators */}
                        {isProcessing && <span className="text-xs text-red-500 animate-pulse hidden sm:inline">Generating...</span>}
                        {(isLoadingWheelMask || isLoadingBodyMask) && !isProcessing && (
                            <span className="text-xs text-blue-400 animate-pulse">
                                <span className="hidden sm:inline">Detecting regions...</span>
                                <span className="sm:hidden">Detecting...</span>
                            </span>
                        )}
                        {wheelMask && bodyMask && !isProcessing && !isLoadingWheelMask && !isLoadingBodyMask && (
                            <span className="text-xs text-green-500">Ready</span>
                        )}
                        <button
                            onClick={() => router.push("/studio")}
                            className="bg-zinc-800 text-zinc-300 px-3 md:px-4 py-2 rounded-lg text-xs md:text-sm font-medium hover:bg-zinc-700 hover:text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1 md:gap-2"
                            disabled={isProcessing}
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                                <path d="M9.25 13.25a.75.75 0 0 0 1.5 0V4.636l2.955 3.129a.75.75 0 0 0 1.09-1.03l-4.25-4.5a.75.75 0 0 0-1.09 0l-4.25 4.5a.75.75 0 1 0 1.09 1.03L9.25 4.636v8.614Z" />
                                <path d="M3.5 12.75a.75.75 0 0 0-1.5 0v2.5A2.75 2.75 0 0 0 4.75 18h10.5A2.75 2.75 0 0 0 18 15.25v-2.5a.75.75 0 0 0-1.5 0v2.5c0 .69-.56 1.25-1.25 1.25H4.75c-.69 0-1.25-.56-1.25-1.25v-2.5Z" />
                            </svg>
                            <span className="hidden sm:inline">Upload New</span>
                        </button>
                        <div className="relative">
                            <button
                                onClick={() => setShowExportMenu(!showExportMenu)}
                                disabled={!originalImage}
                                className="bg-white text-black px-3 md:px-4 py-2 rounded-lg text-xs md:text-sm font-semibold hover:bg-zinc-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1 md:gap-2"
                            >
                                Export
                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                                    <path fillRule="evenodd" d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
                                </svg>
                            </button>
                            {showExportMenu && (
                                <>
                                    <div className="fixed inset-0 z-40" onClick={() => setShowExportMenu(false)} />
                                    <div className="absolute right-0 mt-2 w-48 bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl z-50 overflow-hidden">
                                        {EXPORT_SIZES.map((size) => (
                                            <button
                                                key={size.label}
                                                onClick={() => handleExport(size.width, size.height)}
                                                className="w-full px-4 py-3 text-left hover:bg-zinc-800 transition-colors flex items-center gap-3"
                                            >
                                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-zinc-400">
                                                    <path d="M10.75 2.75a.75.75 0 0 0-1.5 0v8.614L6.295 8.235a.75.75 0 1 0-1.09 1.03l4.25 4.5a.75.75 0 0 0 1.09 0l4.25-4.5a.75.75 0 0 0-1.09-1.03l-2.955 3.129V2.75Z" />
                                                    <path d="M3.5 12.75a.75.75 0 0 0-1.5 0v2.5A2.75 2.75 0 0 0 4.75 18h10.5A2.75 2.75 0 0 0 18 15.25v-2.5a.75.75 0 0 0-1.5 0v2.5c0 .69-.56 1.25-1.25 1.25H4.75c-.69 0-1.25-.56-1.25-1.25v-2.5Z" />
                                                </svg>
                                                <span className="text-sm font-medium text-white flex-1">{size.label}</span>
                                                <span className="text-xs text-zinc-500">{size.width}×{size.height}</span>
                                            </button>
                                        ))}
                                    </div>
                                </>
                            )}
                        </div>
                    </div>
                </div>
            </header>

            {/* Main Workspace - Column on mobile, row on desktop */}
            <main className="flex-1 flex flex-col md:flex-row overflow-hidden relative">
                {/* Canvas Section - Scrollable middle area on mobile, with bottom padding for fixed panel */}
                <section className="flex-1 min-h-0 bg-zinc-950/50 flex flex-col relative z-0 order-1 md:order-2 overflow-y-auto md:overflow-visible pb-[180px] md:pb-0">
                    {/* Original/Tuned toggle - only show when image is loaded AND has modifications */}
                    {originalImage && (selectedWheel || selectedPaint) && (
                        <div className="absolute top-1 left-1 z-10 md:relative md:top-0 md:left-0 md:p-4">
                            <div className={`inline-flex bg-zinc-900/90 backdrop-blur md:bg-zinc-900 rounded-lg p-1 ${isProcessing ? "opacity-50 pointer-events-none" : ""}`}>
                                <button
                                    onClick={() => setViewingOriginal(true)}
                                    className={`px-3 md:px-4 py-1.5 md:py-2 rounded-md text-xs md:text-sm font-medium transition-all ${
                                        viewingOriginal
                                            ? "bg-zinc-800 text-white shadow-sm"
                                            : "text-zinc-500 hover:text-zinc-300"
                                    }`}
                                >
                                    Original
                                </button>
                                <button
                                    onClick={() => setViewingOriginal(false)}
                                    className={`px-3 md:px-4 py-1.5 md:py-2 rounded-md text-xs md:text-sm font-medium transition-all ${
                                        !viewingOriginal
                                            ? "bg-zinc-800 text-white shadow-sm"
                                            : "text-zinc-500 hover:text-zinc-300"
                                    }`}
                                >
                                    Tuned
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Image container - fills available space, pinch-zoomable on mobile */}
                    <div className={`flex-1 flex items-center justify-center overflow-hidden ${originalImage ? "p-0 md:px-6 md:pb-6" : "p-2 md:p-6"}`}>
                        {!originalImage ? (
                            <FileUpload
                                onSuccess={(url) => {
                                    setOriginalImage(url);
                                    setWheelLayers({});
                                    setPaintLayers({});
                                    setViewingOriginal(false);
                                    setSelectedWheel(null);
                                    setSelectedPaint(null);
                                    const storedWheelMask = sessionStorage.getItem("tuner-ai-wheel-mask");
                                    const storedBodyMask = sessionStorage.getItem("tuner-ai-body-mask");
                                    if (storedWheelMask) {
                                        setWheelMask(storedWheelMask);
                                        setIsLoadingWheelMask(false);
                                        sessionStorage.removeItem("tuner-ai-wheel-mask");
                                    } else {
                                        setIsLoadingWheelMask(false);
                                    }
                                    if (storedBodyMask) {
                                        setBodyMask(storedBodyMask);
                                        setIsLoadingBodyMask(false);
                                        sessionStorage.removeItem("tuner-ai-body-mask");
                                    } else {
                                        setIsLoadingBodyMask(false);
                                    }
                                }}
                            />
                        ) : (
                            <div
                                className="w-full h-full overflow-auto overscroll-contain md:overflow-visible"
                                style={{ touchAction: "pan-x pan-y pinch-zoom" }}
                            >
                                <div className="min-w-full min-h-full md:min-w-0 md:min-h-0 flex items-center justify-center">
                                    <EditorCanvas
                                        ref={canvasRef}
                                        originalImage={originalImage}
                                        wheelLayer={currentWheelLayer}
                                        paintLayer={currentPaintLayer}
                                        wheelVisible={wheelVisible && !viewingOriginal}
                                        paintVisible={paintVisible && !viewingOriginal}
                                        wheelMask={wheelMask}
                                        bodyMask={bodyMask}
                                        highlightType={highlightType}
                                    />
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Processing Overlay */}
                    {isProcessing && (
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            className="absolute inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center"
                        >
                            <motion.div
                                initial={{ scale: 0.9, opacity: 0 }}
                                animate={{ scale: 1, opacity: 1 }}
                                className="bg-zinc-900/95 backdrop-blur-xl border border-red-500/30 p-6 md:p-8 rounded-2xl flex flex-col items-center gap-4 shadow-2xl max-w-sm w-full mx-4"
                            >
                                <div className="relative w-12 h-12 md:w-16 md:h-16">
                                    <div className="absolute inset-0 border-4 border-red-500/20 rounded-full"></div>
                                    <div className="absolute inset-0 border-4 border-transparent border-t-red-500 rounded-full animate-spin"></div>
                                    <div className="absolute inset-2 border-4 border-transparent border-t-red-400 rounded-full animate-spin" style={{ animationDuration: '0.8s' }}></div>
                                </div>
                                <div className="text-center">
                                    <h3 className="text-lg md:text-xl font-bold mb-3 text-white">TUNING IN PROGRESS</h3>
                                    <LoadingMessages selectionId={processingItem} />
                                </div>
                            </motion.div>
                        </motion.div>
                    )}
                </section>

                {/* Options Panel - FIXED at viewport bottom on mobile, sidebar on desktop */}
                <aside className={`w-full md:w-80 border-t md:border-t-0 md:border-r border-zinc-800 bg-zinc-950/95 backdrop-blur-sm md:backdrop-blur-none md:bg-zinc-950 flex flex-col z-50 md:z-10 fixed bottom-0 left-0 right-0 md:relative md:bottom-auto md:left-auto md:right-auto md:order-1 md:max-h-none ${!originalImage ? "hidden md:flex" : "flex"}`}>
                    {/* Tab switcher */}
                    <div className="p-2 md:p-4 border-b border-zinc-800 shrink-0">
                        <div className="flex bg-zinc-900 rounded-lg p-1">
                            {[
                                { id: "wheels", label: "Wheels" },
                                { id: "paint", label: "Exterior Color" }
                            ].map((tab) => (
                                <button
                                    key={tab.id}
                                    onClick={() => setActiveTab(tab.id)}
                                    disabled={isProcessing}
                                    className={`flex-1 py-2 text-xs md:text-sm font-medium rounded-md transition-all ${activeTab === tab.id
                                        ? "bg-zinc-800 text-white shadow-sm"
                                        : "text-zinc-500 hover:text-zinc-300"
                                        } ${isProcessing ? "opacity-50 cursor-not-allowed" : ""}`}
                                >
                                    {tab.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Content area - shows wheel/color options, min height ensures visibility on mobile */}
                    <div className={`p-2 pb-6 md:p-4 md:pb-4 md:space-y-4 md:overflow-y-auto md:flex-1 min-h-[120px] md:min-h-0 ${!originalImage ? "opacity-20 pointer-events-none blur-sm" : "opacity-100"}`}>
                        {!originalImage && (
                            <div className="absolute inset-0 z-20 flex items-center justify-center p-6 text-center">
                                <p className="text-zinc-500 text-sm font-medium">Upload a car photo to unlock tuning tools</p>
                            </div>
                        )}

                        {/* WHEELS TAB */}
                        {activeTab === "wheels" && (
                            <div className="space-y-2 md:space-y-4">
                                <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider hidden md:block">Select Genesis Wheels</h3>
                                {/* Horizontal scroll on mobile, grid on desktop */}
                                <div className="flex md:grid md:grid-cols-2 gap-2 md:gap-3 overflow-x-auto md:overflow-x-visible pb-2 md:pb-0 -mx-2 px-2 md:mx-0 md:px-0 snap-x snap-mandatory md:snap-none">
                                    {[
                                        { id: "20-sputtering", name: "20\" Sputtering", image: "/wheels/20-sputtering.png", prompt: "genesis g80 20-inch sputtering wheels, bright chrome finish, complex lattice spoke design, Pirelli Tires", description: "20-inch Sputtering Wheels · Front Mono-block (4P) Brakes · Pirelli Tires (245/40R20 (F), 275/35R20 (R))" },
                                        { id: "19-hyper-silver", name: "19\" Hyper Silver", image: "/wheels/19-hyper-silver.png", prompt: "genesis g80 19-inch hyper silver wheels type A, 5 spoke split design, elegant silver finish", description: "19-inch Hyper Silver Wheels (A) · Front Mono-block (4P) Brakes · Continental Tires (245/45R19 (F), 275/40R19 (R))" },
                                        { id: "19-diamond-cut", name: "19\" Diamond Cut", image: "/wheels/19-diamond.png", prompt: "genesis g80 19-inch diamond cutting wheels type B, multi-spoke machined face design", description: "19-inch Diamond Cutting Wheels (B) · Front Mono-block (4P) Brakes · Continental Tires (245/45R19 (F), 275/40R19 (R))" },
                                        { id: "18-diamond-cut", name: "18\" Diamond Cut", image: "/wheels/18-diamond.png", prompt: "genesis g80 18-inch diamond cutting wheels, 5 double-spoke design, machined finish", description: "18-inch Diamond Cutting Wheels · Front Mono-block (4P) Brakes · Pirelli Tires (245/50R18)" },
                                    ].map((wheel, i) => {
                                        const isSelected = selectedWheel === wheel.id;
                                        const isVisible = isSelected && wheelVisible && !viewingOriginal;
                                        return (
                                            <div key={i} className="group relative flex-shrink-0 w-[100px] md:w-auto snap-start">
                                                <button
                                                    onClick={() => handleWheelClick(wheel)}
                                                    disabled={isProcessing || isLoadingWheelMask}
                                                    onMouseEnter={(e) => {
                                                        const rect = e.currentTarget.getBoundingClientRect();
                                                        setTooltip({ text: isLoadingWheelMask ? "Detecting wheels..." : wheel.description, title: wheel.name, top: rect.top });
                                                    }}
                                                    onMouseLeave={() => setTooltip({ text: null, top: 0, title: "" })}
                                                    className={`w-full bg-zinc-900 rounded-lg border cursor-pointer transition-all flex flex-col items-center justify-center p-2 text-center group overflow-hidden relative ${
                                                        isLoadingWheelMask ? "border-zinc-800 opacity-50 cursor-wait"
                                                            : isVisible ? "border-red-500 bg-zinc-800"
                                                            : isSelected ? "border-red-500/50 bg-zinc-800/50 opacity-60"
                                                            : "border-zinc-800 hover:border-red-500/50 hover:bg-zinc-800"
                                                    }`}
                                                >
                                                    <div className="w-full h-16 md:h-20 relative flex items-center justify-center">
                                                        <img src={wheel.image} alt={wheel.name} className="w-full h-full object-contain scale-[1.3] group-hover:scale-[1.4] transition-transform duration-500 drop-shadow-2xl" />
                                                    </div>
                                                    <span className={`text-[10px] md:text-xs font-medium mt-1 z-10 relative transition-colors leading-tight ${isVisible ? "text-white" : isSelected ? "text-zinc-400" : "text-zinc-500 group-hover:text-zinc-300"}`}>
                                                        {wheel.name}
                                                    </span>
                                                    {isVisible && (
                                                        <div className="absolute top-1 right-1 bg-red-500 text-white rounded-full w-4 h-4 flex items-center justify-center shadow-lg z-20">
                                                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3">
                                                                <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" />
                                                            </svg>
                                                        </div>
                                                    )}
                                                </button>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}

                        {/* EXTERIOR COLOR TAB */}
                        {activeTab === "paint" && (
                            <>
                                {/* Desktop: Grid layout */}
                                <div className="hidden md:block space-y-6">
                                    <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Exterior Color</h3>
                                    <div className="space-y-3">
                                        <h4 className="text-xs font-medium text-zinc-400">Glossy</h4>
                                        <div className="grid grid-cols-4 gap-2">
                                            {[
                                                { id: "vik-black", name: "Vik Black", hex: "#1a1a1a", prompt: "glossy Vik Black paint, deep black metallic finish" },
                                                { id: "himalayan-gray", name: "Himalayan Gray", hex: "#4a5568", prompt: "glossy Himalayan Gray paint, dark gray metallic finish" },
                                                { id: "adriatic-blue", name: "Adriatic Blue", hex: "#1e3a5f", prompt: "glossy Adriatic Blue paint, deep navy blue metallic finish" },
                                                { id: "cardiff-green", name: "Cardiff Green", hex: "#2d4a4a", prompt: "glossy Cardiff Green paint, dark teal green metallic finish" },
                                                { id: "savile-silver", name: "Savile Silver", hex: "#9ca3af", prompt: "glossy Savile Silver paint, light silver metallic finish" },
                                                { id: "uyuni-white", name: "Uyuni White", hex: "#f5f5f4", prompt: "glossy Uyuni White paint, pearl white finish" },
                                                { id: "gold-coast", name: "Gold Coast Silver", hex: "#78716c", prompt: "glossy Gold Coast Silver paint, bronze brown metallic finish" },
                                            ].map((color) => {
                                                const isSelected = selectedPaint === color.id;
                                                const isVisible = isSelected && paintVisible && !viewingOriginal;
                                                return (
                                                    <button key={color.id} onClick={() => handlePaintClick(color)} disabled={isProcessing || isLoadingBodyMask}
                                                        className={`group relative aspect-square rounded-lg border-2 transition-all overflow-hidden ${isLoadingBodyMask ? "border-zinc-700 opacity-50 cursor-wait" : isVisible ? "border-red-500 ring-2 ring-red-500/50" : isSelected ? "border-red-500/50 ring-1 ring-red-500/30 opacity-60" : "border-zinc-700 hover:border-red-500/50"}`}
                                                        title={isLoadingBodyMask ? "Detecting body..." : color.name}>
                                                        <div className="absolute inset-0" style={{ backgroundColor: color.hex }} />
                                                        <div className="absolute inset-0 bg-gradient-to-br from-white/20 to-transparent opacity-60" />
                                                        {isVisible && (<div className="absolute bottom-1 right-1 bg-red-500 text-white rounded-full w-4 h-4 flex items-center justify-center shadow-lg z-20"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3"><path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" /></svg></div>)}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>
                                    <div className="space-y-3">
                                        <h4 className="text-xs font-medium text-zinc-400">Matte</h4>
                                        <div className="grid grid-cols-4 gap-2">
                                            {[{ id: "makalu-gray", name: "Makalu Gray", hex: "#5a6a7a", prompt: "matte Makalu Gray paint, flat gray-blue matte finish, no gloss" }].map((color) => {
                                                const isSelected = selectedPaint === color.id;
                                                const isVisible = isSelected && paintVisible && !viewingOriginal;
                                                return (
                                                    <button key={color.id} onClick={() => handlePaintClick(color)} disabled={isProcessing || isLoadingBodyMask}
                                                        className={`group relative aspect-square rounded-lg border-2 transition-all overflow-hidden ${isLoadingBodyMask ? "border-zinc-700 opacity-50 cursor-wait" : isVisible ? "border-red-500 ring-2 ring-red-500/50" : isSelected ? "border-red-500/50 ring-1 ring-red-500/30 opacity-60" : "border-zinc-700 hover:border-red-500/50"}`}
                                                        title={isLoadingBodyMask ? "Detecting body..." : color.name}>
                                                        <div className="absolute inset-0" style={{ backgroundColor: color.hex }} />
                                                        {isVisible && (<div className="absolute bottom-1 right-1 bg-red-500 text-white rounded-full w-4 h-4 flex items-center justify-center shadow-lg z-20"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3"><path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" /></svg></div>)}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>
                                </div>

                                {/* Mobile: Horizontal scroll with cards matching wheel size */}
                                <div className="md:hidden">
                                    <div className="flex gap-2 overflow-x-auto pb-2 -mx-2 px-2 snap-x snap-mandatory">
                                        {/* Glossy section header */}
                                        <div className="flex-shrink-0 w-12 flex items-center justify-center snap-start">
                                            <span className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider -rotate-90 whitespace-nowrap">Glossy</span>
                                        </div>
                                        {/* Glossy colors */}
                                        {[
                                            { id: "vik-black", name: "Vik Black", hex: "#1a1a1a", prompt: "glossy Vik Black paint, deep black metallic finish" },
                                            { id: "himalayan-gray", name: "Himalayan Gray", hex: "#4a5568", prompt: "glossy Himalayan Gray paint, dark gray metallic finish" },
                                            { id: "adriatic-blue", name: "Adriatic Blue", hex: "#1e3a5f", prompt: "glossy Adriatic Blue paint, deep navy blue metallic finish" },
                                            { id: "cardiff-green", name: "Cardiff Green", hex: "#2d4a4a", prompt: "glossy Cardiff Green paint, dark teal green metallic finish" },
                                            { id: "savile-silver", name: "Savile Silver", hex: "#9ca3af", prompt: "glossy Savile Silver paint, light silver metallic finish" },
                                            { id: "uyuni-white", name: "Uyuni White", hex: "#f5f5f4", prompt: "glossy Uyuni White paint, pearl white finish" },
                                            { id: "gold-coast", name: "Gold Coast", hex: "#78716c", prompt: "glossy Gold Coast Silver paint, bronze brown metallic finish" },
                                        ].map((color) => {
                                            const isSelected = selectedPaint === color.id;
                                            const isVisible = isSelected && paintVisible && !viewingOriginal;
                                            return (
                                                <div key={color.id} className="flex-shrink-0 w-[100px] snap-start">
                                                    <button
                                                        onClick={() => handlePaintClick(color)}
                                                        disabled={isProcessing || isLoadingBodyMask}
                                                        className={`w-full bg-zinc-900 rounded-lg border cursor-pointer transition-all flex flex-col items-center p-2 text-center overflow-hidden relative ${
                                                            isLoadingBodyMask ? "border-zinc-800 opacity-50 cursor-wait"
                                                                : isVisible ? "border-red-500 bg-zinc-800"
                                                                : isSelected ? "border-red-500/50 bg-zinc-800/50 opacity-60"
                                                                : "border-zinc-800 hover:border-red-500/50 hover:bg-zinc-800"
                                                        }`}
                                                    >
                                                        <div className="w-full h-16 rounded-md overflow-hidden relative">
                                                            <div className="absolute inset-0" style={{ backgroundColor: color.hex }} />
                                                            <div className="absolute inset-0 bg-gradient-to-br from-white/30 to-transparent" />
                                                        </div>
                                                        <span className={`text-[10px] font-medium mt-1.5 z-10 relative transition-colors leading-tight ${isVisible ? "text-white" : isSelected ? "text-zinc-400" : "text-zinc-500"}`}>
                                                            {color.name}
                                                        </span>
                                                        {isVisible && (
                                                            <div className="absolute top-1 right-1 bg-red-500 text-white rounded-full w-4 h-4 flex items-center justify-center shadow-lg z-20">
                                                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3">
                                                                    <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" />
                                                                </svg>
                                                            </div>
                                                        )}
                                                    </button>
                                                </div>
                                            );
                                        })}
                                        {/* Matte section header */}
                                        <div className="flex-shrink-0 w-12 flex items-center justify-center snap-start">
                                            <span className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider -rotate-90 whitespace-nowrap">Matte</span>
                                        </div>
                                        {/* Matte colors */}
                                        {[{ id: "makalu-gray", name: "Makalu Gray", hex: "#5a6a7a", prompt: "matte Makalu Gray paint, flat gray-blue matte finish, no gloss" }].map((color) => {
                                            const isSelected = selectedPaint === color.id;
                                            const isVisible = isSelected && paintVisible && !viewingOriginal;
                                            return (
                                                <div key={color.id} className="flex-shrink-0 w-[100px] snap-start">
                                                    <button
                                                        onClick={() => handlePaintClick(color)}
                                                        disabled={isProcessing || isLoadingBodyMask}
                                                        className={`w-full bg-zinc-900 rounded-lg border cursor-pointer transition-all flex flex-col items-center p-2 text-center overflow-hidden relative ${
                                                            isLoadingBodyMask ? "border-zinc-800 opacity-50 cursor-wait"
                                                                : isVisible ? "border-red-500 bg-zinc-800"
                                                                : isSelected ? "border-red-500/50 bg-zinc-800/50 opacity-60"
                                                                : "border-zinc-800 hover:border-red-500/50 hover:bg-zinc-800"
                                                        }`}
                                                    >
                                                        <div className="w-full h-16 rounded-md overflow-hidden relative">
                                                            <div className="absolute inset-0" style={{ backgroundColor: color.hex }} />
                                                        </div>
                                                        <span className={`text-[10px] font-medium mt-1.5 z-10 relative transition-colors leading-tight ${isVisible ? "text-white" : isSelected ? "text-zinc-400" : "text-zinc-500"}`}>
                                                            {color.name}
                                                        </span>
                                                        {isVisible && (
                                                            <div className="absolute top-1 right-1 bg-red-500 text-white rounded-full w-4 h-4 flex items-center justify-center shadow-lg z-20">
                                                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3">
                                                                    <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" />
                                                                </svg>
                                                            </div>
                                                        )}
                                                    </button>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            </>
                        )}
                    </div>
                </aside>
            </main>

            {/* Error Toast - Positioned above bottom sheet on mobile */}
            {error && (
                <div className="fixed bottom-[55vh] md:bottom-8 left-1/2 -translate-x-1/2 bg-red-500/90 text-white px-4 md:px-6 py-2 md:py-3 rounded-full shadow-xl backdrop-blur-md z-[200] flex items-center gap-2 md:gap-3 animate-in fade-in slide-in-from-bottom-4 max-w-[90vw]">
                    <span className="text-base md:text-xl">⚠️</span>
                    <span className="font-medium text-sm md:text-base truncate">{error}</span>
                    <button
                        onClick={() => setError(null)}
                        className="ml-1 md:ml-2 hover:bg-white/20 rounded-full p-1 transition-colors flex-shrink-0"
                    >
                        ✕
                    </button>
                </div>
            )}

            {/* Global Tooltip - Desktop only (hidden on mobile/touch devices) */}
            {tooltip.text && (
                <div
                    className="hidden md:block fixed left-80 ml-6 p-6 bg-zinc-900/95 backdrop-blur-xl border border-zinc-700 rounded-xl shadow-2xl w-96 z-[100] pointer-events-none transition-all duration-200"
                    style={{ top: Math.max(16, tooltip.top - 20) }}
                >
                    <h4 className="text-white font-bold mb-3 text-lg">{tooltip.title}</h4>
                    <div className="h-px w-full bg-zinc-800 mb-3" />
                    <p className="text-zinc-300 text-sm leading-relaxed font-normal opacity-90">{tooltip.text}</p>
                </div>
            )}

            {/* Fullscreen Image Zoom Modal - Mobile only */}
            <AnimatePresence>
                {showImageZoom && originalImage && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 z-[300] bg-black flex flex-col md:hidden"
                    >
                        {/* Zoomable/pannable image container */}
                        <div
                            className="flex-1 overflow-auto overscroll-contain"
                            style={{ touchAction: "pan-x pan-y pinch-zoom" }}
                        >
                            <div className="min-w-[150%] min-h-[150%] flex items-center justify-center p-4">
                                {canvasRef.current && (
                                    <img
                                        src={canvasRef.current.exportImage("png") || originalImage}
                                        alt="Zoomed car"
                                        className="max-w-none w-auto h-auto pointer-events-none"
                                        style={{ maxWidth: "250%" }}
                                    />
                                )}
                            </div>
                        </div>

                        {/* Bottom controls - docked */}
                        <div className="shrink-0 flex items-center justify-between px-4 py-3 bg-zinc-900/90 backdrop-blur">
                            <span className="text-zinc-400 text-sm">Pinch to zoom</span>
                            <button
                                onClick={() => setShowImageZoom(false)}
                                className="bg-zinc-800 hover:bg-zinc-700 px-4 py-2 rounded-full flex items-center gap-2 transition-colors"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
                                    <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
                                </svg>
                                <span className="text-sm font-medium">Close</span>
                            </button>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
