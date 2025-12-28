import { NextRequest, NextResponse } from "next/server";
import { processQwenImageEdit, validateToken } from "@/lib/replicate";
import { extractDifferenceLayer } from "@/lib/mask-utils";
import { buildPrompt } from "@/lib/prompts";
import fs from "fs/promises";
import path from "path";

// Wheel ID to Filename mapping
// This must match the IDs sent from the frontend
const WHEEL_FILES: Record<string, string> = {
  "20-sputtering": "20-sputtering.png",
  "19-hyper-silver": "19-hyper-silver.png",
  "19-diamond-cut": "19-diamond.png",
  "18-diamond-cut": "18-diamond.png",
};

// Detailed wheel descriptions for Flux Fill Pro inpainting
// These prompts describe each wheel design in detail for text-based generation
const WHEEL_PROMPTS: Record<string, string> = {
  "20-sputtering": "Premium 20-inch dark gray alloy wheels with 5 split-spoke design, each spoke has layered angular cuts and slots, modern Genesis luxury vehicle wheel, metallic gunmetal finish, photorealistic",
  "19-hyper-silver": "Elegant 19-inch two-tone alloy wheels with 5 split-spoke design, black base with machined silver face, premium Genesis luxury wheel, sharp angular spokes, photorealistic",
  "19-diamond-cut": "Luxurious 19-inch chrome mesh wheels with intricate lattice web pattern, complex geometric spoke design with diamond-cut finish, elegant silver chrome, Genesis premium wheel, photorealistic",
  "18-diamond-cut": "Refined 18-inch silver alloy wheels with multi-spoke star pattern, 10+ spokes radiating from center, diamond-cut machined finish, Genesis luxury wheel, photorealistic",
};

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const image = formData.get("image") as File;
    const prompt = formData.get("prompt") as string;
    const selectedWheel = formData.get("selectedWheel") as string;
    const wheelMask = formData.get("wheelMask") as string | null; // Optional wheel region mask from FastSAM

    // Diagnose Auth
    const authStatus = validateToken() as any;
    if (!authStatus.valid) {
      console.error("❌ Auth Validation Failed:", authStatus.reason);
      return NextResponse.json(
        {
          error: "Authentication Invalid",
          message: `Token issue: ${authStatus.reason}`,
          details: `Length: ${authStatus.token?.length || 0}. Please check .env.local and restart server.`
        },
        { status: 401 }
      );
    } else {
      console.log(`✅ Auth Validated. Token Length: ${authStatus.length}, Starts with: ${authStatus.token?.substring(0, 4)}`);
    }

    if (!image) {
      return NextResponse.json(
        { error: "No image provided" },
        { status: 400 }
      );
    }

    console.log("Processing image:", image.name);
    if (selectedWheel) console.log("Selected Wheel ID:", selectedWheel);

    // Convert car image to base64
    const arrayBuffer = await image.arrayBuffer();
    const base64Car = `data:${image.type};base64,${Buffer.from(arrayBuffer).toString("base64")}`;

    let layerUrl = null;
    let layerType: "wheel" | "paint" | null = null;
    const normalizedWheel = selectedWheel?.trim();

    // WHEEL SWAP - Extract as layer
    if (normalizedWheel && WHEEL_FILES[normalizedWheel]) {
      console.log(`[LAYER] Processing wheel swap: ${normalizedWheel}`);
      const startTime = Date.now();

      try {
        // Load wheel reference image
        const wheelFilename = WHEEL_FILES[normalizedWheel];
        const wheelPath = path.join(process.cwd(), "public", "wheels", wheelFilename);
        const wheelBuffer = await fs.readFile(wheelPath);
        const base64Wheel = `data:image/png;base64,${wheelBuffer.toString("base64")}`;

        // Build wheel prompt using modular prompt system
        const wheelDescription = WHEEL_PROMPTS[normalizedWheel] || "alloy wheel design from reference";
        const qwenPrompt = buildPrompt("wheels", wheelDescription);

        console.log("[LAYER] Generating with Qwen...");
        const qwenOutput = await processQwenImageEdit(base64Car, base64Wheel, qwenPrompt);

        // Extract as transparent layer (only changed pixels)
        // If wheelMask provided, only keep pixels INSIDE wheel regions
        console.log("[LAYER] Extracting difference layer...");
        if (wheelMask) {
          console.log("[LAYER] Using wheel mask to filter - keeping only wheel region pixels");
        }
        layerUrl = await extractDifferenceLayer(base64Car, qwenOutput, 25, wheelMask || undefined, "include");
        layerType = "wheel";

        const elapsed = Date.now() - startTime;
        console.log(`✅ Wheel layer extracted in ${elapsed}ms`);

      } catch (error: any) {
        console.error("❌ Wheel layer extraction failed:", error);
        throw error;
      }
    }
    // PAINT COLOR CHANGE - Extract as layer
    else if (prompt && prompt.includes("paint")) {
      console.log(`[LAYER] Processing paint change: ${prompt}`);
      const startTime = Date.now();

      try {
        // Build paint prompt using modular prompt system
        const qwenPrompt = buildPrompt("paint", prompt);

        console.log("[LAYER] Generating paint change with Qwen...");
        const qwenOutput = await processQwenImageEdit(base64Car, base64Car, qwenPrompt);

        // Extract as transparent layer (only changed pixels)
        // If wheelMask provided, EXCLUDE wheel regions from paint layer
        console.log("[LAYER] Extracting difference layer...");
        if (wheelMask) {
          console.log("[LAYER] Using wheel mask to filter - excluding wheel region pixels from paint");
        }
        layerUrl = await extractDifferenceLayer(base64Car, qwenOutput, 25, wheelMask || undefined, "exclude");
        layerType = "paint";

        const elapsed = Date.now() - startTime;
        console.log(`✅ Paint layer extracted in ${elapsed}ms`);

      } catch (error: any) {
        console.error("❌ Paint layer extraction failed:", error);
        throw error;
      }
    }
    else if (normalizedWheel) {
      throw new Error(`Unknown wheel ID: ${normalizedWheel}`);
    } else {
      throw new Error("No wheel or paint color selected");
    }

    if (!layerUrl) {
      throw new Error("Failed to extract layer");
    }

    return NextResponse.json({
      success: true,
      message: "Layer extracted successfully",
      layerUrl,
      layerType,
    });

  } catch (error: any) {
    console.error("[API ERROR]:", error);

    // Extract detailed error message
    const errorMessage = error?.message || "Internal Server Error";
    const errorDetail = error?.detail || error?.details || String(error);

    return NextResponse.json(
      {
        error: "Failed to process image",
        message: errorMessage,
        details: errorDetail
      },
      { status: error?.status || 500 }
    );
  }
}
