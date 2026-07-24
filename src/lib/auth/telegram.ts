// Telegram Login Widget verification.
// Validates the hash Telegram signs so we know the login is genuine.
// Docs: https://core.telegram.org/widgets/login#checking-authorization
import crypto from "crypto";
import { SERVER_ENV } from "../config";

export interface TelegramAuthData {
  id: string;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: string;
  hash: string;
}

export function verifyTelegramLogin(data: TelegramAuthData): boolean {
  const token = SERVER_ENV.telegramBotToken;
  if (!token) return false;

  const { hash, ...rest } = data;
  const checkString = Object.keys(rest)
    .filter((k) => (rest as Record<string, unknown>)[k] !== undefined)
    .sort()
    .map((k) => `${k}=${(rest as Record<string, string>)[k]}`)
    .join("\n");

  const secret = crypto.createHash("sha256").update(token).digest();
  const hmac = crypto
    .createHmac("sha256", secret)
    .update(checkString)
    .digest("hex");

  if (hmac !== hash) return false;

  // Reject logins older than 24h.
  const authDate = Number(data.auth_date) * 1000;
  if (Date.now() - authDate > 24 * 3600 * 1000) return false;
  return true;
}
