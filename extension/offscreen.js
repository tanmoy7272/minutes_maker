(() => {
  "use strict";

  let mediaRecorder = null;
  let recordedChunks = [];
  let recordingInterval = null;
  let recordingActive = false;
  let portalUrl = "https://minutes-maker-five.vercel.app";

  // On startup, retrieve stored capture parameters and immediately begin stream consumption
  chrome.storage.local.get(["tempStreamId", "portalUrl"], async (data) => {
    if (data.portalUrl) {
      portalUrl = data.portalUrl;
    }
    
    const streamId = data.tempStreamId;
    if (!streamId) {
      console.warn("[MMP-Offscreen] No active stream ID found in storage on mount.");
      return;
    }

    // Clean up temporary streamId immediately to protect lifecycle tokens
    chrome.storage.local.remove(["tempStreamId"]);
    
    console.log(`[MMP-Offscreen] Initiating capture for stream ID: ${streamId}`);
    
    try {
      // 1. Capture the exact tab audio stream using standard mediaDevices token
      const tabStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          mandatory: {
            chromeMediaSource: "tab",
            chromeMediaSourceId: streamId
          }
        },
        video: false
      });

      // 2. WEB AUDIO MIX & LOOPBACK: Capture silences local tab speakers natively.
      // We link the tab audio to speakers (destination) so the user continues hearing other participants,
      // and mix both the tab audio and the host's microphone together for MediaRecorder.
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const tabSource = audioCtx.createMediaStreamSource(tabStream);
      
      // Loop back tab audio to speakers
      tabSource.connect(audioCtx.destination);
      console.log("[MMP-Offscreen] Web Audio Loopback speaker pipe successful.");

      // Create a mixed destination stream to record both inputs
      const mixedDestination = audioCtx.createMediaStreamDestination();
      tabSource.connect(mixedDestination);

      let finalStream = mixedDestination.stream;

      // Try to capture user's own microphone and mix it in
      try {
        const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const micSource = audioCtx.createMediaStreamSource(micStream);
        micSource.connect(mixedDestination);
        console.log("[MMP-Offscreen] Microphone captured and mixed successfully.");
      } catch (micErr) {
        console.warn("[MMP-Offscreen] Microphone capture failed or denied. Continuing with tab audio only.", micErr);
        // Fallback: finalStream already contains tab audio via mixedDestination, which is perfect.
      }

      // 3. Initiate active recording context
      startRecordingStream(finalStream);
    } catch (err) {
      console.error("[MMP-Offscreen] getUserMedia tab capture failed:", err);
      chrome.runtime.sendMessage({ action: "captureError", error: err.message });
    }
  });

  chrome.runtime.onMessage.addListener(async (msg) => {
    if (msg.action === "stopCapture") {
      console.log("[MMP-Offscreen] Received stopCapture instruction.");
      stopRecordingStream();
    }
  });

  const startRecordingStream = (stream) => {
    recordingActive = true;
    recordedChunks = [];
    
    // Choose appropriate mime type supported by MediaRecorder
    let mimeType = "audio/webm";
    if (!MediaRecorder.isTypeSupported(mimeType)) {
      mimeType = ""; // Fallback to browser default
    }

    mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);

    mediaRecorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        recordedChunks.push(event.data);
      }
    };

    mediaRecorder.onstop = async () => {
      const audioBlob = new Blob(recordedChunks, { type: (mediaRecorder && mediaRecorder.mimeType) || "audio/webm" });
      recordedChunks = [];

      let sentForTranscription = false;

      // Safe size filter: ignore micro-silent recordings (less than 1KB)
      if (audioBlob.size > 1000) {
        console.log(`[MMP-Offscreen] Slicing segmented blob (${audioBlob.size} bytes). Sending to Whisper...`);
        sendBlobForTranscription(audioBlob);
        sentForTranscription = true;
      }

      // Automatically recycle and restart MediaRecorder for continuous progressive segments
      if (recordingActive && mediaRecorder) {
        try {
          mediaRecorder.start();
        } catch (e) {
          console.error("[MMP-Offscreen] Failed to auto-restart recorder:", e);
        }
      } else if (!recordingActive && !sentForTranscription) {
        // If we are stopping and did not send a chunk, notify background immediately
        console.log("[MMP-Offscreen] Stop requested and final chunk empty. Triggering cleanup completion.");
        chrome.runtime.sendMessage({ action: "offscreenCleanupComplete" });
      }
    };

    // Begin standard capture recording
    mediaRecorder.start();
    console.log("[MMP-Offscreen] MediaRecorder active. Slicing progressive chunks.");

    // Slices audio every 20 seconds to provide responsive transcripts
    recordingInterval = setInterval(() => {
      if (mediaRecorder && mediaRecorder.state === "recording") {
        mediaRecorder.stop(); // Stops, compiles current blob, and auto-recycles
      }
    }, 20000);
  };

  const stopRecordingStream = () => {
    recordingActive = false;
    
    if (recordingInterval) {
      clearInterval(recordingInterval);
      recordingInterval = null;
    }

    if (mediaRecorder) {
      if (mediaRecorder.state !== "inactive") {
        mediaRecorder.stop();
      }
      mediaRecorder = null;
    } else {
      // If there is no active mediaRecorder, notify background of completion immediately
      console.log("[MMP-Offscreen] No active media recorder. Triggering cleanup completion.");
      chrome.runtime.sendMessage({ action: "offscreenCleanupComplete" });
    }
  };

  const sendBlobForTranscription = async (blob, attempt = 1) => {
    const formData = new FormData();
    formData.append("file", blob, "audio.webm");

    const maxAttempts = 3;
    const baseDelay = 1500; // start with 1.5s delay

    try {
      const endpoint = `${portalUrl.endsWith("/") ? portalUrl.slice(0, -1) : portalUrl}/api/transcribe`;
      const response = await fetch(endpoint, {
        method: "POST",
        body: formData
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();
      const text = result.text?.trim();

      if (text) {
        console.log(`[MMP-Offscreen] Transcribed Text: "${text.substring(0, 60)}..."`);
        chrome.runtime.sendMessage({
          action: "audioSegmentTranscribed",
          text
        });
      }

      // If this is the final transcription segment and recording has stopped, let background know
      if (!recordingActive) {
        console.log("[MMP-Offscreen] Final transcription segment completed. Triggering cleanup completion.");
        chrome.runtime.sendMessage({ action: "offscreenCleanupComplete" });
      }
    } catch (err) {
      console.error(`[MMP-Offscreen] Transcription attempt ${attempt} failed:`, err);
      
      if (attempt < maxAttempts) {
        const delay = baseDelay * Math.pow(2, attempt - 1);
        console.log(`[MMP-Offscreen] Retrying in ${delay}ms...`);
        setTimeout(() => {
          sendBlobForTranscription(blob, attempt + 1);
        }, delay);
      } else {
        console.error("[MMP-Offscreen] All transcription retry attempts failed.");
        // Notify background that cleanup is complete anyway to avoid hangs
        if (!recordingActive) {
          chrome.runtime.sendMessage({ action: "offscreenCleanupComplete" });
        }
      }
    }
  };
})();
