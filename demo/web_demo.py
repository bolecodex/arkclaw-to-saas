#!/usr/bin/env python3
"""
ArkClaw 消息外接 Web Demo (飞书 OAuth 认证版)

流程:
  1. 启动本地 HTTP 服务
  2. 浏览器打开后跳转飞书 OAuth 授权页
  3. 用户在飞书授权后回调本地，获取 user_access_token
  4. 用 user_access_token 建立 WebSocket 连接并进行对话

使用方式:
  python3 web_demo.py --instance-id ci-xxx
  python3 web_demo.py --space-id csi-xxx
"""

import argparse
import http.server
import json
import logging
import os
import sys
import urllib.parse
import urllib.request
import webbrowser

from arkclaw_api import (
    create_claw_instance,
    get_claw_instance_chat_token,
    get_claw_instance_status,
    wait_instance_ready,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)

REGION = "cn-beijing"
PORT = 8765

LARK_APP_ID = os.getenv("LARK_APP_ID", "")
LARK_APP_SECRET = os.getenv("LARK_APP_SECRET", "")


def get_lark_app_access_token() -> str:
    data = json.dumps({
        "app_id": LARK_APP_ID,
        "app_secret": LARK_APP_SECRET,
    }).encode()
    req = urllib.request.Request(
        "https://open.feishu.cn/open-apis/auth/v3/app_access_token/internal",
        data=data,
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req) as resp:
        result = json.loads(resp.read())
    return result["app_access_token"]


def exchange_code_for_user_token(code: str, redirect_uri: str) -> dict:
    """用授权码换取 user_access_token (v2 接口)"""
    data = json.dumps({
        "grant_type": "authorization_code",
        "client_id": LARK_APP_ID,
        "client_secret": LARK_APP_SECRET,
        "code": code,
        "redirect_uri": redirect_uri,
    }).encode()
    req = urllib.request.Request(
        "https://open.feishu.cn/open-apis/authen/v2/oauth/token",
        data=data,
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        logger.error(f"换取 token 失败 ({e.code}): {body}")
        return {"error": body, "code": e.code}


def exchange_code_for_user_token_v1(code: str, app_access_token: str) -> dict:
    """用授权码换取 user_access_token (v1 接口，旧版兼容)"""
    data = json.dumps({
        "grant_type": "authorization_code",
        "code": code,
    }).encode()
    req = urllib.request.Request(
        "https://open.feishu.cn/open-apis/authen/v1/oidc/access_token",
        data=data,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {app_access_token}",
        },
    )
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        logger.error(f"v1 换取 token 失败 ({e.code}): {body}")
        return {"error": body, "code": e.code}


# --------------- HTML 模板 ---------------

LOGIN_PAGE = r"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>ArkClaw Demo - 登录</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: linear-gradient(135deg, #667eea, #764ba2); height: 100vh; display: flex; align-items: center; justify-content: center; }
.card { background: #fff; border-radius: 16px; padding: 48px 40px; text-align: center; box-shadow: 0 20px 60px rgba(0,0,0,.2); max-width: 420px; width: 90%; }
.card h1 { font-size: 24px; margin-bottom: 12px; color: #333; }
.card p { color: #666; margin-bottom: 32px; line-height: 1.6; font-size: 14px; }
.card a { display: inline-block; padding: 14px 40px; background: linear-gradient(135deg, #667eea, #764ba2); color: #fff; text-decoration: none; border-radius: 10px; font-size: 16px; font-weight: 600; transition: all .2s; }
.card a:hover { transform: translateY(-2px); box-shadow: 0 8px 20px rgba(102,126,234,.4); }
.info { margin-top: 24px; font-size: 12px; color: #999; }
</style>
</head>
<body>
<div class="card">
  <h1>ArkClaw Demo</h1>
  <p>实例: __INSTANCE_ID__<br>需要通过飞书账号授权后才能使用</p>
  <a href="__AUTH_URL__">飞书账号登录</a>
  <div class="info">点击后将跳转到飞书授权页面</div>
</div>
</body>
</html>"""

CHAT_PAGE = r"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>ArkClaw Demo</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f0f2f5; height: 100vh; display: flex; flex-direction: column; }
.header { background: linear-gradient(135deg, #667eea, #764ba2); color: #fff; padding: 16px 24px; display: flex; align-items: center; justify-content: space-between; }
.header h1 { font-size: 18px; font-weight: 600; }
.status { display: flex; align-items: center; gap: 8px; font-size: 13px; }
.dot { width: 10px; height: 10px; border-radius: 50%; }
.dot.off { background: #e74c3c; }
.dot.on  { background: #2ecc71; animation: pulse 1.5s infinite; }
.dot.wait { background: #f1c40f; animation: pulse 1s infinite; }
@keyframes pulse { 50% { opacity: .5; } }
.chat { flex: 1; overflow-y: auto; padding: 20px; display: flex; flex-direction: column; gap: 12px; }
.msg { max-width: 80%; padding: 10px 14px; border-radius: 12px; font-size: 14px; line-height: 1.6; word-break: break-word; white-space: pre-wrap; }
.msg.system { align-self: center; background: #e8e8e8; color: #666; font-size: 12px; border-radius: 16px; padding: 6px 16px; max-width: 90%; }
.msg.user { align-self: flex-end; background: #667eea; color: #fff; border-bottom-right-radius: 4px; }
.msg.bot { align-self: flex-start; background: #fff; color: #333; border: 1px solid #e0e0e0; border-bottom-left-radius: 4px; }
.msg.bot img { max-width: 100%; border-radius: 8px; margin: 6px 0; cursor: pointer; }
.msg.bot video { max-width: 100%; border-radius: 8px; margin: 6px 0; }
.msg.bot a.file-link { display: inline-flex; align-items: center; gap: 6px; padding: 8px 12px; background: #f0f2f5; border-radius: 8px; color: #667eea; text-decoration: none; font-size: 13px; margin: 4px 0; word-break: break-all; }
.msg.bot a.file-link:hover { background: #e8eaf0; }
.media-box { display: flex; align-items: center; gap: 8px; padding: 10px 14px; background: #f8f9fb; border: 1px solid #e0e4ea; border-radius: 10px; margin: 8px 0; flex-wrap: wrap; }
.media-box .media-icon { font-size: 24px; }
.media-box span { flex: 1; font-size: 12px; color: #555; word-break: break-all; }
.media-box button { padding: 6px 14px; background: #667eea; color: #fff; border: none; border-radius: 6px; font-size: 12px; cursor: pointer; white-space: nowrap; }
.media-box button:hover:not(:disabled) { background: #5569d4; }
.media-box button:disabled { opacity: .6; cursor: not-allowed; }
.msg.error { align-self: center; background: #ffe0e0; color: #c0392b; }
.thinking { align-self: flex-start; max-width: 85%; }
.thinking .think-header { display: flex; align-items: center; gap: 8px; padding: 8px 14px; background: #f8f0ff; border-radius: 12px 12px 0 0; border: 1px solid #e0d4f0; border-bottom: none; font-size: 13px; color: #764ba2; font-weight: 600; }
.thinking .think-header .spinner { width: 14px; height: 14px; border: 2px solid #e0d4f0; border-top-color: #764ba2; border-radius: 50%; animation: spin .8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.thinking .steps { padding: 0; background: #faf8ff; border: 1px solid #e0d4f0; border-radius: 0 0 12px 12px; max-height: 200px; overflow-y: auto; }
.thinking .steps .step { padding: 6px 14px; font-size: 12px; color: #666; border-top: 1px solid #f0eaf5; display: flex; align-items: flex-start; gap: 6px; }
.thinking .steps .step::before { content: ""; flex-shrink: 0; width: 6px; height: 6px; margin-top: 5px; background: #764ba2; border-radius: 50%; }
.thinking.done .think-header { background: #f0f8f0; border-color: #d4e8d4; color: #2a7a2a; }
.thinking.done .think-header .spinner { display: none; }
.thinking.done .steps { border-color: #d4e8d4; background: #f8fdf8; }
.input-bar { display: flex; gap: 10px; padding: 16px 20px; background: #fff; border-top: 1px solid #e0e0e0; }
.input-bar textarea { flex: 1; padding: 10px 14px; border: 2px solid #e0e0e0; border-radius: 10px; font-size: 14px; resize: none; height: 44px; font-family: inherit; }
.input-bar textarea:focus { outline: none; border-color: #667eea; }
.input-bar button { padding: 0 24px; background: linear-gradient(135deg, #667eea, #764ba2); color: #fff; border: none; border-radius: 10px; font-size: 14px; font-weight: 600; cursor: pointer; }
.input-bar button:disabled { opacity: .5; cursor: not-allowed; }
.input-bar button:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 4px 12px rgba(102,126,234,.4); }
.info { font-size: 11px; color: rgba(255,255,255,.7); }
</style>
</head>
<body>
<div class="header">
  <div>
    <h1>ArkClaw Demo</h1>
    <div class="info">实例: __INSTANCE_ID__ | 用户: __USER_NAME__</div>
  </div>
  <div class="status"><div id="dot" class="dot wait"></div><span id="stxt">连接中...</span></div>
</div>
<div id="chat" class="chat">
  <div class="msg system">飞书授权成功，正在连接 WebSocket...</div>
</div>
<div class="input-bar">
  <textarea id="inp" placeholder="输入消息，Enter 发送..." disabled></textarea>
  <button id="btn" disabled>发送</button>
</div>
<script>
const CHAT_TOKEN = "__CHAT_TOKEN__";
const INSTANCE_ID = "__INSTANCE_ID__";
const ENDPOINT = "__ENDPOINT__";
const USER_TOKEN = "__USER_TOKEN__";

const chat = document.getElementById("chat");
const inp = document.getElementById("inp");
const btn = document.getElementById("btn");
const dot = document.getElementById("dot");
const stxt = document.getElementById("stxt");

function uuid() { return crypto.randomUUID ? crypto.randomUUID() : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g,c=>{const r=Math.random()*16|0;return(c==="x"?r:r&3|8).toString(16)}); }

let thinkingEl = null;
let stepCount = 0;

function startThinking() {
  if (thinkingEl) return;
  thinkingEl = document.createElement("div");
  thinkingEl.className = "thinking";
  thinkingEl.innerHTML = '<div class="think-header"><div class="spinner"></div><span>思考中...</span></div><div class="steps"></div>';
  chat.appendChild(thinkingEl);
  chat.scrollTop = chat.scrollHeight;
  stepCount = 0;
}

function addStep(text) {
  if (!thinkingEl) startThinking();
  stepCount++;
  const steps = thinkingEl.querySelector(".steps");
  const step = document.createElement("div");
  step.className = "step";
  step.textContent = text;
  steps.appendChild(step);
  thinkingEl.querySelector(".think-header span").textContent = "思考中... (" + stepCount + " 步)";
  steps.scrollTop = steps.scrollHeight;
  chat.scrollTop = chat.scrollHeight;
}

function finishThinking() {
  if (!thinkingEl) return;
  thinkingEl.classList.add("done");
  thinkingEl.querySelector(".think-header span").textContent = "已完成思考 (" + stepCount + " 步)";
  thinkingEl = null;
  stepCount = 0;
}

function addMsg(text, cls) {
  var d = document.createElement("div");
  d.className = "msg " + cls;
  if (cls === "bot") {
    d.innerHTML = renderBotText(text);
  } else {
    d.textContent = text;
  }
  chat.appendChild(d);
  chat.scrollTop = chat.scrollHeight;
}

function escHtml(s) {
  var div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

function renderBotText(text) {
  var lines = text.split("\n");
  var result = [];
  var vidRe = /\.(mp4|webm|mov|avi)$/i;
  var imgRe = /\.(png|jpg|jpeg|gif|webp|svg|bmp)$/i;
  var pathRe = /\/root\/\.openclaw\/workspace\/\S+/g;
  var urlRe = /https?:\/\/\S+/g;
  for (var li = 0; li < lines.length; li++) {
    var line = lines[li];
    var paths = line.match(pathRe) || [];
    var urls = line.match(urlRe) || [];
    var mediaFound = false;
    for (var pi = 0; pi < paths.length; pi++) {
      var p = paths[pi].replace(/[*\x60]/g, "");
      if (vidRe.test(p)) {
        result.push(escHtml(line.replace(paths[pi], "")));
        result.push("<div class='media-box'><div class='media-icon'>&#127916;</div><span>" + escHtml(p) + "</span>");
        result.push("<span style='font-size:11px;color:#999'>视频文件较大，建议在飞书中查看</span></div>");
        mediaFound = true;
      } else if (imgRe.test(p)) {
        result.push(escHtml(line.replace(paths[pi], "")));
        result.push("<div class='media-box'><div class='media-icon'>&#128247;</div><span>" + escHtml(p) + "</span>");
        result.push("<button onclick='fetchFile(this,\"" + encodeURIComponent(p) + "\",\"image\")'>加载预览</button></div>");
        mediaFound = true;
      }
    }
    for (var ui = 0; ui < urls.length; ui++) {
      var u = urls[ui];
      if (vidRe.test(u)) {
        result.push("<div style='margin:8px 0'><video controls style='max-width:100%;border-radius:8px' src='" + escHtml(u) + "'></video></div>");
        mediaFound = true;
      } else if (imgRe.test(u)) {
        result.push("<div style='margin:8px 0'><img style='max-width:100%;border-radius:8px;cursor:pointer' src='" + escHtml(u) + "' onclick='window.open(this.src)'></div>");
        mediaFound = true;
      }
    }
    if (!mediaFound) result.push(escHtml(line));
  }
  return result.join("\n");
}

var pendingFileLoads = {};
var fileLoadSuppressIds = {};

function fetchFile(btn, encodedPath, mediaType) {
  btn.textContent = "加载中...";
  btn.disabled = true;
  var path = decodeURIComponent(encodedPath);
  var container = btn.parentElement;
  var reqId = uuid();

  pendingFileLoads[reqId] = { path: path, mediaType: mediaType, container: container, btn: btn };

  var ext = path.split(".").pop().toLowerCase();
  var mimeMap = {png:"image/png", jpg:"image/jpeg", jpeg:"image/jpeg", gif:"image/gif", webp:"image/webp", svg:"image/svg+xml", bmp:"image/bmp", mp4:"video/mp4", webm:"video/webm", mov:"video/mp4"};
  var mime = mimeMap[ext] || (mediaType === "video" ? "video/mp4" : "image/png");

  var msgId = uuid();
  fileLoadSuppressIds[msgId] = reqId;

  ws.send(JSON.stringify({
    type: "req", id: msgId, method: "chat.send",
    params: {
      sessionKey: "agent:main:main",
      message: "SYSTEM_FILE_REQUEST_" + reqId + ": Execute this command and return ONLY the raw output, no explanation, no markdown: base64 " + path,
      deliver: false, idempotencyKey: uuid()
    }
  }));
  btn.textContent = "请求中(图片约10秒,视频较大不建议)...";
}

function tryRenderBase64(text) {
  var keys = Object.keys(pendingFileLoads);
  if (keys.length === 0) return false;

  var cleanText = text.replace(/[\s\n\r]/g, "");
  if (cleanText.length < 100) return false;
  var b64Re = /^[A-Za-z0-9+\/=]{100,}$/;
  if (!b64Re.test(cleanText)) {
    for (var ki = 0; ki < keys.length; ki++) {
      var tagRe = new RegExp("SYSTEM_FILE_REQUEST_" + keys[ki]);
      if (tagRe.test(text)) {
        var b64match = text.match(/[A-Za-z0-9+\/=]{100,}/);
        if (b64match) { cleanText = b64match[0]; break; }
      }
    }
    if (!b64Re.test(cleanText)) return false;
  }

  var reqId = keys[keys.length - 1];
  var info = pendingFileLoads[reqId];
  if (!info) return false;
  delete pendingFileLoads[reqId];

  var ext = info.path.split(".").pop().toLowerCase();
  var mimeMap = {png:"image/png", jpg:"image/jpeg", jpeg:"image/jpeg", gif:"image/gif", webp:"image/webp", svg:"image/svg+xml", bmp:"image/bmp", mp4:"video/mp4", webm:"video/webm", mov:"video/mp4"};
  var mime = mimeMap[ext] || (info.mediaType === "video" ? "video/mp4" : "image/png");

  try {
    var binary = atob(cleanText);
    var bytes = new Uint8Array(binary.length);
    for (var bi = 0; bi < binary.length; bi++) bytes[bi] = binary.charCodeAt(bi);
    var blob = new Blob([bytes], {type: mime});
    var blobUrl = URL.createObjectURL(blob);

    info.btn.style.display = "none";
    if (info.mediaType === "video") {
      var vid = document.createElement("video");
      vid.controls = true;
      vid.style.cssText = "max-width:100%;border-radius:8px;margin-top:8px";
      vid.src = blobUrl;
      info.container.appendChild(vid);
    } else {
      var img = document.createElement("img");
      img.style.cssText = "max-width:100%;border-radius:8px;margin-top:8px;cursor:pointer";
      img.src = blobUrl;
      img.onclick = function() { window.open(blobUrl); };
      info.container.appendChild(img);
    }
    chat.scrollTop = chat.scrollHeight;
    return true;
  } catch(e) {
    info.btn.textContent = "解码失败";
    info.btn.disabled = false;
    return false;
  }
}

function addRichMsg(contents, cls) {
  var d = document.createElement("div");
  d.className = "msg " + cls;
  var hasContent = false;
  for (var i = 0; i < contents.length; i++) {
    var c = contents[i];
    if (c.type === "text" && c.text) {
      var p = document.createElement("div");
      p.textContent = c.text;
      d.appendChild(p);
      hasContent = true;
    } else if (c.type === "image" || c.type === "image_url") {
      var url = c.url || c.image_url || (c.source && c.source.url) || "";
      if (url) {
        var img = document.createElement("img");
        img.src = url;
        img.alt = "image";
        img.onclick = function() { window.open(this.src); };
        d.appendChild(img);
        hasContent = true;
      }
    } else if (c.type === "video" || c.type === "file") {
      var vUrl = c.url || c.file_url || (c.source && c.source.url) || "";
      var vName = c.name || c.filename || "";
      var isVideo = (c.type === "video") || /\.(mp4|webm|mov|avi)$/i.test(vUrl || vName);
      if (vUrl && isVideo) {
        var vid = document.createElement("video");
        vid.src = vUrl;
        vid.controls = true;
        vid.style.maxWidth = "100%";
        d.appendChild(vid);
        hasContent = true;
      } else if (vUrl) {
        var a = document.createElement("a");
        a.className = "file-link";
        a.href = vUrl;
        a.target = "_blank";
        a.textContent = vName || vUrl;
        d.appendChild(a);
        hasContent = true;
      }
    }
  }
  if (hasContent) {
    chat.appendChild(d);
    chat.scrollTop = chat.scrollHeight;
  }
}

function setStatus(state, text) {
  dot.className = "dot " + state;
  stxt.textContent = text;
}

const wsBase = `wss://${ENDPOINT}/?chatToken=${encodeURIComponent(CHAT_TOKEN)}&clawInstanceId=${encodeURIComponent(INSTANCE_ID)}`;
const wsUrl = wsBase + `&token=${encodeURIComponent(USER_TOKEN)}`;
addMsg("正在尝试连接...", "system");

const ws = new WebSocket(wsUrl);

function sendConnect() {
  const msg = {
    type: "req", id: uuid(), method: "connect",
    params: {
      minProtocol: 3, maxProtocol: 3,
      client: { id: "openclaw-control-ui", version: "dev", platform: navigator.platform, mode: "webchat" },
      role: "operator", scopes: ["operator.admin"], caps: ["tool-events"],
      userAgent: navigator.userAgent, locale: "zh-CN"
    }
  };
  ws.send(JSON.stringify(msg));
  addMsg("已发送 connect 请求", "system");
}

ws.onopen = () => {
  setStatus("wait", "握手中...");
  addMsg("WebSocket 连接成功，等待服务端握手...", "system");
};

let handshakeDone = false;

ws.onmessage = (e) => {
  try {
    const data = JSON.parse(e.data);
    const type = data.type || "";
    const event = data.event || "";
    const method = data.method || "";

    // connect.challenge — 服务端通知可以发 connect
    if (type === "event" && event === "connect.challenge") {
      addMsg("收到 challenge，发送 connect...", "system");
      sendConnect();
      return;
    }

    // connect 响应 (type=resp 或 type=res)
    if (type === "resp" || type === "res") {
      if (data.ok === true || !data.error) {
        if (!handshakeDone) {
          handshakeDone = true;
          setStatus("on", "已连接");
          addMsg("协议握手完成，可以开始对话", "system");
          inp.disabled = false; btn.disabled = false; inp.focus();
        }
      } else {
        setStatus("off", "握手失败");
        addMsg("握手失败: " + JSON.stringify(data.error), "error");
      }
      return;
    }

    // 所有 event 类型的消息
    if (type === "event") {
      // 完成握手检测
      if (!handshakeDone && (event === "heartbeat" || event === "tick" || event === "state" || event === "connect.ready")) {
        handshakeDone = true;
        setStatus("on", "已连接");
        addMsg("协议握手完成，可以开始对话", "system");
        inp.disabled = false; btn.disabled = false; inp.focus();
      }

      var payload = data.payload || {};

      // AI 聊天回复: event="chat"
      if (event === "chat") {
        var chatMsg = payload.message || {};
        var contents = chatMsg.content || [];
        var chatState = payload.state || "";
        var chatRole = chatMsg.role || "";
        var chatText = "";
        var mediaItems = [];
        var i;

        for (i = 0; i < contents.length; i++) {
          var c = contents[i];
          if (c.type === "text" && c.text) chatText += c.text;
          if (c.type === "image" || c.type === "image_url" || c.type === "video" || c.type === "file") {
            mediaItems.push(c);
          }
          if (c.type === "tool_call" || c.type === "tool_use") {
            var tcName = c.name || c.function || c.tool || "tool";
            var tcArgs = c.arguments || c.input || c.params || "";
            var tcSummary = tcName;
            if (typeof tcArgs === "string" && tcArgs.length > 0) {
              tcSummary += ": " + (tcArgs.length > 120 ? tcArgs.slice(0, 120) + "..." : tcArgs);
            } else if (typeof tcArgs === "object") {
              var tcStr = JSON.stringify(tcArgs);
              tcSummary += ": " + (tcStr.length > 120 ? tcStr.slice(0, 120) + "..." : tcStr);
            }
            addStep(tcSummary);
          }
        }

        if ((chatRole === "assistant" || !chatRole) && chatState === "final") {
          finishThinking();
          var streamEl = chat.querySelector(".msg.bot.streaming");
          if (streamEl) streamEl.remove();

          if (chatText && !tryRenderBase64(chatText)) {
            if (chatText.indexOf("SYSTEM_FILE_REQUEST_") === -1) {
              addMsg(chatText, "bot");
            }
          }
          if (mediaItems.length > 0) {
            addRichMsg(mediaItems, "bot");
          }
        } else if ((chatRole === "assistant" || !chatRole) && chatText) {
          if (Object.keys(pendingFileLoads).length > 0 && chatText.replace(/[\s]/g,"").length > 200) {
            if (tryRenderBase64(chatText)) return;
          }
          if (chatText.indexOf("SYSTEM_FILE_REQUEST_") !== -1) return;
          startThinking();
          var lastEl = chat.querySelector(".msg.bot.streaming");
          if (!lastEl) { lastEl = document.createElement("div"); lastEl.className = "msg bot streaming"; chat.appendChild(lastEl); lastEl.textContent = ""; }
          lastEl.textContent = chatText;
          chat.scrollTop = chat.scrollHeight;
        }

        if (chatState === "final" && !chatText && mediaItems.length === 0) finishThinking();
        return;
      }

      // tool 执行结果
      if (event === "tool" || event === "tool_result") {
        var toolName = payload.name || payload.tool || "";
        if (toolName) addStep(toolName + " (done)");
        return;
      }

      // run 状态
      if (event === "run.start" || event === "run") { startThinking(); return; }
      if (event === "run.done" || event === "run.end") { finishThinking(); return; }

      // heartbeat / tick / state 静默
      if (event === "heartbeat" || event === "tick" || event === "state") return;

      return;
    }

    // 业务事件 (type=evt) — 兼容另一种格式
    if (type === "evt") {
      const p = data.params || {};
      if (method === "chat.message" || method === "chat.update") {
        const text = p.text || p.message || "";
        if (text) addMsg(text, "bot");
      } else if (method === "chat.stream") {
        const text = p.text || p.delta || "";
        if (text) {
          let last = chat.querySelector(".msg.bot.streaming");
          if (!last) { last = document.createElement("div"); last.className = "msg bot streaming"; chat.appendChild(last); }
          last.textContent += text;
          chat.scrollTop = chat.scrollHeight;
        }
      } else if (method === "chat.stream.end") {
        const el = chat.querySelector(".msg.bot.streaming");
        if (el) el.classList.remove("streaming");
      }
      return;
    }

    console.log("unhandled:", data);
  } catch(err) { addMsg("[error] " + err.message + " | raw: " + e.data.slice(0, 200), "error"); }
};

ws.onerror = () => { setStatus("off", "连接错误"); addMsg("WebSocket 连接错误", "error"); };
ws.onclose = (ev) => {
  setStatus("off", "已断开");
  inp.disabled = true; btn.disabled = true;
  let reason = "WebSocket 已断开";
  if (ev.code !== 1000) reason += ` (code=${ev.code})`;
  if (ev.reason) reason += ` ${ev.reason}`;
  addMsg(reason, "system");
};

function send() {
  const text = inp.value.trim();
  if (!text || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({
    type: "req", id: uuid(), method: "chat.send",
    params: { sessionKey: "agent:main:main", message: text, deliver: false, idempotencyKey: uuid() }
  }));
  addMsg(text, "user");
  inp.value = "";
  inp.focus();
}

btn.addEventListener("click", send);
inp.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } });
</script>
</body>
</html>"""

ERROR_PAGE = """<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><title>Error</title>
<style>
body { font-family: sans-serif; background: #f0f2f5; display: flex; align-items: center; justify-content: center; height: 100vh; }
.card { background: #fff; padding: 40px; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,.1); max-width: 500px; text-align: center; }
.card h2 { color: #e74c3c; margin-bottom: 16px; }
.card pre { text-align: left; background: #f8f8f8; padding: 12px; border-radius: 8px; font-size: 12px; overflow: auto; margin: 16px 0; }
.card a { color: #667eea; }
</style></head><body>
<div class="card"><h2>__TITLE__</h2><p>__MSG__</p><pre>__DETAIL__</pre><a href="/">重试</a></div>
</body></html>"""


def main():
    parser = argparse.ArgumentParser(description="ArkClaw Web Demo (飞书 OAuth 认证版)")
    parser.add_argument("--space-id", help="ClawSpace ID (创建新实例时需要)")
    parser.add_argument("--instance-id", help="已有实例 ID (直接连接)")
    parser.add_argument("--port", type=int, default=PORT, help=f"本地端口 (默认: {PORT})")
    args = parser.parse_args()

    if not args.instance_id and not args.space_id:
        parser.error("请指定 --instance-id 或 --space-id")

    ak = os.getenv("VOLC_ACCESS_KEY_ID", "") or os.getenv("VOLC_2_ACCESS_KEY_ID", "")
    sk = os.getenv("VOLC_SECRET_ACCESS_KEY", "") or os.getenv("VOLC_2_SECRET_ACCESS_KEY", "")
    if not ak or not sk:
        logger.error(
            "未找到火山引擎 AK/SK 环境变量，请设置:\n"
            "  VOLC_ACCESS_KEY_ID / VOLC_SECRET_ACCESS_KEY"
        )
        sys.exit(1)
    if not LARK_APP_ID or not LARK_APP_SECRET:
        logger.error(
            "未找到飞书应用凭证，请设置:\n"
            "  LARK_APP_ID / LARK_APP_SECRET"
        )
        sys.exit(1)
    logger.info(f"已加载 AK/SK (region={REGION})")

    if args.instance_id:
        instance_id = args.instance_id
        status = get_claw_instance_status(ak, sk, instance_id, region=REGION)
        if status != "Running":
            logger.info(f"实例状态: {status}，等待就绪...")
            wait_instance_ready(ak, sk, instance_id, region=REGION)
    else:
        logger.info("创建新实例...")
        instance_id = create_claw_instance(ak, sk, args.space_id, region=REGION)
        logger.info("等待实例就绪...")
        wait_instance_ready(ak, sk, instance_id, region=REGION)

    logger.info("获取聊天凭证...")
    chat_token, endpoint = get_claw_instance_chat_token(ak, sk, instance_id, region=REGION)
    logger.info(f"获取 app_access_token...")
    app_token = get_lark_app_access_token()
    logger.info(f"app_access_token: {app_token[:8]}...")

    port = args.port
    redirect_uri = f"http://127.0.0.1:{port}/callback"
    auth_url = (
        f"https://accounts.feishu.cn/open-apis/authen/v1/authorize"
        f"?client_id={LARK_APP_ID}"
        f"&response_type=code"
        f"&redirect_uri={urllib.parse.quote(redirect_uri, safe='')}"
        f"&state=arkclaw_demo"
    )

    login_html = (
        LOGIN_PAGE
        .replace("__INSTANCE_ID__", instance_id)
        .replace("__AUTH_URL__", auth_url)
    )

    state = {"user_token": None, "user_name": ""}

    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            parsed = urllib.parse.urlparse(self.path)

            # OAuth 回调
            if parsed.path == "/callback":
                params = urllib.parse.parse_qs(parsed.query)
                if "error" in params:
                    self._serve_error("授权被拒绝", params.get("error", [""])[0], "")
                    return
                code = params.get("code", [""])[0]
                if not code:
                    self._serve_error("缺少授权码", "回调中未携带 code 参数", "")
                    return

                logger.info(f"收到授权码: {code[:8]}...")

                # 先尝试 v2 接口
                result = exchange_code_for_user_token(code, redirect_uri)
                user_token = result.get("access_token", "")

                # 如果 v2 失败，回退 v1
                if not user_token:
                    logger.info("v2 接口未返回 token，尝试 v1 接口...")
                    result = exchange_code_for_user_token_v1(code, app_token)
                    data = result.get("data", {})
                    user_token = data.get("access_token", "")

                if not user_token:
                    self._serve_error(
                        "获取 Token 失败",
                        "无法从飞书获取 user_access_token",
                        json.dumps(result, indent=2, ensure_ascii=False),
                    )
                    return

                state["user_token"] = user_token
                user_name = result.get("name", "") or result.get("data", {}).get("name", "") or "已授权用户"
                state["user_name"] = user_name
                logger.info(f"飞书授权成功: {user_name}, token={user_token[:8]}...")

                # 重定向到聊天页
                self.send_response(302)
                self.send_header("Location", "/chat")
                self.end_headers()
                return

            # 聊天页
            if parsed.path == "/chat" and state["user_token"]:
                html = (
                    CHAT_PAGE
                    .replace("__CHAT_TOKEN__", chat_token)
                    .replace("__INSTANCE_ID__", instance_id)
                    .replace("__ENDPOINT__", endpoint)
                    .replace("__USER_TOKEN__", state["user_token"])
                    .replace("__USER_NAME__", state["user_name"])
                )
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.end_headers()
                self.wfile.write(html.encode("utf-8"))
                return

            # 默认: 登录页
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.end_headers()
            self.wfile.write(login_html.encode("utf-8"))

        def _serve_error(self, title, msg, detail):
            html = (
                ERROR_PAGE
                .replace("__TITLE__", title)
                .replace("__MSG__", msg)
                .replace("__DETAIL__", detail)
            )
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.end_headers()
            self.wfile.write(html.encode("utf-8"))

        def log_message(self, fmt, *a):
            pass

    server = http.server.HTTPServer(("127.0.0.1", port), Handler)
    url = f"http://127.0.0.1:{port}"

    logger.info("=" * 50)
    logger.info(f"实例: {instance_id}")
    logger.info(f"Endpoint: {endpoint}")
    logger.info(f"ChatToken: {chat_token[:8]}...")
    logger.info(f"飞书授权地址: {auth_url[:80]}...")
    logger.info("=" * 50)
    logger.info(f"请打开浏览器访问: {url}")
    logger.info("按 Ctrl+C 停止服务")

    webbrowser.open(url)

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        logger.info("\n服务已停止")
        server.server_close()


if __name__ == "__main__":
    main()
