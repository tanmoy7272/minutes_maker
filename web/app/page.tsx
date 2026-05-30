"use client";

import React, { useState } from "react";
import { 
  Download, 
  Pin, 
  Check, 
  Zap, 
  Clock, 
  FileText, 
  Copy, 
  ChevronDown, 
  ExternalLink,
  Shield,
  HelpCircle,
  Play,
  CheckSquare,
  Sparkles
} from "lucide-react";

export default function LandingPage() {
  const [copiedText, setCopiedText] = useState(false);
  const [activeFaq, setActiveFaq] = useState<number | null>(null);
  const [demoViewMode, setDemoViewMode] = useState<"document" | "board">("document");
  const [demoTasks, setDemoTasks] = useState([
    { id: 1, task: "Figma dashboard mocks", owner: "Alex", dueDate: "Monday", completed: false, gradient: "from-pink-500 to-rose-600" },
    { id: 2, task: "Finalize NextJS dashboard", owner: "Tanmoy", dueDate: "Monday", completed: false, gradient: "from-purple-500 to-indigo-600" }
  ]);

  const toggleDemoTask = (id: number) => {
    setDemoTasks(prev => prev.map(t => t.id === id ? { ...t, completed: !t.completed } : t));
  };

  const copyCommand = () => {
    navigator.clipboard.writeText("chrome://extensions");
    setCopiedText(true);
    setTimeout(() => setCopiedText(false), 2000);
  };

  const toggleFaq = (index: number) => {
    setActiveFaq(activeFaq === index ? null : index);
  };

  const faqs = [
    {
      q: "Is it free?",
      a: "Yes, Meet Minutes Pro is 100% free. There are no paid tiers, no subscription models, and no hidden fees."
    },
    {
      q: "Where is my data stored?",
      a: "Your privacy is our priority. We do not use any database or authentication system. Transcripts are sent to a secure API, summarized instantly in memory, and sent directly to your browser's address bar as an encoded hash. Your meeting data is never saved, tracked, or shared."
    },
    {
      q: "Do I need an API key?",
      a: "No! Unlike standard DIY Chrome extensions, we host a secure server-side endpoint that handles all AI processing under the hood. You don't need to create a Google AI Studio account, generate any Gemini API keys, or deal with any technical configurations."
    },
    {
      q: "Do I need to enable Google Meet captions?",
      a: "No, you don't need to do anything! Our advanced engine captures high-fidelity digital audio directly from the meeting tab and mixes it with your microphone. You can record and transcribe the entire call without ever turning on Google Meet captions."
    }
  ];

  return (
    <div className="relative min-h-screen overflow-hidden">
      {/* Visual background accents */}
      <div className="absolute top-[-10%] left-[-20%] w-[60%] h-[50%] rounded-full bg-purple-900/10 blur-[150px] animate-pulse-slow pointer-events-none" />
      <div className="absolute top-[20%] right-[-10%] w-[50%] h-[50%] rounded-full bg-indigo-900/10 blur-[150px] animate-pulse-slow pointer-events-none" />

      {/* Header / Nav */}
      <header className="sticky top-0 z-50 w-full border-b border-white/[0.05] bg-[#030303]/70 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between p-4 px-6 md:px-8">
          <div className="flex items-center gap-3">
            <div className="relative flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-tr from-purple-600 to-indigo-600 shadow-[0_0_20px_rgba(139,92,246,0.3)]">
              <Zap className="h-5 w-5 text-white" />
            </div>
            <div>
              <span className="bg-gradient-to-r from-white to-slate-400 bg-clip-text font-bold text-lg tracking-tight text-transparent">
                Meet Minutes Pro
              </span>
              <span className="ml-2 rounded-full border border-purple-500/30 bg-purple-500/15 px-2 py-0.5 text-[10px] font-semibold text-purple-300">
                v1.2
              </span>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <a 
              href="#install-guide" 
              className="text-sm font-medium text-slate-300 transition-colors hover:text-white"
            >
              How to Install
            </a>
            <a 
              href="#how-it-works"
              className="hidden text-sm font-medium text-slate-300 transition-colors hover:text-white sm:block"
            >
              How it works
            </a>
            <a
              href="https://github.com/tanmoy7272/minutes_maker"
              target="_blank"
              rel="noreferrer"
              className="rounded-full border border-white/10 bg-white/5 p-2 text-slate-400 transition-all hover:bg-white/10 hover:text-white"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" className="h-4 w-4"><path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4"></path><path d="M9 18c-4.51 2-5-2-7-2"></path></svg>
            </a>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="mx-auto max-w-7xl px-6 pt-20 pb-16 text-center md:px-8 md:pt-32 md:pb-24">
        <div className="mx-auto max-w-3xl">
          <div className="inline-flex items-center gap-2 rounded-full border border-purple-500/30 bg-purple-500/10 px-3 py-1 text-xs text-purple-300 backdrop-blur-sm">
            <Zap className="h-3 w-5 animate-pulse" />
            <span>Instant Meeting Summary In 4 Seconds</span>
          </div>
          
          <h1 className="mt-8 bg-gradient-to-b from-white via-slate-100 to-slate-400 bg-clip-text text-4xl font-extrabold tracking-tight text-transparent sm:text-6xl md:text-7xl leading-[1.1]">
            Turn Google Meet into perfect minutes <br className="hidden md:block"/> in 4 seconds
          </h1>
          
          <p className="mt-6 text-lg text-slate-400 sm:text-xl max-w-2xl mx-auto">
            Zero databases. Zero user API keys. Absolute privacy. Mix tab audio and your microphone in high-fidelity to generate beautifully formatted Markdown summaries instantly.
          </p>

          <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
            <a
              href="#install-guide"
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-tr from-purple-600 to-indigo-600 px-6 py-3.5 text-sm font-semibold text-white shadow-lg transition-all hover:scale-[1.02] hover:shadow-purple-500/20 active:scale-[0.98] sm:w-auto"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" className="h-5 w-5"><circle cx="12" cy="12" r="10"></circle><circle cx="12" cy="12" r="4"></circle><line x1="21.17" y1="8" x2="12" y2="8"></line><line x1="3.95" y1="6.06" x2="8.54" y2="14"></line><line x1="10.88" y1="21.94" x2="15.46" y2="14"></line></svg>
              Install for Chrome (Free)
            </a>
            <a
              href="#how-it-works"
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-6 py-3.5 text-sm font-semibold text-slate-300 transition-all hover:bg-white/10 hover:text-white sm:w-auto"
            >
              <Play className="h-4 w-4" />
              See how it works
            </a>
          </div>
        </div>

        {/* Demo UI Mockup */}
        <div className="mt-16 sm:mt-24 relative rounded-2xl border border-white/10 bg-slate-950/40 p-2 shadow-2xl backdrop-blur-sm max-w-5xl mx-auto">
          <div className="absolute inset-0 rounded-2xl bg-gradient-to-tr from-purple-500/10 via-transparent to-indigo-500/10 pointer-events-none" />
          <div className="rounded-xl overflow-hidden border border-white/[0.08] bg-[#0c0c14] p-4 text-left">
            <div className="flex items-center justify-between border-b border-white/[0.05] pb-3 mb-4">
              <div className="flex items-center gap-2">
                <div className="h-3 w-3 rounded-full bg-red-500" />
                <div className="h-3 w-3 rounded-full bg-yellow-500" />
                <div className="h-3 w-3 rounded-full bg-green-500" />
              </div>
              
              {/* Tab Switcher for Interactive Demo */}
              <div className="flex bg-white/5 p-0.5 rounded-lg border border-white/10 text-[10px] font-semibold">
                <button
                  onClick={() => setDemoViewMode("document")}
                  className={`px-2.5 py-1 rounded transition-all ${
                    demoViewMode === "document" 
                      ? "bg-purple-600 text-white shadow-md" 
                      : "text-slate-400 hover:text-white"
                  }`}
                >
                  Document View
                </button>
                <button
                  onClick={() => setDemoViewMode("board")}
                  className={`px-2.5 py-1 rounded transition-all ${
                    demoViewMode === "board" 
                      ? "bg-purple-600 text-white shadow-md" 
                      : "text-slate-400 hover:text-white"
                  }`}
                >
                  Interactive Board
                </button>
              </div>

              <div className="rounded-lg bg-white/5 px-4 py-1 text-xs text-slate-400 hidden sm:block">
                meet-minutes-pro.vercel.app/result#encoded-minutes
              </div>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="col-span-1 rounded-xl bg-white/[0.02] border border-white/[0.05] p-4">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-purple-400 animate-pulse" />
                  Live Audio Ingested
                </h4>
                <div className="mt-3 space-y-3 font-mono text-[11px] text-slate-400">
                  <p className="border-l-2 border-purple-500/30 pl-2 py-0.5">
                    <span className="text-purple-400 font-bold">[10:04:12] Tanmoy:</span> Let's finalize the NextJS dashboard layout by Monday.
                  </p>
                  <p className="border-l-2 border-purple-500/30 pl-2 py-0.5">
                    <span className="text-purple-400 font-bold">[10:04:30] Alex:</span> Sure, I will take care of creating the Figma mocks.
                  </p>
                  <p className="border-l-2 border-purple-500/30 pl-2 py-0.5">
                    <span className="text-purple-400 font-bold">[10:05:02] Sarah:</span> Excellent. We also decided to avoid any SQL database to protect client privacy.
                  </p>
                </div>
              </div>
              
              <div className="col-span-2 rounded-xl border border-white/[0.05] bg-slate-950/60 p-5">
                <div className="flex items-center justify-between border-b border-white/[0.05] pb-2 mb-3">
                  <h3 className="font-bold text-sm text-slate-200 flex items-center gap-1.5">
                    🚀 Sprint Planning Meeting
                  </h3>
                  <div className="flex gap-1.5">
                    <div className="h-2 w-2 rounded-full bg-purple-500" />
                    <div className="h-2 w-2 rounded-full bg-indigo-500" />
                  </div>
                </div>

                {demoViewMode === "document" ? (
                  <div className="space-y-4 text-xs animate-fade-in">
                    <div>
                      <h4 className="text-purple-400 font-semibold mb-1">## Summary</h4>
                      <p className="text-slate-300 leading-relaxed">The team held a sprint planning session focusing on the new portal dashboard layout and data storage. Alex will design Figma mocks, while the team agreed to proceed with a fully serverless, zero-database architecture to maximize privacy.</p>
                    </div>
                    <div>
                      <h4 className="text-emerald-400 font-semibold mb-1">## Decisions</h4>
                      <ul className="list-disc pl-4 text-slate-300 space-y-1">
                        <li>Use a client-side hash based architecture instead of an SQL database for meetings. <span className="text-[10px] text-emerald-400 font-semibold border border-emerald-500/30 bg-emerald-500/10 px-1 py-0.5 rounded">10:05:02</span></li>
                      </ul>
                    </div>
                    <div>
                      <h4 className="text-blue-400 font-semibold mb-1">## Action Items</h4>
                      <ul className="list-disc pl-4 text-slate-300 space-y-1">
                        <li>Figma dashboards mocks — Owner: Alex — Due: Monday <span className="text-[10px] text-blue-400 font-semibold border border-blue-500/30 bg-blue-500/10 px-1 py-0.5 rounded">10:04:30</span></li>
                        <li>Finalize NextJS dashboard — Owner: Tanmoy — Due: Monday <span className="text-[10px] text-blue-400 font-semibold border border-blue-500/30 bg-blue-500/10 px-1 py-0.5 rounded">10:04:12</span></li>
                      </ul>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4 text-xs animate-fade-in">
                    {/* Tiny Progress Tracker inside Demo Mockup */}
                    <div className="rounded-lg border border-blue-500/10 bg-gradient-to-r from-blue-950/20 to-emerald-950/20 p-2.5">
                      <div className="flex justify-between items-center text-[10px] mb-1.5 font-bold">
                        <span className="text-blue-400 uppercase tracking-widest flex items-center gap-1">
                          <CheckSquare className="h-3 w-3" />
                          Progress Tracker
                        </span>
                        <span className="text-slate-300">
                          {demoTasks.filter(t => t.completed).length} of {demoTasks.length} tasks ({Math.round((demoTasks.filter(t => t.completed).length / demoTasks.length) * 100)}%)
                        </span>
                      </div>
                      <div className="h-1.5 w-full bg-slate-900 rounded-full overflow-hidden p-[1px]">
                        <div 
                          className="h-full bg-gradient-to-r from-blue-500 to-emerald-500 rounded-full transition-all duration-300 shadow-[0_0_8px_rgba(59,130,246,0.5)]" 
                          style={{ width: `${(demoTasks.filter(t => t.completed).length / demoTasks.length) * 100}%` }}
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {demoTasks.map(t => (
                        <div 
                          key={t.id} 
                          className={`rounded-lg border p-2.5 transition-all duration-300 ${
                            t.completed 
                              ? "border-white/5 bg-white/[0.01] opacity-50" 
                              : "border-blue-500/10 bg-blue-950/5 hover:bg-blue-950/10 hover:border-blue-500/20 hover:shadow-lg hover:shadow-blue-500/5"
                          }`}
                        >
                          <div className="flex items-start gap-2">
                            <button 
                              onClick={() => toggleDemoTask(t.id)}
                              className="text-blue-400 mt-0.5 cursor-pointer"
                            >
                              {t.completed ? (
                                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" className="h-4.5 w-4.5"><polyline points="20 6 9 17 4 12"></polyline></svg>
                              ) : (
                                <div className="h-4 w-4 border border-slate-500 rounded hover:border-blue-400 transition-colors" />
                              )}
                            </button>
                            <div className="flex-1 min-w-0">
                              <h5 className={`font-bold text-xs text-white leading-snug truncate ${t.completed ? "line-through text-slate-500" : ""}`}>
                                {t.task}
                              </h5>
                              <div className="mt-2 flex items-center gap-1.5">
                                <div className={`h-4.5 w-4.5 rounded-full bg-gradient-to-tr ${t.gradient} flex items-center justify-center font-black text-[7px] text-white`}>
                                  {t.owner.charAt(0)}
                                </div>
                                <span className="text-[9px] text-slate-400 font-bold">{t.owner}</span>
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* How It Works Section */}
      <section id="how-it-works" className="mx-auto max-w-7xl px-6 py-20 border-t border-white/[0.05] md:px-8 md:py-32">
        <div className="text-center">
          <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
            How it works in 3 steps
          </h2>
          <p className="mt-4 text-slate-400 max-w-xl mx-auto">
            Get perfect meeting records without breaking your workflow. Simple, elegant, fast.
          </p>
        </div>

        <div className="mt-16 grid grid-cols-1 gap-8 md:grid-cols-3">
          {/* Step 1 */}
          <div className="group rounded-2xl border border-white/10 bg-slate-950/40 p-8 hover:border-purple-500/30 transition-all hover:bg-slate-950/60 duration-300">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-purple-500/10 text-purple-400 border border-purple-500/20 group-hover:scale-110 transition-transform">
              <Download className="h-6 w-6" />
            </div>
            <h3 className="mt-6 text-xl font-bold text-white">1. Install</h3>
            <p className="mt-3 text-slate-400 leading-relaxed text-sm">
              Download the unpacked extension. Load it into your Chrome browser in less than a minute. No registration required.
            </p>
            {/* Step illustration */}
            <div className="mt-6 rounded-lg bg-black/40 border border-white/5 p-4 flex items-center justify-center h-28">
              <div className="flex flex-col items-center">
                <div className="h-10 w-10 rounded-lg bg-purple-500/15 border border-purple-500/30 flex items-center justify-center animate-bounce">
                  <Download className="h-5 w-5 text-purple-400" />
                </div>
                <span className="mt-2.5 font-mono text-[10px] text-slate-500">meet_minutes_pro.zip</span>
              </div>
            </div>
          </div>

          {/* Step 2 */}
          <div className="group rounded-2xl border border-white/10 bg-slate-950/40 p-8 hover:border-indigo-500/30 transition-all hover:bg-slate-950/60 duration-300">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 group-hover:scale-110 transition-transform">
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" className="h-6 w-6"><circle cx="12" cy="12" r="10"></circle><circle cx="12" cy="12" r="4"></circle><line x1="21.17" y1="8" x2="12" y2="8"></line><line x1="3.95" y1="6.06" x2="8.54" y2="14"></line><line x1="10.88" y1="21.94" x2="15.46" y2="14"></line></svg>
            </div>
            <h3 className="mt-6 text-xl font-bold text-white">2. Capture</h3>
            <p className="mt-3 text-slate-400 leading-relaxed text-sm">
              Open Google Meet, open the extension popup and click "Start Capture". The extension records the meeting tab audio output and mixes it with your microphone automatically!
            </p>
            {/* Step illustration */}
            <div className="mt-6 rounded-lg bg-black/40 border border-white/5 p-4 flex flex-col justify-center h-28">
              <div className="flex items-center justify-between border-b border-white/5 pb-2 mb-2">
                <div className="flex gap-1">
                  <div className="h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse" />
                  <span className="text-[8px] text-slate-500 font-mono">CAPTURING</span>
                </div>
                <span className="text-[10px] text-emerald-400 border border-emerald-500/20 bg-emerald-500/10 px-1 rounded font-bold">Audio Mixed</span>
              </div>
              <div className="space-y-1.5">
                <div className="h-2 w-[70%] bg-slate-800 rounded-full" />
                <div className="h-2 w-[85%] bg-slate-800 rounded-full" />
              </div>
            </div>
          </div>

          {/* Step 3 */}
          <div className="group rounded-2xl border border-white/10 bg-slate-950/40 p-8 hover:border-pink-500/30 transition-all hover:bg-slate-950/60 duration-300">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-pink-500/10 text-pink-400 border border-pink-500/20 group-hover:scale-110 transition-transform">
              <Zap className="h-6 w-6" />
            </div>
            <h3 className="mt-6 text-xl font-bold text-white">3. Get Minutes</h3>
            <p className="mt-3 text-slate-400 leading-relaxed text-sm">
              Press "Stop Capture". The extension runs it through our secure AI processor, creating a base64 link that renders your formatted minutes instantly.
            </p>
            {/* Step illustration */}
            <div className="mt-6 rounded-lg bg-black/40 border border-white/5 p-4 flex items-center justify-center h-28">
              <div className="relative rounded-lg border border-purple-500/30 bg-purple-500/10 px-4 py-2 text-xs font-semibold text-purple-300 animate-pulse">
                ✨ Generating perfect minutes...
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Manual Install Guide */}
      <section id="install-guide" className="mx-auto max-w-7xl px-6 py-20 border-t border-white/[0.05] md:px-8 md:py-32">
        <div className="text-center">
          <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
            Manual Installation Guide
          </h2>
          <p className="mt-4 text-slate-400 max-w-xl mx-auto">
            Since Meet Minutes Pro respects user privacy and runs with zero database storage, loading it unpacked takes less than 60 seconds.
          </p>
        </div>

        <div className="mt-16 grid grid-cols-1 gap-8 lg:grid-cols-3 max-w-5xl mx-auto">
          {/* Step 1 */}
          <div className="relative border border-white/10 bg-slate-950/30 rounded-2xl p-6">
            <div className="absolute top-4 right-4 text-4xl font-black text-white/5 font-mono select-none">01</div>
            <div className="h-9 w-9 rounded-lg bg-purple-500/10 text-purple-400 border border-purple-500/20 flex items-center justify-center font-bold text-sm mb-4">1</div>
            <h4 className="text-lg font-bold text-white">Download the Extension Zip</h4>
            <p className="mt-2 text-sm text-slate-400">
              Download the repository files as a ZIP by clicking the button below, then extract the folder onto your local drive.
            </p>
            <div className="mt-6">
              <a 
                href="/meet-minutes-pro.zip" 
                download
                className="inline-flex items-center gap-2 text-xs font-semibold text-purple-400 hover:text-purple-300 group"
              >
                Download Extension ZIP (Free)
                <Download className="h-3.5 w-3.5 transition-transform group-hover:translate-y-0.5" />
              </a>
            </div>
          </div>

          {/* Step 2 */}
          <div className="relative border border-white/10 bg-slate-950/30 rounded-2xl p-6">
            <div className="absolute top-4 right-4 text-4xl font-black text-white/5 font-mono select-none">02</div>
            <div className="h-9 w-9 rounded-lg bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 flex items-center justify-center font-bold text-sm mb-4">2</div>
            <h4 className="text-lg font-bold text-white">Enable Developer Mode</h4>
            <p className="mt-2 text-sm text-slate-400">
              Open Google Chrome, navigate to the extensions page by copying the path, and toggle <strong className="text-white">"Developer mode"</strong> ON in the top right.
            </p>
            
            {/* Copy Command */}
            <div className="mt-4 flex items-center justify-between rounded-lg bg-black/40 border border-white/5 p-2 font-mono text-xs">
              <span className="text-purple-300">chrome://extensions</span>
              <button 
                onClick={copyCommand}
                className="p-1 rounded bg-white/5 text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
                title="Copy address"
              >
                {copiedText ? <Check className="h-3.5 w-3.5 text-green-400" /> : <Copy className="h-3.5 w-3.5" />}
              </button>
            </div>
          </div>

          {/* Step 3 */}
          <div className="relative border border-white/10 bg-slate-950/30 rounded-2xl p-6">
            <div className="absolute top-4 right-4 text-4xl font-black text-white/5 font-mono select-none">03</div>
            <div className="h-9 w-9 rounded-lg bg-pink-500/10 text-pink-400 border border-pink-500/20 flex items-center justify-center font-bold text-sm mb-4">3</div>
            <h4 className="text-lg font-bold text-white">Load Unpacked & Pin</h4>
            <p className="mt-2 text-sm text-slate-400">
              Click <strong className="text-white">"Load unpacked"</strong> in the top left, select the extracted <code className="text-purple-300">/extension</code> folder from Step 1, and pin <strong className="text-white">Meet Minutes Pro</strong> to your extension bar!
            </p>
            <div className="mt-6 flex items-center gap-2 font-mono text-[10px] text-slate-500">
              <Pin className="h-3.5 w-3.5 text-pink-400" />
              <span>Pin for quick start control panel access</span>
            </div>
          </div>
        </div>
      </section>

      {/* Features Grid */}
      <section className="mx-auto max-w-7xl px-6 py-20 border-t border-white/[0.05] md:px-8 md:py-32">
        <div className="text-center">
          <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
            Designed for privacy, built for speed
          </h2>
          <p className="mt-4 text-slate-400 max-w-xl mx-auto">
            Everything you need for clean documentation without bloated databases.
          </p>
        </div>

        <div className="mt-16 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4 max-w-5xl mx-auto">
          {/* Feature 1 */}
          <div className="rounded-xl border border-white/5 bg-slate-950/20 p-6 hover:bg-slate-950/40 hover:border-white/10 transition-all duration-300">
            <div className="h-10 w-10 rounded-lg bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-400 mb-4">
              <Clock className="h-5 w-5" />
            </div>
            <h4 className="text-base font-bold text-white">Auto Timestamps</h4>
            <p className="mt-2 text-sm text-slate-400">
              Captures precise time markers for decisions and actions directly from the meeting flow.
            </p>
          </div>

          {/* Feature 2 */}
          <div className="rounded-xl border border-white/5 bg-slate-950/20 p-6 hover:bg-slate-950/40 hover:border-white/10 transition-all duration-300">
            <div className="h-10 w-10 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 mb-4">
              <Zap className="h-5 w-5" />
            </div>
            <h4 className="text-base font-bold text-white">Action Items</h4>
            <p className="mt-2 text-sm text-slate-400">
              Infers responsible owners and deadlines for each item so work gets tracked seamlessly.
            </p>
          </div>

          {/* Feature 3 */}
          <div className="rounded-xl border border-white/5 bg-slate-950/20 p-6 hover:bg-slate-950/40 hover:border-white/10 transition-all duration-300">
            <div className="h-10 w-10 rounded-lg bg-pink-500/10 border border-pink-500/20 flex items-center justify-center text-pink-400 mb-4">
              <Shield className="h-5 w-5" />
            </div>
            <h4 className="text-base font-bold text-white">100% Secure</h4>
            <p className="mt-2 text-sm text-slate-400">
              Your audio or transcripts never live on a database. Meeting summaries exist solely in your browser tab.
            </p>
          </div>

          {/* Feature 4 */}
          <div className="rounded-xl border border-white/5 bg-slate-950/20 p-6 hover:bg-slate-950/40 hover:border-white/10 transition-all duration-300">
            <div className="h-10 w-10 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 mb-4">
              <FileText className="h-5 w-5" />
            </div>
            <h4 className="text-base font-bold text-white">Share Everywhere</h4>
            <p className="mt-2 text-sm text-slate-400">
              Export to clean markdown, copy to Clipboard instantly, or print straight to PDF for clean archives.
            </p>
          </div>
        </div>
      </section>

      {/* FAQ Section */}
      <section className="mx-auto max-w-4xl px-6 py-20 border-t border-white/[0.05] md:py-32">
        <div className="text-center">
          <HelpCircle className="mx-auto h-10 w-10 text-purple-400 mb-4" />
          <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
            Frequently Asked Questions
          </h2>
          <p className="mt-4 text-slate-400">
            Got questions? We've got answers.
          </p>
        </div>

        <div className="mt-12 space-y-4 max-w-2xl mx-auto">
          {faqs.map((faq, idx) => (
            <div 
              key={idx}
              className="rounded-xl border border-white/5 bg-slate-950/30 overflow-hidden transition-all duration-200"
            >
              <button
                onClick={() => toggleFaq(idx)}
                className="flex w-full items-center justify-between p-5 text-left font-semibold text-white hover:bg-white/[0.02]"
              >
                <span>{faq.q}</span>
                <ChevronDown className={`h-4 w-4 text-slate-400 transition-transform duration-200 ${activeFaq === idx ? "rotate-180 text-purple-400" : ""}`} />
              </button>
              
              <div 
                className={`transition-all duration-300 ease-in-out ${
                  activeFaq === idx 
                    ? "max-h-60 border-t border-white/5 opacity-100 p-5 text-slate-400 text-sm leading-relaxed" 
                    : "max-h-0 opacity-0 overflow-hidden"
                }`}
              >
                {faq.a}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/[0.05] bg-[#030303]">
        <div className="mx-auto max-w-7xl px-6 py-12 flex flex-col md:flex-row items-center justify-between gap-6 md:px-8">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-tr from-purple-600 to-indigo-600">
              <Zap className="h-4 w-4 text-white" />
            </div>
            <span className="font-bold text-sm text-slate-200">Meet Minutes Pro</span>
          </div>
          
          <p className="text-xs text-slate-500">
            © {new Date().getFullYear()} Meet Minutes Pro. All rights reserved. Zero-data architecture.
          </p>

          <div className="flex items-center gap-4 text-xs text-slate-400">
            <a href="https://github.com/tanmoy7272/minutes_maker" target="_blank" rel="noreferrer" className="flex items-center gap-1 hover:text-white transition-colors">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" className="h-4 w-4"><path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4"></path><path d="M9 18c-4.51 2-5-2-7-2"></path></svg>
              GitHub
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
