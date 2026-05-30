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
  Edit2,
  LayoutGrid,
  CheckSquare,
  Square,
  User,
  Quote
} from "lucide-react";
import confetti from "canvas-confetti";

export default function ResultPage() {
  const [mounted, setMounted] = useState(false);
  const [markdown, setMarkdown] = useState("");
  const [meetingTitle, setMeetingTitle] = useState("Meeting Minutes Pro");
  const [meetingDate, setMeetingDate] = useState("");
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [copied, setCopied] = useState(false);
  
  // Sassy Interactive States
  const [viewMode, setViewMode] = useState<"document" | "board">("document");
  const [parsedDecisions, setParsedDecisions] = useState<Array<{ decision: string; timestamp: string; rationale: string }>>([]);
  const [parsedActionItems, setParsedActionItems] = useState<Array<{ id: number; task: string; owner: string; dueDate: string; evidence: string; completed: boolean }>>([]);
  const [individualCopiedTask, setIndividualCopiedTask] = useState<number | null>(null);

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
            const binary = atob(encoded);
            const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
            const decoded = new TextDecoder().decode(bytes);
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

  // On-the-fly parser converting markdown string back to interactive JSON data structures
  useEffect(() => {
    if (!markdown) return;

    try {
      // 1. Parse Decisions
      const decisionsSection = markdown.match(/## Decisions([\s\S]*?)(?=##|$)/);
      const decs: Array<{ decision: string; timestamp: string; rationale: string }> = [];
      if (decisionsSection && decisionsSection[1]) {
        const lines = decisionsSection[1].split("\n").map(l => l.trim()).filter(Boolean);
        lines.forEach(line => {
          if (line.startsWith("- ")) {
            const decMatch = line.match(/^-\s+\*\*([^*]+)\*\*.*?Rational[e]?:?\s*(.*)$/i);
            const timeMatch = line.match(/\(([^)]+)\)/);
            if (decMatch) {
              decs.push({
                decision: decMatch[1].trim(),
                timestamp: timeMatch ? timeMatch[1].trim() : "",
                rationale: decMatch[2] ? decMatch[2].trim() : "Not mentioned"
              });
            } else {
              const cleanLine = line.replace(/^-\s+/, "");
              decs.push({ decision: cleanLine, timestamp: "", rationale: "Not mentioned" });
            }
          }
        });
      }
      setParsedDecisions(decs.filter(d => d.decision !== "—" && d.decision !== "- —"));

      // 2. Parse Action Items
      const actionSection = markdown.match(/## Action Items([\s\S]*?)(?=##|$)/);
      const actions: Array<{ id: number; task: string; owner: string; dueDate: string; evidence: string; completed: boolean }> = [];
      if (actionSection && actionSection[1]) {
        const textBlocks = actionSection[1].split(/(?=-\s+\*\*)/);
        let idCounter = 1;
        textBlocks.forEach(block => {
          const trimmed = block.trim();
          if (!trimmed || trimmed.startsWith("- —")) return;

          const lines = trimmed.split("\n").map(l => l.trim()).filter(Boolean);
          const firstLine = lines[0];
          const secondLine = lines[1] || "";

          const taskMatch = firstLine.match(/^-\s+\*\*([^*]+)\*\*/);
          const ownerMatch = firstLine.match(/Owner:\s*([^\s—]+)/i) || firstLine.match(/Owner:\s*([^—\n]+)/i);
          const dueMatch = firstLine.match(/Due:\s*([^\s—]+)/i) || firstLine.match(/Due:\s*([^\n]+)/i);
          const evMatch = secondLine.match(/\*Evidence:\s*\"([^\"]+)\"\*/i);

          if (taskMatch) {
            actions.push({
              id: idCounter++,
              task: taskMatch[1].trim(),
              owner: ownerMatch ? ownerMatch[1].trim().replace(/(—|$)/g, "") : "Not mentioned",
              dueDate: dueMatch ? dueMatch[1].trim() : "Not mentioned",
              evidence: evMatch ? evMatch[1].trim() : "Verbatim evidence not recorded",
              completed: false
            });
          }
        });
      }
      setParsedActionItems(actions);
    } catch (err) {
      console.error("[MMP] Board parsing failed:", err);
    }
  }, [markdown]);

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

  const toggleTaskCompleted = (id: number) => {
    setParsedActionItems(prev => prev.map(item => 
      item.id === id ? { ...item, completed: !item.completed } : item
    ));
  };

  const handleCopyIndividualTask = (item: any) => {
    const text = `📋 Task: ${item.task}\n👤 Owner: ${item.owner}\n📅 Due: ${item.dueDate}\n💬 Evidence: "${item.evidence}"`;
    navigator.clipboard.writeText(text);
    setIndividualCopiedTask(item.id);
    setTimeout(() => setIndividualCopiedTask(null), 1500);
  };

  const getOwnerInitials = (owner: string) => {
    if (!owner || owner === "Not mentioned" || owner === "—") return "?";
    const parts = owner.trim().split(/\s+/);
    if (parts.length > 1) {
      return (parts[0].charAt(0) + parts[1].charAt(0)).toUpperCase();
    }
    return owner.substring(0, 2).toUpperCase();
  };

  const getOwnerAvatarStyle = (owner: string) => {
    if (!owner || owner === "Not mentioned" || owner === "—") {
      return "from-slate-600 to-slate-800 shadow-[0_0_10px_rgba(100,116,139,0.3)]";
    }
    let hash = 0;
    for (let i = 0; i < owner.length; i++) {
      hash = owner.charCodeAt(i) + ((hash << 5) - hash);
    }
    const gradients = [
      "from-purple-500 to-indigo-600 shadow-[0_0_10px_rgba(139,92,246,0.35)]",
      "from-pink-500 to-rose-600 shadow-[0_0_10px_rgba(236,72,153,0.35)]",
      "from-emerald-400 to-teal-600 shadow-[0_0_10px_rgba(16,185,129,0.35)]",
      "from-amber-400 to-orange-500 shadow-[0_0_10px_rgba(245,158,11,0.35)]",
      "from-blue-500 to-cyan-600 shadow-[0_0_10px_rgba(59,130,246,0.35)]",
      "from-fuchsia-500 to-pink-600 shadow-[0_0_10px_rgba(217,70,239,0.35)]"
    ];
    const index = Math.abs(hash) % gradients.length;
    return gradients[index];
  };

  // Helper to parse and render styled markdown elements
  const renderFormattedMarkdown = (rawMarkdown: string) => {
    if (!rawMarkdown) return null;

    let content = rawMarkdown;
    if (content.startsWith("# ")) {
      const lines = content.split("\n");
      lines.shift();
      content = lines.join("\n");
    }

    const blocks = content.split(/\n(?=##\s+)/);

    return blocks.map((block, idx) => {
      const trimmedBlock = block.trim();
      if (!trimmedBlock) return null;

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
        const headerMatch = trimmedBlock.match(/^##\s+(.+)$/m);
        if (headerMatch) {
          headerText = headerMatch[1].trim();
        }
      }

      const lines = trimmedBlock.split("\n");
      if (lines[0].startsWith("## ")) {
        lines.shift();
      }
      const sectionContent = lines.join("\n").trim();

      const renderedLines = sectionContent.split("\n").map((line, lineIdx) => {
        let text = line.trim();
        if (!text) return <div key={lineIdx} className="h-2" />;

        const isBullet = text.startsWith("- ") || text.startsWith("* ");
        if (isBullet) {
          text = text.substring(2);
        }

        let formattedText: React.ReactNode[] = [];
        const boldRegex = /\*\*([^*]+)\*\*/g;
        let lastIndex = 0;
        let match;

        const timestampRegex = /(\[?\b\d{2}:\d{2}:\d{2}\b\]?)/g;

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

  // Render the gorgeous tech-savvy Kanban board view
  const renderBoardView = () => {
    // Extract executive summary text only
    let summaryText = "No summary parsed.";
    const summaryMatch = markdown.match(/## Summary([\s\S]*?)(?=##|$)/);
    if (summaryMatch && summaryMatch[1]) {
      summaryText = summaryMatch[1].trim();
    }

    const totalTasks = parsedActionItems.length;
    const completedTasks = parsedActionItems.filter(t => t.completed).length;
    const completionRate = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

    return (
      <div className="space-y-8 animate-fade-in no-print">
        {/* Executive Summary Card at the top of the board */}
        <div className="rounded-xl border border-purple-500/20 bg-gradient-to-tr from-purple-500/5 to-indigo-500/5 p-5 shadow-lg">
          <h4 className="text-xs font-bold uppercase tracking-wider text-purple-400 mb-2 flex items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5" />
            Executive Summary
          </h4>
          <p className="text-slate-300 text-sm leading-relaxed">{summaryText}</p>
        </div>

        {/* Progress Tracker Card */}
        {totalTasks > 0 && (
          <div className="rounded-xl border border-blue-500/10 bg-gradient-to-r from-blue-950/10 via-slate-950/10 to-emerald-950/10 p-5 shadow-lg relative overflow-hidden backdrop-blur-sm">
            <div className="absolute top-0 right-0 w-[30%] h-full bg-blue-500/5 blur-[50px] pointer-events-none" />
            <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-3 gap-2">
              <span className="text-xs font-bold text-blue-400 uppercase tracking-widest flex items-center gap-2">
                <CheckSquare className="h-4 w-4 text-blue-400 animate-pulse" />
                Action Items Progress Tracker
              </span>
              <span className="text-xs font-bold text-slate-300">
                <strong className="text-white text-sm font-extrabold">{completedTasks}</strong> of <strong className="text-white text-sm font-extrabold">{totalTasks}</strong> tasks completed ({completionRate}%)
              </span>
            </div>
            <div className="h-2.5 w-full bg-slate-900/60 rounded-full overflow-hidden border border-white/5 p-[1px]">
              <div 
                className="h-full bg-gradient-to-r from-blue-500 to-emerald-500 rounded-full transition-all duration-500 ease-out shadow-[0_0_12px_rgba(59,130,246,0.6)]" 
                style={{ width: `${completionRate}%` }}
              />
            </div>
          </div>
        )}

        {/* Board Grid columns */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
          
          {/* COLUMN 1: DECISIONS */}
          <div className="space-y-4">
            <div className="flex items-center justify-between border-b border-white/[0.08] pb-2">
              <h4 className="text-xs font-black uppercase tracking-widest text-emerald-400 flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                Key Decisions ({parsedDecisions.length})
              </h4>
            </div>

            {parsedDecisions.length === 0 ? (
              <div className="rounded-xl border border-white/5 bg-white/[0.02] p-6 text-center text-slate-500 text-xs italic">
                No key decisions recorded in this session.
              </div>
            ) : (
              parsedDecisions.map((dec, i) => (
                <div key={i} className="group relative rounded-xl border border-emerald-500/10 bg-emerald-950/5 hover:bg-emerald-950/10 p-4 transition-all duration-300 hover:shadow-lg hover:shadow-emerald-500/5">
                  <div className="absolute top-4 right-4">
                    {dec.timestamp && (
                      <span className="timestamp-pill timestamp-pill-green">
                        <Clock className="h-3 w-3 mr-1 inline" />
                        {dec.timestamp}
                      </span>
                    )}
                  </div>
                  <h5 className="font-bold text-sm text-white pr-16 leading-snug">
                    {dec.decision}
                  </h5>
                  <div className="mt-3 pt-3 border-t border-emerald-500/10 text-xs">
                    <span className="text-emerald-400/80 font-bold uppercase tracking-wider block mb-1 text-[10px]">Rationale</span>
                    <p className="text-slate-400 italic">"{dec.rationale}"</p>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* COLUMN 2: ACTION ITEMS (CHECKABLE TASK CARDS) */}
          <div className="space-y-4">
            <div className="flex items-center justify-between border-b border-white/[0.08] pb-2">
              <h4 className="text-xs font-black uppercase tracking-widest text-blue-400 flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-blue-500 animate-pulse" />
                Action Tasks ({parsedActionItems.length})
              </h4>
            </div>

            {parsedActionItems.length === 0 ? (
              <div className="rounded-xl border border-white/5 bg-white/[0.02] p-6 text-center text-slate-500 text-xs italic">
                No actionable tasks recorded in this session.
              </div>
            ) : (
              parsedActionItems.map((item) => (
                <div 
                  key={item.id} 
                  className={`group relative rounded-xl border transition-all duration-300 p-4 ${
                    item.completed 
                      ? "border-white/5 bg-white/[0.01] opacity-50" 
                      : "border-blue-500/10 bg-blue-950/5 hover:bg-blue-950/10 hover:shadow-lg hover:shadow-blue-500/5"
                  }`}
                >
                  {/* Task Header with interactive Checkbox */}
                  <div className="flex items-start gap-3">
                    <button 
                      onClick={() => toggleTaskCompleted(item.id)}
                      className="mt-0.5 rounded text-blue-400 hover:text-white transition-colors"
                    >
                      {item.completed ? (
                        <CheckSquare className="h-5 w-5 text-emerald-400 fill-emerald-500/10" />
                      ) : (
                        <Square className="h-5 w-5 text-slate-500 hover:border-blue-400" />
                      )}
                    </button>

                    <div className="flex-1">
                      <h5 className={`font-bold text-sm text-white leading-snug transition-all ${
                        item.completed ? "line-through text-slate-500" : ""
                      }`}>
                        {item.task}
                      </h5>

                      {/* Card meta badges */}
                      <div className="mt-3 flex items-center gap-4 flex-wrap">
                        {/* Owner Badge */}
                        <div className="flex items-center gap-1.5 text-xs text-slate-300">
                          <div className={`h-6 w-6 rounded-full bg-gradient-to-tr ${getOwnerAvatarStyle(item.owner)} flex items-center justify-center font-bold text-[9px] text-white`}>
                            {getOwnerInitials(item.owner)}
                          </div>
                          <span className="font-semibold text-slate-400">Owner:</span>
                          <span className="text-white font-bold">{item.owner}</span>
                        </div>

                        {/* Due Date Badge */}
                        <div className="flex items-center gap-1 text-xs text-slate-400">
                          <Calendar className="h-3.5 w-3.5 text-purple-400" />
                          <span className="font-semibold">Due:</span>
                          <span className="text-white font-bold">{item.dueDate}</span>
                        </div>
                      </div>

                      {/* Verbatim Evidence Section */}
                      {item.evidence && (
                        <div className="mt-3 bg-black/30 border-l-2 border-purple-500/20 rounded p-2.5 text-xs relative overflow-hidden group-hover:border-purple-500/40 transition-colors">
                          <Quote className="absolute right-2 bottom-1 h-10 w-10 text-white/[0.02] pointer-events-none" />
                          <span className="text-[10px] text-purple-400 font-bold uppercase tracking-wider block mb-1">Verbatim Evidence</span>
                          <p className="text-slate-400 italic">"{item.evidence}"</p>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Individual Task Copy buttons */}
                  <div className="absolute top-4 right-4 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity no-print">
                    <button
                      onClick={() => handleCopyIndividualTask(item)}
                      className="p-1.5 rounded bg-white/5 border border-white/10 text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
                      title="Copy task details"
                    >
                      {individualCopiedTask === item.id ? (
                        <Check className="h-3.5 w-3.5 text-green-400" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    );
  };

  if (!mounted) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#030303] text-slate-400 font-mono text-xs">
        Loading...
      </div>
    );
  }

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
            Please host or join a Google Meet, open our extension popup, activate audio capture, and press "Stop Capture" when finished to view your structured meeting minutes here.
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

        {/* View Mode Segmented Switcher (No Print) */}
        <div className="flex border-b border-white/[0.05] pb-5 mb-6 no-print">
          <div className="flex bg-white/5 p-1 rounded-xl border border-white/10">
            <button
              onClick={() => setViewMode("document")}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-all ${
                viewMode === "document" 
                  ? "bg-purple-600 text-white shadow-lg shadow-purple-500/15" 
                  : "text-slate-400 hover:text-white"
              }`}
            >
              <FileText className="h-3.5 w-3.5" />
              Document View
            </button>
            <button
              onClick={() => setViewMode("board")}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-all ${
                viewMode === "board" 
                  ? "bg-purple-600 text-white shadow-lg shadow-purple-500/15" 
                  : "text-slate-400 hover:text-white"
              }`}
            >
              <LayoutGrid className="h-3.5 w-3.5" />
              Interactive Board
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

        {/* Content Container (Standard Render or Kanban Board Render) */}
        <div className="prose prose-invert max-w-none prose-headings:text-white prose-p:text-slate-300 prose-strong:text-white prose-ul:list-disc">
          {viewMode === "document" ? (
            renderFormattedMarkdown(markdown)
          ) : (
            renderBoardView()
          )}
        </div>
      </main>
    </div>
  );
}
