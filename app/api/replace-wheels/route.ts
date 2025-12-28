import { NextRequest, NextResponse } from "next/server";
import { processQwenImageEdit, validateToken } from "@/lib/replicate";
import sharp from "sharp";

// Wheel configurations with reference images
// NOTE: Nano Banana expects natural descriptions of images, not "Image 1/Image 2" references
const WHEEL_CONFIG: Record<string, { refImage: string; description: string }> = {
  "20-sputtering": {
    refImage: "/wheels/20-sputtering.png",
    description: "20-inch sputtering finish multi-spoke alloy wheels",
  },
  "19-hyper-silver": {
    refImage: "/wheels/19-hyper-silver.png",
    description: "19-inch hyper silver split-spoke alloy wheels",
  },
  "19-diamond-cut": {
    refImage: "/wheels/19-diamond.png",
    description: "19-inch diamond-cut dual-tone alloy wheels",
  },
  "18-diamond-cut": {
    refImage: "/wheels/18-diamond.png",
    description: "18-inch diamond-cut alloy wheels with machined finish",
  },
};

/**
 * Hybrid wheel replacement:
 * 1. Qwen generates car with new wheels using reference image (accurate design)
 * 2. SAM3 mask extracts ONLY wheel pixels from Qwen output
 * 3. Composite wheel pixels onto original image (no shifting)
 *
 * This combines Qwen's accuracy with pixel-perfect background preservation.
 */
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const image = formData.get("image") as File;
    const wheelMask = formData.get("wheelMask") as string; // Base64 from SAM3
    const selectedWheel = formData.get("selectedWheel") as string;

    // Validate auth
    const authStatus = validateToken() as any;
    if (!authStatus.valid) {
      return NextResponse.json(
        { error: "Authentication Invalid", message: authStatus.reason },
        { status: 401 }
      );
    }

    if (!image) {
      return NextResponse.json({ error: "No image provided" }, { status: 400 });
    }

    if (!wheelMask) {
      return NextResponse.json(
        { error: "No wheel mask provided. Wait for wheel detection to complete." },
        { status: 400 }
      );
    }

    const normalizedWheel = selectedWheel?.trim();
    if (!normalizedWheel || !WHEEL_CONFIG[normalizedWheel]) {
      return NextResponse.json(
        { error: `Unknown wheel ID: ${normalizedWheel}` },
        { status: 400 }
      );
    }

    console.log("[replace-wheels] Processing:", normalizedWheel);
    const startTime = Date.now();

    // Get original image buffer and dimensions
    const arrayBuffer = await image.arrayBuffer();
    const originalBuffer = Buffer.from(arrayBuffer);
    const originalMetadata = await sharp(originalBuffer).metadata();
    const originalWidth = originalMetadata.width!;
    const originalHeight = originalMetadata.height!;
    console.log(`[replace-wheels] Original: ${originalWidth}x${originalHeight}`);

    // Convert original to base64
    const base64Car = `data:${image.type};base64,${originalBuffer.toString("base64")}`;

    // Get wheel reference image (fetch from public folder)
    const config = WHEEL_CONFIG[normalizedWheel];
    const wheelRefUrl = `${process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000"}${config.refImage}`;
    console.log(`[replace-wheels] Fetching wheel reference: ${config.refImage}`);

    const wheelRefResponse = await fetch(wheelRefUrl);
    if (!wheelRefResponse.ok) {
      throw new Error(`Failed to fetch wheel reference: ${wheelRefResponse.status}`);
    }
    const wheelRefBuffer = await wheelRefResponse.arrayBuffer();
    const base64WheelRef = `data:image/png;base64,${Buffer.from(wheelRefBuffer).toString("base64")}`;

    // Build natural language prompt that describes both images
    // Nano Banana Pro: be specific about only modifying foreground vehicle rims
    const prompt = `Replace the rims of the vehicle in the foreground with the rim from the attached reference photo. The reference shows ${config.description}. Make it seem natural. Don't replace or edit anything else in the original photo except for the rims on only the vehicle from the foreground.`;

    console.log("[replace-wheels] Calling Nano Banana with reference image...");
    console.log("[replace-wheels] Prompt:", prompt);
    const qwenResult = await processQwenImageEdit(base64Car, base64WheelRef, prompt);
    console.log("[replace-wheels] Qwen completed:", qwenResult.substring(0, 100));

    // Get Qwen output as buffer - result may be URL or data URL
    let qwenBuffer: Buffer;
    if (qwenResult.startsWith("data:")) {
      // Already a data URL
      const qwenData = qwenResult.replace(/^data:image\/\w+;base64,/, "");
      qwenBuffer = Buffer.from(qwenData, "base64");
    } else {
      // It's a URL - need to download
      console.log("[replace-wheels] Downloading Qwen result from URL...");
      const qwenResponse = await fetch(qwenResult);
      if (!qwenResponse.ok) {
        throw new Error(`Failed to download Qwen result: ${qwenResponse.status}`);
      }
      const qwenArrayBuffer = await qwenResponse.arrayBuffer();
      qwenBuffer = Buffer.from(qwenArrayBuffer);
      console.log("[replace-wheels] Downloaded:", qwenBuffer.length, "bytes");
    }

    // Get output dimensions
    const outputMetadata = await sharp(qwenBuffer).metadata();
    console.log(`[replace-wheels] Nano Banana output: ${outputMetadata.width}x${outputMetadata.height}`);

    // Resize output to match original if needed
    let resizedBuffer: Buffer = qwenBuffer;
    if (outputMetadata.width !== originalWidth || outputMetadata.height !== originalHeight) {
      console.log(`[replace-wheels] Resizing output to ${originalWidth}x${originalHeight}`);
      resizedBuffer = await sharp(qwenBuffer)
        .resize(originalWidth, originalHeight, { fit: "fill", kernel: "lanczos3" })
        .toBuffer();
    }

    // EXTRACT WHEEL PIXELS ONLY using SAM3 mask
    // This creates a transparent layer that can be composited with other layers
    console.log("[replace-wheels] Extracting wheel pixels using mask...");

    const maskData = wheelMask.replace(/^data:image\/\w+;base64,/, "");
    const maskBuffer = Buffer.from(maskData, "base64");

    // Ensure mask matches dimensions
    const maskMeta = await sharp(maskBuffer).metadata();
    let resizedMaskBuffer: Buffer = maskBuffer;
    if (maskMeta.width !== originalWidth || maskMeta.height !== originalHeight) {
      resizedMaskBuffer = await sharp(maskBuffer)
        .resize(originalWidth, originalHeight, { fit: "fill", kernel: "nearest" })
        .toBuffer();
    }

    // Get raw pixels from generated image and mask
    const generatedRaw = await sharp(resizedBuffer)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const maskRaw = await sharp(resizedMaskBuffer)
      .grayscale()
      .raw()
      .toBuffer();

    // Create transparent layer: only wheel pixels are visible
    const wheelLayer = Buffer.alloc(generatedRaw.data.length);
    for (let i = 0; i < originalWidth * originalHeight; i++) {
      const srcIdx = i * 4;
      const maskVal = maskRaw[i];

      wheelLayer[srcIdx] = generatedRaw.data[srcIdx];         // R
      wheelLayer[srcIdx + 1] = generatedRaw.data[srcIdx + 1]; // G
      wheelLayer[srcIdx + 2] = generatedRaw.data[srcIdx + 2]; // B
      wheelLayer[srcIdx + 3] = maskVal;                        // A = mask (white=visible, black=transparent)
    }

    // Convert to PNG (preserves transparency)
    const layerPng = await sharp(wheelLayer, {
      raw: { width: originalWidth, height: originalHeight, channels: 4 },
    })
      .png()
      .toBuffer();

    console.log("[replace-wheels] Wheel layer created (transparent PNG)");

    // Return as PNG to preserve transparency
    const finalResult = `data:image/png;base64,${layerPng.toString("base64")}`;

    const elapsed = Date.now() - startTime;
    console.log(`[replace-wheels] Completed in ${elapsed}ms`);

    return NextResponse.json({
      success: true,
      message: "Wheels replaced successfully",
      resultUrl: finalResult,
      layerUrl: finalResult,
      layerType: "wheel",
      elapsed,
    });

  } catch (error: any) {
    console.error("[replace-wheels] Error:", error);
    return NextResponse.json(
      {
        error: "Wheel replacement failed",
        message: error?.message || String(error),
      },
      { status: 500 }
    );
  }
}
