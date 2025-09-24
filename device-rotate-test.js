/**
 * device-rotate-test.js - Improved Version
 * 
 * উন্নতি সমূহ:
 * - Better 404 error handling
 * - Enhanced network monitoring
 * - Improved page status checking
 * - Better screenshot management
 */

const { chromium, devices } = require('playwright');
const fs = require('fs').promises;
const path = require('path');

const INTERVAL = 60_000;
const SDK_WAIT = 20_000;
const PAGE_LOAD_TIMEOUT = 60_000;
const SCREENSHOT_PREFIX = 'screenshot';
const MAX_ITERATIONS = 1000;

// Screenshots directory create করবেন
const SCREENSHOT_DIR = 'screenshots';

// ডিভাইস প্রোফাইল সংজ্ঞা
const deviceProfiles = [
  { 
    ...devices['iPhone 15 Pro'], 
    name: 'iPhone 15 Pro'
  },
  { 
    ...devices['Pixel 6'], 
    name: 'Pixel 6'
  },
  { 
    ...devices['iPad (gen 7)'], 
    name: 'iPad (gen 7)'
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
    name: 'Galaxy S23'
  }
];

// CLI আর্গুমেন্ট চেক
const url = process.argv[2];
if (!url) {
  console.error('❌ Usage: node device-rotate-test.js <TEST_URL>');
  console.error('📖 Example: node device-rotate-test.js https://example.com');
  console.error('💡 Tips: URL must include http:// or https://');
  process.exit(1);
}

// URL validation
if (!url.startsWith('http://') && !url.startsWith('https://')) {
  console.error('❌ Invalid URL format. Must start with http:// or https://');
  console.error('💡 Example: https://example.com');
  process.exit(1);
}

// গ্রেসফুল শাটডাউন হ্যান্ডলিং
let isShuttingDown = false;
let currentTest = null;

process.on('SIGINT', async () => {
  console.log('\n🛑 Received SIGINT. Shutting down gracefully...');
  isShuttingDown = true;
  if (currentTest) {
    await currentTest.cleanup().catch(console.error);
  }
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n🛑 Received SIGTERM. Shutting down gracefully...');
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
    this.pageStatus = 'unknown';
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
  }

  async test() {
    try {
      console.log(`\n🚀 Starting test for device: ${this.profileName}`);
      
      // Screenshot directory create করুন
      await this.ensureScreenshotDir();

      // ব্রাউজার লঞ্চ করুন
      this.browser = await chromium.launch({ 
        headless: true,
        args: [
          '--disable-dev-shm-usage',
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-web-security'
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
        ignoreHTTPSErrors: true
      });

      // পেজ তৈরি করুন
      this.page = await this.context.newPage();
      
      // ইভেন্ট হ্যান্ডলার সেটআপ
      this.setupEventHandlers();

      console.log(`📱 Device: ${this.profileName}`);
      console.log(`📏 Viewport: ${this.profile.viewport?.width}x${this.profile.viewport?.height}`);
      console.log(`🔗 Loading URL: ${url}`);

      // পেজ লোড করুন with better error handling
      await this.loadPage();

      // পেজ স্ট্যাটাস চেক করুন
      await this.checkPageStatus();

      console.log(`⏳ Waiting ${SDK_WAIT/1000}s for SDK initialization...`);
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

  async ensureScreenshotDir() {
    try {
      await fs.access(SCREENSHOT_DIR);
    } catch {
      await fs.mkdir(SCREENSHOT_DIR, { recursive: true });
      console.log(`📁 Created screenshot directory: ${SCREENSHOT_DIR}`);
    }
  }

  setupEventHandlers() {
    // Network responses monitor
    this.page.on('response', response => {
      const status = response.status();
      if (status >= 400) {
        console.warn(`[${this.profileName}] HTTP ${status}: ${response.url()}`);
        
        if (status === 404) {
          this.pageStatus = '404';
          console.error(`❌ 404 Page Not Found: ${response.url()}`);
        }
      }
    });

    // Console errors
    this.page.on('console', msg => {
      if (msg.type() === 'error') {
        console.log(`[${this.profileName}] Console Error: ${msg.text()}`);
      }
    });

    // Page errors
    this.page.on('pageerror', error => {
      console.error(`[${this.profileName}] Page Error:`, error.message);
    });

    // Request failures
    this.page.on('requestfailed', request => {
      const failure = request.failure();
      if (failure) {
        console.error(`[${this.profileName}] Request Failed: ${request.url()} - ${failure.errorText}`);
      }
    });
  }

  async loadPage() {
    try {
      const response = await this.page.goto(url, { 
        waitUntil: 'domcontentloaded',
        timeout: PAGE_LOAD_TIMEOUT 
      });

      if (!response) {
        throw new Error('No response received from page load');
      }

      const status = response.status();
      console.log(`📊 HTTP Status: ${status}`);

      if (status >= 400) {
        throw new Error(`HTTP ${status} - ${response.statusText()}`);
      }

    } catch (error) {
      if (error.name === 'TimeoutError') {
        console.log('⏰ Page load timeout, trying to continue...');
        // Continue even if timeout
      } else {
        throw error;
      }
    }
  }

  async checkPageStatus() {
    try {
      // Check for common error pages
      const pageTitle = await this.page.title();
      const pageContent = await this.page.content();
      
      if (pageTitle.includes('404') || pageTitle.includes('Not Found')) {
        this.pageStatus = '404';
        console.error('❌ 404 Error detected from page title');
      }
      
      if (pageContent.includes('404') || pageContent.includes('Page Not Found')) {
        this.pageStatus = '404';
        console.error('❌ 404 Error detected from page content');
      }

      // Check for Netlify 404 page
      if (pageContent.includes('Netlify') && pageContent.includes('page not found')) {
        this.pageStatus = '404';
        console.error('❌ Netlify 404 Page detected');
      }

      if (this.pageStatus === 'unknown') {
        this.pageStatus = '200';
        console.log('✅ Page appears to be loaded successfully');
      }

    } catch (error) {
      console.error('Error checking page status:', error.message);
    }
  }

  async takeScreenshot() {
    try {
      const safeName = this.profileName.replace(/[^a-z0-9]/gi, '-').toLowerCase();
      const statusSuffix = this.pageStatus === '404' ? '-404-error' : '';
      const screenshotPath = path.join(
        SCREENSHOT_DIR, 
        `${SCREENSHOT_PREFIX}-${this.iteration}-${safeName}${statusSuffix}.png`
      );
      
      await this.page.screenshot({ 
        path: screenshotPath, 
        fullPage: true,
        type: 'png',
        quality: 80,
        timeout: 10000
      });

      console.log(`📸 Screenshot saved: ${screenshotPath}`);

    } catch (error) {
      console.error('Error taking screenshot:', error.message);
    }
  }

  async takeErrorScreenshot() {
    if (!this.page) return;
    
    try {
      const safeName = this.profileName.replace(/[^a-z0-9]/gi, '-').toLowerCase();
      const screenshotPath = path.join(
        SCREENSHOT_DIR,
        `error-${SCREENSHOT_PREFIX}-${this.iteration}-${safeName}.png`
      );
      
      await this.page.screenshot({ 
        path: screenshotPath,
        timeout: 5000 
      });
      
      console.log(`📸 Error screenshot saved: ${screenshotPath}`);
    } catch (screenshotError) {
      console.error('Failed to take error screenshot:', screenshotError.message);
    }
  }

  async collectPageInfo() {
    try {
      const pageTitle = await this.page.title();
      const currentUrl = this.page.url();
      
      console.log(`📄 Page Title: "${pageTitle}"`);
      console.log(`🔗 Current URL: ${currentUrl}`);
      console.log(`📊 Page Status: ${this.pageStatus}`);

      // Check if page is actually loaded
      const bodyText = await this.page.evaluate(() => document.body.innerText);
      console.log(`📝 Content length: ${bodyText.length} characters`);

    } catch (error) {
      console.error('Error collecting page info:', error.message);
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
  console.log('📁 Screenshot Directory:', SCREENSHOT_DIR);
  console.log('\n💡 Press CTRL+C to stop the test');
  console.log('='.repeat(60));

  let iteration = 0;
  let successCount = 0;
  let errorCount = 0;
  let page404Count = 0;

  // Screenshot directory create করুন
  try {
    await fs.mkdir(SCREENSHOT_DIR, { recursive: true });
  } catch (error) {
    console.error('Error creating screenshot directory:', error.message);
  }

  while (!isShuttingDown && iteration < MAX_ITERATIONS) {
    const profileIndex = iteration % deviceProfiles.length;
    const profile = deviceProfiles[profileIndex];
    
    console.log(`\n${'='.repeat(60)}`);
    console.log(`🔄 Iteration ${iteration + 1} - ${new Date().toLocaleString()}`);
    console.log(`📱 Device ${profileIndex + 1}/${deviceProfiles.length}: ${profile.name}`);
    console.log(`${'='.repeat(60)}`);

    const tester = new DeviceTester(profile, iteration);
    currentTest = tester;
    const success = await tester.test();
    currentTest = null;
    
    if (success) {
      successCount++;
      if (tester.pageStatus === '404') {
        page404Count++;
        console.error('🚨 404 ERROR DETECTED! The page was not found.');
      }
    } else {
      errorCount++;
    }

    const totalTests = iteration + 1;
    const successRate = ((successCount / totalTests) * 100).toFixed(1);
    
    console.log(`\n📊 Summary:`);
    console.log(`   ✅ Success: ${successCount}`);
    console.log(`   ❌ Errors: ${errorCount}`);
    console.log   (`   404 Pages: ${page404Count}`);
    console.log(`   📈 Success Rate: ${successRate}%`);
    console.log(`   🔄 Total Iterations: ${totalTests}`);

    if (page404Count > 0) {
      console.log(`\n🚨 ALERT: ${page404Count} tests detected 404 errors!`);
      console.log(`💡 Check if the URL is correct: ${url}`);
    }

    iteration++;

    // শেষ ইটারেশন না হলে অপেক্ষা করুন
    if (!isShuttingDown && iteration < MAX_ITERATIONS) {
      console.log(`\n💤 Sleeping for ${INTERVAL/1000} seconds...`);
      await sleepWithInterrupt(INTERVAL);
    }
  }

  console.log('\n✅ Test completed');
  console.log(`🎯 Final Stats - Success: ${successCount}, Errors: ${errorCount}, 404s: ${page404Count}`);
}

function sleepWithInterrupt(ms) {
  return new Promise(resolve => {
    const timeout = setTimeout(resolve, ms);
    
    const checkInterval = setInterval(() => {
      if (isShuttingDown) {
        clearTimeout(timeout);
        clearInterval(checkInterval);
        resolve();
      }
    }, 1000);
  });
}

// Error handling
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection:', reason);
  process.exit(1);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  process.exit(1);
});

(async () => {
  try {
    await runTests();
  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  }
})();

