"use client";

import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Image from "next/image";
import { useRouter } from "next/navigation";

interface FileUploadProps {
  onUpload?: (file: File) => void;
  onSuccess?: (imageUrl: string) => void;
}

interface VehicleAnalysis {
  make: string;
  model: string;
  year: string;
  color: string;
  colorHex: string;
  bodyType: string;
  angle: string;
}

type AnalysisStep = "make" | "model" | "year" | "color" | "bodyType" | "angle" | "masks" | "complete";

const ANALYSIS_STEPS: { key: AnalysisStep; label: string }[] = [
  { key: "make", label: "Make" },
  { key: "model", label: "Model" },
  { key: "year", label: "Year" },
  { key: "color", label: "Color" },
  { key: "bodyType", label: "Body Type" },
  { key: "angle", label: "Photo Angle" },
  { key: "masks", label: "AI Segmentation" },
];

// Characters for scramble animation
const SCRAMBLE_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

// Character scramble animation component
function ScrambleText({ isActive }: { isActive: boolean }) {
  const [text, setText] = useState("--------");

  useEffect(() => {
    if (!isActive) return;

    const interval = setInterval(() => {
      setText(
        Array.from({ length: 8 }, () =>
          SCRAMBLE_CHARS[Math.floor(Math.random() * SCRAMBLE_CHARS.length)]
        ).join("")
      );
    }, 50);

    return () => clearInterval(interval);
  }, [isActive]);

  if (!isActive) return null;

  return (
    <span className="font-mono text-xs text-blue-400/70 tracking-wider">
      {text}
    </span>
  );
}

// Animated value reveal component
function AnimatedValue({ value, colorHex }: { value: string; colorHex?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, x: 10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      className="flex items-center gap-2"
    >
      {colorHex && (
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ duration: 0.2, delay: 0.1 }}
          className="w-5 h-5 rounded border border-zinc-600"
          style={{ backgroundColor: colorHex }}
        />
      )}
      <span className="text-sm text-zinc-200 font-medium">{value}</span>
    </motion.div>
  );
}

export default function FileUpload({ onUpload, onSuccess }: FileUploadProps) {
  const [preview, setPreview] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [canProceed, setCanProceed] = useState(false);
  const [currentStep, setCurrentStep] = useState<AnalysisStep>("make");
  const [analysis, setAnalysis] = useState<VehicleAnalysis | null>(null);
  const [masksReady, setMasksReady] = useState(false);
  // Track which attributes have been revealed (for staggered animation)
  const [revealedAttributes, setRevealedAttributes] = useState<Set<string>>(new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  // Stagger reveal of attributes with random delays
  const revealAttributesStaggered = async (analysisResult: VehicleAnalysis) => {
    const attributes = ["make", "model", "year", "color", "bodyType", "angle"];
    // Shuffle the array for random order
    const shuffled = [...attributes].sort(() => Math.random() - 0.5);

    for (const attr of shuffled) {
      // Random delay between 100-300ms for each attribute (~1-1.8 seconds total)
      await new Promise(r => setTimeout(r, 100 + Math.random() * 200));
      setRevealedAttributes(prev => new Set([...prev, attr]));
    }
  };

  // Animate through steps - values appear as soon as API returns
  const animateSteps = async (
    analysisPromise: Promise<VehicleAnalysis | null>,
    masksPromise: Promise<void>,
    setAnalysisState: (a: VehicleAnalysis | null) => void
  ) => {
    // Reset revealed attributes
    setRevealedAttributes(new Set());

    // Start the masks promise and update state when ready (runs in background)
    masksPromise.then(() => {
      setMasksReady(true);
    });

    // Wait for analysis to complete
    const result = await analysisPromise;

    if (result) {
      console.log("[FileUpload] Analysis received, starting staggered reveal");
      setAnalysisState(result);
      // Reveal attributes one by one with random delays (takes ~1-2 seconds)
      await revealAttributesStaggered(result);
    }

    // Show masks step
    setCurrentStep("masks");

    // Hold results on screen for 1.5 seconds after attributes are revealed
    // Don't wait for masks - they complete in background
    await new Promise(r => setTimeout(r, 1500));
    setCurrentStep("complete");
  };

  // Start SAM3 detection in background - wheels AND body in parallel
  const startDetection = async (imageDataUrl: string, fileName: string): Promise<void> => {
    console.log("[FileUpload] Starting SAM3 detection (wheels + body in parallel)...");

    // Set flag to indicate detection is in progress (prevents duplicate calls in editor)
    sessionStorage.setItem("tuner-ai-detection-in-progress", "true");

    try {
      // Convert data URL to blob for FormData
      const response = await fetch(imageDataUrl);
      const blob = await response.blob();

      // Create FormData for both requests
      const wheelFormData = new FormData();
      wheelFormData.append("image", blob, fileName);

      const bodyFormData = new FormData();
      bodyFormData.append("image", blob, fileName);

      // Run wheel and body detection IN PARALLEL - handle failures gracefully
      const [wheelResult, bodyResult] = await Promise.allSettled([
        fetch("/api/detect-wheels", { method: "POST", body: wheelFormData }).then(r => r.json()),
        fetch("/api/detect-body", { method: "POST", body: bodyFormData }).then(r => r.json()),
      ]);

      // Store wheel mask if successful
      if (wheelResult.status === "fulfilled" && wheelResult.value.success && wheelResult.value.wheelMask) {
        console.log("[FileUpload] Wheel mask ready");
        sessionStorage.setItem("tuner-ai-wheel-mask", wheelResult.value.wheelMask);
      } else {
        const error = wheelResult.status === "rejected" ? wheelResult.reason : wheelResult.value?.error;
        console.warn("[FileUpload] Wheel detection failed (will use fallback):", error);
      }

      // Store body mask if successful
      if (bodyResult.status === "fulfilled" && bodyResult.value.success && bodyResult.value.bodyMask) {
        console.log("[FileUpload] Body mask ready");
        sessionStorage.setItem("tuner-ai-body-mask", bodyResult.value.bodyMask);
      } else {
        const error = bodyResult.status === "rejected" ? bodyResult.reason : bodyResult.value?.error;
        console.warn("[FileUpload] Body detection failed (will use fallback):", error);
      }
    } catch (error) {
      console.error("[FileUpload] Detection error:", error);
    } finally {
      // Clear in-progress flag
      sessionStorage.removeItem("tuner-ai-detection-in-progress");
    }
  };

  // Analyze vehicle using vision model
  const analyzeVehicle = async (imageDataUrl: string, fileName: string): Promise<VehicleAnalysis | null> => {
    console.log("[FileUpload] Starting vehicle analysis...");

    try {
      const response = await fetch(imageDataUrl);
      const blob = await response.blob();

      const formData = new FormData();
      formData.append("image", blob, fileName);

      const res = await fetch("/api/analyze-vehicle", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        console.error("[FileUpload] Vehicle analysis failed");
        return null;
      }

      const data = await res.json();
      console.log("[FileUpload] Vehicle analysis complete:", data.analysis);

      // Store analysis in sessionStorage for later use
      sessionStorage.setItem("tuner-ai-vehicle-analysis", JSON.stringify(data.analysis));

      return data.analysis;
    } catch (error) {
      console.error("[FileUpload] Analysis error:", error);
      return null;
    }
  };

  const handleFile = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      alert("Please upload an image file");
      return;
    }

    setIsAnalyzing(true);
    setCanProceed(false);
    setMasksReady(false);
    setAnalysis(null);
    setCurrentStep("make");
    setRevealedAttributes(new Set());

    // Create preview
    const reader = new FileReader();
    reader.onloadend = async () => {
      const dataUrl = reader.result as string;
      setPreview(dataUrl);

      // Start all async operations in parallel
      const analysisPromise = analyzeVehicle(dataUrl, file.name);
      const masksPromise = startDetection(dataUrl, file.name);

      // Animate through steps while waiting for results
      await animateSteps(analysisPromise, masksPromise, setAnalysis);

      setIsAnalyzing(false);
      setCanProceed(true);
    };
    reader.readAsDataURL(file);

    // Send to API (optional callback)
    if (onUpload) {
      onUpload(file);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const file = e.dataTransfer.files[0];
    if (file) {
      handleFile(file);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleClick = () => {
    if (!isAnalyzing) {
      fileInputRef.current?.click();
    }
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleFile(file);
    }
  };

  const handleStartCustomizing = () => {
    if (preview && canProceed) {
      // Store image in sessionStorage to pass to editor
      sessionStorage.setItem("tuner-ai-image", preview);

      if (onSuccess) {
        onSuccess(preview);
      } else {
        router.push("/editor");
      }
    }
  };

  const handleSampleClick = async (samplePath: string) => {
    setIsAnalyzing(true);
    setCanProceed(false);
    setMasksReady(false);
    setAnalysis(null);
    setCurrentStep("make");
    setRevealedAttributes(new Set());

    // Fetch the sample image and convert to data URL
    const response = await fetch(samplePath);
    const blob = await response.blob();
    const reader = new FileReader();
    reader.onloadend = async () => {
      const dataUrl = reader.result as string;
      setPreview(dataUrl);

      const fileName = samplePath.split("/").pop() || "sample.jpg";

      // Start all async operations in parallel
      const analysisPromise = analyzeVehicle(dataUrl, fileName);
      const masksPromise = startDetection(dataUrl, fileName);

      // Animate through steps while waiting for results
      await animateSteps(analysisPromise, masksPromise, setAnalysis);

      setIsAnalyzing(false);
      setCanProceed(true);
    };
    reader.readAsDataURL(blob);
  };

  const sampleImages = [
    "/samples/genesis-1.jpg",
    "/samples/genesis-2.jpg",
    "/samples/genesis-3.jpg",
    "/samples/genesis-4.jpg",
  ];

  // Get step status - only "complete" when value is revealed
  const getStepStatus = (stepKey: AnalysisStep) => {
    if (stepKey === "masks") {
      if (masksReady) return "complete";
      if (currentStep === "masks" || currentStep === "complete") return "active";
      return "pending";
    }

    // For other attributes, only complete if revealed
    if (revealedAttributes.has(stepKey)) return "complete";

    // Show all as active (scrambling) while analyzing
    if (isAnalyzing && currentStep !== "complete") return "active";

    return "pending";
  };

  const getStepValue = (stepKey: AnalysisStep) => {
    // Only return value if attribute has been revealed
    if (!analysis || !revealedAttributes.has(stepKey)) {
      if (stepKey === "masks" && masksReady) return "Ready";
      return null;
    }

    switch (stepKey) {
      case "make": return analysis.make;
      case "model": return analysis.model;
      case "year": return analysis.year;
      case "color": return { name: analysis.color, hex: analysis.colorHex };
      case "bodyType": return analysis.bodyType;
      case "angle": return analysis.angle;
      case "masks": return masksReady ? "Ready" : null;
      default: return null;
    }
  };

  return (
    <div className={`w-full h-full mx-auto flex flex-col ${preview ? "max-w-4xl" : "max-w-2xl"}`}>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleFileInput}
        className="hidden"
      />

      <AnimatePresence mode="wait">
        {!preview ? (
          <motion.div
            key="upload"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onClick={handleClick}
            className={`
              flex-1 border-2 border-dashed rounded-2xl p-3 md:p-12 cursor-pointer flex flex-col
              transition-all duration-300
              ${isDragging
                ? "border-red-500 bg-red-500/10"
                : "border-zinc-700 hover:border-zinc-600 bg-zinc-900/30"
              }
            `}
          >
            {/* Upload prompt section - compact */}
            <div className="text-center space-y-1 md:space-y-4">
              <div className="text-3xl md:text-6xl">📸</div>
              <h3 className="text-base md:text-2xl font-semibold">Upload Your Car</h3>
              <p className="text-zinc-400 text-xs md:text-base">
                Drop your car photo here, or tap to browse
              </p>
              <div className="flex flex-wrap justify-center gap-1.5 text-[10px] md:text-xs text-zinc-500">
                <span className="bg-zinc-800 px-2 py-0.5 rounded-full">JPG</span>
                <span className="bg-zinc-800 px-2 py-0.5 rounded-full">PNG</span>
                <span className="bg-zinc-800 px-2 py-0.5 rounded-full">WEBP</span>
              </div>
            </div>

            {/* Sample images section - compact, no extra space */}
            <div className="pt-3 md:pt-6 border-t border-zinc-800 mt-3 md:mt-4">
              <p className="text-[10px] md:text-xs text-zinc-500 mb-2 text-center">Or select a sample image</p>
              {/* 2 per row on mobile, 4 on desktop */}
              <div className="grid grid-cols-2 md:flex md:justify-center gap-2 md:gap-4">
                {sampleImages.map((src, index) => (
                  <button
                    key={src}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleSampleClick(src);
                    }}
                    className="relative aspect-[16/9] md:w-44 md:h-28 rounded-lg overflow-hidden border-2 border-zinc-700 hover:border-red-500 active:border-red-500 transition-colors group"
                  >
                    <Image
                      src={src}
                      alt={`Sample car ${index + 1}`}
                      fill
                      className="object-cover group-hover:scale-105 transition-transform"
                    />
                  </button>
                ))}
              </div>
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="preview"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="w-full h-full flex flex-col"
          >
            {/* Main content area - scrollable on mobile, with bottom padding for fixed CTAs */}
            <div className="flex-1 flex flex-col md:block relative w-full max-w-4xl mx-auto overflow-y-auto md:overflow-visible pb-28 md:pb-0">

              {/* Car Image - Clean on mobile, overlay on desktop */}
              <div className="relative rounded-xl md:rounded-2xl overflow-hidden bg-zinc-900 shadow-2xl shrink-0">
                <Image
                  src={preview}
                  alt="Car preview"
                  width={1200}
                  height={800}
                  className={`w-full h-auto transition-all duration-700 ${isAnalyzing ? "md:scale-[1.02]" : ""}`}
                  unoptimized
                />

                {/* Desktop only: Analysis overlay */}
                <AnimatePresence>
                  {isAnalyzing && (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="hidden md:block absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-black/20"
                    >
                      <motion.div
                        initial={{ y: 50, opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        transition={{ delay: 0.2 }}
                        className="absolute bottom-0 left-0 right-0 p-6"
                      >
                        <div className="bg-zinc-900/80 backdrop-blur-xl border border-zinc-700/50 rounded-2xl p-6 shadow-2xl">
                          <div className="flex items-center justify-between mb-5">
                            <div className="flex items-center gap-3">
                              <div className="relative w-10 h-10">
                                <div className="absolute inset-0 border-3 border-blue-500/30 rounded-full"></div>
                                <div className="absolute inset-0 border-3 border-transparent border-t-blue-500 rounded-full animate-spin"></div>
                              </div>
                              <div>
                                <h3 className="text-lg font-bold text-white">ANALYZING VEHICLE</h3>
                                <p className="text-zinc-400 text-sm">AI is identifying your car...</p>
                              </div>
                            </div>
                            <div className="w-32">
                              <div className="w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                                <motion.div
                                  className="h-full bg-gradient-to-r from-blue-500 to-cyan-400 rounded-full"
                                  initial={{ width: "0%" }}
                                  animate={{
                                    width: currentStep === "complete" ? "100%" :
                                      `${((ANALYSIS_STEPS.findIndex(s => s.key === currentStep) + 1) / ANALYSIS_STEPS.length) * 100}%`
                                  }}
                                  transition={{ duration: 0.3 }}
                                />
                              </div>
                            </div>
                          </div>
                          <div className="grid grid-cols-2 gap-3">
                            {ANALYSIS_STEPS.filter(s => s.key !== "masks").map((step) => {
                              const status = getStepStatus(step.key);
                              const value = getStepValue(step.key);
                              return (
                                <motion.div
                                  key={step.key}
                                  initial={{ opacity: 0, y: 10 }}
                                  animate={{ opacity: 1, y: 0 }}
                                  className={`flex items-center justify-between px-4 py-3 rounded-xl transition-all ${
                                    status === "active" ? "bg-blue-500/15 border border-blue-500/40"
                                      : status === "complete" ? "bg-zinc-800/60 border border-zinc-700/50"
                                      : "bg-zinc-800/30 border border-zinc-700/30"
                                  }`}
                                >
                                  <div className="flex items-center gap-3">
                                    {status === "complete" ? (
                                      <div className="w-6 h-6 rounded-full bg-green-500/20 flex items-center justify-center">
                                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-green-400">
                                          <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" />
                                        </svg>
                                      </div>
                                    ) : status === "active" ? (
                                      <div className="w-6 h-6 rounded-full border-2 border-blue-500 border-t-transparent animate-spin"></div>
                                    ) : (
                                      <div className="w-6 h-6 rounded-full border-2 border-zinc-600/50"></div>
                                    )}
                                    <span className={`text-sm font-medium ${status === "active" ? "text-blue-300" : status === "complete" ? "text-zinc-300" : "text-zinc-500"}`}>
                                      {step.label}
                                    </span>
                                  </div>
                                  <div className="flex items-center min-w-[120px] justify-end">
                                    {value ? (
                                      step.key === "color" && typeof value === "object" ? (
                                        <AnimatedValue value={value.name} colorHex={value.hex} />
                                      ) : (
                                        <AnimatedValue value={String(value)} />
                                      )
                                    ) : status === "active" ? (
                                      <ScrambleText isActive={true} />
                                    ) : status === "pending" ? (
                                      <span className="font-mono text-xs text-zinc-600 tracking-wider">--------</span>
                                    ) : null}
                                  </div>
                                </motion.div>
                              );
                            })}
                          </div>
                          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-3 flex items-center justify-center gap-2 text-xs text-zinc-500">
                            {masksReady ? (
                              <>
                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-green-400">
                                  <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" />
                                </svg>
                                <span className="text-green-400">AI segmentation ready</span>
                              </>
                            ) : (
                              <>
                                <div className="w-3 h-3 rounded-full border border-zinc-600 border-t-blue-400 animate-spin"></div>
                                <span>Preparing AI segmentation...</span>
                              </>
                            )}
                          </motion.div>
                        </div>
                      </motion.div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Desktop only: Analysis complete summary overlay */}
                {!isAnalyzing && analysis && (
                  <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="hidden md:block absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/95 via-black/70 to-transparent p-6"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 rounded-xl border-2 border-zinc-600 shadow-lg" style={{ backgroundColor: analysis.colorHex }} />
                        <div>
                          <p className="text-white font-bold text-xl">{analysis.year} {analysis.make} {analysis.model}</p>
                          <p className="text-zinc-400">{analysis.color} • {analysis.bodyType} • {analysis.angle} view</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 bg-green-500/20 px-4 py-2 rounded-full">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5 text-green-400">
                          <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" />
                        </svg>
                        <span className="text-green-400 font-medium">Ready to customize</span>
                      </div>
                    </div>
                  </motion.div>
                )}
              </div>

              {/* Mobile only: Analysis list - parent handles scrolling */}
              <div className="md:hidden flex flex-col mt-2 space-y-1.5 px-1">
                {/* Analysis header - compact */}
                {isAnalyzing && (
                  <div className="flex items-center gap-2 py-1">
                    <div className="w-4 h-4 rounded-full border-2 border-blue-500 border-t-transparent animate-spin"></div>
                    <span className="text-xs font-medium text-blue-400">Analyzing vehicle...</span>
                  </div>
                )}

                {/* Each attribute on its own row */}
                {ANALYSIS_STEPS.filter(s => s.key !== "masks").map((step) => {
                  const status = getStepStatus(step.key);
                  const value = getStepValue(step.key);
                  return (
                    <motion.div
                      key={step.key}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      className={`flex items-center justify-between px-3 py-2 rounded-lg transition-all ${
                        status === "active" ? "bg-blue-500/15 border border-blue-500/40"
                          : status === "complete" ? "bg-zinc-800/60 border border-zinc-700/50"
                          : "bg-zinc-800/30 border border-zinc-700/30"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        {status === "complete" ? (
                          <div className="w-5 h-5 rounded-full bg-green-500/20 flex items-center justify-center">
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3 text-green-400">
                              <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" />
                            </svg>
                          </div>
                        ) : status === "active" ? (
                          <div className="w-5 h-5 rounded-full border-2 border-blue-500 border-t-transparent animate-spin"></div>
                        ) : (
                          <div className="w-5 h-5 rounded-full border-2 border-zinc-600/50"></div>
                        )}
                        <span className={`text-sm font-medium ${status === "active" ? "text-blue-300" : status === "complete" ? "text-zinc-300" : "text-zinc-500"}`}>
                          {step.label}
                        </span>
                      </div>
                      <div className="flex items-center">
                        {value ? (
                          step.key === "color" && typeof value === "object" ? (
                            <AnimatedValue value={value.name} colorHex={value.hex} />
                          ) : (
                            <AnimatedValue value={String(value)} />
                          )
                        ) : status === "active" ? (
                          <ScrambleText isActive={true} />
                        ) : null}
                      </div>
                    </motion.div>
                  );
                })}

                {/* AI Segmentation row */}
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className={`flex items-center justify-between px-3 py-2 rounded-lg ${
                    masksReady ? "bg-zinc-800/60 border border-zinc-700/50" : "bg-zinc-800/30 border border-zinc-700/30"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    {masksReady ? (
                      <div className="w-5 h-5 rounded-full bg-green-500/20 flex items-center justify-center">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3 text-green-400">
                          <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" />
                        </svg>
                      </div>
                    ) : (
                      <div className="w-5 h-5 rounded-full border-2 border-zinc-600 border-t-blue-400 animate-spin"></div>
                    )}
                    <span className={`text-sm font-medium ${masksReady ? "text-zinc-300" : "text-zinc-500"}`}>
                      AI Segmentation
                    </span>
                  </div>
                  {masksReady && <span className="text-sm text-green-400">Ready</span>}
                </motion.div>

              </div>

              {/* Desktop: Action buttons (inside scrollable area) */}
              <div className="hidden md:flex gap-3 mt-4">
                <button
                  onClick={handleClick}
                  disabled={isAnalyzing}
                  className={`flex-1 px-4 md:px-6 py-3 rounded-xl font-medium transition-all text-sm md:text-base ${
                    isAnalyzing
                      ? "bg-zinc-800/50 text-zinc-500 cursor-not-allowed"
                      : "bg-zinc-800 hover:bg-zinc-700 text-white hover:scale-[1.02]"
                  }`}
                >
                  Upload Different Photo
                </button>
                <button
                  onClick={handleStartCustomizing}
                  disabled={!canProceed}
                  className={`flex-1 px-4 md:px-6 py-3 rounded-xl font-semibold transition-all text-sm md:text-base ${
                    canProceed
                      ? "bg-gradient-to-r from-red-600 to-red-500 hover:from-red-500 hover:to-red-400 text-white shadow-lg shadow-red-500/25 hover:scale-[1.02]"
                      : "bg-red-600/30 text-white/50 cursor-not-allowed"
                  }`}
                >
                  {isAnalyzing ? "Analyzing..." : "Start Customizing →"}
                </button>
              </div>
            </div>

            {/* Mobile: FIXED CTA buttons at viewport bottom - always visible */}
            <div className="md:hidden fixed bottom-0 left-0 right-0 z-50 px-3 pt-3 pb-6 border-t border-zinc-800 bg-zinc-950/95 backdrop-blur-sm">
              <div className="flex gap-2 max-w-4xl mx-auto">
                <button
                  onClick={handleClick}
                  disabled={isAnalyzing}
                  className={`flex-1 px-4 py-3 rounded-xl font-medium transition-all text-sm ${
                    isAnalyzing
                      ? "bg-zinc-800/50 text-zinc-500 cursor-not-allowed"
                      : "bg-zinc-800 hover:bg-zinc-700 text-white hover:scale-[1.02]"
                  }`}
                >
                  Upload Different
                </button>
                <button
                  onClick={handleStartCustomizing}
                  disabled={!canProceed}
                  className={`flex-1 px-4 py-3 rounded-xl font-semibold transition-all text-sm ${
                    canProceed
                      ? "bg-gradient-to-r from-red-600 to-red-500 hover:from-red-500 hover:to-red-400 text-white shadow-lg shadow-red-500/25 hover:scale-[1.02]"
                      : "bg-red-600/30 text-white/50 cursor-not-allowed"
                  }`}
                >
                  {isAnalyzing ? "Analyzing..." : "Start Customizing →"}
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
