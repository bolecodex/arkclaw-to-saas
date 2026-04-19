import type { QuickAction } from '@/sdk/types';

interface Props {
  actions: QuickAction[];
  onClick: (action: QuickAction) => void;
}

export function QuickActions({ actions, onClick }: Props) {
  if (!actions?.length) return null;
  return (
    <div className="ac-quick">
      {actions.map((a, i) => (
        <button key={a.id || i} className="ac-quick__btn" onClick={() => onClick(a)} title={a.prompt}>
          {a.icon ? <span style={{ marginRight: 4 }}>{a.icon}</span> : null}
          {a.label}
        </button>
      ))}
    </div>
  );
}
