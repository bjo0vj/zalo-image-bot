// index.js
const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const DATA_FILE = path.join(__dirname, 'botdata.json');

// === CONFIG ===
const OA_TOKEN = process.env.ZALO_OA_TOKEN || '1820869734993300256';
const TARGET_DEFAULT = 10;
// =============

console.log('OA_TOKEN=', OA_TOKEN);

// Load hoặc init state
let state = { targetCount: TARGET_DEFAULT, counting: false, countedUsers: [] };
try {
  if (fs.existsSync(DATA_FILE)) {
    state = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    console.log('Loaded state:', state);
  }
} catch (e) {
  console.warn('Không thể load file dữ liệu, dùng state mặc định.', e);
}

function saveState() {
  try { fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2), 'utf8'); }
  catch (e) { console.error('Lỗi khi lưu state:', e); }
}

// Helper gửi message
async function sendMessage(target, text, isConversation = true) {
  if (!OA_TOKEN) return console.warn('⚠️ Không có OA_TOKEN, không gửi tin nhắn.');
  const url = 'https://openapi.zalo.me/v2.0/oa/message';
  const headers = { 'access_token': OA_TOKEN, 'Content-Type': 'application/json' };
  const body = isConversation
    ? { recipient: { conversation_id: target }, message: { text } }
    : { recipient: { user_id: target }, message: { text } };
  try { await axios.post(url, body, { headers }); }
  catch (err) { console.error('Gửi tin nhắn thất bại:', err.response?.data || err.message); }
}

// Express setup
const app = express();
app.use(bodyParser.json());

// Health check
app.get('/health', (req, res) => res.send('OK'));

// Status
app.get('/status', (req, res) => res.json({
  counting: state.counting,
  targetCount: state.targetCount,
  countedUsers: state.countedUsers.length
}));

// Webhook Zalo
app.post('/webhook', async (req, res) => {
  res.status(200).send('OK'); // trả ngay 200
  const payload = req.body;

  const messageObj = payload.message || payload.data || {};
  const sender = payload.sender?.id || messageObj.from?.id || messageObj.sender?.id || null;
  const conversationId = messageObj.conversation_id || payload.conversation_id || payload.conversationId || null;
  const text = (messageObj.text || messageObj.message || '').toString().trim().toLowerCase();

  // === Xử lý lệnh text ===
  if (text) {
    if (text === '!menu') {
      const menuText = [
        '📜 *Menu lệnh*',
        '!count -> Bắt đầu đếm người gửi ảnh.',
        '!setsonguoi:<số> -> Đặt mục tiêu số người.',
        '!status -> Xem trạng thái bot.'
      ].join('\n');
      if (conversationId) await sendMessage(conversationId, menuText, true);
      else if (sender) await sendMessage(sender, menuText, false);
      return;
    }
    if (text.startsWith('!setsonguoi:')) {
      const n = parseInt(text.split(':')[1]);
      if (!isNaN(n) && n > 0) {
        state.targetCount = n;
        saveState();
        const reply = `✅ Mục tiêu đã được đặt thành ${n} người.`;
        if (conversationId) await sendMessage(conversationId, reply, true);
        else if (sender) await sendMessage(sender, reply, false);
      }
      return;
    }
    if (text === '!count') {
      state.counting = true;
      state.countedUsers = [];
      saveState();
      const reply = `🔔 Đã bật chế độ đếm. Mục tiêu: ${state.targetCount} người.`;
      if (conversationId) await sendMessage(conversationId, reply, true);
      else if (sender) await sendMessage(sender, reply, false);
      return;
    }
    if (text === '!status') {
      const statusMsg = `Status: counting=${state.counting}, target=${state.targetCount}, current=${state.countedUsers.length}`;
      if (conversationId) await sendMessage(conversationId, statusMsg, true);
      else if (sender) await sendMessage(sender, statusMsg, false);
      return;
    }
  }

  // === Xử lý ảnh ===
  if (!state.counting || !sender) return;

  let attachments = messageObj.attachments || messageObj.payload?.attachments || [];
  if (!Array.isArray(attachments)) attachments = [];

  let foundImage = false;
  for (const a of attachments) {
    const t = (a.type || '').toString().toLowerCase();
    if (t.includes('image') || a.image_url || a.url) { foundImage = true; break; }
  }
  if (!foundImage && messageObj.image?.url) foundImage = true;

  if (foundImage && !state.countedUsers.includes(sender)) {
    state.countedUsers.push(sender);
    saveState();
    const say = `📸 Ghi nhận: +1 người gửi ảnh. Hiện: ${state.countedUsers.length}/${state.targetCount}`;
    if (conversationId) await sendMessage(conversationId, say, true);
    else await sendMessage(sender, say, false);

    if (state.countedUsers.length >= state.targetCount) {
      const notifyText = `🎉 ĐÃ ĐỦ: ${state.countedUsers.length}/${state.targetCount} người.`;
      if (conversationId) await sendMessage(conversationId, notifyText, true);
      else await sendMessage(sender, notifyText, false);
      state.counting = false;
      saveState();
    }
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Bot chạy port ${port}`));
