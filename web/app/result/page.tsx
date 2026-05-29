"use client";

import React, { useEffect, useState } from "react";
import { 
  Copy, 
  Download, 
  Printer, 
  Check, 
  Zap, 
  Calendar, 
  ArrowLeft,
  FileText,
  Clock,
  Sparkles,
  Edit2
} from "lucide-react";
import confetti from "canvas-confetti";

export default function ResultPage() {
  const [mounted, setMounted] = useState(false);
  const [markdown, setMarkdown] = useState("");
  const [meetingTitle, setMeetingTitle] = useState("Meeting Minutes Pro");
  const [meetingDate, setMeetingDate] = useState("");
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setMounted(true);
    setMeetingDate(new Date().toLocaleDateString("en-US", {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    }));

    if (typeof window !== "undefined") {
      const handleHashChange = () => {
        const hash = window.location.hash;
        if (hash && hash.length > 1) {
          try {
            const encoded = hash.substring(1);
            // safe UTF-8 decoding
            const decoded = decodeURIComponent(escape(atob(encoded)));
            setMarkdown(decoded);

            // Infer title from first line if it's a h1 header
            const titleMatch = decoded.match(/^#\s+(.+)$/m);
            if (titleMatch && titleMatch[1]) {
              setMeetingTitle(titleMatch[1].trim());
            }

            // Confetti blast!
            setTimeout(() => {
              confetti({
                particleCount: 120,
                spread: 80,
                origin: { y: 0.3 },
                colors: ["#8b5cf6", "#6366f1", "#3b82f6", "#10b981", "#fbbf24"]
              });
            }, 300);
          } catch (e) {
            console.error("Base64 decoding failed:", e);
          }
        } else {
          setMarkdown("");
        }
      };

      handleHashChange();
      window.addEventListener("hashchange", handleHashChange);
      return () => window.removeEventListener("hashchange", handleHashChange);
    }
  }, []);

  const handleCopy = () => {
    if (!markdown) return;
    navigator.clipboard.writeText(markdown);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    if (!markdown) return;
    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    
    // Format title for filename
    const sanitizedTitle = meetingTitle
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "");
      
    link.setAttribute("download", `${sanitizedTitle || "meeting"}-minutes.md`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handlePrint = () => {
    if (typeof window !== "undefined") {
      window.print();
    }
  };

  // Helper to parse and render styled markdown elements with custom pills and section classes
  const renderFormattedMarkdown = (rawMarkdown: string) => {
    if (!rawMarkdown) return null;

    // Clean up title header if we are already displaying it at the top
    let content = rawMarkdown;
    if (content.startsWith("# ")) {
      const lines = content.split("\n");
      lines.shift(); // remove first header line
      content = lines.join("\n");
    }

    // Split markdown into logical blocks to parse
    const blocks = content.split(/\n(?=##\s+)/);

    return blocks.map((block, idx) => {
      const trimmedBlock = block.trim();
      if (!trimmedBlock) return null;

      // Identify section type
      let sectionClass = "border-l-4 border-slate-700 pl-4 py-1 my-6";
      let sectionStyleType = "default";
      let headerText = "";

      if (trimmedBlock.startsWith("## Summary")) {
        sectionClass = "result-section-summary";
        sectionStyleType = "summary";
        headerText = "Summary";
      } else if (trimmedBlock.startsWith("## Decisions")) {
        sectionClass = "result-section-decisions";
        sectionStyleType = "decisions";
        headerText = "Decisions";
      } else if (trimmedBlock.startsWith("## Action Items")) {
        sectionClass = "result-section-action-items";
        sectionStyleType = "action-items";
        headerText = "Action Items";
      } else if (trimmedBlock.startsWith("## Key Points")) {
        sectionClass = "result-section-key-points";
        sectionStyleType = "key-points";
        headerText = "Key Points";
      } else {
        // Generic double header
        const headerMatch = trimmedBlock.match(/^##\s+(.+)$/m);
        if (headerMatch) {
          headerText = headerMatch[1].trim();
        }
      }

      // Extract content lines skipping the ## header line itself
      const lines = trimmedBlock.split("\n");
      if (lines[0].startsWith("## ")) {
        lines.shift();
      }
      const sectionContent = lines.join("\n").trim();

      // Render lines within this section
      const renderedLines = sectionContent.split("\n").map((line, lineIdx) => {
        let text = line.trim();
        if (!text) return <div key={lineIdx} className="h-2" />;

        // Check if list bullet
        const isBullet = text.startsWith("- ") || text.startsWith("* ");
        if (isBullet) {
          text = text.substring(2);
        }

        // Format bold text (**text**)
        let formattedText: React.ReactNode[] = [];
        const boldRegex = /\*\*([^*]+)\*\*/g;
        let lastIndex = 0;
        let match;

        // Extract timestamps like [00:12:34] or (00:12:34) or 00:12:34
        const timestampRegex = /(\[?\b\d{2}:\d{2}:\d{2}\b\]?)/g;

        // Process bold tags and then process timestamps inside the segments
        const processTextSegments = (rawSegment: string, segmentKey: string) => {
          const parts = rawSegment.split(timestampRegex);
          return parts.map((part, pIdx) => {
            const timeMatch = part.match(/\[?(\d{2}:\d{2}:\d{2})\]?/);
            if (timeMatch && timeMatch[1]) {
              let pillColor = "timestamp-pill";
              if (sectionStyleType === "decisions") pillColor = "timestamp-pill timestamp-pill-green";
              if (sectionStyleType === "key-points") pillColor = "timestamp-pill timestamp-pill-amber";
              
              return (
                <span key={`${segmentKey}-${pIdx}`} className={`${pillColor} transition-transform hover:scale-105 cursor-default`}>
                  <Clock className="h-3 w-3 mr-1 inline" />
                  {timeMatch[1]}
                </span>
              );
            }
            return part;
          });
        };

        let boldCounter = 0;
        while ((match = boldRegex.exec(text)) !== null) {
          const plainPart = text.substring(lastIndex, match.index);
          const boldPart = match[1];
          
          if (plainPart) {
            formattedText.push(...processTextSegments(plainPart, `plain-${boldCounter}`));
          }
          formattedText.push(
            <strong key={`bold-${boldCounter}`} className="text-white font-bold">
              {boldPart}
            </strong>
          );
          
          lastIndex = boldRegex.lastIndex;
          boldCounter++;
        }
        
        const remainingPart = text.substring(lastIndex);
        if (remainingPart) {
          formattedText.push(...processTextSegments(remainingPart, `plain-end`));
        }

        // Render bullet list item or paragraph
        if (isBullet) {
          return (
            <li key={lineIdx} className="text-slate-300 leading-relaxed text-sm mb-2 list-none flex items-start">
              <span className="text-purple-400 mr-2.5 mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-purple-400" />
              <span className="flex-1">{formattedText}</span>
            </li>
          );
        } else {
          return (
            <p key={lineIdx} className="text-slate-300 leading-relaxed text-sm mb-3">
              {formattedText}
            </p>
          );
        }
      });

      return (
        <div key={idx} className={`${sectionClass} print-colored-border`}>
          {headerText && (
            <h3 className="text-base font-bold tracking-tight text-white mb-2 uppercase tracking-wide flex items-center gap-2">
              <span className={`h-1.5 w-1.5 rounded-full ${
                sectionStyleType === "summary" ? "bg-purple-400" :
                sectionStyleType === "decisions" ? "bg-emerald-400" :
                sectionStyleType === "action-items" ? "bg-blue-400" : "bg-amber-400"
              }`} />
              {headerText}
            </h3>
          )}
          <div className="pl-1">
            {renderedLines}
          </div>
        </div>
      );
    });
  };

  if (!mounted) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#030303] text-slate-400 font-mono text-xs">
        Loading...
      </div>
    );
  }

  // Empty state if no markdown is decoded
  if (!markdown) {
    return (
      <div className="relative flex min-h-screen flex-col items-center justify-center px-4">
        <div className="absolute top-[-10%] w-[50%] h-[50%] rounded-full bg-purple-900/10 blur-[150px] pointer-events-none" />
        <div className="mx-auto flex max-w-md flex-col items-center text-center">
          <div className="relative flex h-16 w-16 items-center justify-center rounded-2xl bg-white/5 border border-white/10 text-purple-400 mb-6 shadow-xl">
            <Sparkles className="h-8 w-8 animate-pulse" />
          </div>
          <h2 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
            No Meeting Minutes Detected
          </h2>
          <p className="mt-3 text-slate-400 text-sm leading-relaxed">
            Please host or join a Google Meet, open our extension popup, activate caption capture, and press "Stop Capture" when finished to view your structured meeting minutes here.
          </p>
          <div className="mt-8 flex flex-col gap-3 w-full sm:flex-row">
            <a
              href="/"
              className="flex items-center justify-center gap-2 rounded-xl bg-white/5 border border-white/10 px-5 py-3 text-xs font-semibold text-slate-300 transition-all hover:bg-white/10 hover:text-white w-full sm:w-auto"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to Home
            </a>
            <a
              href="/#install-guide"
              className="flex items-center justify-center gap-2 rounded-xl bg-gradient-to-tr from-purple-600 to-indigo-600 px-5 py-3 text-xs font-semibold text-white shadow-lg transition-all hover:scale-[1.02] w-full sm:w-auto"
            >
              <FileText className="h-4 w-4" />
              Installation Guide
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen py-10 px-4 sm:px-6 lg:px-8">
      {/* Back button */}
      <div className="mx-auto max-w-3xl mb-6 no-print">
        <a 
          href="/" 
          className="inline-flex items-center gap-2 text-xs font-semibold text-slate-400 hover:text-white transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to Home
        </a>
      </div>

      <main className="mx-auto max-w-3xl rounded-2xl border border-white/10 bg-slate-950/40 p-6 sm:p-8 shadow-2xl backdrop-blur-md print-card">
        {/* Top Control Bar */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between border-b border-white/[0.08] pb-6 mb-6 gap-4 no-print">
          <div className="flex-1">
            <div className="flex items-center gap-2">
              {isEditingTitle ? (
                <input
                  type="text"
                  value={meetingTitle}
                  onChange={(e) => setMeetingTitle(e.target.value)}
                  onBlur={() => setIsEditingTitle(false)}
                  onKeyDown={(e) => e.key === "Enter" && setIsEditingTitle(false)}
                  className="bg-white/5 border border-purple-500/50 rounded-lg px-2.5 py-1 text-xl font-extrabold text-white focus:outline-none focus:ring-1 focus:ring-purple-500 w-full"
                  autoFocus
                />
              ) : (
                <div className="flex items-center gap-2 group">
                  <h1 className="text-xl font-extrabold tracking-tight text-white">
                    {meetingTitle}
                  </h1>
                  <button 
                    onClick={() => setIsEditingTitle(true)}
                    className="p-1 rounded text-slate-500 hover:text-white hover:bg-white/5 transition-colors opacity-0 group-hover:opacity-100"
                    title="Rename"
                  >
                    <Edit2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
            </div>
            
            <div className="flex items-center gap-2 mt-2 font-medium text-xs text-slate-500">
              <Calendar className="h-3.5 w-3.5 text-purple-400/80" />
              <span>{meetingDate}</span>
              <span className="h-1 w-1 rounded-full bg-slate-700" />
              <span className="text-[10px] text-purple-300 font-semibold border border-purple-500/20 bg-purple-500/10 px-1.5 py-0.5 rounded-full uppercase tracking-wider">
                Instant Summary
              </span>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-2.5 sm:self-center flex-wrap">
            <button
              onClick={handleCopy}
              className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-xs font-semibold text-slate-300 transition-all hover:bg-white/10 hover:text-white hover:scale-[1.02] active:scale-[0.98]"
            >
              {copied ? (
                <>
                  <Check className="h-4 w-4 text-green-400" />
                  Copied!
                </>
              ) : (
                <>
                  <Copy className="h-4 w-4" />
                  Copy
                </>
              )}
            </button>

            <button
              onClick={handleDownload}
              className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-xs font-semibold text-slate-300 transition-all hover:bg-white/10 hover:text-white hover:scale-[1.02] active:scale-[0.98]"
            >
              <Download className="h-4 w-4" />
              MD
            </button>

            <button
              onClick={handlePrint}
              className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-tr from-purple-600 to-indigo-600 px-4 py-2.5 text-xs font-semibold text-white shadow-lg transition-all hover:shadow-purple-500/15 hover:scale-[1.02] active:scale-[0.98]"
            >
              <Printer className="h-4 w-4" />
              Print PDF
            </button>
          </div>
        </div>

        {/* Print Only Header */}
        <div className="hidden print:block mb-8">
          <h1 className="text-3xl font-bold text-black border-b pb-3 mb-2">{meetingTitle}</h1>
          <div className="text-sm text-gray-500 flex gap-4">
            <span>Date: {meetingDate}</span>
            <span>• Generated by Meet Minutes Pro</span>
          </div>
        </div>

        {/* Formatted Content Container */}
        <div className="prose prose-invert max-w-none prose-headings:text-white prose-p:text-slate-300 prose-strong:text-white prose-ul:list-disc">
          {renderFormattedMarkdown(markdown)}
        </div>
      </main>
    </div>
  );
}
