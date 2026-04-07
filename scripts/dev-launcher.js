// Launcher that ensures node is in PATH for ALL child processes (including Turbopack)
const path = require("path");
const { execSync } = require("child_process");

// Add nvm node bin to PATH so Turbopack child processes can find node
const nodeDir = path.dirname(process.execPath);
process.env.PATH = `${nodeDir}:${process.env.PATH || ""}`;

// Also create a symlink in /usr/local/bin if it doesn't point to our node
// Alternatively, just ensure PATH is set before requiring next
console.log(`[dev-launcher] Node: ${process.execPath}`);
console.log(`[dev-launcher] PATH includes: ${nodeDir}`);

// Start next dev
require("next/dist/bin/next");
