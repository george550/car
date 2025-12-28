import { NextRequest, NextResponse } from "next/server";
import Replicate from "replicate";

const replicate = new Replicate({
    auth: process.env.REPLICATE_API_TOKEN?.replace(/['"]/g, "").trim(),
});

export async function POST(request: NextRequest) {
    const startTime = Date.now();

    try {
        const formData = await request.formData();
        const imageFile = formData.get("image") as File;

        if (!imageFile) {
            return NextResponse.json({ error: "No image provided" }, { status: 400 });
        }

        // Convert to base64 for the vision model
        const bytes = await imageFile.arrayBuffer();
        const base64 = Buffer.from(bytes).toString("base64");
        const mimeType = imageFile.type || "image/jpeg";
        const dataUrl = `data:${mimeType};base64,${base64}`;

        console.log("[analyze-vehicle] Starting vehicle analysis with GPT-4.1-mini...");

        // Use OpenAI GPT-4.1-mini for fast, accurate vehicle analysis
        const prompt = `You are analyzing a car photo. Follow these steps:

STEP 1: Identify the vehicle
- Make, Model, Year, Color (with hex code), Body Type
- Horizontal angle: Front, Side, Front 3/4, Rear 3/4, Rear

STEP 2: CRITICAL - Check camera elevation (THIS IS THE MOST IMPORTANT STEP)
Look at the car's ROOF:
- Can you see the roof? How much of it?
- Is the camera positioned ABOVE the vehicle looking DOWN?
- Are you looking at the car from an elevated position (hillside, building, drone)?

IF YOU CAN SEE A SIGNIFICANT PORTION OF THE ROOF, THE PHOTO IS PROBLEMATIC.

Examples:
- Roof clearly visible + looking down = HIGH-ANGLE or AERIAL = angleProblematic: true
- Only see windshield/hood normally = EYE-LEVEL = angleProblematic: false
- Standing next to car = SLIGHTLY-ELEVATED = angleProblematic: false

STEP 3: Respond in JSON format ONLY (no other text):
{
  "make": "string",
  "model": "string",
  "year": "string",
  "color": "string",
  "colorHex": "#hexcode",
  "bodyType": "string",
  "angle": "Front|Side|Front 3/4|Rear 3/4|Rear",
  "cameraElevation": "eye-level|slightly-elevated|high-angle|aerial",
  "angleProblematic": true/false,
  "angleReason": "explanation if problematic"
}

Camera elevation definitions:
- "eye-level": Camera at car height, minimal roof visible
- "slightly-elevated": Standing next to car, slight roof visibility OK
- "high-angle": Looking down, ROOF IS CLEARLY VISIBLE - SET angleProblematic=true
- "aerial": Drone/extreme overhead - SET angleProblematic=true

REMEMBER: If roof is prominent/clearly visible, ALWAYS set angleProblematic=true`;

        const systemPrompt = "You are a car photography analyst. Your PRIMARY task is detecting elevated camera angles. If you can see the car's roof clearly, the angle is problematic. Be strict. Always respond with valid JSON only.";

        // Stream the response and collect it
        let responseText = "";
        for await (const event of replicate.stream("openai/gpt-4.1-mini", {
            input: {
                prompt: prompt,
                image_input: [dataUrl],
                system_prompt: systemPrompt,
            },
        })) {
            responseText += String(event);
        }

        console.log("[analyze-vehicle] Raw response:", responseText);

        // Parse JSON from response
        let analysis = {
            make: "Unknown",
            model: "Unknown",
            year: "Unknown",
            color: "Unknown",
            colorHex: "#808080",
            bodyType: "Unknown",
            angle: "Unknown",
            cameraElevation: "eye-level" as "eye-level" | "slightly-elevated" | "high-angle" | "aerial",
            angleProblematic: false,
            angleReason: "",
            confidence: "low",
        };

        // Parse natural language response from moondream2
        const text = responseText.toLowerCase();
        const originalText = responseText;

        // Try JSON first (in case model returns JSON)
        try {
            const jsonMatch = responseText.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0]);
                analysis = { ...analysis, ...parsed };
            }
        } catch {
            // Continue with text parsing
        }

        // Extract make - look for known manufacturers
        const makes: Record<string, string> = {
            "genesis": "Genesis", "hyundai": "Hyundai", "kia": "Kia",
            "bmw": "BMW", "mercedes": "Mercedes-Benz", "mercedes-benz": "Mercedes-Benz",
            "audi": "Audi", "volkswagen": "Volkswagen", "vw": "Volkswagen",
            "tesla": "Tesla", "toyota": "Toyota", "lexus": "Lexus",
            "honda": "Honda", "acura": "Acura", "nissan": "Nissan", "infiniti": "Infiniti",
            "ford": "Ford", "lincoln": "Lincoln", "chevrolet": "Chevrolet", "chevy": "Chevrolet",
            "cadillac": "Cadillac", "gmc": "GMC", "dodge": "Dodge", "jeep": "Jeep", "ram": "RAM",
            "porsche": "Porsche", "ferrari": "Ferrari", "lamborghini": "Lamborghini",
            "bentley": "Bentley", "rolls-royce": "Rolls-Royce", "maserati": "Maserati",
            "jaguar": "Jaguar", "land rover": "Land Rover", "range rover": "Range Rover",
            "volvo": "Volvo", "subaru": "Subaru", "mazda": "Mazda",
        };
        for (const [key, value] of Object.entries(makes)) {
            if (text.includes(key)) {
                analysis.make = value;
                break;
            }
        }

        // Extract model - look for common patterns
        const modelPatterns = [
            /(?:model|is a|it's a|this is a?)\s+(?:\d{4}\s+)?(?:\w+\s+)?(\w+[-\s]?\w*)/i,
            /(\w+[-]?\d+)/i, // Matches G80, M3, Model 3, etc.
        ];
        for (const pattern of modelPatterns) {
            const match = originalText.match(pattern);
            if (match && match[1] && match[1].length > 1) {
                const model = match[1].trim();
                if (!makes[model.toLowerCase()] && model.toLowerCase() !== "car") {
                    analysis.model = model;
                    break;
                }
            }
        }

        // Extract year
        const yearMatch = originalText.match(/\b(20[0-2]\d|19\d{2})\b/);
        if (yearMatch) {
            analysis.year = yearMatch[1];
        } else if (text.includes("recent") || text.includes("new") || text.includes("latest")) {
            analysis.year = "2022-2024";
        }

        // Extract body type
        const bodyTypes: Record<string, string> = {
            "suv": "SUV", "crossover": "SUV", "sport utility": "SUV",
            "sedan": "Sedan", "saloon": "Sedan",
            "coupe": "Coupe", "coupé": "Coupe",
            "hatchback": "Hatchback", "hatch": "Hatchback",
            "wagon": "Wagon", "estate": "Wagon",
            "truck": "Truck", "pickup": "Truck",
            "convertible": "Convertible", "cabriolet": "Convertible",
            "minivan": "Minivan", "van": "Van",
        };
        for (const [key, value] of Object.entries(bodyTypes)) {
            if (text.includes(key)) {
                analysis.bodyType = value;
                break;
            }
        }

        // Extract color
        const colors: Record<string, string> = {
            "white": "#F5F5F5", "pearl white": "#FAFAFA", "snow white": "#FFFAFA",
            "black": "#1a1a1a", "jet black": "#0d0d0d",
            "silver": "#C0C0C0", "metallic silver": "#A8A8A8",
            "gray": "#808080", "grey": "#808080", "charcoal": "#36454F",
            "blue": "#1e3a5f", "navy": "#000080", "dark blue": "#00008B",
            "red": "#8B0000", "burgundy": "#800020", "maroon": "#800000",
            "green": "#2d4a4a", "dark green": "#013220", "forest green": "#228B22",
            "brown": "#654321", "bronze": "#CD7F32", "tan": "#D2B48C",
            "gold": "#FFD700", "champagne": "#F7E7CE", "beige": "#F5F5DC",
            "orange": "#FF8C00", "yellow": "#FFD700",
        };
        for (const [color, hex] of Object.entries(colors)) {
            if (text.includes(color)) {
                analysis.color = color.split(" ").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
                analysis.colorHex = hex;
                break;
            }
        }

        // Detect photo angle from response or default based on typical car photos
        if (text.includes("side") || text.includes("profile")) {
            analysis.angle = "Side";
        } else if (text.includes("front") && text.includes("quarter")) {
            analysis.angle = "Front 3/4";
        } else if (text.includes("rear") && text.includes("quarter")) {
            analysis.angle = "Rear 3/4";
        } else if (text.includes("front")) {
            analysis.angle = "Front";
        } else if (text.includes("rear") || text.includes("back")) {
            analysis.angle = "Rear";
        } else {
            analysis.angle = "Side"; // Default for most car photos
        }

        // Safety check: Detect problematic angles from raw response text
        // This runs AFTER JSON parsing to catch cases the model might miss
        const safetyKeywords = {
            aerial: ["aerial", "drone", "bird's eye", "overhead", "from above"],
            highAngle: ["roof visible", "roof is visible", "see the roof", "looking down", "elevated angle", "high angle", "top of the car", "top of the vehicle"],
        };

        // Check for aerial keywords
        if (safetyKeywords.aerial.some(keyword => text.includes(keyword))) {
            analysis.cameraElevation = "aerial";
            analysis.angleProblematic = true;
            analysis.angleReason = "Aerial/overhead angle detected - camera is far above the vehicle";
            console.log("[analyze-vehicle] Safety check: Aerial angle detected from keywords");
        }
        // Check for high-angle keywords (roof visibility)
        else if (safetyKeywords.highAngle.some(keyword => text.includes(keyword))) {
            analysis.cameraElevation = "high-angle";
            analysis.angleProblematic = true;
            analysis.angleReason = "High angle detected - camera is elevated, roof is clearly visible";
            console.log("[analyze-vehicle] Safety check: High angle detected from keywords");
        }

        // Fallback detection for camera elevation if not set by JSON or safety check
        if (!analysis.angleProblematic && (!analysis.cameraElevation || analysis.cameraElevation === "eye-level")) {
            if (text.includes("elevated") || text.includes("above")) {
                analysis.cameraElevation = "high-angle";
                analysis.angleProblematic = true;
                analysis.angleReason = "Elevated camera position detected";
                console.log("[analyze-vehicle] Fallback: High angle detected");
            }
        }

        const elapsed = Date.now() - startTime;
        console.log(`[analyze-vehicle] Analysis complete in ${elapsed}ms:`, analysis);

        return NextResponse.json({
            success: true,
            analysis,
            elapsed,
        });
    } catch (error: any) {
        console.error("[analyze-vehicle] Error:", error);
        return NextResponse.json(
            { error: error.message || "Analysis failed" },
            { status: 500 }
        );
    }
}
