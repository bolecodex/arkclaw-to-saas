import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useChatStore } from '@/store/chatStore';

interface Props {
  onSend: (text: string) => void;
  disabled?: boolean;
}

export function InputBar({ onSend, disabled }: Props) {
  const [val, setVal] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);
  const pendingContext = useChatStore((s) => s.pendingContext);
  const setPendingContext = useChatStore((s) => s.setPendingContext);

  useEffect(() => {
    if (!ref.current) return;
    ref.current.style.height = 'auto';
    ref.current.style.height = Math.min(ref.current.scrollHeight, 120) + 'px';
  }, [val]);

  const handleSend = () => {
    const text = val.trim();
    if (!text || disabled) return;
    onSend(text);
    setVal('');
    setPendingContext(null);
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {pendingContext && (
        <div className="ac-input__pending" style={{ margin: '0 12px 0' }}>
          <span>📌 上下文：</span>
          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {pendingContext.tagName}
            {pendingContext.text ? `: ${pendingContext.text.slice(0, 40)}` : ''}
          </span>
          <button onClick={() => setPendingContext(null)} aria-label="取消上下文">×</button>
        </div>
      )}
      <div className="ac-input">
        <textarea
          ref={ref}
          className="ac-input__textarea"
          placeholder="问点什么？(Enter 发送，Shift+Enter 换行)"
          value={val}
          onChange={(e) => setVal(e.target.value)}
          onKeyDown={onKey}
          rows={1}
          disabled={disabled}
        />
        <button className="ac-input__send" onClick={handleSend} disabled={disabled || !val.trim()}>
          发送
        </button>
      </div>
    </div>
  );
}
