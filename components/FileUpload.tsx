"use client";

import { useState, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Image from "next/image";
import { useRouter } from "next/navigation";

interface FileUploadProps {
  onUpload?: (file: File) => void;
}

export default function FileUpload({ onUpload }: FileUploadProps) {
  const [preview, setPreview] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const handleFile = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      alert("Please upload an image file");
      return;
    }

    // Create preview
    const reader = new FileReader();
    reader.onloadend = () => {
      setPreview(reader.result as string);
    };
    reader.readAsDataURL(file);

    // Send to API
    if (onUpload) {
      onUpload(file);
    }

    setIsProcessing(true);
    try {
      const formData = new FormData();
      formData.append("image", file);

      const response = await fetch("/api/process-car", {
        method: "POST",
        body: formData,
      });

      const data = await response.json();
      console.log("API Response:", data);
    } catch (error) {
      console.error("Upload error:", error);
    } finally {
      setIsProcessing(false);
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
    fileInputRef.current?.click();
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleFile(file);
    }
  };

  const handleStartCustomizing = () => {
    if (preview) {
      // Store image in sessionStorage to pass to editor without re-uploading
      // In a real app, this would be a URL from the backend/blob storage
      sessionStorage.setItem("tuner-ai-image", preview);
      router.push("/editor");
    }
  };

  return (
    <div className="w-full max-w-2xl mx-auto">
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
              border-2 border-dashed rounded-2xl p-12 cursor-pointer
              transition-all duration-300
              ${isDragging
                ? "border-red-500 bg-red-500/10"
                : "border-zinc-700 hover:border-zinc-600 bg-zinc-900/30"
              }
            `}
          >
            <div className="text-center space-y-4">
              <div className="text-6xl">📸</div>
              <h3 className="text-2xl font-semibold">Upload Your Car</h3>
              <p className="text-zinc-400 max-w-md mx-auto">
                Drop your car photo here, or click to browse. Best results with side-angle shots.
              </p>
              <div className="flex flex-wrap justify-center gap-2 text-xs text-zinc-500 pt-4">
                <span className="bg-zinc-800 px-3 py-1 rounded-full">JPG</span>
                <span className="bg-zinc-800 px-3 py-1 rounded-full">PNG</span>
                <span className="bg-zinc-800 px-3 py-1 rounded-full">WEBP</span>
              </div>
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="preview"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="space-y-4"
          >
            <div className="relative rounded-2xl overflow-hidden bg-zinc-900 border border-zinc-800">
              <Image
                src={preview}
                alt="Car preview"
                width={800}
                height={600}
                className="w-full h-auto"
                unoptimized
              />
              {isProcessing && (
                <div className="absolute inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center">
                  <div className="text-center space-y-3">
                    <div className="animate-spin text-4xl">⚙️</div>
                    <p className="text-white font-semibold">Processing your ride...</p>
                  </div>
                </div>
              )}
            </div>

            <div className="flex gap-3">
              <button
                onClick={handleClick}
                className="flex-1 bg-zinc-800 hover:bg-zinc-700 text-white px-6 py-3 rounded-lg font-medium transition-colors"
              >
                Upload Different Photo
              </button>
              <button
                onClick={handleStartCustomizing}
                className="flex-1 bg-red-600 hover:bg-red-700 text-white px-6 py-3 rounded-lg font-medium transition-colors"
                disabled={isProcessing}
              >
                Start Customizing
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
