import { NextRequest, NextResponse } from "next/server";
import { validateToken, processQwenPaint } from "@/lib/replicate";
import { detectBodyMask } from "@/lib/sam3";
import sharp from "sharp";

/**
 * Keep only the largest connected component (the main foreground car).
 * Filters out background vehicles from the body mask.
 */
async function keepLargestComponent(
  maskBuffer: Buffer,
  width: number,
  height: number
): Promise<Buffer> {
  const rawMask = await sharp(maskBuffer).grayscale().raw().toBuffer();

  const labels = new Int32Array(width * height);
  const componentSizes: Map<number, number> = new Map();
  let nextLabel = 1;

  function floodFill(startIdx: number, label: number): number {
    const stack = [startIdx];
    let size = 0;

    while (stack.length > 0) {
      const idx = stack.pop()!;
      if (labels[idx] !== 0 || rawMask[idx] < 128) continue;

      labels[idx] = label;
      size++;

      const x = idx % width;
      const y = Math.floor(idx / width);

      if (x > 0) stack.push(idx - 1);
      if (x < width - 1) stack.push(idx + 1);
      if (y > 0) stack.push(idx - width);
      if (y < height - 1) stack.push(idx + width);
    }

    return size;
  }

  for (let i = 0; i < width * height; i++) {
    if (rawMask[i] >= 128 && labels[i] === 0) {
      const size = floodFill(i, nextLabel);
      componentSizes.set(nextLabel, size);
      nextLabel++;
    }
  }

  console.log(`[paint-body] Found ${componentSizes.size} body regions in mask`);

  // Keep only the single largest component
  let largestLabel = 0;
  let largestSize = 0;
  for (const [label, size] of componentSizes) {
    if (size > largestSize) {
      largestSize = size;
      largestLabel = label;
    }
  }

  console.log(`[paint-body] Keeping largest body: ${largestSize}px`);

  const filteredMask = Buffer.alloc(width * height);
  for (let i = 0; i < width * height; i++) {
    filteredMask[i] = labels[i] === largestLabel ? 255 : 0;
  }

  return sharp(filteredMask, {
    raw: { width, height, channels: 1 }
  }).png().toBuffer();
}

// Paint color prompts for Qwen
const PAINT_COLORS: Record<string, { name: string; prompt: string }> = {
  "vik-black": {
    name: "Vik Black",
    prompt: "deep black metallic car paint, glossy black finish, professional automotive paint"
  },
  "himalayan-gray": {
    name: "Himalayan Gray",
    prompt: "dark gray metallic car paint, charcoal gray automotive finish, professional paint job"
  },
  "adriatic-blue": {
    name: "Adriatic Blue",
    prompt: "deep navy blue metallic car paint, dark blue automotive finish, professional paint job"
  },
  "cardiff-green": {
    name: "Cardiff Green",
    prompt: "dark forest green metallic car paint, deep green automotive finish, professional paint job"
  },
  "savile-silver": {
    name: "Savile Silver",
    prompt: "bright silver metallic car paint, polished silver automotive finish, professional paint job"
  },
  "uyuni-white": {
    name: "Uyuni White",
    prompt: "pearl white car paint, bright white automotive finish, professional paint job"
  },
  "gold-coast": {
    name: "Gold Coast Silver",
    prompt: "champagne gold metallic car paint, warm silver gold automotive finish, professional paint job"
  },
  "makalu-gray": {
    name: "Makalu Gray",
    prompt: "medium gray blue metallic car paint, slate gray automotive finish, professional paint job"
  },
};

/**
 * Paint car body using Qwen + mask compositing.
 *
 * 1. Use pre-computed body mask OR detect with SAM3
 * 2. Subtract wheel mask from body mask (don't paint wheels)
 * 3. Call Qwen to generate car with new paint color
 * 4. Apply body mask as alpha to Qwen output
 * 5. Composite masked Qwen over original (keeps background pixel-perfect)
 */
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const image = formData.get("image") as File;
    const selectedPaint = formData.get("selectedPaint") as string;
    const wheelMask = formData.get("wheelMask") as string; // Optional - to exclude wheels
    const precomputedBodyMask = formData.get("bodyMask") as string; // Pre-computed from upload

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

    const normalizedPaint = selectedPaint?.trim();
    if (!normalizedPaint || !PAINT_COLORS[normalizedPaint]) {
      return NextResponse.json(
        { error: `Unknown paint ID: ${normalizedPaint}` },
        { status: 400 }
      );
    }

    const paintConfig = PAINT_COLORS[normalizedPaint];
    console.log(`[paint-body] Processing: ${paintConfig.name}`);
    const startTime = Date.now();

    // Get original image buffer and dimensions
    const arrayBuffer = await image.arrayBuffer();
    const originalBuffer = Buffer.from(arrayBuffer);
    const originalMetadata = await sharp(originalBuffer).metadata();
    const originalWidth = originalMetadata.width!;
    const originalHeight = originalMetadata.height!;
    console.log(`[paint-body] Original: ${originalWidth}x${originalHeight}`);

    // Convert original to base64 for Nano Banana
    const base64Car = `data:${image.type};base64,${originalBuffer.toString("base64")}`;

    // Get body mask (pre-computed or detect now)
    let bodyMaskBase64: string;
    if (precomputedBodyMask) {
      console.log("[paint-body] Using pre-computed body mask");
      bodyMaskBase64 = precomputedBodyMask;
    } else {
      console.log("[paint-body] Detecting body with SAM3...");
      bodyMaskBase64 = await detectBodyMask(base64Car);
      console.log("[paint-body] Body mask generated (unfiltered)");

      // Filter to keep only largest component (removes background vehicles)
      const rawMaskData = bodyMaskBase64.replace(/^data:image\/\w+;base64,/, "");
      const rawMaskBuffer = Buffer.from(rawMaskData, "base64");
      const rawMaskMeta = await sharp(rawMaskBuffer).metadata();

      // Resize to original dimensions first if needed
      let resizedRawMask: Buffer = rawMaskBuffer;
      if (rawMaskMeta.width !== originalWidth || rawMaskMeta.height !== originalHeight) {
        resizedRawMask = await sharp(rawMaskBuffer)
          .resize(originalWidth, originalHeight, { fit: "fill", kernel: "nearest" })
          .png()
          .toBuffer();
      }

      // Apply largest-component filter
      const filteredMask = await keepLargestComponent(resizedRawMask, originalWidth, originalHeight);
      bodyMaskBase64 = `data:image/png;base64,${filteredMask.toString("base64")}`;
      console.log("[paint-body] Body mask filtered to foreground vehicle only");
    }

    // Resize body mask if needed
    const bodyMaskData = bodyMaskBase64.replace(/^data:image\/\w+;base64,/, "");
    let bodyMaskBuffer: Buffer = Buffer.from(bodyMaskData, "base64");
    const bodyMaskMeta = await sharp(bodyMaskBuffer).metadata();
    if (bodyMaskMeta.width !== originalWidth || bodyMaskMeta.height !== originalHeight) {
      bodyMaskBuffer = await sharp(bodyMaskBuffer)
        .resize(originalWidth, originalHeight, { fit: "fill", kernel: "nearest" })
        .toBuffer();
    }

    // If we have wheel mask, subtract it from body mask (don't include wheels in body layer)
    let finalBodyMask: Buffer = bodyMaskBuffer;
    if (wheelMask) {
      console.log("[paint-body] Subtracting wheels from body mask...");
      const wheelMaskData = wheelMask.replace(/^data:image\/\w+;base64,/, "");
      let wheelMaskBuf: Buffer = Buffer.from(wheelMaskData, "base64");
      const wheelMaskMeta = await sharp(wheelMaskBuf).metadata();
      if (wheelMaskMeta.width !== originalWidth || wheelMaskMeta.height !== originalHeight) {
        wheelMaskBuf = await sharp(wheelMaskBuf)
          .resize(originalWidth, originalHeight, { fit: "fill", kernel: "nearest" })
          .toBuffer();
      }

      const bodyRaw = await sharp(bodyMaskBuffer).grayscale().raw().toBuffer();
      const wheelRaw = await sharp(wheelMaskBuf).grayscale().raw().toBuffer();
      const combined = Buffer.alloc(bodyRaw.length);
      for (let i = 0; i < bodyRaw.length; i++) {
        combined[i] = bodyRaw[i] > 128 && wheelRaw[i] < 128 ? 255 : 0;
      }
      finalBodyMask = await sharp(combined, {
        raw: { width: originalWidth, height: originalHeight, channels: 1 }
      }).png().toBuffer();
    }

    // Call Nano Banana to generate car with new paint color
    // IMPORTANT: Specify foreground vehicle only
    console.log(`[paint-body] Calling Nano Banana Pro with prompt: ${paintConfig.prompt}`);
    const prompt = `Change the body paint color of the vehicle in the foreground to ${paintConfig.prompt}. Make it seem natural. Don't replace or edit anything else in the original photo except for the body paint on only the vehicle from the foreground.`;

    const result = await processQwenPaint(base64Car, prompt);
    console.log("[paint-body] Nano Banana completed:", result.substring(0, 100));

    // Get output as buffer - result may be URL or data URL
    let outputBuffer: Buffer;
    if (result.startsWith("data:")) {
      const data = result.replace(/^data:image\/\w+;base64,/, "");
      outputBuffer = Buffer.from(data, "base64");
    } else {
      console.log("[paint-body] Downloading result from URL...");
      const response = await fetch(result);
      if (!response.ok) {
        throw new Error(`Failed to download result: ${response.status}`);
      }
      const arrayBuffer = await response.arrayBuffer();
      outputBuffer = Buffer.from(arrayBuffer);
      console.log("[paint-body] Downloaded:", outputBuffer.length, "bytes");
    }

    // Get output dimensions and resize if needed
    const outputMetadata = await sharp(outputBuffer).metadata();
    console.log(`[paint-body] Nano Banana output: ${outputMetadata.width}x${outputMetadata.height}`);

    let resizedBuffer: Buffer = outputBuffer;
    if (outputMetadata.width !== originalWidth || outputMetadata.height !== originalHeight) {
      console.log(`[paint-body] Resizing output to ${originalWidth}x${originalHeight}`);
      resizedBuffer = await sharp(outputBuffer)
        .resize(originalWidth, originalHeight, { fit: "fill", kernel: "lanczos3" })
        .toBuffer();
    }

    // EXTRACT BODY PIXELS ONLY using SAM3 mask
    // This creates a transparent layer that can be composited with other layers
    console.log("[paint-body] Extracting body pixels using mask...");

    const generatedRaw = await sharp(resizedBuffer)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    // Debug: verify mask dimensions
    const maskMeta = await sharp(finalBodyMask).metadata();
    console.log(`[paint-body] Mask dimensions: ${maskMeta.width}x${maskMeta.height}, Expected: ${originalWidth}x${originalHeight}`);

    const maskRaw = await sharp(finalBodyMask)
      .grayscale()
      .raw()
      .toBuffer();

    console.log(`[paint-body] Generated raw: ${generatedRaw.data.length} bytes, Mask raw: ${maskRaw.length} bytes, Expected: ${originalWidth * originalHeight * 4} / ${originalWidth * originalHeight}`);

    // Create transparent layer: only body pixels are visible
    const bodyLayer = Buffer.alloc(generatedRaw.data.length);
    let transparentCount = 0;
    let opaqueCount = 0;
    for (let i = 0; i < originalWidth * originalHeight; i++) {
      const srcIdx = i * 4;
      const maskVal = maskRaw[i];

      bodyLayer[srcIdx] = generatedRaw.data[srcIdx];         // R
      bodyLayer[srcIdx + 1] = generatedRaw.data[srcIdx + 1]; // G
      bodyLayer[srcIdx + 2] = generatedRaw.data[srcIdx + 2]; // B
      bodyLayer[srcIdx + 3] = maskVal;                        // A = mask (white=visible, black=transparent)

      if (maskVal < 128) transparentCount++;
      else opaqueCount++;
    }
    console.log(`[paint-body] Layer pixels: ${opaqueCount} opaque, ${transparentCount} transparent (${(opaqueCount / (opaqueCount + transparentCount) * 100).toFixed(1)}% visible)`);

    // Convert to PNG (preserves transparency)
    const layerPng = await sharp(bodyLayer, {
      raw: { width: originalWidth, height: originalHeight, channels: 4 },
    })
      .png()
      .toBuffer();

    console.log("[paint-body] Body layer created (transparent PNG)");

    // Return as PNG to preserve transparency
    const finalResult = `data:image/png;base64,${layerPng.toString("base64")}`;

    const elapsed = Date.now() - startTime;
    console.log(`[paint-body] Completed in ${elapsed}ms`);

    return NextResponse.json({
      success: true,
      message: "Body painted successfully",
      resultUrl: finalResult,
      layerUrl: finalResult,
      layerType: "paint",
      elapsed,
    });

  } catch (error: any) {
    console.error("[paint-body] Error:", error);
    return NextResponse.json(
      {
        error: "Body painting failed",
        message: error?.message || String(error),
      },
      { status: 500 }
    );
  }
}
