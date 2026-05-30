(() => {
  "use strict";

  let mediaRecorder = null;
  let recordedChunks = [];
  let recordingInterval = null;
  let recordingActive = false;
  let portalUrl = "https://minutes-maker-five.vercel.app";

  // Load configured portal URL from storage
  chrome.storage.local.get(["portalUrl"], (data) => {
    if (data.portalUrl) {
      portalUrl = data.portalUrl;
    }
  });

  chrome.runtime.onMessage.addListener(async (msg) => {
    if (msg.action === "initiateCapture") {
      const { streamId } = msg;
      console.log(`[MMP-Offscreen] Initiating capture for stream ID: ${streamId}`);
      
      try {
        // 1. Capture the exact tab audio stream using standard mediaDevices token
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            mandatory: {
              chromeMediaSource: "tab",
              chromeMediaSourceId: streamId
            }
          },
          video: false
        });

        // 2. WEB AUDIO LOOPBACK: Capture silences local tab speakers natively. 
        // We create an AudioContext destination link to pipe sound back to user's hardware.
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const source = audioCtx.createMediaStreamSource(stream);
        source.connect(audioCtx.destination);
        console.log("[MMP-Offscreen] Web Audio Loopback speaker pipe successful.");

        // 3. Initiate active recording context
        startRecordingStream(stream);
      } catch (err) {
        console.error("[MMP-Offscreen] getUserMedia tab capture failed:", err);
        chrome.runtime.sendMessage({ action: "captureError", error: err.message });
      }
    } else if (msg.action === "stopCapture") {
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
      const audioBlob = new Blob(recordedChunks, { type: mediaRecorder.mimeType || "audio/webm" });
      recordedChunks = [];

      // Safe size filter: ignore micro-silent recordings (less than 1KB)
      if (audioBlob.size > 1000 && recordingActive) {
        console.log(`[MMP-Offscreen] Slicing segmented blob (${audioBlob.size} bytes). Sending to Whisper...`);
        sendBlobForTranscription(audioBlob);
      }

      // Automatically recycle and restart MediaRecorder for continuous progressive segments
      if (recordingActive) {
        try {
          mediaRecorder.start();
        } catch (e) {
          console.error("[MMP-Offscreen] Failed to auto-restart recorder:", e);
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
    }

    // Terminate offscreen context safely after cleanup
    setTimeout(() => {
      window.close();
    }, 500);
  };

  const sendBlobForTranscription = async (blob) => {
    const formData = new FormData();
    formData.append("file", blob, "audio.webm");

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
    } catch (err) {
      console.error("[MMP-Offscreen] Transcription transmission failed:", err);
    }
  };
})();
