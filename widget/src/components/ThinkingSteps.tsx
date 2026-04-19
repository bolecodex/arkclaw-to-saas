import { useState } from 'react';
import type { ThinkingStep } from '@/store/chatStore';

interface Props {
  steps: ThinkingStep[];
  done: boolean;
}

export function ThinkingSteps({ steps, done }: Props) {
  const [open, setOpen] = useState(true);
  if (!steps.length && done) return null;

  return (
    <div className="ac-thinking">
      <div className="ac-thinking__head" onClick={() => setOpen((v) => !v)}>
        <span>{done ? '已完成思考' : '思考中…'}</span>
        <span style={{ marginLeft: 'auto', opacity: .6 }}>
          {steps.length} 步 · {open ? '收起' : '展开'}
        </span>
      </div>
      {open && (
        <div className="ac-thinking__list">
          {steps.length === 0 && !done && <div className="ac-thinking__item">…</div>}
          {steps.map((s) => (
            <div key={s.id} className="ac-thinking__item">· {s.text}</div>
          ))}
        </div>
      )}
    </div>
  );
}
