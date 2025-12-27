import { NextRequest, NextResponse } from "next/server";
import { processImageKontext } from "@/lib/replicate";

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const image = formData.get("image") as File;
    const prompt = formData.get("prompt") as string; // e.g. "bronze te37 wheels"
    // const maskPrompt = formData.get("mask_prompt") as string || "wheels"; // Not used currently

    if (!image) {
      return NextResponse.json(
        { error: "No image provided" },
        { status: 400 }
      );
    }

    console.log("Processing image:", image.name, "Prompt:", prompt);

    // Convert file to base64 for Replicate API
    const arrayBuffer = await image.arrayBuffer();
    const base64Image = `data:${image.type};base64,${Buffer.from(arrayBuffer).toString("base64")}`;

    let resultUrl = null;

    // If we have a prompt, run the full pipeline
    if (prompt) {
      // Use Flux Kontext Pro for direct IMG+PROMPT -> IMG generation
      console.log("Generating with Flux Kontext Pro...");

      const output = await processImageKontext(base64Image, prompt);
      resultUrl = output;

      // Handle array output if necessary (some models return [url])
      if (Array.isArray(resultUrl)) {
        resultUrl = resultUrl[0];
      }
    }

    return NextResponse.json({
      success: true,
      message: prompt ? "Image processed successfully" : "Image uploaded successfully",
      metadata: {
        filename: image.name,
        size: image.size,
        type: image.type,
      },
      resultUrl: resultUrl,
    });

  } catch (error) {
    console.error("[API] Error processing image:", error);
    // @ts-ignore
    if (error?.message) console.error("[API] Error Message:", error.message);

    return NextResponse.json(
      { error: "Failed to process image", details: String(error) },
      { status: 500 }
    );
  }
}
