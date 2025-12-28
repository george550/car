const Replicate = require("replicate");
const fs = require("fs");
const path = require("path");

// Load .env.local
require("dotenv").config({ path: path.join(__dirname, ".env.local") });

const replicate = new Replicate({
    auth: process.env.REPLICATE_API_TOKEN,
});

const GROUNDED_SAM = "schananas/grounded_sam:ee871c19efb1941f55f66a3d7d960428c8a5afcb77449547fe8e5a3ab9ebc21c";
const FLUX_FILL = "black-forest-labs/flux-fill-pro";

async function streamToBuffer(stream) {
    const reader = stream.getReader();
    const chunks = [];
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
    }
    return Buffer.concat(chunks);
}

async function testFullPipeline() {
    // Use the output image (has the Genesis GV70)
    const imagePath = "/Users/george/Dropbox/My Mac (Georges-MBP)/Downloads/out-0 (4).jpg";

    if (!fs.existsSync(imagePath)) {
        console.log("Image not found at:", imagePath);
        process.exit(1);
    }

    const imageBuffer = fs.readFileSync(imagePath);
    const base64Image = `data:image/jpeg;base64,${imageBuffer.toString("base64")}`;

    console.log("=== STEP 1: Grounded SAM (Wheel Detection) ===");
    console.log("Image size:", imageBuffer.length, "bytes");

    // Step 1: Get wheel mask
    const samOutput = await replicate.run(GROUNDED_SAM, {
        input: {
            image: base64Image,
            mask_prompt: "wheels",
            negative_mask_prompt: "",
            adjustment_factor: 0,
        },
    });

    console.log("SAM output received, extracting mask...");

    // Get the mask (index 2) - white = wheels
    let maskBuffer;
    if (samOutput[2] && typeof samOutput[2].getReader === 'function') {
        maskBuffer = await streamToBuffer(samOutput[2]);
    } else {
        console.error("Unexpected SAM output format");
        process.exit(1);
    }

    // Save mask for reference
    fs.writeFileSync(path.join(__dirname, "pipeline-mask.png"), maskBuffer);
    console.log("Mask saved to pipeline-mask.png");

    // Convert mask to base64
    const base64Mask = `data:image/png;base64,${maskBuffer.toString("base64")}`;

    console.log("\n=== STEP 2: Flux Fill Pro (Inpainting) ===");

    // Detailed wheel description for the 19" Diamond lattice design
    const wheelPrompt = `Premium chrome mesh wheels with intricate lattice web pattern, elegant silver chrome finish, luxury vehicle wheels, high-end alloy rims with complex geometric spoke design, detailed wheel spokes, photorealistic`;

    console.log("Prompt:", wheelPrompt);
    console.log("Running Flux Fill Pro...");

    const fillOutput = await replicate.run(FLUX_FILL, {
        input: {
            image: base64Image,
            mask: base64Mask,
            prompt: wheelPrompt,
            steps: 50,
            guidance: 30,
            output_format: "jpg",
            safety_tolerance: 2,
        },
    });

    console.log("Flux Fill output received");

    // Handle output
    let resultBuffer;
    if (fillOutput && typeof fillOutput.getReader === 'function') {
        resultBuffer = await streamToBuffer(fillOutput);
    } else if (typeof fillOutput === 'string') {
        // It's a URL, fetch it
        console.log("Output is URL:", fillOutput);
        const response = await fetch(fillOutput);
        resultBuffer = Buffer.from(await response.arrayBuffer());
    } else if (fillOutput && typeof fillOutput.url === 'function') {
        const url = fillOutput.url();
        console.log("Output URL:", url);
        const response = await fetch(url);
        resultBuffer = Buffer.from(await response.arrayBuffer());
    } else {
        console.error("Unexpected Flux Fill output format:", fillOutput);
        process.exit(1);
    }

    // Save result
    const resultPath = path.join(__dirname, "pipeline-result.jpg");
    fs.writeFileSync(resultPath, resultBuffer);
    console.log("\n✅ SUCCESS! Result saved to:", resultPath);
    console.log("Result size:", resultBuffer.length, "bytes");
}

testFullPipeline().catch(err => {
    console.error("Pipeline failed:", err);
    process.exit(1);
});
