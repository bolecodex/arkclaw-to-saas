/**
 * 离线验证 widget 新链路里的两个关键纯函数：
 *   - buildHostCapabilityPrompt：注入给 AI 的 system prompt 是否包含字段、actions、调用示例
 *   - tryParseActions：AI 各种格式的回答都能否被解析成 action 调用
 *
 * 这是 Node 端跑的，不走浏览器，目的是在让用户验证之前先排掉代码层 bug。
 */

import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// 跟生产 bundle 一样从源文件吃逻辑（这两个函数是纯逻辑，不依赖 React/DOM）
const hostPrompt = await import(resolve(__dirname, '../src/utils/hostPrompt.ts')).catch(async () => {
  // .ts 在 node 下不能直接 import，退回手动 transpile
  const fs = await import('fs');
  const ts = fs.readFileSync(resolve(__dirname, '../src/utils/hostPrompt.ts'), 'utf8');
  // 极简 strip：去类型即可（这个文件没复杂语法）
  const stripped = ts
    .replace(/^import[^;]+;\n/gm, '')
    .replace(/: \w+(\[\])?(\s*\|\s*\w+(\[\])?)*/g, '')
    .replace(/\bexport\s+/g, '')
    .replace(/interface\s+\w+\s*\{[\s\S]*?\}\s*/g, '');
  const m = new Function(stripped + '\nreturn { buildHostCapabilityPrompt, buildHostShortReminder };');
  return m();
});

const { buildHostCapabilityPrompt, buildHostShortReminder } = hostPrompt;

const sampleHost = {
  pageTitle: '报销单 · 演示页面',
  pageUrl: 'http://127.0.0.1:8080/examples/vanilla-html/index.html',
  actions: ['fillForm', 'clickButton', 'highlight'],
  fields: [
    { selector: '#title', name: 'title', tagName: 'input', type: 'text', label: '报销标题', placeholder: '如：4 月差旅' },
    { selector: '#amount', name: 'amount', tagName: 'input', type: 'number', label: '金额（元）' },
    { selector: '#category', name: 'category', tagName: 'select', label: '类别',
      options: [{ value: '', label: '请选择' }, { value: 'travel', label: '差旅' }, { value: 'meal', label: '餐费' }, { value: 'other', label: '其他' }] },
    { selector: '#memo', name: 'memo', tagName: 'textarea', label: '备注' },
    { selector: '#submit-btn', name: 'submit-btn', tagName: 'button', label: '提交' },
    { selector: '#ai-fill', name: 'ai-fill', tagName: 'button', label: '让 AI 帮我填' },
  ],
};

console.log('\n=== buildHostCapabilityPrompt 输出 ===\n');
console.log(buildHostCapabilityPrompt(sampleHost));

console.log('\n=== buildHostShortReminder 输出（用户后续每条消息附带）===\n');
console.log(buildHostShortReminder(sampleHost));

// 关键断言：强约束身份关键词必须出现，不能让 AI 跑去搜索
const cap = buildHostCapabilityPrompt(sampleHost);
const required = ['嵌入', '严禁', 'fillForm', '<arkclaw:action', '差旅', 'travel', '不要去打开', '不要再去打开'];
const missing = required.filter((kw) => {
  // "不要再去打开" 跟 "不要去打开" 任一出现即可
  if (kw === '不要去打开' || kw === '不要再去打开') {
    return !cap.includes('不要去打开') && !cap.includes('不要再去打开') && !cap.includes('严禁调用');
  }
  return !cap.includes(kw);
});
if (missing.length) {
  console.log('\n❌ 强约束 prompt 缺少关键词: ' + missing.join(', '));
} else {
  console.log('\n✔ 强约束 prompt 关键词齐全');
}

// ---- tryParseActions：把 useWebSocket.ts 里的解析函数搬过来跑 ----
const ACTION_TAG_RE = /<arkclaw:action\s+name=["']([^"']+)["']\s*>([\s\S]*?)<\/arkclaw:action>/g;
const JSON_FENCE_RE = /```(?:json|action)?\s*\n([\s\S]*?)\n```/g;

function tryParseActions(text) {
  const out = [];
  for (const m of text.matchAll(ACTION_TAG_RE)) {
    try {
      const args = JSON.parse(m[2].trim());
      if (args && typeof args === 'object') out.push({ action: m[1], args });
    } catch {}
  }
  for (const m of text.matchAll(JSON_FENCE_RE)) {
    const parsed = tryParseJsonAction(m[1].trim());
    if (parsed) out.push(...parsed);
  }
  if (out.length === 0) {
    const idx = text.indexOf('{');
    if (idx >= 0) {
      const parsed = tryParseJsonAction(text.slice(idx));
      if (parsed) out.push(...parsed);
    }
  }
  return out;
}

function tryParseJsonAction(raw) {
  let parsed;
  try { parsed = JSON.parse(raw); } catch {
    const trimmed = trimToBalancedJson(raw);
    if (!trimmed) return null;
    try { parsed = JSON.parse(trimmed); } catch { return null; }
  }
  const arr = Array.isArray(parsed) ? parsed : [parsed];
  const out = [];
  for (const it of arr) {
    if (!it || typeof it !== 'object') continue;
    const action = it.action || it.name || it.tool;
    const args = it.args || it.arguments || it.params || {};
    if (typeof action === 'string' && action) out.push({ action, args });
  }
  return out.length ? out : null;
}

function trimToBalancedJson(s) {
  let depth = 0, start = -1;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '{') { if (start < 0) start = i; depth += 1; }
    else if (c === '}') { depth -= 1; if (depth === 0 && start >= 0) return s.slice(start, i + 1); }
  }
  return null;
}

const cases = [
  {
    name: '场景1：标准 <arkclaw:action> 标签（多个连发）',
    text: `好的，我来帮你填报销单。
<arkclaw:action name="fillForm">{"field": "title", "value": "4 月差旅"}</arkclaw:action>
<arkclaw:action name="fillForm">{"field": "amount", "value": "1280"}</arkclaw:action>
<arkclaw:action name="fillForm">{"field": "category", "value": "travel"}</arkclaw:action>
已经填好了，请确认。`,
    expectActions: 3,
  },
  {
    name: '场景2：markdown json 代码块（豆包/通义常见）',
    text: '我帮你填一下：\n```json\n{"action": "fillForm", "args": {"field": "title", "value": "4月差旅"}}\n```\n',
    expectActions: 1,
  },
  {
    name: '场景3：markdown json 代码块装着数组',
    text: '```json\n[{"action":"fillForm","args":{"field":"title","value":"4月"}},{"action":"fillForm","args":{"field":"amount","value":"1280"}}]\n```',
    expectActions: 2,
  },
  {
    name: '场景4：纯 JSON 行（OpenAI tool_call 风格）',
    text: '{"name": "fillForm", "arguments": {"field": "memo", "value": "出差北京"}}',
    expectActions: 1,
  },
  {
    name: '场景5：AI 只是闲聊，没 action',
    text: '你好，请告诉我具体要填的字段名和值。',
    expectActions: 0,
  },
  {
    name: '场景6：流式半成品（不闭合的标签 + 不完整 JSON）',
    text: '<arkclaw:action name="fillForm">{"field": "ti',
    expectActions: 0,
  },
];

console.log('\n=== tryParseActions 测试 ===\n');
let pass = 0, fail = 0;
for (const c of cases) {
  const got = tryParseActions(c.text);
  const ok = got.length === c.expectActions;
  console.log(`${ok ? '✔' : '✘'} ${c.name}`);
  console.log(`   expect=${c.expectActions} got=${got.length}`);
  if (got.length) console.log(`   actions=${JSON.stringify(got, null, 2).split('\n').join('\n   ')}`);
  if (ok) pass += 1; else fail += 1;
}

console.log(`\n=== 汇总：${pass} 通过 / ${fail} 失败 ===`);
process.exit(fail === 0 ? 0 : 1);
