import { NextResponse } from "next/server";

/**
 * GET /api/notifications/config
 *
 * Indicates whether Telegram credentials are present, and where they
 * come from (env vs settings table). Never returns the actual token.
 * Used by the UI to disable bot-token / chat-id inputs when env vars
 * are managing the config.
 */
export async function GET() {
  const tokenFromEnv = Boolean(process.env.TELEGRAM_BOT_TOKEN);
  const chatIdFromEnv = Boolean(process.env.TELEGRAM_CHAT_ID);
  return NextResponse.json({
    telegram: {
      tokenFromEnv,
      chatIdFromEnv,
      managedByEnv: tokenFromEnv && chatIdFromEnv,
    },
  });
}
