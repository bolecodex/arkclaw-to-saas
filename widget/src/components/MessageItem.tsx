import type { Message } from '@/store/chatStore';
import { ThinkingSteps } from './ThinkingSteps';
import { MediaPreview } from './MediaPreview';

interface Props { msg: Message }

export function MessageItem({ msg }: Props) {
  const cls = `ac-msg ac-msg--${msg.role}`;
  return (
    <div className={cls}>
      {msg.contextChip && (
        <div className="ac-context-chip" title={msg.contextChip.selector}>
          📌 {msg.contextChip.tagName}
          {msg.contextChip.text ? `: ${msg.contextChip.text.slice(0, 40)}` : ''}
        </div>
      )}
      {msg.role === 'assistant' && (msg.thinking?.length || !msg.thinkingDone) && (
        <ThinkingSteps steps={msg.thinking || []} done={!!msg.thinkingDone} />
      )}
      {msg.text && (
        <div className={`ac-bubble ${msg.streaming ? 'ac-stream-cursor' : ''}`}>
          {msg.text}
        </div>
      )}
      {msg.media && msg.media.length > 0 && <MediaPreview items={msg.media} />}
    </div>
  );
}
