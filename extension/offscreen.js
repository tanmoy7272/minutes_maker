(() => {
  "use strict";

  let mediaRecorder = null;
  let recordedChunks = [];
  let recordingInterval = null;
  let recordingActive = false;
  let portalUrl = "https://minutes-maker-five.vercel.app";

  let captureInitiated = false;
  let offlineBlobQueue = [];

  const initCaptureFlow = async (streamId) => {
    if (captureInitiated) return;
    captureInitiated = true;

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

      // Track ended handler to auto-cleanup when tab closes / redirects
      tabStream.getAudioTracks().forEach(track => {
        track.onended = () => {
          console.log("[MMP-Offscreen] Tab stream audio track ended. Stopping capture...");
          stopRecordingStream();
        };
      });

      // 2. WEB AUDIO MIX & LOOPBACK: Capture silences local tab speakers natively.
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === "suspended") {
        await audioCtx.resume();
      }
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
        console.log("[MMP-Offscreen] Microphone capture failed or denied. Continuing with tab audio only.", micErr);
      }

      // 3. Initiate active recording context
      startRecordingStream(finalStream);
    } catch (err) {
      console.error("[MMP-Offscreen] getUserMedia tab capture failed:", err);
      chrome.runtime.sendMessage({ action: "captureError", error: err.message });
    }
  };

  // On startup, retrieve stored capture parameters (fallback)
  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
    chrome.storage.local.get(["tempStreamId", "portalUrl"], async (data) => {
      if (data.portalUrl) {
        portalUrl = data.portalUrl;
      }
      
      const streamId = data.tempStreamId;
      if (streamId) {
        chrome.storage.local.remove(["tempStreamId"]);
        console.log("[MMP-Offscreen] Found stream ID in storage on load.");
        initCaptureFlow(streamId);
      }
    });
  } else {
    console.log("[MMP-Offscreen] chrome.storage is not available. Using direct message-driven capture.");
  }

  // Message listener for direct message-driven transfer (primary)
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === "initiateCapture") {
      console.log("[MMP-Offscreen] Received initiateCapture message.");
      initCaptureFlow(msg.streamId);
    } else if (msg.action === "stopCapture") {
      console.log("[MMP-Offscreen] Received stopCapture instruction.");
      stopRecordingStream();
    } else if (msg.action === "pingOffscreen") {
      sendResponse({ ok: true });
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
        let targetBlob = audioBlob;
        if (offlineBlobQueue.length > 0) {
          console.log(`[MMP-Offscreen] Concatenating ${offlineBlobQueue.length} offline cached slices with current slice.`);
          targetBlob = new Blob([...offlineBlobQueue, audioBlob], { type: audioBlob.type });
        }

        console.log(`[MMP-Offscreen] Slicing segmented blob (${targetBlob.size} bytes). Sending to Whisper...`);
        sendBlobForTranscription(targetBlob, audioBlob); // Pass raw blob to cache if it fails
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
        // If we are stopping and did not send a chunk, check if we have remaining offline blobs to attempt
        if (offlineBlobQueue.length > 0) {
          console.log("[MMP-Offscreen] Stop requested. Attempting final flush of offline queue...");
          const finalBlob = new Blob(offlineBlobQueue, { type: "audio/webm" });
          sendBlobForTranscription(finalBlob, finalBlob);
        } else {
          console.log("[MMP-Offscreen] Stop requested and final chunk empty. Triggering cleanup completion.");
          chrome.runtime.sendMessage({ action: "offscreenCleanupComplete" });
        }
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
      if (offlineBlobQueue.length > 0) {
        console.log("[MMP-Offscreen] Stop requested (no recorder). Flushing offline queue...");
        const finalBlob = new Blob(offlineBlobQueue, { type: "audio/webm" });
        sendBlobForTranscription(finalBlob, finalBlob);
      } else {
        console.log("[MMP-Offscreen] No active media recorder. Triggering cleanup completion.");
        chrome.runtime.sendMessage({ action: "offscreenCleanupComplete" });
      }
    }
  };

  const sendBlobForTranscription = async (blob, rawSourceBlob, attempt = 1) => {
    const formData = new FormData();
    formData.append("file", blob, "audio.webm");

    const maxAttempts = 3;
    const baseDelay = 1500; // start with 1.5s delay

    try {
      const endpoint = `${portalUrl.endsWith("/") ? portalUrl.slice(0, -1) : portalUrl}/api/transcribe`;
      const dataStorage = await new Promise((resolve) => {
        chrome.storage.local.get(["customGeminiKey"], resolve);
      });
      const headers = {};
      if (dataStorage && dataStorage.customGeminiKey) {
        headers["x-custom-gemini-key"] = dataStorage.customGeminiKey;
      }

      const response = await fetch(endpoint, {
        method: "POST",
        headers,
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

      // Successful upload - clear queue!
      offlineBlobQueue = [];

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
          sendBlobForTranscription(blob, rawSourceBlob, attempt + 1);
        }, delay);
      } else {
        console.error("[MMP-Offscreen] All transcription retry attempts failed. Buffering source chunk in offline queue.");
        if (rawSourceBlob) {
          offlineBlobQueue.push(rawSourceBlob);
        }
        // Notify background that cleanup is complete anyway to avoid hangs
        if (!recordingActive) {
          chrome.runtime.sendMessage({ action: "offscreenCleanupComplete" });
        }
      }
    }
  };
})();
