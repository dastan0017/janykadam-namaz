import { useEffect, useRef, useState } from 'react';
import { useActions } from '../store/context';
import type { LinkCheck } from '../types';
import { channelLinkError, normalizeChannelLink } from './channel';

/**
 * Проверяет ссылку, пока её вставляют: не ссылка — сразу, канал или группа —
 * у бэкенда (он смотрит страницу t.me). Результат приходит с паузой, чтобы не
 * дёргать сервер на каждую букву.
 */
export function useLinkCheck(value: string, enabled = true): { res: LinkCheck | null; busy: boolean } {
  const { checkChannelLink } = useActions();
  const check = useRef(checkChannelLink);
  check.current = checkChannelLink;
  const [res, setRes] = useState<LinkCheck | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!enabled || !value.trim()) {
      setRes(null);
      setBusy(false);
      return;
    }
    let alive = true;
    setBusy(true);
    const timer = window.setTimeout(async () => {
      const local = channelLinkError(value);
      const out: LinkCheck = local
        ? { link: null, kind: 'invalid', ok: false, message: local }
        : ((await check.current(value)) ?? {
            link: normalizeChannelLink(value),
            kind: 'unknown',
            ok: true,
            message: 'Не удалось проверить ссылку — проверим, когда бот попадёт в канал',
          });
      if (!alive) return;
      setRes(out);
      setBusy(false);
    }, 450);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [value, enabled]);

  return { res, busy };
}

