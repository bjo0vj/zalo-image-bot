// index.js (CommonJS)
const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const axios = require('axios');
const path = require('path');

const DATA_FILE = path.join(__dirname, 'botdata.json');

// === CONFIG - dùng biến môi trường (bạn sẽ đặt trên Render) ===
const OA_TOKEN = process.env.ZALO_OA_TOKEN || '';
const NGOCANH_ID = process.env.NGOCANH_ID || null; // optional
// ==============================================================

if (!OA_TOKEN) {
  console.warn('⚠️ CHƯA CÓ ZALO_OA_TOKEN. Hãy đặt biến môi trường ZALO_OA_TOKEN trước khi deploy.');
}

// Load or init persistent data
let state = { targetCount: 10, counting: false, countedUsers: [] };
try {
  if (fs.existsSync(DATA_FILE)) {
    state = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    console.log('Loaded state:', state);
  }
} catch (e) {
  console.warn('Không thể load file dữ liệu, dùng state mặc định.', e);
}

function saveState() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2), 'utf8');
  } catch (e) {
    console.error('Lỗi khi lưu state:', e);
  }
}

// Helper: gửi message (conversation hoặc DM)
async function sendMessage(target, text, isConversation = true) {
  if (!OA_TOKEN) {
    console.error('Không có OA_TOKEN, không thể gửi tin nhắn.');
    return;
  }
  const url = 'https://openapi.zalo.me/v2.0/oa/message';
  const headers = { 'access_token': OA_TOKEN, 'Content-Type': 'application/json' };

  let body;
  if (isConversation) {
    body = {
      recipient: { conversation_id: target },
      message: { text }
    };
  } else {
    body = {
      recipient: { user_id: target },
      message: { text }
    };
  }

  try {
    const resp = await axios.post(url, body, { headers });
    return resp.data;
  } catch (err) {
    console.error('Gửi tin nhắn thất bại:', err.response ? err.response.data : err.message);
    throw err;
  }
}

// Express setup
const app = express();
app.use(bodyParser.json());

// Health endpoint
app.get('/health', (req, res) => res.send('OK'));

// Quick status
app.get('/status', (req, res) => res.json({
  counting: state.counting,
  targetCount: state.targetCount,
  countedUsers: state.countedUsers.length,
  users: state.countedUsers
}));

// Webhook endpoint
app.post('/webhook', async (req, res) => {
  // Trả 200 ngay
  res.status(200).send('OK');

  const payload = req.body;
  console.log('Webhook payload received:', JSON.stringify(payload, null, 2).slice(0, 2000));

  // Common fields
  const messageObj = payload.message || payload.data || {};
  const sender = (payload.sender && payload.sender.id)
                || (messageObj.from && messageObj.from.id)
                || (messageObj.sender && messageObj.sender.id)
                || null;
  const conversationId = messageObj.conversation_id
    || payload.conversation_id
    || payload.conversationId
    || (messageObj.metadata && messageObj.metadata.conversation_id)
    || null;

  const text = (messageObj.text || messageObj.message || '').toString().trim();

  // Handle text commands
  if (text) {
    const lower = text.toLowerCase();
    if (lower === '!menu') {
      const menuText = [
        '📜 *Menu lệnh*',
        '!count -> Bắt đầu đếm người đã gửi ảnh (reset bộ đếm).',
        '!setsonguoi:<số> -> Đặt mục tiêu số người. Ví dụ: !setsonguoi:32',
        '!menu -> Hiện menu.',
        '!status -> Xem trạng thái bot (dev).'
      ].join('\n');
      try {
        if (conversationId) await sendMessage(conversationId, menuText, true);
        else if (sender) await sendMessage(sender, menuText, false);
      } catch (e) { console.error('Không gửi menu được', e); }
      return;
    }

    if (lower.startsWith('!setsonguoi:')) {
      const parts = text.split(':');
      const n = parseInt(parts[1]);
      if (!isNaN(n) && n > 0) {
        state.targetCount = n;
        saveState();
        const reply = `✅ Mục tiêu đã được đặt thành ${n} người.`;
        try {
          if (conversationId) await sendMessage(conversationId, reply, true);
          else if (sender) await sendMessage(sender, reply, false);
        } catch (e) { console.error('Không thể gửi phản hồi setsonguoi', e); }
      } else {
        const reply = '❌ Lệnh !setsonguoi sai định dạng. Ví dụ đúng: !setsonguoi:32';
        try {
          if (conversationId) await sendMessage(conversationId, reply, true);
          else if (sender) await sendMessage(sender, reply, false);
        } catch (e) {}
      }
      return;
    }

    if (lower === '!count') {
      state.counting = true;
      state.countedUsers = []; // reset khi bắt đầu
      saveState();
      const reply = `🔔 Đã bật chế độ đếm. Bot sẽ bắt đầu ghi những *người* gửi ít nhất 1 ảnh. Mục tiêu: ${state.targetCount} người.`;
      try {
        if (conversationId) await sendMessage(conversationId, reply, true);
        else if (sender) await sendMessage(sender, reply, false);
      } catch (e) {}
      return;
    }

    if (lower === '!status') {
      const statusMsg = `Status: counting=${state.counting}, target=${state.targetCount}, current=${state.countedUsers.length}`;
      try {
        if (conversationId) await sendMessage(conversationId, statusMsg, true);
        else if (sender) await sendMessage(sender, statusMsg, false);
      } catch (e) {}
      return;
    }
  }

  // Handle image when counting
  if (!state.counting) {
    console.log('Bot không đang đếm -> bỏ qua event ảnh.');
    return;
  }

  // Detect image in various payload shapes
  let attachments = messageObj.attachments || messageObj.payload && messageObj.payload.attachments || [];
  if (!Array.isArray(attachments)) attachments = [];

  let foundImage = false;
  // check attachments
  for (const a of attachments) {
    const t = (a.type || '').toString().toLowerCase();
    if (t.includes('image') || a.image_url || a.url) { foundImage = true; break; }
  }
  // direct image object
  if (!foundImage && (messageObj.image && (messageObj.image.url || messageObj.image.image_url))) foundImage = true;
  // message items
  if (!foundImage && messageObj.items && Array.isArray(messageObj.items)) {
    for (const it of messageObj.items) {
      const t = (it.type || '').toString().toLowerCase();
      if (t.includes('image') || it.image_url) { foundImage = true; break; }
    }
  }

  if (foundImage && sender) {
    if (!state.countedUsers.includes(sender)) {
      state.countedUsers.push(sender);
      saveState();
      console.log(`📸 Thêm user ${sender} -> tổng người đã gửi ảnh: ${state.countedUsers.length}`);
      try {
        const say = `📸 Ghi nhận: một người mới đã gửi ảnh. Hiện: ${state.countedUsers.length}/${state.targetCount}`;
        if (conversationId) await sendMessage(conversationId, say, true);
        else await sendMessage(sender, say, false);
      } catch (e) { console.error('Không gửi thông báo tạm thời', e); }
    } else {
      console.log(`User ${sender} đã được ghi nhận trước đó -> không cộng thêm.`);
    }

    // Check target reached
    if (state.countedUsers.length >= state.targetCount) {
      const notifyTextBase = `🎉 ĐÃ ĐỦ: Mục tiêu ${state.targetCount} người đã hoàn thành! (${state.countedUsers.length}/${state.targetCount})`;
      try {
        if (conversationId) {
          let msg = notifyTextBase;
          if (NGOCANH_ID) msg += `\n@ngocanh`;
          await sendMessage(conversationId, msg, true);
        } else {
          let msg = notifyTextBase;
          if (NGOCANH_ID) msg += `\n@ngocanh`;
          await sendMessage(sender, msg, false);
        }
        if (NGOCANH_ID) {
          try { await sendMessage(NGOCANH_ID, `Bạn được tag: ${notifyTextBase}`, false); }
          catch (e) { console.warn('Không gửi DM tới NGOCANH_ID được.', e.message || e); }
        }
      } catch (e) { console.error('Lỗi khi gửi thông báo đã đủ:', e); }
      state.counting = false;
      saveState();
    }
  } else {
    console.log('Không phát hiện ảnh hoặc không có sender -> bỏ qua.');
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Zalo image-user counter bot chạy port ${port}`);
});
