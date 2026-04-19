/**
 * InstancePicker — header 上的实例切换下拉。
 *
 * 痛点背景：之前 widget 强依赖后端 .env 配的 ARKCLAW_INSTANCE_ID，
 * 一旦那个实例的 Agent 没绑模型，对话就只会收到 chat.final 空 content。
 * 现在让用户能在 widget 里直接选择空间下的任意实例。
 */

import { useEffect, useRef, useState } from 'react';
import type { InstanceInfo } from '@/api/client';

export interface InstancePickerProps {
  currentId: string;
  loading: boolean;
  onLoadInstances: () => Promise<InstanceInfo[]>;
  onPick: (instance: InstanceInfo) => void;
}

export function InstancePicker({ currentId, loading, onLoadInstances, onPick }: InstancePickerProps) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<InstanceInfo[] | null>(null);
  const [fetching, setFetching] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onClick);
    return () => window.removeEventListener('mousedown', onClick);
  }, [open]);

  const ensureLoaded = async (force = false) => {
    if (items && !force) return;
    setFetching(true);
    setErr(null);
    try {
      const list = await onLoadInstances();
      setItems(list);
    } catch (e) {
      setErr((e as Error).message || '加载实例列表失败');
    } finally {
      setFetching(false);
    }
  };

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next) ensureLoaded();
  };

  const current = items?.find((it) => it.instance_id === currentId);
  const label = current?.name || (currentId ? truncate(currentId, 14) : '未配置');

  return (
    <div className="ac-instance-picker" ref={wrapRef}>
      <button
        type="button"
        className="ac-instance-picker__trigger"
        onClick={toggle}
        disabled={loading}
        title={`当前实例：${current?.name ?? ''}\nID: ${currentId || '(未配置)'}\n点击切换`}
      >
        <span className="ac-instance-picker__label">{label}</span>
        <span className="ac-instance-picker__chev">▾</span>
      </button>
      {open && (
        <div className="ac-instance-picker__panel" role="listbox">
          <div className="ac-instance-picker__panel-head">
            <span>切换实例</span>
            <button
              type="button"
              className="ac-instance-picker__refresh"
              onClick={() => ensureLoaded(true)}
              disabled={fetching}
              title="刷新列表"
            >
              {fetching ? '⏳' : '↻'}
            </button>
          </div>
          {err && <div className="ac-instance-picker__err">{err}</div>}
          {!err && items && items.length === 0 && (
            <div className="ac-instance-picker__empty">该 Space 下暂无实例</div>
          )}
          <div className="ac-instance-picker__list">
            {(items || []).map((it) => (
              <button
                type="button"
                key={it.instance_id}
                className={
                  'ac-instance-picker__item' +
                  (it.instance_id === currentId ? ' is-current' : '')
                }
                onClick={() => {
                  onPick(it);
                  setOpen(false);
                }}
              >
                <div className="ac-instance-picker__item-main">
                  <span className="ac-instance-picker__item-name">{it.name || '(未命名)'}</span>
                  <span className="ac-instance-picker__item-spec" data-status={it.status}>
                    {it.spec} · {it.status}
                  </span>
                </div>
                <span className="ac-instance-picker__item-id">{it.instance_id}</span>
              </button>
            ))}
            {!items && fetching && (
              <div className="ac-instance-picker__empty">加载中…</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function truncate(s: string, max: number): string {
  if (!s) return '';
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}
