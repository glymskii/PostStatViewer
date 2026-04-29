import { NextResponse } from "next/server";
import { sendTelegram, formatAlertText } from "@/scraper/common/notify";

/**
 * POST /api/notifications/test
 * Sends a test message via the configured Telegram bot. Useful as a
 * one-click sanity check after entering bot token / chat id in /settings.
 * No body required.
 */
export async function POST() {
  const text = formatAlertText({
    severity: "test",
    message:
      "Hello from PostStatViewer! If you see this, your Telegram alerts are wired up correctly.",
  });
  const result = await sendTelegram(text);
  if (!result.ok) {
    return NextResponse.json(
      {
        ok: false,
        error:
          result.error === "telegram_not_configured"
            ? "Сначала задай telegram_bot_token и telegram_chat_id в настройках."
            : `Не удалось отправить: ${result.error}`,
      },
      { status: 400 }
    );
  }
  return NextResponse.json({ ok: true });
}
