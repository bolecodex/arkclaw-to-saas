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
  lines.push('[宿主能力]');
  if (info.pageTitle) lines.push(`页面: ${info.pageTitle}`);
  if (info.pageUrl) lines.push(`URL: ${info.pageUrl}`);

  if (info.actions.length) {
    lines.push(`可调用动作: ${info.actions.join(', ')}`);
  } else {
    lines.push('（宿主尚未注册任何动作）');
  }

  const formFields = info.fields.filter((f) => f.tagName !== 'button' && !(f.tagName === 'input' && f.type === 'button'));
  const buttons = info.fields.filter((f) => f.tagName === 'button' || f.tagName === 'input' && f.type === 'button' || f.tagName === 'div' || f.tagName === 'span' /* role=button */);

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
  lines.push('—— 调用规则 ——');
  lines.push('当用户的请求需要操作宿主页面时，请在你的回复里**用如下 XML 标签输出动作调用**（widget 会自动解析并执行）：');
  lines.push('  <arkclaw:action name="动作名">{"参数": "值"}</arkclaw:action>');
  lines.push('');
  lines.push('示例：');
  lines.push('  <arkclaw:action name="fillForm">{"field": "title", "value": "4 月差旅"}</arkclaw:action>');
  lines.push('  <arkclaw:action name="fillForm">{"field": "amount", "value": "1280"}</arkclaw:action>');
  lines.push('  <arkclaw:action name="clickButton">{"selector": "#submit-btn"}</arkclaw:action>');
  lines.push('');
  lines.push('注意事项：');
  lines.push('  1. 一次回复可以包含多个 <arkclaw:action> 标签，会按顺序执行');
  lines.push('  2. JSON 必须是合法的双引号格式');
  lines.push('  3. 标签前后用自然语言告诉用户你在做什么（"我帮你填好了…"）');
  lines.push('  4. 只调用上面列出的"可调用动作"和"页面字段"，不要凭空猜不存在的字段名');

  return lines.join('\n');
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
