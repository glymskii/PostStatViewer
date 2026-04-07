import type { BrowserContext, Page } from "playwright-core";
import { randomDelay, saveState } from "./stealth";

async function typeHumanLike(page: Page, selector: string, text: string) {
  await page.click(selector);
  for (const char of text) {
    await page.keyboard.type(char, {
      delay: Math.floor(Math.random() * 100) + 50,
    });
  }
}

async function isLoggedIn(page: Page): Promise<boolean> {
  try {
    await page.goto("https://www.instagram.com/", {
      waitUntil: "domcontentloaded",
      timeout: 15000,
    });
    await randomDelay(2000, 4000);

    // If we see the login form, we're not logged in
    const loginForm = await page.$('input[name="username"]');
    return !loginForm;
  } catch {
    return false;
  }
}

async function loginToInstagram(
  context: BrowserContext,
  username: string,
  password: string,
  totpSecret?: string
): Promise<boolean> {
  const page = await context.newPage();

  try {
    // Check if already logged in via saved cookies
    if (await isLoggedIn(page)) {
      console.log("[auth] Already logged in via saved session");
      await page.close();
      return true;
    }

    console.log("[auth] Logging in to Instagram...");
    await page.goto("https://www.instagram.com/accounts/login/", {
      waitUntil: "domcontentloaded",
      timeout: 15000,
    });
    await randomDelay(2000, 4000);

    // Accept cookies dialog if present
    try {
      const cookieButton = await page.$(
        'button:has-text("Allow all cookies"), button:has-text("Allow essential and optional cookies")'
      );
      if (cookieButton) {
        await cookieButton.click();
        await randomDelay(1000, 2000);
      }
    } catch {
      // Cookie dialog may not appear
    }

    // Wait for login form
    await page.waitForSelector('input[name="username"]', { timeout: 10000 });

    // Type credentials human-like
    await typeHumanLike(page, 'input[name="username"]', username);
    await randomDelay(500, 1000);
    await typeHumanLike(page, 'input[name="password"]', password);
    await randomDelay(500, 1500);

    // Click login button
    await page.click('button[type="submit"]');
    await randomDelay(3000, 5000);

    // Check for 2FA
    const twoFactorInput = await page.$('input[name="verificationCode"]');
    if (twoFactorInput && totpSecret) {
      const { generateTOTP } = await import("./totp");
      const code = generateTOTP(totpSecret);
      console.log("[auth] Entering 2FA code...");
      await typeHumanLike(page, 'input[name="verificationCode"]', code);
      await randomDelay(500, 1000);

      const confirmButton = await page.$('button:has-text("Confirm")');
      if (confirmButton) {
        await confirmButton.click();
        await randomDelay(3000, 5000);
      }
    } else if (twoFactorInput) {
      console.error("[auth] 2FA required but no TOTP secret configured");
      await page.close();
      return false;
    }

    // Handle "Save Your Login Info?" prompt
    try {
      const saveInfoButton = await page.$(
        'button:has-text("Save Info"), button:has-text("Save info")'
      );
      if (saveInfoButton) {
        await saveInfoButton.click();
        await randomDelay(2000, 3000);
      }
    } catch {
      // May not appear
    }

    // Handle "Turn on Notifications" prompt
    try {
      const notNowButton = await page.$(
        'button:has-text("Not Now"), button:has-text("Not now")'
      );
      if (notNowButton) {
        await notNowButton.click();
        await randomDelay(1000, 2000);
      }
    } catch {
      // May not appear
    }

    // Verify login success
    const loggedIn = await isLoggedIn(page);
    if (loggedIn) {
      console.log("[auth] Login successful");
      await saveState(context);
    } else {
      console.error("[auth] Login failed — could not verify session");
    }

    await page.close();
    return loggedIn;
  } catch (error) {
    console.error("[auth] Login error:", error);
    await page.close();
    return false;
  }
}

export { loginToInstagram, isLoggedIn };
