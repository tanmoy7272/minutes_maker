(() => {
  "use strict";

  const $grantBtn = document.getElementById("grantBtn");
  const $card = document.getElementById("card");
  const $iconWrapper = document.getElementById("iconWrapper");

  $grantBtn.onclick = async () => {
    try {
      // 1. Request microphone access through standard web device APIs
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      // 2. Terminate all tracks instantly to prevent continuous device capture
      stream.getTracks().forEach(track => track.stop());

      // 3. Update the UI to a premium success state
      $iconWrapper.className = "icon-wrapper success-bg";
      $iconWrapper.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" class="success-icon"><polyline points="20 6 9 17 4 12"></polyline></svg>
      `;

      $card.innerHTML = `
        <div class="logo-area">
          <div class="logo-icon">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>
          </div>
          <div class="logo-text">
            <h1>Meet Minutes Pro</h1>
          </div>
        </div>
        <div class="separator"></div>
        ${$iconWrapper.outerHTML}
        <h2 style="color: #10b981;">Access Granted!</h2>
        <p>Your microphone permission has been successfully configured. You can now close this tab and start capturing your meetings instantly.</p>
        <div style="font-size: 11px; color: #94a3b8; font-family: monospace; margin-top: 10px;">Closing tab in 2 seconds...</div>
      `;

      // 4. Clean close in 2 seconds
      setTimeout(() => {
        window.close();
      }, 2000);

    } catch (err) {
      console.error("[MMP-Permission] Permission denied or failed:", err);
      alert("Microphone access was denied. Please click the site settings toggle or lock icon in your browser address bar and enable microphone access to proceed.");
    }
  };
})();
