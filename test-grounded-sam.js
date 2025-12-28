const Replicate = require("replicate");
const fs = require("fs");
const path = require("path");

// Load .env.local
require("dotenv").config({ path: path.join(__dirname, ".env.local") });

const replicate = new Replicate({
    auth: process.env.REPLICATE_API_TOKEN,
});

async function testGroundedSam() {
    // Read the test car image
    // Use one of the output images to test (has the Genesis GV70 with wheels)
const imagePath = "/Users/george/Dropbox/My Mac (Georges-MBP)/Downloads/out-0 (4).jpg";

    // Check if file exists - if not, try to use a URL or base64
    let imageInput;

    if (fs.existsSync(imagePath)) {
        const imageBuffer = fs.readFileSync(imagePath);
        const base64 = imageBuffer.toString("base64");
        const mimeType = "image/jpeg";
        imageInput = `data:${mimeType};base64,${base64}`;
        console.log("Using local image file (base64)");
    } else {
        console.log("Image not found at:", imagePath);
        console.log("Please provide a valid image path");
        process.exit(1);
    }

    console.log("Testing Grounded SAM wheel detection...");
    console.log("Image input length:", imageInput.length);

    try {
        const output = await replicate.run(
            "schananas/grounded_sam:ee871c19efb1941f55f66a3d7d960428c8a5afcb77449547fe8e5a3ab9ebc21c",
            {
                input: {
                    image: imageInput,
                    mask_prompt: "wheels",
                    negative_mask_prompt: "",
                    adjustment_factor: 0,
                },
            }
        );

        console.log("\n=== Grounded SAM Output ===");
        console.log("Output type:", Array.isArray(output) ? `Array of ${output.length}` : typeof output);

        if (Array.isArray(output)) {
            const names = ["annotated", "negative", "mask", "inverted"];

            for (let i = 0; i < output.length; i++) {
                const item = output[i];
                const outputPath = path.join(__dirname, `test-output-${names[i]}.png`);

                // Handle ReadableStream
                if (item && typeof item.getReader === 'function') {
                    console.log(`\nSaving ${names[i]} (ReadableStream)...`);
                    const reader = item.getReader();
                    const chunks = [];

                    while (true) {
                        const { done, value } = await reader.read();
                        if (done) break;
                        chunks.push(value);
                    }

                    const buffer = Buffer.concat(chunks);
                    fs.writeFileSync(outputPath, buffer);
                    console.log(`  Saved to: ${outputPath} (${buffer.length} bytes)`);
                }
                // Handle URL string
                else if (typeof item === 'string') {
                    console.log(`\n${names[i]}: ${item}`);
                }
                // Handle file object with .url()
                else if (item && typeof item.url === 'function') {
                    console.log(`\n${names[i]}: ${item.url()}`);
                }
            }

            console.log("\n✅ Done! Check test-output-*.png files in the project root.");
        }

    } catch (error) {
        console.error("Error:", error);
    }
}

testGroundedSam();
