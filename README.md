# Meet Minutes Pro

Instant, privacy-first AI meeting minutes from Google Meet live captions. Zero databases. Zero user API keys. Complete privacy.

**Stack**: Next.js 16 (App Router) · TypeScript · Tailwind CSS v4 · Gemini 2.5 Flash · Chrome Extension (MV3)

---

## How It Works (Privacy-First Audio-Mix Architecture)

Unlike standard SaaS platforms that store sensitive business meetings on centralized SQL databases, **Meet Minutes Pro** utilizes a fully decentralized, serverless architecture that prioritizes absolute confidentiality:

1. **Capture**: The extension captures standard tab audio (meeting audio) using an offscreen document and mixes it with your local microphone stream using the Web Audio API. 
2. **Speech-to-Text**: Audio chunks are sliced every 20 seconds and sent to our secure Vercel API `/api/transcribe`. It transcribes them using Groq Whisper (primary) or falls back to Gemini's native audio understanding (backup).
3. **AI Summarization**: On Stop, the extension requests a summary from `/api/summarize`, which compiles the transcript in a high-fidelity 3-stage intelligence pipeline using Llama 3.3 70B (primary) or Gemini 2.5 Flash (fallback).
4. **Instant Share Link**: The API returns the meeting minutes, which the extension base64-encodes and opens directly in the browser's URL hash (e.g. `https://your-vercel-url.vercel.app/result#<base64-markdown>`).
5. **Zero Logs**: Meeting text, transcripts, and summaries are **never** written to a database or disk, ensuring absolute client data confidentiality.

---

## Deployment & Setup Guide

### 1. Deploy the Web Portal to Vercel

The portal is a lightweight Next.js app inside the `/web` folder. 

1. Copy the environment template:
   ```bash
   cd web
   # Create a .env.local file:
   # GEMINI_API_KEY=your-api-key
   # GROQ_API_KEYS=key1,key2 (optional, comma-separated)
   ```
2. Populate the `GEMINI_API_KEY` in your environment. Get a free API key from [Google AI Studio](https://aistudio.google.com/).
3. Deploy to Vercel:
   - Go to [Vercel](https://vercel.com) and click **Add New** → **Project**.
   - Import the `/web` folder from your repository.
   - Configure the environment variables: `GEMINI_API_KEY=your-api-key`.
   - Click **Deploy** and copy your deployment URL (e.g., `https://meet-minutes-pro.vercel.app`).

### 2. Download pre-configured Chrome Extension
Our built-in Vercel packager automatically patches the extension with your specific Vercel deployment URL during compile time:
1. Open your deployed Vercel URL landing page in a browser.
2. Click **Download Extension ZIP (Free)** to download `meet-minutes-pro.zip`. (This zip file is already pre-configured to communicate with your deployment!).
3. Extract the ZIP file onto your local drive.
4. Open Google Chrome and navigate to `chrome://extensions`.
5. Toggle **"Developer mode"** ON in the top right.
6. Click **"Load unpacked"** in the top left and select the extracted directory.
7. Click the Chrome Puzzle icon and **Pin** "Meet Minutes Pro" to your extension bar!

---

## 3. Test the End-to-End Flow

1. Join or host a Google Meet tab.
2. Click the "Meet Minutes Pro" extension icon in your extension bar.
3. Click **Start Capture**. You will see the elapsed timer begin and the audio visualizer start to pulse. (If microphone permissions are missing, it will open the onboarding tab to request it first).
4. Speak or play audio on the call. The extension records and transcribes the meeting seamlessly.
5. When finished, click **Stop Capture**. The popup will show a "Summarizing..." progress loader overlay.
6. Within a few seconds, a new tab opens displaying your perfectly styled meeting minutes!

---

## Project Structure

```
meet_minutes_maker/
├── README.md
├── extension/                  # Chrome Extension (Vanilla JS)
│   ├── manifest.json           # Extension permissions and background config
│   ├── background.js           # Launch instruction guides and connection checks
│   ├── content.js              # Captures, speaker extracts, and dedups DOM captions
│   ├── popup.html              # Glassmorphic digital timers and start controls
│   ├── popup.js                # Core controller: fetches summarizer & opens rezult
│   ├── styles.css              # Vibrant purple glass backdrop styles
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── web/                        # Vercel Webapp (Next.js 16)
    ├── .env.example
    ├── vercel.json
    ├── package.json
    ├── tsconfig.json
    └── app/
        ├── layout.tsx          # Default dark mode Inter layout
        ├── globals.css         # Tailwind v4 globals and Print PDF styling
        ├── page.tsx            # Linear/Vercel styling Landing Page
        ├── result/
        │   └── page.tsx        # Notion-styled decoded minutes viewer & Print PDF
        └── api/
            └── summarize/
                └── route.ts    # Secure Gemini 2.5 Flash API with CORS
```

---

## Security & Rate Limiting

- **No Database Logs**: Absolute privacy. Your meeting data is fully ephemeral and disappears when the tab is closed.
- **In-Memory Rate Limiting**: The serverless Vercel API maintains an in-memory IP rate map, limiting requests to **max 20 per hour per IP** to prevent abuse.
- **Dynamic CORS Headers**: Supports secure, authorized API requests from Chrome Extensions only.

---

## License

MIT
