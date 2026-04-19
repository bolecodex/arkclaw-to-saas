/**
 * SelectionToolbar — 在 widget panel 内显示的简易工具栏。
 * （宿主页面的划词通过 SDK 推送上下文进 chip。）
 */
import { useEffect, useState } from 'react';

interface Props {
  onAsk: (prompt: string) => void;
}

export function SelectionToolbar({ onAsk }: Props) {
  const [text, setText] = useState('');
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const handler = () => {
      const sel = window.getSelection();
      const t = sel?.toString().trim() || '';
      if (!t || t.length < 2) {
        setPos(null); setText(''); return;
      }
      try {
        const range = sel?.getRangeAt(0);
        const rect = range?.getBoundingClientRect();
        if (rect && rect.width) {
          setText(t);
          setPos({ x: rect.left + rect.width / 2, y: rect.top - 8 });
        }
      } catch {/* noop */}
    };
    document.addEventListener('selectionchange', handler);
    return () => document.removeEventListener('selectionchange', handler);
  }, []);

  if (!pos || !text) return null;

  const ask = (prompt: string) => { onAsk(prompt); setPos(null); };
  return (
    <div
      className="ac-selection-toolbar"
      style={{ left: pos.x, top: pos.y, transform: 'translate(-50%, -100%)' }}
      onMouseDown={(e) => e.preventDefault()}
    >
      <button onClick={() => ask(`请解释这段内容：\n"${text}"`)}>问 AI</button>
      <button onClick={() => ask(`请把以下内容总结成 3 点：\n"${text}"`)}>总结</button>
      <button onClick={() => ask(`请把以下内容翻译成英文：\n"${text}"`)}>翻译</button>
    </div>
  );
}
