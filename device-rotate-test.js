/**
 * device-rotate-test.js
 *
 * Usage:
 *   1) npm install
 *   2) npx playwright install  (install browser binaries)
 *   3) node device-rotate-test.js https://your-test-url.example
 *
 * What it does:
 * - প্রতি ITERATION একটি নতুন Playwright context তৈরি করে একটি ভিন্ন ডিভাইস প্রোফাইল ব্যবহার করে URL খোলে
 * - পেজ লোড হলে 20s অপেক্ষা করে (SDK-গুলোর init/রেন্ডার হওয়ার জন্য)
 * - প্রতিটি iteration এ একটি screenshot নেয় (screenshot-0.png, screenshot-1.png ...)
 * - DevTools console এ পেজের console.logs প্রদর্শন করে
 *
 * Safety note: This does NOT change your public IP. It's device/user-agent/viewport emulation only.
 */

const { chromium, devices } = require('playwright');

const INTERVAL = 60_000; // প্রতি রাউন্ডের বিরতি — 60000ms = 60s
const SDK_WAIT = 20_000; // পেজ লোড হয়ে SDK init হওয়ার জন্য অপেক্ষার সময় (ms)
const SCREENSHOT_PREFIX = 'screenshot';

const deviceProfiles = [
  devices['iPhone 15 Pro'],
  devices['Pixel 6'],
  devices['iPad (gen 7)'],
  // Desktop profile (custom) — Playwright provides 'Desktop Chrome' via empty device, we'll set viewport & userAgent
  {
    name: 'Desktop Chrome',
    viewport: { width: 1366, height: 768 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  },
  devices['Galaxy S23']
];

// get target url from CLI
const url = process.argv[2];
if (!url) {
  console.error('Usage: node device-rotate-test.js <TEST_URL>');
  process.exit(1);
}

(async () => {
  console.log('Device-rotate test starting for URL:', url);
  console.log('Press CTRL+C to stop.');

  let iteration = 0;
  while (true) {
    const profile = deviceProfiles[iteration % deviceProfiles.length];
    const profileName = profile.name || `profile-${iteration}`;
    console.log(`\n[${new Date().toISOString()}] Iteration ${iteration} — Device: ${profileName}`);

    // Launch browser (headful recommended for visual verification)
    const browser = await chromium.launch({ headless: false, args: ['--disable-dev-shm-usage'] });

    // create context using the device profile (merge desktop custom if needed)
    const contextOptions = {};
    if (profile.viewport) contextOptions.viewport = profile.viewport;
    if (profile.userAgent) contextOptions.userAgent = profile.userAgent;
    if (profile.deviceScaleFactor) contextOptions.deviceScaleFactor = profile.deviceScaleFactor;
    if (profile.isMobile !== undefined) contextOptions.isMobile = profile.isMobile;
    if (profile.hasTouch !== undefined) contextOptions.hasTouch = profile.hasTouch;
    if (profile.locale) contextOptions.locale = profile.locale;

    const context = await browser.newContext(contextOptions);

    // if profile provides viewport and isMobile etc via devices map, apply via newContext({ ...profile })
    // (some device objects include many fields — for safety we'll try to spread the object)
    // If the device is a Playwright built-in full device, prefer using it directly:
    const isBuiltInDevice = !!devices[profile.name];
    if (isBuiltInDevice) {
      // Close the previously created context and recreate with full device descriptor
      await context.close();
      await browser.close();
      // create again using the full device descriptor
      const browser2 = await chromium.launch({ headless: false, args: ['--disable-dev-shm-usage'] });
      const context2 = await browser2.newContext(devices[profile.name]);
      const page2 = await context2.newPage();

      // page console -> node console
      page2.on('console', msg => {
        try {
          console.log(`PAGE LOG [${profileName}]>`, msg.text());
        } catch (e) { /* ignore */ }
      });

      try {
        await page2.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
        console.log('Page loaded — waiting for SDKs to initialize...');
        await page2.waitForTimeout(SDK_WAIT);

        const shot = `${SCREENSHOT_PREFIX}-${iteration}.png`;
        await page2.screenshot({ path: shot, fullPage: false });
        console.log('Saved screenshot:', shot);
      } catch (err) {
        console.error('Page load / screenshot error:', err.message || err);
      } finally {
        await context2.close();
        await browser2.close();
      }
    } else {
      // use the simpler context we created above
      const page = await context.newPage();
      page.on('console', msg => {
        try {
          console.log(`PAGE LOG [${profileName}]>`, msg.text());
        } catch (e) { /* ignore */ }
      });

      try {
        await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
        console.log('Page loaded — waiting for SDKs to initialize...');
        await page.waitForTimeout(SDK_WAIT);

        const shot = `${SCREENSHOT_PREFIX}-${iteration}.png`;
        await page.screenshot({ path: shot, fullPage: false });
        console.log('Saved screenshot:', shot);
      } catch (err) {
        console.error('Page load / screenshot error:', err.message || err);
      } finally {
        await context.close();
        await browser.close();
      }
    }

    iteration++;
    console.log(`Sleeping ${INTERVAL/1000} seconds before next device...`);
    await new Promise(resolve => setTimeout(resolve, INTERVAL));
  }
})();

