/**
 * 把宿主页面的能力清单 / 字段清单格式化成一段 system prompt，
 * 让 AI 知道：
 *  1. 当前页面有哪些可填字段、可点按钮
 *  2. 宿主已经注册了哪些 action
 *  3. 想触发宿主操作必须用什么格式输出（widget 才能解析）
 *
 * 设计原则：
 *  - 只在第一条用户消息时注入一次（在 ChatPanel 里 hostInfoSentRef 控制）
 *  - 字段表用紧凑表示，避免撑爆 prompt
 *  - 给出 1~2 个具体例子，让 LLM 学会照抄格式
 */

import type { HostInfo, HostField } from '@/sdk/types';

const MAX_FIELD_LINES = 30;

export function buildHostCapabilityPrompt(info: HostInfo): string {
  if (!info) return '';
  const lines: string[] = [];

  // —— 身份定位（最关键，必须放最前面）——
  // 之前发现 ArkClaw Agent 配了浏览/搜索工具，AI 误把自己当外部代理去打开 URL，
  // 这里强制 AI 认识到："你不是远程助手，你就在用户的页面里"。
  lines.push('==== 你的运行环境 ====');
  lines.push('你不是一个外部网页代理，**你正以 Copilot 抽屉的形式嵌入在用户当前查看的网页里**。');
  lines.push('用户和你共用同一个浏览器窗口，他看到什么页面，你就在什么页面里。');
  lines.push('用户说"这张表 / 这个页面 / 帮我填一下"——指的就是下面列出的字段，**不要再去打开任何 URL**。');
  lines.push('');
  lines.push('严禁行为：');
  lines.push('  1. 严禁调用任何"打开网页 / 浏览网址 / 搜索引擎 / web search / browse"类工具去找页面，');
  lines.push('     页面已经在下面给你了，再去搜只会拿到无关结果（已多次出现误打开 SearXNG 的情况）。');
  lines.push('  2. 严禁让用户"提供报销单的 URL / 把链接发给我"——你已经在那个页面里。');
  lines.push('  3. 如果用户的请求超出下面"可调用动作"和"页面字段"列表，直接用自然语言回答，不要硬调工具。');
  lines.push('');

  lines.push('==== 当前页面信息 ====');
  if (info.pageTitle) lines.push(`标题: ${info.pageTitle}`);
  if (info.pageUrl) lines.push(`URL:  ${info.pageUrl}（仅供你了解，无需访问）`);
  lines.push('');

  if (info.actions.length) {
    lines.push(`可调用动作: ${info.actions.join(', ')}`);
  } else {
    lines.push('（宿主尚未注册任何动作，用户的请求请用自然语言回答即可）');
  }

  const buttons = info.fields.filter((f) => f.tagName === 'button' || (f.tagName === 'input' && f.type === 'button'));
  const formFields = info.fields.filter((f) => f.tagName !== 'button' && !(f.tagName === 'input' && f.type === 'button'));

  if (formFields.length) {
    lines.push('');
    lines.push('页面可填字段（fillForm 用 field 引用，优先填 name；没有 name 时用 selector）：');
    const shown = formFields.slice(0, MAX_FIELD_LINES);
    shown.forEach((f) => lines.push('  - ' + describeField(f)));
    if (formFields.length > MAX_FIELD_LINES) {
      lines.push(`  …（还有 ${formFields.length - MAX_FIELD_LINES} 个字段未列出）`);
    }
  }

  if (buttons.length) {
    lines.push('');
    lines.push('页面可点按钮（clickButton 用 selector 引用）：');
    buttons.slice(0, 15).forEach((b) => {
      const label = b.label || b.name || '(无文本)';
      lines.push(`  - "${label}" → selector: ${b.selector}`);
    });
  }

  lines.push('');
  lines.push('==== 触发宿主动作的唯一格式 ====');
  lines.push('要让 widget 真正帮用户操作页面，**必须**在回复里输出下面这种 XML 标签——');
  lines.push('widget 只解析这种格式，其他形式（JSON、function call 等）虽然也兼容，但请优先用 XML：');
  lines.push('');
  lines.push('  <arkclaw:action name="动作名">{"参数": "值"}</arkclaw:action>');
  lines.push('');
  lines.push('完整示例（用户说"帮我填差旅 1280"时你应该这样回）：');
  lines.push('  好的，我帮你填一下：');
  lines.push('  <arkclaw:action name="fillForm">{"field": "title", "value": "4 月差旅"}</arkclaw:action>');
  lines.push('  <arkclaw:action name="fillForm">{"field": "amount", "value": "1280"}</arkclaw:action>');
  lines.push('  <arkclaw:action name="fillForm">{"field": "category", "value": "travel"}</arkclaw:action>');
  lines.push('  填好啦，请确认无误后点"提交"。');
  lines.push('');
  lines.push('注意：');
  lines.push('  1. 一次回复可以包含多个 <arkclaw:action> 标签，会按顺序执行');
  lines.push('  2. JSON 必须是合法的双引号格式');
  lines.push('  3. 只调用上面列出的"可调用动作"和"页面字段"，不要凭空猜不存在的字段名');
  lines.push('  4. select 类字段填的是 value（不是显示文本），看 options 列表对照');

  return lines.join('\n');
}

/**
 * 每条用户消息都附带这段短提醒，避免 AI 在多轮对话中"忘了"自己嵌在页面里又跑去搜索。
 * 注意：只在已经注入过完整 prompt 之后才用，避免覆盖首条详细注入。
 */
export function buildHostShortReminder(info: HostInfo): string {
  if (!info) return '';
  const fc = info.fields.length;
  const title = info.pageTitle || '宿主页面';
  return `[宿主提醒] 你正嵌入在页面「${title}」里。已知 ${fc} 个可操作字段（详见首条上下文）。需要填表请用 <arkclaw:action name="fillForm">{...}</arkclaw:action>，**不要去搜索或打开任何 URL**。`;
}

function describeField(f: HostField): string {
  const parts: string[] = [];
  parts.push(`[${f.name || f.selector}]`);
  parts.push(`<${f.tagName}${f.type ? '/' + f.type : ''}>`);
  if (f.label) parts.push(`"${f.label}"`);
  else if (f.placeholder) parts.push(`placeholder="${f.placeholder}"`);
  if (f.options && f.options.length) {
    const optStr = f.options
      .filter((o) => o.value)
      .slice(0, 6)
      .map((o) => `${o.value}=${o.label}`)
      .join('|');
    if (optStr) parts.push(`options={${optStr}}`);
  }
  return parts.join(' ');
}
