import { NextRequest, NextResponse } from "next/server";
import { inpaintImage, validateToken } from "@/lib/replicate";
import sharp from "sharp";

// Detailed wheel descriptions for Flux Fill Pro inpainting
const WHEEL_PROMPTS: Record<string, string> = {
  "20-sputtering": "20-inch dark gunmetal alloy wheel with 5 split-spoke design, modern angular cuts, premium metallic finish, photorealistic car wheel",
  "19-hyper-silver": "19-inch two-tone alloy wheel with 5 split-spoke design, black base with machined silver face, sharp angular spokes, photorealistic car wheel",
  "19-diamond-cut": "19-inch chrome mesh wheel with intricate lattice web pattern, complex geometric spoke design, diamond-cut silver chrome finish, photorealistic car wheel",
  "18-diamond-cut": "18-inch silver alloy wheel with multi-spoke star pattern, 10+ spokes radiating from center, diamond-cut machined finish, photorealistic car wheel",
};

/**
 * Inpaint wheels using Flux Fill Pro.
 *
 * Flux Fill Pro ONLY modifies pixels inside the white mask areas.
 * Black areas stay PIXEL-PERFECT unchanged - no shifts, no artifacts.
 *
 * IMPORTANT: Flux Fill Pro may return images at a different resolution
 * than the input. We resize the output to match the original dimensions.
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
    if (!normalizedWheel || !WHEEL_PROMPTS[normalizedWheel]) {
      return NextResponse.json(
        { error: `Unknown wheel ID: ${normalizedWheel}` },
        { status: 400 }
      );
    }

    console.log("[inpaint-wheels] Processing:", normalizedWheel);
    console.log("[inpaint-wheels] Mask:", wheelMask.substring(0, 100) + "...");
    const startTime = Date.now();

    // Convert car image to buffer and get original dimensions
    const arrayBuffer = await image.arrayBuffer();
    const originalBuffer = Buffer.from(arrayBuffer);

    const originalMetadata = await sharp(originalBuffer).metadata();
    const originalWidth = originalMetadata.width!;
    const originalHeight = originalMetadata.height!;
    console.log(`[inpaint-wheels] Original image: ${originalWidth}x${originalHeight}`);

    // Convert to base64 for API
    const base64Car = `data:${image.type};base64,${originalBuffer.toString("base64")}`;

    // Get wheel prompt
    const wheelPrompt = WHEEL_PROMPTS[normalizedWheel];
    console.log("[inpaint-wheels] Prompt:", wheelPrompt);

    // Use Flux Fill Pro to inpaint ONLY the wheel areas
    const resultBase64 = await inpaintImage(base64Car, wheelMask, wheelPrompt);

    // Check output dimensions and resize if needed
    const resultData = resultBase64.replace(/^data:image\/\w+;base64,/, "");
    const resultBuffer = Buffer.from(resultData, "base64");

    const resultMetadata = await sharp(resultBuffer).metadata();
    console.log(`[inpaint-wheels] Flux Fill Pro output: ${resultMetadata.width}x${resultMetadata.height}`);

    let finalResult = resultBase64;

    // Resize output if dimensions differ from original
    if (resultMetadata.width !== originalWidth || resultMetadata.height !== originalHeight) {
      console.log(`[inpaint-wheels] Resizing output from ${resultMetadata.width}x${resultMetadata.height} to ${originalWidth}x${originalHeight}`);

      const resizedBuffer = await sharp(resultBuffer)
        .resize(originalWidth, originalHeight, {
          fit: "fill",  // Stretch to exact dimensions
          kernel: "lanczos3",  // High-quality scaling for photos
        })
        .jpeg({ quality: 95 })  // High quality output
        .toBuffer();

      finalResult = `data:image/jpeg;base64,${resizedBuffer.toString("base64")}`;
      console.log("[inpaint-wheels] Output resized to match original");
    }

    const elapsed = Date.now() - startTime;
    console.log(`[inpaint-wheels] Completed in ${elapsed}ms`);

    // Return the full inpainted image (now at correct dimensions)
    return NextResponse.json({
      success: true,
      message: "Wheels inpainted successfully",
      resultUrl: finalResult,
      layerUrl: finalResult,  // For compatibility with layer system
      layerType: "wheel",
      originalDimensions: { width: originalWidth, height: originalHeight },
      outputDimensions: { width: resultMetadata.width, height: resultMetadata.height },
      elapsed,
    });

  } catch (error: any) {
    console.error("[inpaint-wheels] Error:", error);
    return NextResponse.json(
      {
        error: "Wheel inpainting failed",
        message: error?.message || String(error),
      },
      { status: 500 }
    );
  }
}
