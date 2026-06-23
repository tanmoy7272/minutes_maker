const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '../..');
const extensionDir = path.join(projectRoot, 'extension');
const publicDir = path.join(__dirname, '../public');
const zipPath = path.join(publicDir, 'meet-minutes-pro.zip');

console.log("[MMP-Builder] Starting extension packaging check...");

// Check if extension directory exists (only true on local development machine)
if (!fs.existsSync(extensionDir)) {
  console.log("[MMP-Builder] /extension directory not found. Running in Vercel cloud environment.");
  
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

// Determine custom portal URL if any
let portalUrl = process.env.PORTAL_URL || process.env.NEXT_PUBLIC_PORTAL_URL;
if (!portalUrl && process.env.VERCEL_URL) {
  portalUrl = `https://${process.env.VERCEL_URL}`;
}

let activeSourceDir = extensionDir;
const tempBuildDir = path.join(projectRoot, 'extension-build-temp');

const copyDir = (src, dest) => {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (let entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
};

const deleteDir = (dir) => {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

if (portalUrl) {
  portalUrl = portalUrl.trim();
  const portalUrlWithSlash = portalUrl.endsWith('/') ? portalUrl : `${portalUrl}/`;
  const portalUrlWithoutSlash = portalUrl.endsWith('/') ? portalUrl.slice(0, -1) : portalUrl;

  console.log(`[MMP-Builder] Custom PORTAL_URL detected: "${portalUrlWithoutSlash}". Injecting into extension...`);
  
  try {
    // Ensure temp build directory is clean
    deleteDir(tempBuildDir);
    
    // Copy files
    copyDir(extensionDir, tempBuildDir);
    activeSourceDir = tempBuildDir;

    // Modify files in-place
    const filesToModify = [
      { name: 'manifest.json', matches: [/https:\/\/minutes-maker-five\.vercel\.app\/\*/g, `${portalUrlWithoutSlash}/*`] },
      { name: 'background.js', matches: [/https:\/\/minutes-maker-five\.vercel\.app\//g, portalUrlWithSlash] },
      { name: 'popup.js', matches: [/https:\/\/minutes-maker-five\.vercel\.app/g, portalUrlWithoutSlash] },
      { name: 'offscreen.js', matches: [/https:\/\/minutes-maker-five\.vercel\.app/g, portalUrlWithoutSlash] }
    ];

    for (const item of filesToModify) {
      const filePath = path.join(tempBuildDir, item.name);
      if (fs.existsSync(filePath)) {
        let content = fs.readFileSync(filePath, 'utf8');
        content = content.replace(item.matches[0], item.matches[1]);
        fs.writeFileSync(filePath, content, 'utf8');
        console.log(`[MMP-Builder] Patched ${item.name} successfully.`);
      }
    }
  } catch (err) {
    console.error("[MMP-Builder] Failed to patch extension files:", err);
    deleteDir(tempBuildDir);
    process.exit(1);
  }
} else {
  console.log("[MMP-Builder] No custom VERCEL_URL or PORTAL_URL configured. Zipping default extension...");
}

try {
  if (process.platform === 'win32') {
    // Windows PowerShell compression
    const cmd = `powershell -Command "Compress-Archive -Path '${activeSourceDir}\\*' -DestinationPath '${zipPath}' -Force"`;
    execSync(cmd, { stdio: 'inherit' });
    console.log("[MMP-Builder] Successfully packaged extension via PowerShell.");
  } else {
    // Linux/macOS zip command
    const cmd = `zip -r "${zipPath}" . -x "*.git*"`;
    execSync(cmd, { cwd: activeSourceDir, stdio: 'inherit' });
    console.log("[MMP-Builder] Successfully packaged extension via zip utility.");
  }
} catch (err) {
  console.error("[MMP-Builder] Failed to package extension:", err);
  process.exit(1);
} finally {
  // Always clean up the temporary directory
  if (portalUrl) {
    deleteDir(tempBuildDir);
  }
}
