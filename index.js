const express = require('express');
const axios = require('axios');
const fs = require('fs');
const app = express();

const TARGET_DEFAULT = 10;
const DATA_FILE = 'data.json';  // File lưu state (có thể bị mất trên Render nếu redeploy)

const OA_TOKEN = process.env.ZALO_OA_TOKEN;  // Token từ env

if (!OA_TOKEN) console.warn('⚠️ CHƯA CÓ ZALO_OA_TOKEN. Hãy đặt biến môi trường ZALO_OA_TOKEN trước khi deploy.');
console.log('OA_TOKEN=', OA_TOKEN ? 'Đã set' : 'Chưa set');

// Load hoặc init state
let state = { targetCount: TARGET_DEFAULT, counting: false, countedUsers: [] };
try {
  if (fs.existsSync(DATA_FILE)) {
    state = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    // Đảm bảo countedUsers luôn là array
    state.countedUsers = Array.isArray(state.countedUsers) ? state.countedUsers : [];
    console.log('Loaded state:', state);
  }
} catch (e) {
  console.warn('Không thể load file dữ liệu, dùng state mặc định.', e);
}

function saveState() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2), 'utf8');
    console.log('State saved successfully.');
  } catch (e) {
    console.error('Lỗi khi lưu state (có thể do file system Render):', e);
    // Trên Render, file có thể không persistent – không crash, chỉ log
  }
}

// Helper gửi message
async function sendMessage(target, text, isConversation = true) {
  if (!OA_TOKEN) {
    console.warn('⚠️ Không có OA_TOKEN, không gửi tin nhắn.');
    return;
  }
  const url = 'https://openapi.zalo.me/v2.0/oa/message';
  const headers = { 'access_token': OA_TOKEN, 'Content-Type': 'application/json' };
  const body = isConversation
    ? { recipient: { conversation_id: target }, message: { text } }
    : { recipient: { user_id: target }, message: { text } };
  try {
    await axios.post(url, body, { headers });
    console.log('Tin nhắn gửi thành công.');
  } catch (err) {
    console.error('Gửi tin nhắn thất bại:', err.response?.data || err.message);
  }
}

// Express setup
app.use(express.json());

// Webhook endpoint
app.post('/webhook', async (req, res) => {
  res.status(200).send('OK');  // Phản hồi ngay để tránh timeout

  const { message } = req.body;
  if (!message) return;

  const messageObj = message;
  const text = messageObj.text?.trim();
  const sender = messageObj.from?.id || messageObj.sender?.id;
  const conversationId = messageObj.conversation?.id;

  console.log('Received message:', { text, sender, conversationId });

  // === Xử lý lệnh text ===
  if (text) {
    try {
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
        } else {
          const reply = '❌ Lệnh !setsonguoi sai định dạng. Ví dụ: !setsonguoi:32';
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
    } catch (e) {
      console.error('Lỗi khi xử lý lệnh text:', e);
      return;
    }
  }

  // === Xử lý ảnh khi counting ===
  if (!state.counting || !sender) return;

  let attachments = messageObj.attachments || messageObj.payload?.attachments || [];
  if (!Array.isArray(attachments)) attachments = [];

  let foundImage = false;
  for (const att of attachments) {
    if (att.type === 'image' || att.type === 'photo') {
      foundImage = true;
      break;
    }
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
app.listen(port, () => console.log(`Bot chạy trên port ${port}`));