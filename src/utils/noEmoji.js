// Chats are text only: emojis are taken out of messages (and out of older ones when shown)
const EMOJI = /\p{Extended_Pictographic}|[\u{1F1E6}-\u{1F1FF}]|[\u{1F3FB}-\u{1F3FF}]|\u{FE0F}|\u{200D}|\u{20E3}/gu;
export const noEmoji = (s) => String(s ?? "").replace(EMOJI, "").replace(/[ \t]{2,}/g, " ");
