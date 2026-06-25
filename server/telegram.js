const axios = require("axios");
const { getRuntimeSettings } = require("./runtimeSettings");

function getTelegramConfig() {
  const settings = getRuntimeSettings();
  return {
    token: settings.telegram_bot_token || process.env.TELEGRAM_BOT_TOKEN,
    chatId: settings.telegram_chat_id || process.env.TELEGRAM_CHAT_ID
  };
}

async function sendTelegram(message, extra = {}) {
  const { token, chatId } = getTelegramConfig();
  if (!token || !chatId) return false;

  try {
    await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
      chat_id: chatId,
      text: message,
      parse_mode: "HTML",
      disable_web_page_preview: true,
      ...extra
    });
    return true;
  } catch (err) {
    console.error("Telegram error:", err.response?.data || err.message);
    return false;
  }
}

async function answerCallbackQuery(callbackQueryId, text = "Noted") {
  const { token } = getTelegramConfig();
  if (!token || !callbackQueryId) return false;

  try {
    await axios.post(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
      callback_query_id: callbackQueryId,
      text,
      show_alert: false
    });
    return true;
  } catch (err) {
    console.error("Telegram callback answer error:", err.response?.data || err.message);
    return false;
  }
}

async function editMessageReplyMarkup(chatId, messageId, replyMarkup = null) {
  const { token } = getTelegramConfig();
  if (!token || !chatId || !messageId) return false;

  try {
    await axios.post(`https://api.telegram.org/bot${token}/editMessageReplyMarkup`, {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: replyMarkup
    });
    return true;
  } catch (err) {
    console.error("Telegram edit markup error:", err.response?.data || err.message);
    return false;
  }
}

module.exports = { sendTelegram, answerCallbackQuery, editMessageReplyMarkup, getTelegramConfig };
