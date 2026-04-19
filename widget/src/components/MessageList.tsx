import { useEffect, useRef } from 'react';
import { useChatStore } from '@/store/chatStore';
import { MessageItem } from './MessageItem';

export function MessageList({ greeting }: { greeting?: string }) {
  const messages = useChatStore((s) => s.messages);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages]);

  return (
    <div className="ac-list" ref={ref}>
      {messages.length === 0 && (
        <div className="ac-empty">
          <div className="ac-empty__icon">💬</div>
          <div>{greeting || '开始对话吧'}</div>
        </div>
      )}
      {messages.map((m) => <MessageItem key={m.id} msg={m} />)}
    </div>
  );
}
