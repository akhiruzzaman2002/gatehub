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
const fs = require('fs').promises;

const INTERVAL = 60_000; // প্রতি রাউন্ডের বিরতি - 60000ms = 60s
const SDK_WAIT = 20_000; // SDK init হওয়ার জন্য অপেক্ষার সময়
const PAGE_LOAD_TIMEOUT = 60_000; // পেজ লোড টাইমআউট
const SCREENSHOT_PREFIX = 'screenshot';
const MAX_ITERATIONS = 1000; // সেফটি লিমিট

// ডিভাইস প্রোফাইল সংজ্ঞা - ফিক্সড
const deviceProfiles = [
  { 
    ...devices['iPhone 15 Pro'], 
    name: 'iPhone 15 Pro',
    viewport: devices['iPhone 15 Pro'].viewport 
  },
  { 
    ...devices['Pixel 6'], 
    name: 'Pixel 6',
    viewport: devices['Pixel 6'].viewport 
  },
  { 
    ...devices['iPad (gen 7)'], 
    name: 'iPad (gen 7)',
    viewport: devices['iPad (gen 7)'].viewport 
  },
  { 
    name: 'Desktop Chrome',
    viewport: { width: 1366, height: 768 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    deviceScaleFactor: 1,
    isMobile: false,
    hasTouch: false
  },
  { 
    ...devices['Galaxy S23'], 
    name: 'Galaxy S23',
    viewport: devices['Galaxy S23'].viewport 
  }
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
let currentTest = null;

process.on('SIGINT', async () => {
  console.log('\nReceived SIGINT. Shutting down gracefully...');
  isShuttingDown = true;
  if (currentTest) {
    await currentTest.cleanup().catch(console.error);
  }
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\nReceived SIGTERM. Shutting down gracefully...');
  isShuttingDown = true;
  if (currentTest) {
    await currentTest.cleanup().catch(console.error);
  }
  process.exit(0);
});

class DeviceTester {
  constructor(profile, iteration) {
    this.profile = profile;
    this.iteration = iteration;
    this.profileName = profile.name || `profile-${iteration}`;
    this.browser = null;
    this.context = null;
    this.page = null;
    this.cleanupCalled = false;
  }

  async cleanup() {
    if (this.cleanupCalled) return;
    this.cleanupCalled = true;

    const cleanupTasks = [];
    
    if (this.page && !this.page.isClosed()) {
      cleanupTasks.push(this.page.close().catch(e => 
        console.error(`Error closing page for ${this.profileName}:`, e.message))
      );
    }
    
    if (this.context) {
      cleanupTasks.push(this.context.close().catch(e => 
        console.error(`Error closing context for ${this.profileName}:`, e.message))
      );
    }
    
    if (this.browser) {
      cleanupTasks.push(this.browser.close().catch(e => 
        console.error(`Error closing browser for ${this.profileName}:`, e.message))
      );
    }

    await Promise.allSettled(cleanupTasks);
    this.page = null;
    this.context = null;
    this.browser = null;
  }

  async test() {
    try {
      console.log(`\n🚀 Starting test for device: ${this.profileName}`);
      
      // ব্রাউজার লঞ্চ করুন
      this.browser = await chromium.launch({ 
        headless: true, // হেডলেস মোডে চালান for stability
        args: [
          '--disable-dev-shm-usage',
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-web-security',
          '--disable-features=VizDisplayCompositor',
          '--disable-gpu',
          '--disable-software-rasterizer'
        ],
        timeout: 30000
      });

      // কনটেক্সট তৈরি করুন
      this.context = await this.browser.newContext({
        viewport: this.profile.viewport,
        userAgent: this.profile.userAgent,
        deviceScaleFactor: this.profile.deviceScaleFactor || 1,
        isMobile: this.profile.isMobile || false,
        hasTouch: this.profile.hasTouch || false,
        locale: this.profile.locale || 'en-US',
        ignoreHTTPSErrors: true,
        javaScriptEnabled: true
      });

      // পেজ তৈরি করুন
      this.page = await this.context.newPage();
      
      // ইভেন্ট হ্যান্ডলার সেটআপ
      this.setupEventHandlers();

      console.log(`📱 Device: ${this.profileName}`);
      console.log(`📏 Viewport: ${this.profile.viewport?.width}x${this.profile.viewport?.height}`);
      console.log(`🌐 User Agent: ${this.profile.userAgent?.substring(0, 80)}...`);
      console.log(`🔗 Loading URL: ${url}`);

      // পেজ লোড করুন with better error handling
      await this.loadPage();

      console.log('✅ Page loaded successfully');
      console.log(`⏳ Waiting ${SDK_WAIT/1000}s for SDK initialization...`);

      // SDK ইনিশিয়ালাইজেশনের জন্য অপেক্ষা করুন
      await this.page.waitForTimeout(SDK_WAIT);

      // স্ক্রিনশট নিন
      await this.takeScreenshot();

      // পেজ ইনফো সংগ্রহ করুন
      await this.collectPageInfo();

      return true;

    } catch (error) {
      console.error(`❌ Error testing device ${this.profileName}:`, error.message);
      await this.takeErrorScreenshot();
      return false;

    } finally {
      await this.cleanup();
    }
  }

  setupEventHandlers() {
    // কনসোল লগ ক্যাপচার করুন
    this.page.on('console', msg => {
      const logText = msg.text();
      const type = msg.type();
      if (type === 'error' || type === 'warning') {
        console.log(`[${this.profileName}] [${type.toUpperCase()}] ${logText}`);
      }
    });

    // পেজ এরর হ্যান্ডলিং
    this.page.on('pageerror', error => {
      console.error(`[${this.profileName}] Page Error:`, error.message);
    });

    // নেটওয়ার্ক রিকোয়েস্ট লগ করুন
    this.page.on('requestfailed', request => {
      const failure = request.failure();
      if (failure) {
        console.error(`[${this.profileName}] Request Failed: ${request.url()} - ${failure.errorText}`);
      }
    });

    // রেসপন্স হ্যান্ডলিং
    this.page.on('response', response => {
      if (!response.ok()) {
        console.warn(`[${this.profileName}] HTTP ${response.status(): ${response.url()}`);
      }
    });
  }

  async loadPage() {
    try {
      await this.page.goto(url, { 
        waitUntil: 'networkidle',
        timeout: PAGE_LOAD_TIMEOUT 
      });
    } catch (error) {
      // networkidle ফেললে domcontentloaded try করুন
      if (error.name === 'TimeoutError') {
        console.log('Trying domcontentloaded as fallback...');
        await this.page.goto(url, { 
          waitUntil: 'domcontentloaded',
          timeout: PAGE_LOAD_TIMEOUT 
        });
      } else {
        throw error;
      }
    }
  }

  async takeScreenshot() {
    const safeName = this.profileName.replace(/[^a-z0-9]/gi, '-');
    const screenshotPath = `${SCREENSHOT_PREFIX}-${this.iteration}-${safeName}.png`;
    
    await this.page.screenshot({ 
      path: screenshotPath, 
      fullPage: true,
      type: 'png',
      quality: 80,
      timeout: 10000
    });

    console.log(`📸 Screenshot saved: ${screenshotPath}`);
  }

  async takeErrorScreenshot() {
    if (!this.page) return;
    
    try {
      const safeName = this.profileName.replace(/[^a-z0-9]/gi, '-');
      const errorScreenshotPath = `error-${SCREENSHOT_PREFIX}-${this.iteration}-${safeName}.png`;
      await this.page.screenshot({ 
        path: errorScreenshotPath,
        timeout: 5000 
      });
      console.log(`📸 Error screenshot saved: ${errorScreenshotPath}`);
    } catch (screenshotError) {
      console.error('Failed to take error screenshot:', screenshotError.message);
    }
  }

  async collectPageInfo() {
    try {
      const pageTitle = await this.page.title();
      const currentUrl = this.page.url();
      console.log(`📄 Page Title: ${pageTitle}`);
      console.log(`🔗 Current URL: ${currentUrl}`);
    } catch (error) {
      console.error('Error collecting page info:', error.message);
    }
  }
}

/**
 * একটি ডিভাইস প্রোফাইলের জন্য টেস্ট রান করে
 */
async function testWithDevice(profile, iteration) {
  const tester = new DeviceTester(profile, iteration);
  currentTest = tester;
  const result = await tester.test();
  currentTest = null;
  return result;
}

/**
 * মূল টেস্ট লুপ
 */
async function runTests() {
  console.log('🎯 Starting Device Rotation Test');
  console.log('📊 Target URL:', url);
  console.log('⏰ Interval:', INTERVAL/1000, 'seconds');
  console.log('🔄 Device Profiles:', deviceProfiles.length);
  console.log('📁 Screenshot Prefix:', SCREENSHOT_PREFIX);
  console.log('Press CTRL+C to stop the test\n');

  let iteration = 0;
  let successCount = 0;
  let errorCount = 0;

  // স্ক্রিনশট ডিরেক্টরি চেক করুন
  try {
    await fs.access('./');
    console.log('✅ Current directory is accessible for screenshots');
  } catch (error) {
    console.error('❌ Cannot write to current directory:', error.message);
    return;
  }

  while (!isShuttingDown && iteration < MAX_ITERATIONS) {
    const profileIndex = iteration % deviceProfiles.length;
    const profile = deviceProfiles[profileIndex];
    
    console.log(`\n${'='.repeat(60)}`);
    console.log(`🔄 Iteration ${iteration + 1} - ${new Date().toLocaleString()}`);
    console.log(`📱 Device ${profileIndex + 1}/${deviceProfiles.length}: ${profile.name}`);
    console.log(`${'='.repeat(60)}`);

    const success = await testWithDevice(profile, iteration);
    
    if (success) {
      successCount++;
    } else {
      errorCount++;
    }

    const totalTests = iteration + 1;
    const successRate = ((successCount / totalTests) * 100).toFixed(1);
    
    console.log(`📊 Summary - Success: ${successCount}, Errors: ${errorCount}, Total: ${totalTests}, Success Rate: ${successRate}%`);

    iteration++;

    // শেষ ইটারেশন না হলে অপেক্ষা করুন
    if (!isShuttingDown && iteration < MAX_ITERATIONS) {
      console.log(`\n💤 Sleeping for ${INTERVAL/1000} seconds before next device...`);
      
      await sleepWithInterrupt(INTERVAL);
    }
  }

  console.log('\n✅ Test completed');
  console.log(`🎯 Final Stats - Success: ${successCount}, Errors: ${errorCount}, Total Iterations: ${iteration}`);
}

/**
 * ইন্টারাপ্ট করা যায় এমন স্লিপ ফাংশন
 */
function sleepWithInterrupt(ms) {
  return new Promise(resolve => {
    const checkInterval = setInterval(() => {
      if (isShuttingDown) {
        clearInterval(checkInterval);
        resolve();
      }
    }, 1000);
    
    const timeout = setTimeout(() => {
      clearInterval(checkInterval);
      resolve();
    }, ms);

    // শাটডাউন হলে ক্লিয়ার করুন
    if (isShuttingDown) {
      clearTimeout(timeout);
      clearInterval(checkInterval);
      resolve();
    }
  });
}

// আনহ্যান্ডল্ড প্রমিস রিজেকশন হ্যান্ডলিং
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  if (currentTest) {
    currentTest.cleanup().catch(console.error);
  }
  process.exit(1);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  if (currentTest) {
    currentTest.cleanup().catch(console.error);
  }
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
