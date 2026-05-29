import { callLLM } from "./llm";

// 2,800 tokens is approximately 11,200 characters (Qwen 2.5 context limit optimization)
const CHUNK_SIZE = 11200;

export async function summarizeTranscript(transcript: string, systemPrompt: string, forceFallback = false): Promise<string> {
  const chunks: string[] = [];
  for (let i = 0; i < transcript.length; i += CHUNK_SIZE) {
    chunks.push(transcript.substring(i, i + CHUNK_SIZE));
  }

  console.log(`[MMP] Chunking transcript into ${chunks.length} chunks`);

  let currentSummary = "";

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    console.log(`[MMP] Processing progressive chunk ${i + 1}/${chunks.length}`);

    const userPrompt = `Previous Summary:\n${currentSummary || "None"}\n\nNew Chunk:\n${chunk}`;

    // Call the failover pool progressively
    currentSummary = await callLLM(userPrompt, systemPrompt, forceFallback);
  }

  return currentSummary;
}
