# 🏎 Tuner AI - The Amazon of Car Customization

Transform your car with AI-powered customization. Upload a photo, swap wheels, adjust stance, and visualize your dream build in seconds.

## 🎯 Vision

A digital playground where car culture meets high-precision AI. Solve "fitment anxiety" and "vision block" by transforming driveway photos into professional, modified renders using real-world parts.

## ✨ Features (MVP - Phase 1)

- **Guided Upload**: Auto-detect vehicle make/model/angle
- **Studio-fication**: AI-powered background removal and enhancement
- **Wheel & Stance Swapping**: Visualize modifications with real parts
- **Hero Platforms**: Porsche 911, Tesla Model 3/Y, Honda Civic Type R, Mazda Miata, VW GTI

## 🛠 Tech Stack

- **Frontend**: Next.js 15 (App Router), TypeScript, Tailwind CSS, Framer Motion
- **AI Pipeline**:
  - Vision Agent (vehicle detection)
  - SAM 2 (segmentation)
  - ControlNet (geometry lock)
  - Flux-1-Fill (generative fill)
  - IC-Light (relighting)
- **Storage**: Vercel Blob (images) + Supabase (user data)
- **Deployment**: Vercel

## 🚀 Getting Started

### Prerequisites

- Node.js 18+
- npm or yarn
- API keys for AI services (Replicate/Modal)

### Installation

1. Clone and install dependencies:
```bash
cd tuner-ai
npm install
```

2. Set up environment variables:
```bash
cp .env.example .env.local
# Edit .env.local with your API keys
```

3. Run the development server:
```bash
npm run dev
```

4. Open [http://localhost:3000](http://localhost:3000)

## 📁 Project Structure

```
tuner-ai/
├── app/
│   ├── api/
│   │   └── process-car/      # AI pipeline endpoint
│   ├── globals.css            # Automotive dark mode theme
│   └── page.tsx               # Landing page
├── components/
│   └── FileUpload.tsx         # Drag-and-drop upload component
├── .env.local                 # API keys (not in git)
└── .env.example               # Template for environment variables
```

## 🗺 Roadmap

### Phase 1 (MVP) ✅
- [x] Project scaffolding
- [x] Landing page with automotive aesthetic
- [x] File upload component
- [x] API route structure
- [ ] SAM 2 integration (Mission 2)
- [ ] Flux-1-Fill integration (Mission 3)

### Phase 2 (Dreamer)
- [ ] Environment swapping (Tokyo Nights, Track Day, Mountain Pass)
- [ ] Build Card social generator
- [ ] AI chat "Style My Car"

### Phase 3 (Monetization)
- [ ] Affiliate integration (eBay Partner Network)
- [ ] Direct dropshipping (Turn 14 API)
- [ ] Parts mapping system

## 🎨 Design Philosophy

**Automotive Dark Mode**: Racing-inspired aesthetic with red/orange accents, smooth animations, and high-contrast UI that puts your car front and center.

## 📝 Mission Progress

- ✅ Mission 1: Project Scaffolding (Complete)
- ⏳ Mission 2: Masking & Vision Integration (Next)
- ⏳ Mission 3: Flux-1-Fill Logic (Coming)

## 🤝 Contributing

This is a solo project in active development. Check back for contribution guidelines as the project matures.

## 📄 License

MIT License - See LICENSE file for details

---

**Built with Claude Code** | © 2025 TunerAI
