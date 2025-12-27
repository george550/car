"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import EditorCanvas from "@/components/EditorCanvas";
import { motion } from "framer-motion";

export default function EditorPage() {
    const router = useRouter();
    const [imageSrc, setImageSrc] = useState<string | null>(null);
    const [originalImage, setOriginalImage] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState("wheels");
    const [isProcessing, setIsProcessing] = useState(false);
    const [tooltip, setTooltip] = useState<{ text: string | null; top: number; title: string }>({ text: null, top: 0, title: "" });

    // Cache for generated images: wheelName -> imageUrl
    const [generatedImages, setGeneratedImages] = useState<Record<string, string>>({});
    const [selectedWheel, setSelectedWheel] = useState<string | null>(null);

    useEffect(() => {
        // Load image from session storage
        const storedImage = sessionStorage.getItem("tuner-ai-image");
        if (!storedImage) {
            // Redirect back to studio/upload if no image found
            router.push("/studio");
            return;
        }

        // If we haven't set the original image yet, set it now.
        // We assume the first image loaded is the "original" before modifications in this session
        // In a more persistent app, we'd store "original" vs "current" separately.
        if (!originalImage) {
            setOriginalImage(storedImage);
        }
        setImageSrc(storedImage);
    }, [router, originalImage]); // Added originalImage dependency to avoid resetting it if useEffect re-runs oddly, though standard mount check is safe.

    const [error, setError] = useState<string | null>(null);

    const handleWheelClick = (wheel: { name: string; prompt: string }) => {
        if (isProcessing) return;

        // Toggle logic: If clicking the currently selected wheel, revert to original
        if (selectedWheel === wheel.name) {
            if (originalImage) {
                setImageSrc(originalImage);
                setSelectedWheel(null);
                sessionStorage.setItem("tuner-ai-image", originalImage);
            }
            return;
        }

        // Select new wheel
        setSelectedWheel(wheel.name);

        // Check cache
        if (generatedImages[wheel.name]) {
            setImageSrc(generatedImages[wheel.name]);
            sessionStorage.setItem("tuner-ai-image", generatedImages[wheel.name]);
            return;
        }

        // Not cached, generate
        handleGenerate(wheel.prompt, "wheels", (newUrl) => {
            setGeneratedImages(prev => ({
                ...prev,
                [wheel.name]: newUrl
            }));
        });
    };

    const handleGenerate = async (prompt: string, maskPrompt: string = "wheels", onSuccess?: (url: string) => void) => {
        // Use originalImage as the base for all wheel generations to ensure clean edits
        // (Or continuing from current? Usually for trying different wheels, you want to apply to the BASE car, not a car that already has modified wheels)
        // Adjusting logic: Always use 'originalImage' for wheel swaps if available, to avoid artifact buildup.
        // However, the prompt might expect to see the car.
        const sourceImage = originalImage || imageSrc;

        if (!sourceImage || isProcessing) return;

        setIsProcessing(true);
        setError(null);
        try {
            // Convert current image (base64) to a File object for the API
            const response = await fetch(sourceImage);
            const blob = await response.blob();
            // Use the blob's actual type (e.g. image/jpeg) instead of forcing png
            const fileType = blob.type || "image/png";
            const fileName = fileType === "image/jpeg" ? "input.jpg" : "input.png";
            const file = new File([blob], fileName, { type: fileType });

            const formData = new FormData();
            formData.append("image", file);
            formData.append("prompt", prompt);
            formData.append("mask_prompt", maskPrompt);

            const res = await fetch("/api/process-car", {
                method: "POST",
                body: formData,
            });

            if (!res.ok) {
                const errorData = await res.json();
                console.error("API Error Details:", errorData);
                throw new Error(errorData.detail || errorData.details || errorData.error || "Failed to process image");
            }

            const data = await res.json();

            if (data.resultUrl) {
                setImageSrc(data.resultUrl);
                // Update session storage so refresh keeps the new version
                sessionStorage.setItem("tuner-ai-image", data.resultUrl);

                if (onSuccess) {
                    onSuccess(data.resultUrl);
                }
            } else {
                console.warn("No result URL returned", data);
                throw new Error("No image returned from AI");
            }

        } catch (error) {
            console.error("Generation failed", error);
            setError(error instanceof Error ? error.message : "Something went wrong");
            // If generation failed, deselect
            setSelectedWheel(null);
        } finally {
            setIsProcessing(false);
        }
    };

    return (
        <div className="min-h-screen bg-black text-white flex flex-col h-screen overflow-hidden relative">
            {/* Header */}
            <header className="border-b border-zinc-800 bg-zinc-950 z-10">
                <div className="max-w-screen-2xl mx-auto px-6 h-16 flex items-center justify-between">
                    <div className="flex items-center gap-6">
                        <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
                            <span className="text-xl">🏎</span>
                            <span className="font-bold">Tuner<span className="text-red-500">AI</span></span>
                        </Link>
                        <div className="h-6 w-px bg-zinc-800" />
                        <h1 className="text-sm font-medium text-zinc-400">Editor</h1>
                    </div>

                    <div className="flex items-center gap-4">
                        {isProcessing && <span className="text-xs text-red-500 animate-pulse">Generating...</span>}
                        <button
                            onClick={() => router.push("/studio")}
                            className="text-sm text-zinc-400 hover:text-white transition-colors"
                            disabled={isProcessing}
                        >
                            Upload New
                        </button>
                        <button className="bg-white text-black px-4 py-2 rounded-lg text-sm font-semibold hover:bg-zinc-200 transition-colors">
                            Export
                        </button>
                    </div>
                </div>
            </header>

            {/* Main Workspace */}
            <main className="flex-1 flex overflow-hidden relative">
                {/* Left Sidebar - Tools */}
                <aside className="w-80 border-r border-zinc-800 bg-zinc-950 flex flex-col z-10 relative">
                    <div className="p-4 border-b border-zinc-800">
                        <div className="flex bg-zinc-900 rounded-lg p-1">
                            {["wheels", "stance", "paint"].map((tab) => (
                                <button
                                    key={tab}
                                    onClick={() => setActiveTab(tab)}
                                    disabled={isProcessing}
                                    className={`flex-1 py-2 text-sm font-medium rounded-md capitalize transition-all ${activeTab === tab
                                        ? "bg-zinc-800 text-white shadow-sm"
                                        : "text-zinc-500 hover:text-zinc-300"
                                        } ${isProcessing ? "opacity-50 cursor-not-allowed" : ""}`}
                                >
                                    {tab}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="flex-1 overflow-y-auto p-4 space-y-4">
                        {activeTab === "wheels" && (
                            <div className="space-y-4">
                                <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Select Genesis Wheels</h3>
                                <div className="grid grid-cols-2 gap-3">
                                    {[
                                        {
                                            name: "20\" Sputtering",
                                            image: "/wheels/20-sputtering.png",
                                            prompt: "genesis g80 20-inch sputtering wheels, bright chrome finish, complex lattice spoke design, Pirelli Tires",
                                            description: "20-inch Sputtering Wheels · Front Mono-block (4P) Brakes · Pirelli Tires (245/40R20 (F), 275/35R20 (R))"
                                        },
                                        {
                                            name: "19\" Hyper Silver",
                                            image: "/wheels/19-hyper-silver.png",
                                            prompt: "genesis g80 19-inch hyper silver wheels type A, 5 spoke split design, elegant silver finish",
                                            description: "19-inch Hyper Silver Wheels (A) · Front Mono-block (4P) Brakes · Continental Tires (245/45R19 (F), 275/40R19 (R))"
                                        },
                                        {
                                            name: "19\" Diamond Cut",
                                            image: "/wheels/19-diamond.png",
                                            prompt: "genesis g80 19-inch diamond cutting wheels type B, multi-spoke machined face design",
                                            description: "19-inch Diamond Cutting Wheels (B) · Front Mono-block (4P) Brakes · Continental Tires (245/45R19 (F), 275/40R19 (R))"
                                        },
                                        {
                                            name: "18\" Diamond Cut",
                                            image: "/wheels/18-diamond.png",
                                            prompt: "genesis g80 18-inch diamond cutting wheels, 5 double-spoke design, machined finish",
                                            description: "18-inch Diamond Cutting Wheels · Front Mono-block (4P) Brakes · Pirelli Tires (245/50R18)"
                                        },
                                    ].map((wheel, i) => {
                                        const isSelected = selectedWheel === wheel.name;
                                        return (
                                            <div key={i} className="group relative">
                                                <button
                                                    onClick={() => handleWheelClick(wheel)}
                                                    disabled={isProcessing}
                                                    onMouseEnter={(e) => {
                                                        const rect = e.currentTarget.getBoundingClientRect();
                                                        setTooltip({
                                                            text: wheel.description,
                                                            title: wheel.name,
                                                            top: rect.top
                                                        });
                                                    }}
                                                    onMouseLeave={() => setTooltip({ text: null, top: 0, title: "" })}
                                                    className={`w-full aspect-square bg-zinc-900 rounded-lg border cursor-pointer transition-all flex flex-col items-center justify-center p-1 text-center group overflow-hidden relative ${isSelected
                                                        ? "border-red-500 bg-zinc-800"
                                                        : "border-zinc-800 hover:border-red-500/50 hover:bg-zinc-800"
                                                        }`}
                                                >
                                                    <div className="flex-1 w-full relative mb-1 flex items-center justify-center">
                                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                                        <img
                                                            src={wheel.image}
                                                            alt={wheel.name}
                                                            className="w-full h-full object-contain scale-[1.3] group-hover:scale-[1.4] transition-transform duration-500 drop-shadow-2xl"
                                                        />
                                                    </div>
                                                    <span className={`text-xs font-medium z-10 relative transition-colors ${isSelected ? "text-white" : "text-zinc-500 group-hover:text-zinc-300"}`}>
                                                        {wheel.name}
                                                    </span>

                                                    {isSelected && (
                                                        <div className="absolute bottom-1 right-1 bg-red-500 text-white rounded-full w-4 h-4 flex items-center justify-center shadow-lg z-20">
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
                        {activeTab === "stance" && (
                            <div className="space-y-4">
                                <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Ride Height</h3>
                                <div className="grid grid-cols-1 gap-3">
                                    <button
                                        onClick={() => handleGenerate("lowered suspension, stanced car, fitment, low to ground", "car body")}
                                        disabled={isProcessing}
                                        className="p-4 bg-zinc-900 rounded-lg border border-zinc-800 hover:border-red-500/50"
                                    >
                                        Lower it 👇
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </aside>

                {/* Center - Canvas */}
                <section className="flex-1 bg-zinc-950/50 p-6 flex flex-col justify-center items-center relative z-0">
                    <div className="w-full max-w-5xl h-full max-h-[80vh]">
                        <EditorCanvas imageSrc={imageSrc} />
                    </div>
                    {isProcessing && (
                        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center">
                            <div className="bg-zinc-900 border border-zinc-800 p-8 rounded-2xl flex flex-col items-center gap-4 shadow-2xl">
                                <div className="animate-spin text-4xl text-red-500">⚙️</div>
                                <div className="text-center">
                                    <h3 className="text-xl font-bold mb-1">TUNING IN PROGRESS</h3>
                                    <p className="text-zinc-400 text-sm">AI is modifying your build...</p>
                                </div>
                            </div>
                        </div>
                    )}
                </section>
            </main>

            {/* Error Toast */}
            {error && (
                <div className="fixed bottom-8 left-1/2 -translate-x-1/2 bg-red-500/90 text-white px-6 py-3 rounded-full shadow-xl backdrop-blur-md z-[200] flex items-center gap-3 animate-in fade-in slide-in-from-bottom-4">
                    <span className="text-xl">⚠️</span>
                    <span className="font-medium">{error}</span>
                    <button
                        onClick={() => setError(null)}
                        className="ml-2 hover:bg-white/20 rounded-full p-1 transition-colors"
                    >
                        ✕
                    </button>
                </div>
            )}

            {/* Global Tooltip */}
            {tooltip.text && (
                <div
                    className="fixed left-80 ml-6 p-6 bg-zinc-900/95 backdrop-blur-xl border border-zinc-700 rounded-xl shadow-2xl w-96 z-[100] pointer-events-none transition-all duration-200"
                    style={{ top: Math.max(16, tooltip.top - 20) }}
                >
                    <h4 className="text-white font-bold mb-3 text-lg">{tooltip.title}</h4>
                    <div className="h-px w-full bg-zinc-800 mb-3" />
                    <p className="text-zinc-300 text-sm leading-relaxed font-normal opacity-90">{tooltip.text}</p>
                </div>
            )}
        </div>
    );
}
