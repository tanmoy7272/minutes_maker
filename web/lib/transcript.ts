import { callLLM } from "./llm";

// Standard meetings under ~200,000 characters (~50k tokens) are processed in a high-fidelity multi-stage pipeline.
// Extremely long meetings are chunked progressively with a 2,000-character overlap using a custom merging prompt.
const SINGLE_PASS_THRESHOLD = 200000;
const CHUNK_SIZE = 25000;
const OVERLAP = 2000;

// ==========================================
// 1. ADVANCED MEETING INTELLIGENCE PROMPTS
// ==========================================

const EXTRACTION_SYSTEM_PROMPT = `You are a world-class meeting intelligence analyst. Your goal is to conduct a highly precise, exhaustive information extraction pass over the provided meeting transcript.
Focus exclusively on raw facts, explicit statements, assignments, and commitments. Do not summarize or paraphrase.

Your output must be a single, valid JSON object with NO extra text, comments, or markdown formatting blocks. The JSON must adhere strictly to this schema:
{
  "keyDecisions": [
    {
      "decision": "Concise, specific title of the decision or agreement.",
      "rationale": "Detailed rationale and background behind this decision based strictly on what was discussed.",
      "timestamp": "Verbatim timestamp if mentioned (e.g. '10:05:02'), otherwise leave empty."
    }
  ],
  "actionItems": [
    {
      "task": "Specific task, action item, or deliverable.",
      "owner": "Single first/last name of the responsible person. Use 'Unassigned' if no clear owner is mentioned verbatim.",
      "dueDate": "Specific date, timeline, or 'Not mentioned'.",
      "evidence": "A verbatim, exact quote from the transcript showing where this task was discussed or agreed upon."
    }
  ],
  "keyPoints": [
    "A major technical insight, topic discussion, theme, or takeaway from the meeting."
  ],
  "openQuestions": [
    "An unresolved concern, future agenda item, or open question requiring follow-up."
  ],
  "participants": [
    "Speaker name (verbatim) with a 3-5 word parenthetical summary of their main contribution (e.g. 'Alex (proposed Figma layout)')."
  ],
  "risks": [
    {
      "risk": "Specific project risk, technical roadblock, or dependency identified during the discussion.",
      "mitigation": "Mitigation strategy, backup plan, or follow-up action discussed to address this risk. Use 'Not mentioned' if none discussed.",
      "impact": "One of: 'High', 'Medium', or 'Low' based on the conversation."
    }
  ],
  "timeline": [
    {
      "timestamp": "Verbatim timestamp if mentioned (e.g. '10:04:12'), otherwise leave empty.",
      "topic": "Name of the topic or agenda item discussed.",
      "description": "A concise, 1-sentence description of the discussion, debate, or outcome for this topic."
    }
  ]
}`;

const SYNTHESIS_SYSTEM_PROMPT = `You are a world-class meeting intelligence writer. Your task is to write a highly professional, comprehensive, and engaging 2-3 paragraph executive summary of the meeting.
You must use both the raw transcript and the provided structured facts (decisions, action items, participants, risks, timeline) to construct a cohesive, narrative report.
Highlight the primary agenda, major technical debates, main arguments, and key strategic outcomes. Avoid generic filler.

Your output must be a single, valid JSON object with NO extra text, comments, or markdown formatting. The JSON must adhere strictly to this schema:
{
  "executiveSummary": "A narrative, complete, and engaging 2-3 paragraph executive summary."
}`;

const REFINEMENT_SYSTEM_PROMPT = `You are a meticulous quality-control meeting analyst. Your goal is to review the compiled meeting intelligence and cross-verify every single record against the original transcript to ensure absolute factual preservation and eliminate hallucinations.

Perform the following verification checklist:
1. Verbatim Quotes: Ensure the 'evidence' fields for action items match the transcript verbatim. If a quote is slightly paraphrased or missing, correct it to the exact words from the transcript.
2. Owner Resolution: Ensure action items assigned to placeholder names are mapped to 'Unassigned' or resolved to the correct participant name mentioned verbatim in the surrounding text.
3. Decision Integrity: Confirm that every listed key decision is a genuine, agreed-upon outcome in the transcript, not a proposal that was rejected.
4. Omissions: Look for any critical decisions, action items, or major risks in the transcript that were missed in the previous pass, and insert them.

Your output must be the final, complete, and polished JSON object representing the entire meeting intelligence state. Output NO extra text, comments, or markdown formatting outside the JSON. The JSON must conform exactly to this schema:
{
  "executiveSummary": "Refined executive summary.",
  "keyDecisions": [
    {
      "decision": "decision title",
      "rationale": "decision rationale",
      "timestamp": "timestamp"
    }
  ],
  "actionItems": [
    {
      "task": "task",
      "owner": "owner",
      "dueDate": "dueDate",
      "evidence": "verbatim quote"
    }
  ],
  "keyPoints": ["keyPoint"],
  "openQuestions": ["openQuestion"],
  "participants": ["participant info"],
  "risks": [
    {
      "risk": "risk description",
      "mitigation": "mitigation plan",
      "impact": "High/Medium/Low"
    }
  ],
  "timeline": [
    {
      "timestamp": "timestamp",
      "topic": "topic",
      "description": "description"
    }
  ]
}`;

const MERGE_SYSTEM_PROMPT = `You are a world-class meeting intelligence analyst. Your goal is to progressively extract and merge meeting information from a new transcript chunk into an existing accumulated JSON meeting state.

Analyze the new transcript chunk, identify any new participants, decisions, action items, key points, open questions, risks, or timeline topics, and merge them cleanly with the previous state.
Follow these rules:
1. De-duplicate: If a decision or action item in the new chunk is a duplicate of one in the previous state, keep the most complete version. Do not duplicate records.
2. Cumulative Timeline: Append new chronological timeline topics in order.
3. Participant profiles: Update the contribution summaries for existing speakers if they made new contributions in this chunk, or add new speakers.
4. Keep all existing items: Do not drop previous action items, decisions, or risks unless they were completely revised in the new chunk.

Your output must be a single, valid JSON object with NO extra text, comments, or markdown formatting. The JSON must conform exactly to this schema:
{
  "keyDecisions": [
    {
      "decision": "Concise title",
      "rationale": "Detailed rationale",
      "timestamp": "Verbatim timestamp if mentioned, otherwise leave empty"
    }
  ],
  "actionItems": [
    {
      "task": "Specific action item",
      "owner": "Single verbatim name or 'Unassigned'",
      "dueDate": "Timeline or 'Not mentioned'",
      "evidence": "A verbatim exact quote from the new or previous transcript chunk"
    }
  ],
  "keyPoints": [
    "Theme/Takeaway"
  ],
  "openQuestions": [
    "Unresolved item"
  ],
  "participants": [
    "Speaker name (verbatim) with contribution summary"
  ],
  "risks": [
    {
      "risk": "Risk/Blocker description",
      "mitigation": "Mitigation plan",
      "impact": "High/Medium/Low"
    }
  ],
  "timeline": [
    {
      "timestamp": "Timestamp if mentioned, otherwise leave empty",
      "topic": "Topic name",
      "description": "Topic description"
    }
  ]
}`;

export async function summarizeTranscript(transcript: string, systemPrompt: string, forceFallback = false, customKey?: string): Promise<string> {
  const len = transcript.length;

  // ==========================================
  // PATH A: Standard Meetings (Single Pass Multi-stage Pipeline)
  // ==========================================
  if (len <= SINGLE_PASS_THRESHOLD) {
    console.log(`[MMP] Transcript length is ${len} characters. Processing in high-fidelity multi-stage pipeline...`);

    // Stage 1: Extraction Pass
    console.log("[MMP-Pipeline] Running Stage 1: Structural Extraction...");
    const extractionResult = await callLLM(transcript, EXTRACTION_SYSTEM_PROMPT, forceFallback, customKey);
    
    let parsedExtraction: any;
    try {
      parsedExtraction = JSON.parse(extractionResult);
      console.log(`[MMP-Pipeline] Stage 1 succeeded. Extracted ${parsedExtraction.actionItems?.length || 0} tasks and ${parsedExtraction.keyDecisions?.length || 0} decisions.`);
    } catch (e) {
      console.warn("[MMP-Pipeline] Stage 1 failed to return valid JSON, falling back to a raw single pass...");
      return await callLLM(transcript, systemPrompt, forceFallback, customKey);
    }

    // Stage 2: Narrative Synthesis Pass
    console.log("[MMP-Pipeline] Running Stage 2: Narrative Synthesis...");
    const synthesisPrompt = `Original Transcript:\n${transcript}\n\nExtracted Structural Items:\n${JSON.stringify(parsedExtraction, null, 2)}`;
    const synthesisResult = await callLLM(synthesisPrompt, SYNTHESIS_SYSTEM_PROMPT, forceFallback, customKey);

    let parsedSynthesis: any;
    try {
      parsedSynthesis = JSON.parse(synthesisResult);
    } catch (e) {
      console.warn("[MMP-Pipeline] Stage 2 failed to return valid JSON, injecting default executive summary...");
      parsedSynthesis = { executiveSummary: "Meeting summary successfully captured." };
    }

    // Stage 3: Self-Correction & Refinement Pass
    console.log("[MMP-Pipeline] Running Stage 3: Quality Refinement & Fact Check...");
    const mergedState = {
      ...parsedExtraction,
      executiveSummary: parsedSynthesis.executiveSummary || "Meeting summary successfully captured."
    };
    
    const refinementPrompt = `Original Transcript:\n${transcript}\n\nProposed Meeting Intelligence JSON:\n${JSON.stringify(mergedState, null, 2)}`;
    const finalResult = await callLLM(refinementPrompt, REFINEMENT_SYSTEM_PROMPT, forceFallback, customKey);

    try {
      JSON.parse(finalResult);
      console.log("[MMP-Pipeline] Stage 3 Multi-stage intelligence pipeline completed successfully.");
      return finalResult;
    } catch (e) {
      console.warn("[MMP-Pipeline] Stage 3 failed to return valid JSON. Returning Stage 2 merged state directly.");
      return JSON.stringify(mergedState);
    }
  }

  // ==========================================
  // PATH B: Ultra-Long Meetings (Progressive Chunk Extraction & Merging)
  // ==========================================
  const chunks: string[] = [];
  let start = 0;
  while (start < len) {
    const end = Math.min(start + CHUNK_SIZE, len);
    chunks.push(transcript.substring(start, end));
    if (end === len) break;
    start += (CHUNK_SIZE - OVERLAP);
  }

  console.log(`[MMP] Ultra-long transcript detected (${len} characters). Chunked into ${chunks.length} chunks with a ${OVERLAP}-character overlap.`);

  let currentAccumulatedState = {
    keyDecisions: [],
    actionItems: [],
    keyPoints: [],
    openQuestions: [],
    participants: [],
    risks: [],
    timeline: []
  };

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    console.log(`[MMP] Processing cumulative chunk ${i + 1}/${chunks.length} (Size: ${chunk.length} chars)`);

    const userPrompt = `Previous Accumulated JSON State:\n${JSON.stringify(currentAccumulatedState, null, 2)}\n\nNew Transcript Chunk:\n${chunk}`;
    const mergeResult = await callLLM(userPrompt, MERGE_SYSTEM_PROMPT, forceFallback, customKey);

    try {
      currentAccumulatedState = JSON.parse(mergeResult);
      console.log(`[MMP-Merge] Chunk ${i + 1} merge succeeded. Total decisions: ${currentAccumulatedState.keyDecisions?.length || 0}, action items: ${currentAccumulatedState.actionItems?.length || 0}`);
    } catch (e) {
      console.warn(`[MMP-Merge] Chunk ${i + 1} merge pass failed to return valid JSON. Continuing with prior state.`);
    }
  }

  // Once all chunks are merged, run Stage 2 (Synthesis) and Stage 3 (Refinement) to produce the final polished state!
  console.log("[MMP-Pipeline] Running Stage 2 (Synthesis) on cumulative chunked meeting state...");
  
  // Since original transcript is too long to fully pass, we pass the chronological timeline and key points as context for narrative summary
  const contextSummary = `Chronological timeline topics discussed:\n${JSON.stringify(currentAccumulatedState.timeline || [], null, 2)}\n\nKey discussion themes:\n${JSON.stringify(currentAccumulatedState.keyPoints || [], null, 2)}`;
  
  const synthesisResult = await callLLM(contextSummary, SYNTHESIS_SYSTEM_PROMPT, forceFallback, customKey);
  let parsedSynthesis: any;
  try {
    parsedSynthesis = JSON.parse(synthesisResult);
  } catch (e) {
    parsedSynthesis = { executiveSummary: "Meeting summary successfully captured." };
  }

  const mergedState = {
    ...currentAccumulatedState,
    executiveSummary: parsedSynthesis.executiveSummary || "Meeting summary successfully captured."
  };

  console.log("[MMP-Pipeline] Running Stage 3 (Refinement) on cumulative chunked meeting state...");
  const refinementPrompt = `Cumulative Meeting State:\n${JSON.stringify(mergedState, null, 2)}`;
  const finalResult = await callLLM(refinementPrompt, REFINEMENT_SYSTEM_PROMPT, forceFallback, customKey);

  try {
    JSON.parse(finalResult);
    return finalResult;
  } catch (e) {
    return JSON.stringify(mergedState);
  }
}
