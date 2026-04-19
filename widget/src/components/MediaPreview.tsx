import type { MediaAttachment } from '@/store/chatStore';

interface Props { items: MediaAttachment[] }

export function MediaPreview({ items }: Props) {
  if (!items?.length) return null;
  return (
    <div className="ac-media">
      {items.map((m, idx) => {
        const url = m.blobUrl || m.url || '';
        if (!url && m.loading) {
          return <div key={idx} className="ac-media__item" style={{ padding: '12px 18px' }}>加载中…</div>;
        }
        if (m.error) {
          return <div key={idx} className="ac-media__item" style={{ padding: '12px 18px', color: '#e74c3c' }}>{m.error}</div>;
        }
        if (m.type === 'image') {
          return (
            <a key={idx} className="ac-media__item" href={url} target="_blank" rel="noreferrer">
              <img src={url} alt={m.name || 'image'} loading="lazy" />
            </a>
          );
        }
        if (m.type === 'video') {
          return (
            <div key={idx} className="ac-media__item">
              <video src={url} controls preload="metadata" />
            </div>
          );
        }
        return (
          <a key={idx} className="ac-media__item" href={url} download={m.name}>
            <div style={{ padding: '12px 16px' }}>📎 {m.name || '文件'}</div>
          </a>
        );
      })}
    </div>
  );
}
