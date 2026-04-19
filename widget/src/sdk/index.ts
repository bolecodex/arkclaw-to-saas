/**
 * SDK 入口：被 Vite lib mode 打包成 UMD/ES bundle。
 *
 * 暴露：
 *  - Arkclaw 主类（宿主页面用）
 *  - mountInline 函数（iframe 内部和 inline 模式都会调用）
 *  - 类型导出
 */

export { Arkclaw } from './Arkclaw';
export { mountInline } from './inline';
export { HostBridge, WidgetBridge } from './HostBridge';
export { highlightSelector } from './utils';
export type * from './types';

import { Arkclaw } from './Arkclaw';
import { mountInline } from './inline';
import { HostBridge, WidgetBridge } from './HostBridge';
import { highlightSelector } from './utils';

const api = { Arkclaw, mountInline, HostBridge, WidgetBridge, highlightSelector };

if (typeof window !== 'undefined') {
  (window as any).Arkclaw = Object.assign((window as any).Arkclaw || {}, api, {
    // 保留构造器：const c = new window.Arkclaw.Arkclaw({...})
    create: (opts: ConstructorParameters<typeof Arkclaw>[0]) => new Arkclaw(opts),
  });
}

export default api;
