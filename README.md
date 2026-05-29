# Meet Minutes Pro

Instant, privacy-first AI meeting minutes from Google Meet live captions. Zero databases. Zero user API keys. Complete privacy.

**Stack**: Next.js 16 (App Router) · TypeScript · Tailwind CSS v4 · Gemini 2.5 Flash · Chrome Extension (MV3)

---

## How It Works (Privacy-First Architecture)

Unlike standard SaaS platforms that store sensitive business meetings on centralized SQL databases, **Meet Minutes Pro** utilizes a fully decentralized, serverless architecture that prioritizes absolute confidentiality:

1. **Capture**: The extension watches Google Meet live captions using a lightweight `MutationObserver` + fallback poll cycle.
2. **AI Generation**: On Stop, the extension calls our secure Vercel API `/api/summarize`. The server receives the text and queries Google Gemini in-memory.
3. **Instant Share Link**: The API returns the meeting minutes, which the extension base64-encodes and opens directly in the browser's URL hash (e.g. `https://your-vercel-url.vercel.app/result#<base64-markdown>`).
4. **Zero Logs**: The meeting text, transcripts, and summaries are **never** written to a database or disk, ensuring absolute client data confidentiality.

---

## Deployment & Setup Guide

### 1. Deploy the Web Portal to Vercel

The portal is a lightweight Next.js app inside the `/web` folder. 

1. Copy the environment template:
   ```bash
   cd web
   cp .env.example .env.local
   ```
2. Populate the `GEMINI_API_KEY` in your `.env.local` file. Get a free API key from [Google AI Studio](https://aistudio.google.com/).
3. Deploy to Vercel:
   - Go to [Vercel](https://vercel.com) and click **Add New** → **Project**.
   - Import the `/web` folder from your repository.
   - Configure the environment variable: `GEMINI_API_KEY=your-api-key`.
   - Click **Deploy** and copy your deployment URL (e.g., `https://meet-minutes-pro.vercel.app`).

---

## 2. Load the Chrome Extension

1. In the `/extension` folder, open `background.js` and `popup.js`.
2. Locate the `PORTAL_URL` constant at the top of each file and replace the placeholder with your deployed Vercel URL:
   ```javascript
   const PORTAL_URL = "https://your-vercel-app.vercel.app";
   ```
3. Open `manifest.json` in the `/extension` folder and update the host permission placeholder with your Vercel URL:
   ```json
   "host_permissions": [
     "https://meet.google.com/*",
     "https://your-vercel-app.vercel.app/*"
   ]
   ```
4. Open Google Chrome and navigate to `chrome://extensions`.
5. Toggle **"Developer mode"** ON in the top right.
6. Click **"Load unpacked"** in the top left and select the `/extension` directory of this repository.
7. Click the Chrome Puzzle icon and **Pin** "Meet Minutes Pro" to your extension bar!

---

## 3. Test the End-to-End Flow

1. Join or host a Google Meet tab.
2. Press **C** or click the Google Meet caption icon to enable live captions.
3. Click the "Meet Minutes Pro" extension icon in your extension bar. You will see a pulsing indicator showing that captions are ON/OFF.
4. Click **Start Capture**. You will see the elapse timer and line counter begin.
5. Have your meeting.
6. When finished, click **Stop Capture**. The popup will blur showing a gorgeous "Summarizing..." progress loader overlay.
7. Within 4 seconds, a new tab opens displaying your perfectly styled meeting minutes!

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
