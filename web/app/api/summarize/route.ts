import { NextRequest, NextResponse } from "next/server";
import { summarizeTranscript } from "../../../lib/transcript";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS, HEAD",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

interface SummarizeResult {
  executiveSummary: string;
  keyDecisions: Array<{ decision: string; rationale: string; timestamp: string }>;
  actionItems: Array<{ task: string; owner: string; dueDate: string; evidence: string }>;
  openQuestions: string[];
  participants: string[];
}

function validateSummary(json: SummarizeResult, transcript: string): boolean {
  try {
    if (!json.executiveSummary || !Array.isArray(json.actionItems)) return false;
    
    for (const item of json.actionItems) {
      const lowerOwner = (item.owner || "").toLowerCase().trim();
      // Smart Owner Name word-matching supporting full-name inference on first-name captions
      if (lowerOwner && lowerOwner !== "—" && lowerOwner !== "not mentioned" && lowerOwner !== "none" && lowerOwner !== "not specified" && lowerOwner !== "unassigned") {
        const words = lowerOwner.split(/\s+/).filter(w => w.length > 2);
        const nameFound = words.length > 0 
          ? words.some(word => transcript.toLowerCase().includes(word))
          : transcript.toLowerCase().includes(lowerOwner);
          
        if (!nameFound) {
          console.warn(`[MMP] Owner validation failed: "${item.owner}" not found in transcript.`);
          return false;
        }
      }
      // Relaxed non-empty evidence check to allow short agreements (e.g. "Alex: Yes.")
      if (!item.evidence || item.evidence.trim().length === 0) {
        console.warn(`[MMP] Evidence validation failed: evidence text is empty.`);
        return false;
      }
    }
    return true;
  } catch (_) {
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

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(request: NextRequest) {
  try {
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
        { status: 426, headers: CORS_HEADERS }
      );
    }

    const transcriptText = chunk.trim();

    if (!transcriptText) {
      return new NextResponse(JSON.stringify({ error: "Missing transcript data" }), { status: 400, headers: CORS_HEADERS });
    }

    const SYSTEM_PROMPT = `You are an extractive meeting analyst. CRITICAL INSTRUCTIONS:
1. Read transcript carefully. Output ONLY information explicitly stated.
2. NEVER invent names, dates, numbers, or tasks. If uncertain, output "Not mentioned".
3. For every action item, copy the EXACT supporting sentence as "evidence".
4. Preserve all speaker names verbatim. Do not abbreviate.
5. Output strict JSON matching this schema, no extra text:
{"executiveSummary":"<2-3 sentences>", "keyDecisions":[{"decision":"", "rationale":"", "timestamp":""}], "actionItems":[{"task":"", "owner":"", "dueDate":"", "evidence":""}], "openQuestions":[""], "participants":[""]}`;

    console.log("[MMP] Attempting summarization with primary provider...");
    let resultText = await summarizeTranscript(transcriptText, SYSTEM_PROMPT, false);
    
    let jsonResult: SummarizeResult = {
      executiveSummary: "",
      keyDecisions: [],
      actionItems: [],
      openQuestions: [],
      participants: []
    };
    let isValid = false;

    try {
      jsonResult = JSON.parse(resultText);
      isValid = validateSummary(jsonResult, transcriptText);
    } catch (_) {
      console.warn("[MMP] Failed to parse primary JSON response, triggering fallback.");
      isValid = false;
    }

    // Retry once with Gemini if validation fails or parsing fails
    if (!isValid) {
      console.warn("[MMP] Primary validation failed or returned malformed JSON. Retrying with Gemini 1.5 Pro...");
      resultText = await summarizeTranscript(transcriptText, SYSTEM_PROMPT, true); // forceFallback = true
      
      try {
        jsonResult = JSON.parse(resultText);
      } catch (err) {
        console.error("[MMP] Gemini fallback response also failed parsing:", err);
        return new NextResponse(JSON.stringify({ error: "Summarization failed under strict validation constraints." }), { status: 502, headers: CORS_HEADERS });
      }
    }

    // Defensive defaults safeguarding against optional or missing JSON keys in LLM output
    const executiveSummary = jsonResult.executiveSummary || "Meeting summary not generated.";
    const keyDecisions = Array.isArray(jsonResult.keyDecisions) ? jsonResult.keyDecisions : [];
    const actionItems = Array.isArray(jsonResult.actionItems) ? jsonResult.actionItems : [];
    const openQuestions = Array.isArray(jsonResult.openQuestions) ? jsonResult.openQuestions : [];
    const participants = Array.isArray(jsonResult.participants) ? jsonResult.participants : [];

    // Action Items with sanitized double quotes in evidence to protect regex parsing in Kanban board
    const markdown = `# Meeting Minutes

## Summary
${executiveSummary}

## Decisions
${keyDecisions.map(d => `- **${d.decision}** (${d.timestamp || "—"}) — Rationale: ${d.rationale}`).join("\n") || "- —"}

## Action Items
${actionItems.map(a => `- **${a.task}** — Owner: ${a.owner || "—"} — Due: ${a.dueDate || "—"}\n  *Evidence: "${(a.evidence || "").replace(/"/g, "'")}"*`).join("\n") || "- —"}

## Key Points
${openQuestions.map(q => `- ${q}`).join("\n") || "- —"}

## Participants
${participants.join(", ") || "—"}`;

    return new NextResponse(JSON.stringify({ summary: executiveSummary, markdown }), { status: 200, headers: CORS_HEADERS });
  } catch (error: any) {
    console.error("[MMP] Summarize API route error:", error);
    return new NextResponse(JSON.stringify({ error: error.message }), { status: 500, headers: CORS_HEADERS });
  }
}
