(() => {
  "use strict";

  let mediaRecorder = null;
  let recordedChunks = [];
  let recordingInterval = null;
  let recordingActive = false;
  let portalUrl = "https://minutes-maker-five.vercel.app";

  let captureInitiated = false;
  let offlineBlobQueue = [];
  let customGeminiKey = "";

  let audioCtx = null;
  let tabSource = null;
  let micSource = null;
  let mixedDestination = null;
  let analyser = null;
  let chunkHasAudio = false;
  let volumeCheckTimeout = null;
  const volumeData = new Uint8Array(128);

  const checkVolume = () => {
    if (!recordingActive || !analyser) return;
    try {
      analyser.getByteTimeDomainData(volumeData);
      let sum = 0;
      for (let i = 0; i < volumeData.length; i++) {
        const val = (volumeData[i] - 128) / 128;
        sum += val * val;
      }
      const rms = Math.sqrt(sum / volumeData.length);
      if (rms > 0.015) { // Active speaking volume threshold (filters out silent white noise)
        chunkHasAudio = true;
      }
    } catch (err) {
      console.warn("[MMP-Offscreen] Volume check failed:", err);
    }
    volumeCheckTimeout = setTimeout(checkVolume, 500);
  };

  const initCaptureFlow = async (streamId) => {
    if (captureInitiated) return;
    captureInitiated = true;

    console.log(`[MMP-Offscreen] Initiating capture for stream ID: ${streamId}`);
    
    try {
      // 1. Capture the exact tab audio stream using standard mediaDevices token
      const tabStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          chromeMediaSource: "tab",
          chromeMediaSourceId: streamId
        },
        video: false
      });

      // Track ended handler to auto-cleanup when tab closes / redirects
      tabStream.getAudioTracks().forEach(track => {
        console.log(`[MMP-Offscreen] Tab Audio Track: label="${track.label}", active=${track.active}, enabled=${track.enabled}`);
        track.onended = () => {
          console.log("[MMP-Offscreen] Tab stream audio track ended. Stopping capture...");
          stopRecordingStream();
        };
      });

      // 2. WEB AUDIO MIX & LOOPBACK: Capture silences local tab speakers natively.
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      
      // Auto-resume AudioContext dynamically if suspended by device changes/sleep states
      audioCtx.onstatechange = () => {
        console.log(`[MMP-Offscreen] AudioContext state changed to: ${audioCtx.state}`);
        if (audioCtx.state === "suspended") {
          audioCtx.resume().catch(e => console.warn("[MMP-Offscreen] Failed to resume AudioContext:", e));
        }
      };

      if (audioCtx.state === "suspended") {
        await audioCtx.resume();
      }
      tabSource = audioCtx.createMediaStreamSource(tabStream);
      
      // Loop back tab audio to speakers
      tabSource.connect(audioCtx.destination);
      console.log("[MMP-Offscreen] Web Audio Loopback speaker pipe successful.");

      // Create a mixed destination stream to record both inputs
      mixedDestination = audioCtx.createMediaStreamDestination();
      tabSource.connect(mixedDestination);

      // Create AnalyserNode to monitor amplitude and skip silent segments
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      tabSource.connect(analyser);

      let finalStream = mixedDestination.stream;

      // Try to capture user's own microphone and mix it in with echo cancellation
      try {
        const micStream = await navigator.mediaDevices.getUserMedia({ 
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
          } 
        });
        micStream.getAudioTracks().forEach(track => {
          console.log(`[MMP-Offscreen] Mic Audio Track: label="${track.label}", active=${track.active}, enabled=${track.enabled}`);
        });
        micSource = audioCtx.createMediaStreamSource(micStream);
        micSource.connect(mixedDestination);
        micSource.connect(analyser);
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
      if (msg.customGeminiKey) {
        customGeminiKey = msg.customGeminiKey;
      }
      initCaptureFlow(msg.streamId);
    } else if (msg.action === "stopCapture") {
      console.log("[MMP-Offscreen] Received stopCapture instruction.");
      stopRecordingStream();
      sendResponse({ ok: true });
    } else if (msg.action === "pingOffscreen") {
      sendResponse({ ok: true });
    }
  });

  const startRecordingStream = (stream) => {
    recordingActive = true;
    recordedChunks = [];
    chunkHasAudio = false;
    checkVolume();
    
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

      // Filter out chunks that are completely silent (no audio amplitude detected above noise threshold)
      const hasOffline = offlineBlobQueue.length > 0;
      if (audioBlob.size > 1000) {
        if (!chunkHasAudio && !hasOffline) {
          console.log("[MMP-Offscreen] Audio segment is silent. Skipping API transcription upload to conserve rate limits.");
        } else {
          let targetBlob = audioBlob;
          if (hasOffline) {
            console.log(`[MMP-Offscreen] Concatenating ${offlineBlobQueue.length} offline cached slices with current slice.`);
            targetBlob = new Blob([...offlineBlobQueue, audioBlob], { type: audioBlob.type });
          }

          console.log(`[MMP-Offscreen] Slicing segmented blob (${targetBlob.size} bytes). Sending to Whisper...`);
          sendBlobForTranscription(targetBlob, audioBlob); // Pass raw blob to cache if it fails
          sentForTranscription = true;
        }
      }
      chunkHasAudio = false; // Reset for next segment

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

    // Slices audio every 40 seconds to provide responsive transcripts and pings service worker to prevent sleep
    recordingInterval = setInterval(() => {
      if (mediaRecorder && mediaRecorder.state === "recording") {
        mediaRecorder.stop(); // Stops, compiles current blob, and auto-recycles
      }
      // Heartbeat ping to keep service worker active during long sessions
      try {
        chrome.runtime.sendMessage({ action: "keepAlive" });
      } catch (_) {}
    }, 40000);
  };

  const stopRecordingStream = () => {
    recordingActive = false;
    
    if (volumeCheckTimeout) {
      clearTimeout(volumeCheckTimeout);
      volumeCheckTimeout = null;
    }
    analyser = null;
    
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
      const headers = {};
      if (customGeminiKey) {
        headers["x-custom-gemini-key"] = customGeminiKey;
      } else if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
        try {
          const dataStorage = await new Promise((resolve) => {
            chrome.storage.local.get(["customGeminiKey"], resolve);
          });
          if (dataStorage && dataStorage.customGeminiKey) {
            headers["x-custom-gemini-key"] = dataStorage.customGeminiKey;
          }
        } catch (_) {}
      }

      const response = await fetch(endpoint, {
        method: "POST",
        headers,
        body: formData
      });

      if (!response.ok) {
        let errMsg = `HTTP ${response.status} ${response.statusText}`;
        try {
          const errData = await response.json();
          if (errData && errData.error) {
            errMsg = errData.error;
          }
        } catch (_) {
          try {
            const txt = await response.text();
            if (txt) errMsg = txt.substring(0, 100);
          } catch (_) {}
        }
        throw new Error(errMsg);
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
        
        try {
          chrome.runtime.sendMessage({ 
            action: "transcriptionFailed", 
            error: err.message || String(err) 
          });
        } catch (_) {}

        if (rawSourceBlob) {
          // Prevent queue from growing past 3 chunks (approx 1 minute of audio) to avoid Payload Too Large (413) on Vercel
          if (offlineBlobQueue.length >= 3) {
            console.warn("[MMP-Offscreen] Offline queue is full. Discarding oldest chunk to prevent memory bloat and API payload rejection.");
            offlineBlobQueue.shift();
          }
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
