const express = require("express");
const axios = require("axios");
const fs = require("fs");
const app = express();

// ====== CẤU HÌNH CƠ BẢN ======
const TARGET_DEFAULT = 10;
const DATA_FILE = "data.json";
const OA_TOKEN = process.env.ZALO_OA_TOKEN;

if (!OA_TOKEN) {
  console.warn("⚠️ CHƯA CÓ ZALO_OA_TOKEN. Hãy set trong Railway Variables!");
} else {
  console.log("✅ Đã nhận OA_TOKEN.");
}

// ====== LOAD / SAVE STATE ======
let state = { targetCount: TARGET_DEFAULT, counting: false, countedUsers: [] };
try {
  if (fs.existsSync(DATA_FILE)) {
    state = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    state.countedUsers = Array.isArray(state.countedUsers)
      ? state.countedUsers
      : [];
    console.log("🟢 Loaded state:", state);
  }
} catch (err) {
  console.warn("⚠️ Không thể load file state, dùng mặc định.", err);
}

function saveState() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2), "utf8");
    console.log("💾 State saved.");
  } catch (err) {
    console.error("❌ Lỗi lưu state:", err);
  }
}

// ====== GỬI TIN NHẮN ZALO ======
async function sendMessage(target, text, isConversation = true) {
  if (!OA_TOKEN) return console.warn("⚠️ Không có OA_TOKEN.");

  const url = "https://openapi.zalo.me/v2.0/oa/message";
  const headers = {
    access_token: OA_TOKEN,
    "Content-Type": "application/json",
  };

  const body = isConversation
    ? { recipient: { conversation_id: target }, message: { text } }
    : { recipient: { user_id: target }, message: { text } };

  try {
    await axios.post(url, body, { headers });
    console.log("📤 Gửi tin:", text);
  } catch (err) {
    console.error("🚨 Gửi thất bại:", err.response?.data || err.message);
  }
}

// ====== EXPRESS ======
app.use(express.json());

// Railway health check (ngăn "cannot get healthy")
app.get("/", (req, res) => res.send("✅ Zalo bot is running!"));
app.get("/health", (req, res) => res.status(200).send("OK"));

// ====== WEBHOOK ======
app.post("/webhook", async (req, res) => {
  res.status(200).send("OK"); // tránh timeout

  const { message } = req.body;
  if (!message) return;

  const text = message.text?.trim();
  const sender = message.from?.id || message.sender?.id;
  const conversationId = message.conversation?.id;

  console.log("📩 Nhận message:", { text, sender, conversationId });

  try {
    if (text === "!menu") {
      const menu = [
        "📜 *Menu lệnh*",
        "!count → Bắt đầu đếm ảnh",
        "!setsonguoi:<số> → Đặt mục tiêu",
        "!status → Xem trạng thái bot",
      ].join("\n");
      if (conversationId)
        await sendMessage(conversationId, menu, true);
      else await sendMessage(sender, menu, false);
      return;
    }

    if (text?.startsWith("!setsonguoi:")) {
      const n = parseInt(text.split(":")[1]);
      if (!isNaN(n) && n > 0) {
        state.targetCount = n;
        saveState();
        await sendMessage(
          conversationId || sender,
          `✅ Đặt mục tiêu: ${n} người.`,
          !!conversationId
        );
      } else {
        await sendMessage(
          conversationId || sender,
          "❌ Sai cú pháp! Ví dụ: !setsonguoi:10",
          !!conversationId
        );
      }
      return;
    }

    if (text === "!count") {
      state.counting = true;
      state.countedUsers = [];
      saveState();
      await sendMessage(
        conversationId || sender,
        `🔔 Bắt đầu đếm (${state.targetCount} người cần).`,
        !!conversationId
      );
      return;
    }

    if (text === "!status") {
      const msg = `📊 counting=${state.counting}, target=${state.targetCount}, current=${state.countedUsers.length}`;
      await sendMessage(conversationId || sender, msg, !!conversationId);
      return;
    }
  } catch (err) {
    console.error("💥 Lỗi xử lý text:", err);
  }

  // Nếu đang ở chế độ đếm ảnh
  if (!state.counting || !sender) return;

  const attachments = message.attachments || [];
  const hasImage = attachments.some(
    (att) => att.type === "image" || att.type === "photo" || att.url
  );

  if (hasImage && !state.countedUsers.includes(sender)) {
    state.countedUsers.push(sender);
    saveState();

    const msg = `📸 +1 người gửi ảnh (${state.countedUsers.length}/${state.targetCount})`;
    await sendMessage(conversationId || sender, msg, !!conversationId);

    if (state.countedUsers.length >= state.targetCount) {
      await sendMessage(
        conversationId || sender,
        `🎉 ĐÃ ĐỦ ${state.countedUsers.length}/${state.targetCount} người!`,
        !!conversationId
      );
      state.counting = false;
      saveState();
    }
  }
});

// ====== CHẠY APP ======
const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`🚀 Bot đang chạy trên port ${port}`));
