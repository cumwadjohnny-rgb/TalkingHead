let head = null;
let camStream = null;
let isListening = false;
let voiceEnabled = true;
let autoSpeakEnabled = true;
let autoTimer = null;
let isBusy = false;

const chatHistory = [];
const statusEl = document.getElementById("status");
const setupEl = document.getElementById("setup");

const DEFAULT_PERSONA = "You are a close, expressive companion on a live video call. Keep replies short, natural, and conversational (1 to 3 sentences). Start every reply with one reaction emoji matching your mood or action (such as 😊, 😉, 👋, 😘, 🤔, 😮, ❤️, or 🙄). React to what you see on the user's camera when available.";

document.getElementById("apiKey").value = localStorage.getItem("or_key") || "";
document.getElementById("model").value = localStorage.getItem("or_model") || "openrouter/free";
document.getElementById("persona").value = localStorage.getItem("or_persona") || DEFAULT_PERSONA;

window.openSetup = function() {
  clearTimeout(autoTimer);
  setupEl.style.display = "flex";
};

window.toggleVoice = function() {
  voiceEnabled = !voiceEnabled;
  const btn = document.getElementById("muteBtn");
  if (voiceEnabled) {
    btn.textContent = "🔊 Voice";
    btn.classList.add("active");
  } else {
    window.speechSynthesis.cancel();
    if (head) head.stopSpeaking();
    btn.textContent = "🔇 Muted";
    btn.classList.remove("active");
  }
};

window.toggleAuto = function() {
  autoSpeakEnabled = !autoSpeakEnabled;
  const btn = document.getElementById("autoBtn");
  if (autoSpeakEnabled) {
    btn.textContent = "🤖 Auto On";
    btn.classList.add("active");
    resetAutoTimer();
  } else {
    btn.textContent = "🤖 Auto Off";
    btn.classList.remove("active");
    clearTimeout(autoTimer);
  }
};

function resetAutoTimer() {
  clearTimeout(autoTimer);
  if (!autoSpeakEnabled || !head) return;
  autoTimer = setTimeout(() => {
    if (!isBusy && !isListening && setupEl.style.display === "none") {
      const nudge = camStream
        ? "[System note: The user has been quiet for a moment. Look at their camera feed and say something natural, playful, or observant on your own.]"
        : "[System note: The user has been quiet for a moment. Say something natural, playful, or engaging on your own to keep the call lively.]";
      sendToLLM(nudge, true);
    }
  }, 18000);
}

window.sendTypedMessage = function(e) {
  e.preventDefault();
  const input = document.getElementById("chatInput");
  const text = input.value.trim();
  if (!text) return;
  input.value = "";
  input.blur();
  clearTimeout(autoTimer);
  statusEl.textContent = "You: " + text;
  sendToLLM(text, false);
};

window.joinCall = async function() {
  localStorage.setItem("or_key", document.getElementById("apiKey").value.trim());
  localStorage.setItem("or_model", document.getElementById("model").value.trim());
  localStorage.setItem("or_persona", document.getElementById("persona").value.trim());
  setupEl.style.display = "none";

  if (head) {
    resetAutoTimer();
    return;
  }
  try {
    statusEl.textContent = "Loading 3D avatar...";
    const mod = await import("./modules/talkinghead.mjs");
    head = new mod.TalkingHead(document.getElementById("avatar"), {
      cameraView: "upper",
      lipsyncModules: ["en"],
      avatarIdleHeadMove: 0.7,
      avatarSpeakingHeadMove: 0.8
    });
    await head.showAvatar({
      url: "./avatars/brunette.glb",
      body: "F",
      avatarMood: "happy",
      lipsyncLang: "en"
    });
    head.playGesture("handup", 2.5, true);
    statusEl.textContent = "Connected. Type, talk, or let her lead.";
    resetAutoTimer();
  } catch (err) {
    statusEl.textContent = "Avatar Error: " + err.message;
  }
};

window.toggleCam = async function() {
  const btn = document.getElementById("camBtn");
  const wrap = document.getElementById("pip-wrap");
  const video = document.getElementById("user-cam");
  if (!camStream) {
    try {
      statusEl.textContent = "Starting camera...";
      camStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user" },
        audio: false
      });
      video.srcObject = camStream;
      wrap.style.display = "block";
      await video.play();
      btn.textContent = "📷 Cam On";
      btn.classList.add("active");
      statusEl.textContent = "Camera active.";
    } catch (e) {
      camStream = null;
      wrap.style.display = "none";
      statusEl.textContent = "Camera Error: " + e.message;
    }
  } else {
    camStream.getTracks().forEach(t => t.stop());
    video.srcObject = null;
    camStream = null;
    wrap.style.display = "none";
    btn.textContent = "📷 Cam";
    btn.classList.remove("active");
    statusEl.textContent = "Camera off.";
  }
};

function captureFrame() {
  if (!camStream) return null;
  const video = document.getElementById("user-cam");
  if (!video.videoWidth || !video.videoHeight) return null;
  const canvas = document.getElementById("snap");
  canvas.width = 480;
  canvas.height = Math.round((video.videoHeight / video.videoWidth) * 480);
  canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.7);
}

function applyExpressionAndBody(text) {
  if (!head) return;
  const match = text.match(/[\p{Extended_Pictographic}]/u);
  const emoji = match ? match.at(0) : "";

  if (emoji === "❤️" || emoji === "🥰" || emoji === "😘" || emoji === "😍") {
    head.setMood("love");
  } else if (emoji === "😢" || emoji === "😭" || emoji === "😔" || emoji === "🥺") {
    head.setMood("sad");
  } else if (emoji === "😡" || emoji === "😠" || emoji === "🤬") {
    head.setMood("angry");
  } else if (emoji === "😱" || emoji === "😳") {
    head.setMood("fear");
  } else {
    head.setMood("happy");
  }

  if (emoji) {
    head.speakEmoji(emoji);
  } else {
    head.speakWithHands(0, 0.8);
  }
}

function speakReply(text) {
  statusEl.textContent = text;
  window.speechSynthesis.cancel();
  applyExpressionAndBody(text);

  const cleanSpeech = text.replace(/[\p{Extended_Pictographic}]/gu, "").trim();
  if (head && cleanSpeech) {
    head.stopSpeaking();
    head.speakText(cleanSpeech, { avatarMute: true });
  }

  if (!voiceEnabled || !cleanSpeech) {
    isBusy = false;
    resetAutoTimer();
    return;
  }

  const utter = new SpeechSynthesisUtterance(cleanSpeech);
  utter.onend = () => {
    if (head) head.stopSpeaking();
    isBusy = false;
    resetAutoTimer();
  };
  utter.onerror = () => {
    if (head) head.stopSpeaking();
    isBusy = false;
    resetAutoTimer();
  };
  window.speechSynthesis.speak(utter);
}

async function sendToLLM(userText, isAutonomous, forceTextOnly) {
  const key = (localStorage.getItem("or_key") || "").replace(/[^\x20-\x7E]/g, "").trim();
  if (!key) {
    statusEl.textContent = "Missing API Key. Tap ⚙️ to enter your OpenRouter key.";
    return;
  }

  isBusy = true;
  clearTimeout(autoTimer);
  if (!isAutonomous) statusEl.textContent = "Thinking...";

  const model = localStorage.getItem("or_model") || "openrouter/free";
  const persona = localStorage.getItem("or_persona") || DEFAULT_PERSONA;
  const isTextOnlyModel = forceTextOnly || model.toLowerCase().includes("dolphin") || model.toLowerCase().includes("mythomax");

  const frame = isTextOnlyModel ? null : captureFrame();
  const content = frame
    ? [{ type: "text", text: userText }, { type: "image_url", image_url: { url: frame } }]
    : userText;

  if (!forceTextOnly) chatHistory.push({ role: "user", content });
  const recent = [{ role: "system", content: persona }, ...chatHistory.slice(-10)];

  try {
    const apiEndpoint = atob("aHR0cHM6Ly9vcGVucm91dGVyLmFpL2FwaS92MS9jaGF0L2NvbXBsZXRpb25z");
    const res = await fetch(apiEndpoint, {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + key,
        "HTTP-Referer": window.location.origin,
        "X-Title": "AI Video Call",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ model: model, messages: recent })
    });
    const data = await res.json();
    if (data.error) {
      if (frame && !forceTextOnly) {
        chatHistory.pop();
        return sendToLLM(userText, isAutonomous, true);
      }
      statusEl.textContent = "OpenRouter Error: " + (data.error.message || JSON.stringify(data.error));
      isBusy = false;
      resetAutoTimer();
      return;
    }
    const firstChoice = data.choices && data.choices.at(0);
    const reply = firstChoice ? firstChoice.message.content : "I didn't catch that.";
    chatHistory.push({ role: "assistant", content: reply });
    speakReply(reply);
  } catch (err) {
    statusEl.textContent = "Network Error: " + err.message;
    isBusy = false;
    resetAutoTimer();
  }
}

const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
const rec = SpeechRec ? new SpeechRec() : null;
if (rec) {
  rec.lang = "en-US";
  rec.interimResults = false;
  rec.onresult = (e) => {
    const transcript = e.results.item(0).item(0).transcript;
    statusEl.textContent = "You: " + transcript;
    sendToLLM(transcript, false);
  };
  rec.onerror = (e) => {
    statusEl.textContent = "Mic Error: " + e.error;
    resetAutoTimer();
  };
  rec.onend = () => {
    isListening = false;
    document.getElementById("micBtn").classList.remove("active");
    document.getElementById("micBtn").textContent = "🎙️ Talk";
  };
}

window.toggleMic = function() {
  if (!rec) { statusEl.textContent = "Speech recognition not supported in this browser."; return; }
  if (!isListening) {
    clearTimeout(autoTimer);
    window.speechSynthesis.cancel();
    if (head) head.stopSpeaking();
    isListening = true;
    document.getElementById("micBtn").classList.add("active");
    document.getElementById("micBtn").textContent = "🛑 Listening...";
    rec.start();
  } else {
    rec.stop();
    resetAutoTimer();
  }
};
