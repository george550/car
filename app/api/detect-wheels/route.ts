import { NextRequest, NextResponse } from "next/server";
import { detectWheelsMask, validateSam3Token } from "@/lib/sam3";
import sharp from "sharp";

/**
 * Find connected components in a binary mask and keep only the largest N.
 * This filters out small wheels from background vehicles.
 */
async function keepLargestComponents(
  maskBuffer: Buffer,
  width: number,
  height: number,
  maxComponents: number = 4 // Keep at most 4 wheels (typical for a car)
): Promise<Buffer> {
  // Get raw grayscale pixels
  const rawMask = await sharp(maskBuffer).grayscale().raw().toBuffer();

  // Labels for connected components (0 = background, 1+ = component ID)
  const labels = new Int32Array(width * height);
  const componentSizes: Map<number, number> = new Map();
  let nextLabel = 1;

  // Simple flood-fill to find connected components
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

      // 4-connectivity neighbors
      if (x > 0) stack.push(idx - 1);
      if (x < width - 1) stack.push(idx + 1);
      if (y > 0) stack.push(idx - width);
      if (y < height - 1) stack.push(idx + width);
    }

    return size;
  }

  // Find all components
  for (let i = 0; i < width * height; i++) {
    if (rawMask[i] >= 128 && labels[i] === 0) {
      const size = floodFill(i, nextLabel);
      componentSizes.set(nextLabel, size);
      nextLabel++;
    }
  }

  console.log(`[detect-wheels] Found ${componentSizes.size} wheel regions`);

  // Sort components by size and keep largest N
  const sortedComponents = Array.from(componentSizes.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxComponents);

  const keepLabels = new Set(sortedComponents.map(([label]) => label));

  console.log(`[detect-wheels] Keeping ${keepLabels.size} largest wheels:`,
    sortedComponents.map(([l, s]) => `${l}:${s}px`).join(", "));

  // Create filtered mask
  const filteredMask = Buffer.alloc(width * height);
  for (let i = 0; i < width * height; i++) {
    filteredMask[i] = keepLabels.has(labels[i]) ? 255 : 0;
  }

  // Convert back to PNG
  return sharp(filteredMask, {
    raw: { width, height, channels: 1 }
  }).png().toBuffer();
}

/**
 * Detect wheels in an uploaded car image using SAM3 via Replicate.
 * Returns a binary mask where white = wheel regions.
 * This mask is used with Flux Fill Pro for precise wheel inpainting.
 *
 * IMPORTANT: The mask is resized to match the original image dimensions.
 * SAM3 may return masks at different resolutions, but Flux Fill Pro
 * requires the mask and image to be the same size.
 *
 * SAM3 advantages over FastSAM:
 * - Text-prompted segmentation ("car wheel rim")
 * - Better accuracy with complex scenes
 * - Supports negative prompts to exclude areas
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

    console.log("[detect-wheels] Processing image:", image.name);
    const startTime = Date.now();

    // Convert image to buffer and get dimensions
    const arrayBuffer = await image.arrayBuffer();
    const originalBuffer = Buffer.from(arrayBuffer);

    // Get original image dimensions
    const originalMetadata = await sharp(originalBuffer).metadata();
    const originalWidth = originalMetadata.width!;
    const originalHeight = originalMetadata.height!;
    console.log(`[detect-wheels] Original image: ${originalWidth}x${originalHeight}`);

    // Create base64 data URI for SAM3
    const base64Image = `data:${image.type};base64,${originalBuffer.toString("base64")}`;

    // Use SAM3 to detect wheels - returns base64 mask
    const wheelMaskBase64 = await detectWheelsMask(base64Image);

    // Extract the base64 data (remove data:image/png;base64, prefix)
    const base64Data = wheelMaskBase64.replace(/^data:image\/\w+;base64,/, "");
    const maskBuffer = Buffer.from(base64Data, "base64");

    // Get mask dimensions
    const maskMetadata = await sharp(maskBuffer).metadata();
    console.log(`[detect-wheels] SAM3 mask: ${maskMetadata.width}x${maskMetadata.height}`);

    // Resize mask to match original image if dimensions differ
    let resizedMaskBuffer: Buffer = maskBuffer;
    if (maskMetadata.width !== originalWidth || maskMetadata.height !== originalHeight) {
      console.log(`[detect-wheels] Resizing mask from ${maskMetadata.width}x${maskMetadata.height} to ${originalWidth}x${originalHeight}`);

      resizedMaskBuffer = await sharp(maskBuffer)
        .resize(originalWidth, originalHeight, {
          fit: "fill",  // Stretch to exact dimensions
          kernel: "nearest",  // Nearest neighbor for binary masks (preserves sharp edges)
        })
        .png()
        .toBuffer();

      console.log(`[detect-wheels] Mask resized successfully`);
    }

    // Filter to keep only the largest wheel components (removes background vehicle wheels)
    const filteredMaskBuffer = await keepLargestComponents(
      resizedMaskBuffer,
      originalWidth,
      originalHeight,
      4 // Keep at most 4 wheels
    );

    const finalMaskBase64 = `data:image/png;base64,${filteredMaskBuffer.toString("base64")}`;

    const elapsed = Date.now() - startTime;
    console.log(`[detect-wheels] Wheel detection completed in ${elapsed}ms`);

    return NextResponse.json({
      success: true,
      wheelMask: finalMaskBase64,
      originalDimensions: { width: originalWidth, height: originalHeight },
      maskDimensions: { width: maskMetadata.width, height: maskMetadata.height },
      elapsed,
    });

  } catch (error: any) {
    console.error("[detect-wheels] Error:", error);
    return NextResponse.json(
      {
        error: "Wheel detection failed",
        message: error?.message || String(error),
      },
      { status: 500 }
    );
  }
}
