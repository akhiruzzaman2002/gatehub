# Device-Rotate Test (Playwright)

This project opens a target URL repeatedly with different device emulations (every 60 seconds),
captures a screenshot and prints page console logs. Useful for testing SDKs (Start.io, Moniteg)
and verifying banner rendering on different device profiles.

## Files
- `package.json` — project metadata and dev dependency (playwright)
- `device-rotate-test.js` — main test script
- `.gitignore` — ignore node_modules and screenshots
- `README.md` — this file

## Setup & Run

1. Install Node.js (v16+ recommended).

2. Clone or copy this project folder, then install dependencies:
   ```bash
   npm install

