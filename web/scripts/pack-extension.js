const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '../..');
const extensionDir = path.join(projectRoot, 'extension');
const publicDir = path.join(__dirname, '../public'); // relative to script folder
const zipPath = path.join(publicDir, 'meet-minutes-pro.zip');

console.log("[MMP-Builder] Starting extension packaging check...");

// Check if extension directory exists (only true on local development machine)
if (!fs.existsSync(extensionDir)) {
  console.log("[MMP-Builder] /extension directory not found. Running in Vercel cloud environment.");
  
  // Verify that a pre-built ZIP exists to avoid blank deployment
  if (fs.existsSync(zipPath)) {
    console.log("[MMP-Builder] Found committed pre-built extension ZIP. Skipping packaging.");
    process.exit(0);
  } else {
    console.warn("[MMP-Builder] WARNING: No pre-built extension ZIP found in public folder!");
    process.exit(0);
  }
}

// Ensure public directory exists
if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir, { recursive: true });
}

// Delete old zip locally to ensure a fresh build
if (fs.existsSync(zipPath)) {
  fs.unlinkSync(zipPath);
}

try {
  if (process.platform === 'win32') {
    // Windows PowerShell compression
    const cmd = `powershell -Command "Compress-Archive -Path '${extensionDir}\\*' -DestinationPath '${zipPath}' -Force"`;
    execSync(cmd, { stdio: 'inherit' });
    console.log("[MMP-Builder] Successfully packaged extension via PowerShell.");
  } else {
    // Linux/macOS zip command
    const cmd = `zip -r "${zipPath}" . -x "*.git*"`;
    execSync(cmd, { cwd: extensionDir, stdio: 'inherit' });
    console.log("[MMP-Builder] Successfully packaged extension via zip utility.");
  }
} catch (err) {
  console.error("[MMP-Builder] Failed to package extension:", err);
  process.exit(1);
}
