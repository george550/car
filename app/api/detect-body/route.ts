import { NextRequest, NextResponse } from "next/server";
import { detectBodyMask, validateSam3Token } from "@/lib/sam3";
import sharp from "sharp";

/**
 * Keep only the largest connected component (the main foreground car).
 * Filters out background vehicles.
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

  console.log(`[detect-body] Found ${componentSizes.size} body regions`);

  // Keep only the single largest component
  let largestLabel = 0;
  let largestSize = 0;
  for (const [label, size] of componentSizes) {
    if (size > largestSize) {
      largestSize = size;
      largestLabel = label;
    }
  }

  console.log(`[detect-body] Keeping largest body: ${largestSize}px`);

  const filteredMask = Buffer.alloc(width * height);
  for (let i = 0; i < width * height; i++) {
    filteredMask[i] = labels[i] === largestLabel ? 255 : 0;
  }

  return sharp(filteredMask, {
    raw: { width, height, channels: 1 }
  }).png().toBuffer();
}

/**
 * Detect car body in an uploaded image using SAM3 via Replicate.
 * Returns a binary mask where white = body panels (hood, doors, fenders, etc.)
 *
 * This runs IN PARALLEL with wheel detection during upload.
 * Body mask is used for paint color changes.
 */
export async function POST(request: NextRequest) {
  try {
    // Validate Replicate API token
    const tokenStatus = validateSam3Token();
    if (!tokenStatus.valid) {
      return NextResponse.json(
        { error: "Replicate API token invalid", message: tokenStatus.reason },
        { status: 401 }
      );
    }

    const formData = await request.formData();
    const image = formData.get("image") as File;

    if (!image) {
      return NextResponse.json(
        { error: "No image provided" },
        { status: 400 }
      );
    }

    console.log("[detect-body] Processing image:", image.name);
    const startTime = Date.now();

    // Convert image to buffer and get dimensions
    const arrayBuffer = await image.arrayBuffer();
    const originalBuffer = Buffer.from(arrayBuffer);

    // Get original image dimensions
    const originalMetadata = await sharp(originalBuffer).metadata();
    const originalWidth = originalMetadata.width!;
    const originalHeight = originalMetadata.height!;
    console.log(`[detect-body] Original image: ${originalWidth}x${originalHeight}`);

    // Create base64 data URI for SAM3
    const base64Image = `data:${image.type};base64,${originalBuffer.toString("base64")}`;

    // Use SAM3 to detect car body - returns base64 mask
    const bodyMaskBase64 = await detectBodyMask(base64Image);

    // Extract the base64 data (remove data:image/png;base64, prefix)
    const base64Data = bodyMaskBase64.replace(/^data:image\/\w+;base64,/, "");
    const maskBuffer = Buffer.from(base64Data, "base64");

    // Get mask dimensions
    const maskMetadata = await sharp(maskBuffer).metadata();
    console.log(`[detect-body] SAM3 mask: ${maskMetadata.width}x${maskMetadata.height}`);

    // Resize mask to match original image if dimensions differ
    let resizedMaskBuffer: Buffer = maskBuffer;
    if (maskMetadata.width !== originalWidth || maskMetadata.height !== originalHeight) {
      console.log(`[detect-body] Resizing mask from ${maskMetadata.width}x${maskMetadata.height} to ${originalWidth}x${originalHeight}`);

      resizedMaskBuffer = await sharp(maskBuffer)
        .resize(originalWidth, originalHeight, {
          fit: "fill",
          kernel: "nearest",
        })
        .png()
        .toBuffer();

      console.log(`[detect-body] Mask resized successfully`);
    }

    // Filter to keep only the largest body component (removes background vehicles)
    const filteredMaskBuffer = await keepLargestComponent(
      resizedMaskBuffer,
      originalWidth,
      originalHeight
    );

    const finalMaskBase64 = `data:image/png;base64,${filteredMaskBuffer.toString("base64")}`;

    const elapsed = Date.now() - startTime;
    console.log(`[detect-body] Body detection completed in ${elapsed}ms`);

    return NextResponse.json({
      success: true,
      bodyMask: finalMaskBase64,
      originalDimensions: { width: originalWidth, height: originalHeight },
      maskDimensions: { width: maskMetadata.width, height: maskMetadata.height },
      elapsed,
    });

  } catch (error: any) {
    console.error("[detect-body] Error:", error);
    return NextResponse.json(
      {
        error: "Body detection failed",
        message: error?.message || String(error),
      },
      { status: 500 }
    );
  }
}
