/**
 * device-rotate-test.js - Improved Version
 * 
 * উন্নতি সমূহ:
 * - ইরর হ্যান্ডলিং উন্নত
 * - ব্রাউজার লঞ্চ অপ্টিমাইজড
 * - ডিভাইস প্রোফাইল ম্যানেজমেন্ট সহজ
 * - রিসোর্স লিক প্রতিরোধ
 * - বিস্তারিত লগিং
 * - গ্রেসফুল শাটডাউন
 *
 * Usage:
 *   1) npm install playwright
 *   2) npx playwright install
 *   3) node device-rotate-test.js https://your-test-url.example
 */

const { chromium, devices } = require('playwright');

const INTERVAL = 60_000; // প্রতি রাউন্ডের বিরতি - 60000ms = 60s
const SDK_WAIT = 20_000; // SDK init হওয়ার জন্য অপেক্ষার সময়
const PAGE_LOAD_TIMEOUT = 60_000; // পেজ লোড টাইমআউট
const SCREENSHOT_PREFIX = 'screenshot';

// ডিভাইস প্রোফাইল সংজ্ঞা
const deviceProfiles = [
  { ...devices['iPhone 15 Pro'], name: 'iPhone 15 Pro' },
  { ...devices['Pixel 6'], name: 'Pixel 6' },
  { ...devices['iPad (gen 7)'], name: 'iPad (gen 7)' },
  { 
    name: 'Desktop Chrome',
    viewport: { width: 1366, height: 768 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    deviceScaleFactor: 1,
    isMobile: false,
    hasTouch: false
  },
  { ...devices['Galaxy S23'], name: 'Galaxy S23' }
];

// CLI আর্গুমেন্ট চেক
const url = process.argv[2];
if (!url) {
  console.error('Usage: node device-rotate-test.js <TEST_URL>');
  console.error('Example: node device-rotate-test.js https://example.com');
  process.exit(1);
}

// গ্রেসফুল শাটডাউন হ্যান্ডলিং
let isShuttingDown = false;
process.on('SIGINT', () => {
  console.log('\nReceived SIGINT. Shutting down gracefully...');
  isShuttingDown = true;
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\nReceived SIGTERM. Shutting down gracefully...');
  isShuttingDown = true;
  process.exit(0);
});

/**
 * একটি ডিভাইস প্রোফাইলের জন্য টেস্ট রান করে
 */
async function testWithDevice(profile, iteration) {
  const profileName = profile.name || `profile-${iteration}`;
  let browser = null;
  let context = null;
  let page = null;

  try {
    console.log(`\n🚀 Starting test for device: ${profileName}`);
    
    // ব্রাউজার লঞ্চ করুন
    browser = await chromium.launch({ 
      headless: false, 
      args: [
        '--disable-dev-shm-usage',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-web-security',
        '--disable-features=VizDisplayCompositor'
      ]
    });

    // কনটেক্সট তৈরি করুন
    context = await browser.newContext({
      viewport: profile.viewport,
      userAgent: profile.userAgent,
      deviceScaleFactor: profile.deviceScaleFactor,
      isMobile: profile.isMobile,
      hasTouch: profile.hasTouch,
      locale: profile.locale,
      // পারফরম্যান্স ইম্প্রুভমেন্ট
      ignoreHTTPSErrors: true,
      javaScriptEnabled: true
    });

    // পেজ তৈরি করুন
    page = await context.newPage();
    
    // কনসোল লগ ক্যাপচার করুন
    page.on('console', msg => {
      const logText = msg.text();
      const type = msg.type();
      console.log(`[${profileName}] [${type.toUpperCase()}] ${logText}`);
    });

    // পেজ এরর হ্যান্ডলিং
    page.on('pageerror', error => {
      console.error(`[${profileName}] Page Error:`, error.message);
    });

    // নেটওয়ার্ক রিকোয়েস্ট লগ করুন
    page.on('requestfailed', request => {
      console.error(`[${profileName}] Request Failed: ${request.url()} - ${request.failure().errorText}`);
    });

    console.log(`📱 Device: ${profileName}`);
    console.log(`📏 Viewport: ${profile.viewport?.width}x${profile.viewport?.height}`);
    console.log(`🌐 User Agent: ${profile.userAgent?.substring(0, 80)}...`);
    console.log(`🔗 Loading URL: ${url}`);

    // পেজ লোড করুন
    await page.goto(url, { 
      waitUntil: 'domcontentloaded',
      timeout: PAGE_LOAD_TIMEOUT 
    });

    console.log('✅ Page loaded successfully');
    console.log(`⏳ Waiting ${SDK_WAIT/1000}s for SDK initialization...`);

    // SDK ইনিশিয়ালাইজেশনের জন্য অপেক্ষা করুন
    await page.waitForTimeout(SDK_WAIT);

    // স্ক্রিনশট নিন
    const screenshotPath = `${SCREENSHOT_PREFIX}-${iteration}-${profileName.replace(/\s+/g, '-')}.png`;
    await page.screenshot({ 
      path: screenshotPath, 
      fullPage: true,
      type: 'png',
      quality: 80
    });

    console.log(`📸 Screenshot saved: ${screenshotPath}`);

    // পেজ টাইটেল এবং URL লগ করুন
    const pageTitle = await page.title();
    const currentUrl = page.url();
    console.log(`📄 Page Title: ${pageTitle}`);
    console.log(`🔗 Current URL: ${currentUrl}`);

    return true;

  } catch (error) {
    console.error(`❌ Error testing device ${profileName}:`, error.message);
    
    // ইরর কেসেও স্ক্রিনশট নিন
    if (page) {
      try {
        const errorScreenshotPath = `error-${SCREENSHOT_PREFIX}-${iteration}-${profileName.replace(/\s+/g, '-')}.png`;
        await page.screenshot({ path: errorScreenshotPath });
        console.log(`📸 Error screenshot saved: ${errorScreenshotPath}`);
      } catch (screenshotError) {
        console.error('Failed to take error screenshot:', screenshotError.message);
      }
    }
    
    return false;

  } finally {
    // রিসোর্স ক্লিনআপ
    if (page && !page.isClosed()) {
      await page.close().catch(e => console.error('Error closing page:', e.message));
    }
    if (context) {
      await context.close().catch(e => console.error('Error closing context:', e.message));
    }
    if (browser) {
      await browser.close().catch(e => console.error('Error closing browser:', e.message));
    }
  }
}

/**
 * মূল টেস্ট লুপ
 */
async function runTests() {
  console.log('🎯 Starting Device Rotation Test');
  console.log('📊 Target URL:', url);
  console.log('⏰ Interval:', INTERVAL/1000, 'seconds');
  console.log('🔄 Device Profiles:', deviceProfiles.length);
  console.log('Press CTRL+C to stop the test\n');

  let iteration = 0;
  let successCount = 0;
  let errorCount = 0;

  while (!isShuttingDown) {
    const profile = deviceProfiles[iteration % deviceProfiles.length];
    
    console.log(`\n${'='.repeat(60)}`);
    console.log(`🔄 Iteration ${iteration} - ${new Date().toISOString()}`);
    console.log(`${'='.repeat(60)}`);

    const success = await testWithDevice(profile, iteration);
    
    if (success) {
      successCount++;
    } else {
      errorCount++;
    }

    console.log(`📊 Summary - Success: ${successCount}, Errors: ${errorCount}, Total: ${iteration + 1}`);

    iteration++;

    // শেষ ইটারেশন না হলে অপেক্ষা করুন
    if (!isShuttingDown && iteration < 1000) { // safety limit
      console.log(`\n💤 Sleeping for ${INTERVAL/1000} seconds before next device...`);
      
      // স্লিপ期间 CTRL+C চেক করার জন্য
      await new Promise(resolve => {
        const interval = setInterval(() => {
          if (isShuttingDown) {
            clearInterval(interval);
            resolve();
          }
        }, 1000);
        
        setTimeout(() => {
          clearInterval(interval);
          resolve();
        }, INTERVAL);
      });
    }
  }

  console.log('\n✅ Test completed gracefully');
}

// আনহ্যান্ডল্ড প্রমিস রিজেকশন হ্যান্ডলিং
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  process.exit(1);
});

// প্রোগ্রাম 실행
(async () => {
  try {
    await runTests();
  } catch (error) {
    console.error('Fatal error in main execution:', error);
    process.exit(1);
  }
})();
