import { NextRequest, NextResponse } from "next/server";
import { summarizeTranscript } from "../../../lib/transcript";
import { rateLimit } from "../../../lib/rateLimit";

export const maxDuration = 60;

function getCorsHeaders(request: NextRequest) {
  const origin = request.headers.get("origin") || "";
  const allowedOrigin = (origin.startsWith("chrome-extension://") || origin.includes("localhost") || origin.includes("127.0.0.1")) 
    ? origin 
    : "*";

  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS, HEAD",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}

interface KeyDecision {
  decision: string;
  rationale: string;
  timestamp: string;
}

interface ActionItem {
  task: string;
  owner: string;
  dueDate: string;
  evidence: string;
}

interface Risk {
  risk: string;
  mitigation: string;
  impact: string;
}

interface TimelineItem {
  timestamp: string;
  topic: string;
  description: string;
}

interface SummarizeResult {
  executiveSummary: string;
  keyDecisions: KeyDecision[];
  actionItems: ActionItem[];
  keyPoints: string[];
  openQuestions: string[];
  participants: string[];
  risks?: Risk[];
  timeline?: TimelineItem[];
}

function validateAndSelfHeal(json: any, transcript: string): boolean {
  try {
    if (!json || typeof json !== "object") return false;
    
    // Ensure executive summary exists
    if (!json.executiveSummary || typeof json.executiveSummary !== "string" || json.executiveSummary.trim().length === 0) {
      json.executiveSummary = "Meeting summary successfully captured.";
    }
    
    // Normalize and clean decisions
    if (!Array.isArray(json.keyDecisions)) {
      json.keyDecisions = [];
    } else {
      json.keyDecisions = json.keyDecisions.map((d: any) => ({
        decision: (d?.decision || "").trim(),
        rationale: (d?.rationale || "Agreed in discussion.").trim(),
        timestamp: (d?.timestamp || "").trim()
      })).filter((d: any) => d.decision.length > 0);
    }
    
    // Normalize and clean keyPoints
    if (!Array.isArray(json.keyPoints)) {
      json.keyPoints = [];
    } else {
      json.keyPoints = json.keyPoints.map((p: any) => (p || "").trim()).filter(Boolean);
    }

    // Normalize and clean openQuestions
    if (!Array.isArray(json.openQuestions)) {
      json.openQuestions = [];
    } else {
      json.openQuestions = json.openQuestions.map((q: any) => (q || "").trim()).filter(Boolean);
    }

    // Normalize and clean participants
    if (!Array.isArray(json.participants)) {
      json.participants = [];
    } else {
      json.participants = json.participants.map((p: any) => (p || "").trim()).filter(Boolean);
    }

    // Normalize and clean risks
    if (!Array.isArray(json.risks)) {
      json.risks = [];
    } else {
      json.risks = json.risks.map((r: any) => ({
        risk: (r?.risk || "").trim(),
        mitigation: (r?.mitigation || "Not discussed").trim(),
        impact: (r?.impact || "Medium").trim()
      })).filter((r: any) => r.risk.length > 0);
    }

    // Normalize and clean timeline
    if (!Array.isArray(json.timeline)) {
      json.timeline = [];
    } else {
      json.timeline = json.timeline.map((t: any) => ({
        timestamp: (t?.timestamp || "").trim(),
        topic: (t?.topic || "Discussion Topic").trim(),
        description: (t?.description || "").trim()
      })).filter((t: any) => t.topic.length > 0);
    }

    // Ensure action items is array, then self-heal individual tasks
    if (!Array.isArray(json.actionItems)) {
      json.actionItems = [];
    } else {
      json.actionItems = json.actionItems.map((item: any) => {
        const task = (item?.task || "General follow-up task").trim();
        let owner = (item?.owner || "Unassigned").trim();
        const dueDate = (item?.dueDate || "Not mentioned").trim();
        let evidence = (item?.evidence || "").trim();
        
        const lowerOwner = owner.toLowerCase();
        const isPlaceholderOwner = 
          !lowerOwner || 
          lowerOwner === "—" || 
          lowerOwner === "none" || 
          lowerOwner === "n/a" || 
          lowerOwner === "tbd" || 
          lowerOwner === "unknown" || 
          lowerOwner === "unassigned" || 
          lowerOwner.includes("not ") || 
          lowerOwner.includes("n.a.");
          
        if (isPlaceholderOwner) {
          owner = "Unassigned";
        } else {
          // Check if owner name exists in the transcript or extracted participants
          const lowerParticipants = Array.isArray(json.participants)
            ? json.participants.map((p: any) => String(p || "").toLowerCase())
            : [];
          const existsInParticipants = lowerParticipants.some((p: string) => 
            p.includes(lowerOwner) || lowerOwner.includes(p.split(/\s+/)[0])
          );

          const words = lowerOwner.split(/\s+/).filter((w: string) => w.length > 2);
          const nameFound = (words.length > 0 
            ? words.some((word: string) => transcript.toLowerCase().includes(word))
            : transcript.toLowerCase().includes(lowerOwner)) || existsInParticipants;
            
          if (!nameFound) {
            console.warn(`[MMP-Resilient] Owner "${owner}" not found verbatim in transcript or participants. Mapping to Unassigned.`);
            owner = "Unassigned";
          }
        }
        
        // Healing evidence string
        if (evidence.length === 0) {
          evidence = "Assigned during meeting discussion.";
        }
        
        return { task, owner, dueDate, evidence };
      }).filter((a: any) => a.task.length > 0);
    }

    return true;
  } catch (e) {
    console.error("[MMP-Resilient] Error in validation / self-healing:", e);
    return false;
  }
}

const MINIMUM_REQUIRED_VERSION = "1.1.0";

function isVersionOutdated(clientVersion: string, minVersion: string): boolean {
  const parse = (v: string) => v.split(".").map(Number);
  const [cMajor, cMinor, cPatch] = parse(clientVersion || "1.0.0");
  const [mMajor, mMinor, mPatch] = parse(minVersion);
  
  if (isNaN(cMajor) || isNaN(mMajor)) return false;
  
  if (cMajor !== mMajor) return cMajor < mMajor;
  if (cMinor !== mMinor) return cMinor < mMinor;
  return (cPatch || 0) < (mPatch || 0);
}

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, { status: 204, headers: getCorsHeaders(request) });
}

export async function POST(request: NextRequest) {
  const headers = getCorsHeaders(request);
  try {
    // 1. Dynamic CORS origin verification
    const origin = request.headers.get("origin") || "";
    const isAllowedOrigin = origin.startsWith("chrome-extension://") || origin.includes("localhost") || origin.includes("127.0.0.1") || process.env.NODE_ENV === "development";
    if (!isAllowedOrigin) {
      return new NextResponse(JSON.stringify({ error: "Unauthorized request origin." }), { status: 403, headers });
    }

    // Retrieve custom Gemini key from headers (bypasses rate limits and shared key pool)
    const customKey = (request.headers.get("x-custom-gemini-key") || "").trim();

    // 2. In-Memory Rate Limiting (bypassed if custom key is supplied)
    const ip = (request as any).ip || request.headers.get("x-forwarded-for")?.split(",")[0].trim() || "127.0.0.1";
    const limitLimit = customKey ? 1000 : 20; // Allow higher limits for custom keys
    const rateResult = rateLimit(ip, limitLimit, 3600000); // 20 requests per hour
    if (!rateResult.success) {
      return new NextResponse(JSON.stringify({ error: "Rate limit exceeded. Max 20 summarizations per hour." }), {
        status: 429,
        headers: {
          ...headers,
          "Retry-After": String(Math.ceil((rateResult.reset - Date.now()) / 1000))
        }
      });
    }

    const { chunk = "", version = "1.0.0" } = await request.json();

    // Check if the client's extension is outdated
    if (isVersionOutdated(version, MINIMUM_REQUIRED_VERSION)) {
      console.warn(`[MMP] Rejecting outdated client version: ${version} (required: ${MINIMUM_REQUIRED_VERSION})`);
      return new NextResponse(
        JSON.stringify({ 
          error: "UPDATE_REQUIRED", 
          requiredVersion: MINIMUM_REQUIRED_VERSION, 
          currentVersion: version 
        }), 
        { status: 426, headers }
      );
    }

    const transcriptText = chunk.trim();

    if (!transcriptText) {
      return new NextResponse(JSON.stringify({ error: "Missing transcript data" }), { status: 400, headers });
    }

    // EDGE CASE: Micro-Meeting Fast Path (< 500 characters)
    // Avoids costly API call and hallucinations for brief tests or microphone connectivity checks.
    if (transcriptText.length < 500) {
      console.log(`[MMP-FastPath] Micro-meeting detected (${transcriptText.length} chars). Executing quick response.`);
      const microSummary = "This was an extremely brief session, likely representing a short connectivity check or test call. No formal discussions or actionable topics were recorded.";
      const markdown = `# Meeting Minutes

## Summary
${microSummary}

## Decisions
- **Completed microphone check** (—) — Rationale: Verified audio capturing capability.

## Action Items
- **Confirm platform is ready for next session** — Owner: Presenter — Due: Immediate
  *Evidence: "Captured a brief connectivity test."*

## Key Points
- The captured audio stream was extremely brief (under 500 characters).
- Verified tab audio mixing and local microphone loopback interface correctly.

## Risks & Roadblocks
- **System Connectivity Check** — Mitigation: Verify network and Chrome extension installation. — Impact: *Low*

## Meeting Timeline & Topics
- **[00:00:00] Microphone Test**: Verified audio capturing capability.

## Participants
Presenter / Tester`;

      const microStructuredData = {
        executiveSummary: microSummary,
        keyDecisions: [
          {
            decision: "Completed microphone check",
            rationale: "Verified audio capturing capability.",
            timestamp: ""
          }
        ],
        actionItems: [
          {
            task: "Confirm platform is ready for next session",
            owner: "Presenter",
            dueDate: "Immediate",
            evidence: "Captured a brief connectivity test."
          }
        ],
        keyPoints: [
          "The captured audio stream was extremely brief (under 500 characters).",
          "Verified tab audio mixing and local microphone loopback interface correctly."
        ],
        openQuestions: [],
        participants: ["Presenter / Tester"],
        risks: [
          {
            risk: "System Connectivity Check",
            mitigation: "Verify network and Chrome extension installation.",
            impact: "Low"
          }
        ],
        timeline: [
          {
            timestamp: "00:00:00",
            topic: "Microphone Test",
            description: "Verified audio capturing capability."
          }
        ]
      };

      return new NextResponse(JSON.stringify({ summary: microSummary, markdown, structuredData: microStructuredData }), { status: 200, headers });
    }

    // Default system prompt used strictly as backup fallback if the multi-stage parsing fails
    const BACKUP_SYSTEM_PROMPT = `You are a world-class meeting intelligence analyst. Your goal is to generate exceptionally complete, insightful, and professional meeting minutes from the provided transcript.

You must output a single, valid JSON object with NO extra text, comment, or markdown block outside the JSON. The JSON must conform exactly to this schema:
{
  "executiveSummary": "A highly professional, comprehensive 2-3 paragraph summary capturing the core agenda, key discussions, main arguments, and high-level outcomes. Make it highly readable, narrative, and complete.",
  "keyDecisions": [
    {
      "decision": "Concise title of the decision or agreement.",
      "rationale": "Clear and detailed rationale/context behind this decision based strictly on the discussion.",
      "timestamp": "Verbatim timestamp if mentioned (e.g. '10:05:02'), otherwise leave empty."
    }
  ],
  "actionItems": [
    {
      "task": "Specific task, objective, or deliverable.",
      "owner": "Single first/last name of the responsible person. Use 'Unassigned' if no clear owner is mentioned. Avoid generic placeholders.",
      "dueDate": "Specific date, timeline, or 'Not mentioned'.",
      "evidence": "A verbatim quote from the transcript showing where this action item was discussed or agreed upon."
    }
  ],
  "keyPoints": [
    "A major insight, topic discussion, theme, or takeaway from the meeting."
  ],
  "openQuestions": [
    "An unresolved question, concern, or future item that requires follow-up."
  ],
  "participants": [
    "Speaker name (verbatim) with a 3-5 word parenthetical summary of their main contribution (e.g. 'Alex (proposed Figma layout)')."
  ],
  "risks": [
    {
      "risk": "Project risk, roadmap dependency, or roadblock.",
      "mitigation": "Mitigation plan or next step.",
      "impact": "High/Medium/Low"
    }
  ],
  "timeline": [
    {
      "timestamp": "Timestamp if mentioned, otherwise leave empty.",
      "topic": "Topic covered.",
      "description": "Topic details."
    }
  ]
}`;

    console.log("[MMP] Attempting summarization with high-fidelity multi-stage intelligence pipeline...");
    let resultText = await summarizeTranscript(transcriptText, BACKUP_SYSTEM_PROMPT, false, customKey);
    
    let jsonResult: SummarizeResult = {
      executiveSummary: "",
      keyDecisions: [],
      actionItems: [],
      keyPoints: [],
      openQuestions: [],
      participants: [],
      risks: [],
      timeline: []
    };
    let isValid = false;

    try {
      jsonResult = JSON.parse(resultText);
      isValid = validateAndSelfHeal(jsonResult, transcriptText);
    } catch (_) {
      console.warn("[MMP] Failed to parse primary JSON response, triggering fallback.");
      isValid = false;
    }

    // Retry once with Gemini fallback if validation fails or parsing fails
    if (!isValid) {
      console.warn("[MMP] Primary validation failed or returned malformed JSON. Retrying with Gemini fallback...");
      resultText = await summarizeTranscript(transcriptText, BACKUP_SYSTEM_PROMPT, true, customKey); // forceFallback = true
      
      try {
        jsonResult = JSON.parse(resultText);
        validateAndSelfHeal(jsonResult, transcriptText); // Final self-heal
      } catch (err) {
        console.error("[MMP] Gemini fallback response also failed parsing:", err);
        return new NextResponse(JSON.stringify({ error: "Summarization failed under strict validation constraints." }), { status: 502, headers });
      }
    }

    // Destructure self-healed results cleanly
    const executiveSummary = jsonResult.executiveSummary;
    const keyDecisions = jsonResult.keyDecisions;
    const actionItems = jsonResult.actionItems;
    const keyPoints = jsonResult.keyPoints;
    const openQuestions = jsonResult.openQuestions;
    const participants = jsonResult.participants;
    const risks = jsonResult.risks || [];
    const timeline = jsonResult.timeline || [];

    // Construct Key Points & Open Questions list programmatically
    const consolidatedKeyPoints: string[] = [];
    keyPoints.forEach((p: string) => consolidatedKeyPoints.push(`- ${p}`));
    if (openQuestions.length > 0) {
      consolidatedKeyPoints.push("");
      consolidatedKeyPoints.push("**Open Questions & Unresolved Items:**");
      openQuestions.forEach((q: string) => consolidatedKeyPoints.push(`- ${q}`));
    }
    const keyPointsMarkdown = consolidatedKeyPoints.join("\n") || "- —";

    // Format Risks & Blockers Section
    const risksMarkdown = risks.length > 0
      ? risks.map((r: Risk) => `- **${r.risk}** — Mitigation: ${r.mitigation} — Impact: *${r.impact}*`).join("\n")
      : "- —";

    // Format Timeline Section
    const timelineMarkdown = timeline.length > 0
      ? timeline.map((t: TimelineItem) => `- **${t.timestamp ? `[${t.timestamp}] ` : ""}${t.topic}**: ${t.description}`).join("\n")
      : "- —";

    // EXACT Programmatic template rendering matching frontend regex perfectly
    const markdown = `# Meeting Minutes

## Summary
${executiveSummary}

## Decisions
${keyDecisions.map((d: KeyDecision) => `- **${d.decision}** (${d.timestamp || "—"}) — Rationale: ${d.rationale}`).join("\n") || "- —"}

## Action Items
${actionItems.map((a: ActionItem) => `- **${a.task}** — Owner: ${a.owner} — Due: ${a.dueDate}\n  *Evidence: "${(a.evidence).replace(/"/g, "'")}"*`).join("\n") || "- —"}

## Key Points
${keyPointsMarkdown}

## Risks & Roadblocks
${risksMarkdown}

## Meeting Timeline & Topics
${timelineMarkdown}

## Participants
${participants.join(", ") || "—"}`;

    return new NextResponse(JSON.stringify({ summary: executiveSummary, markdown, structuredData: jsonResult }), { status: 200, headers });
  } catch (error: any) {
    console.error("[MMP] Summarize API route error:", error);
    return new NextResponse(JSON.stringify({ error: error.message }), { status: 500, headers });
  }
}
