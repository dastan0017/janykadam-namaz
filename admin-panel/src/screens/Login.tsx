import { useEffect, useRef } from 'react';
import { useActions, useAppState } from '../store/context';
import type { TelegramAuthPayload } from '../api/dto';

/**
 * Вход в панель — только через Telegram Login Widget.
 *
 * Пароля нет: Telegram подписывает данные ботовым токеном, бэкенд проверяет
 * подпись и ищет username в списке пользователей панели. Поэтому в BotFather
 * обязателен `/setdomain` с доменом панели — без него виджет не отдаст данные.
 */

const BOT_USERNAME: string = import.meta.env.VITE_BOT_USERNAME ?? '';

declare global {
  interface Window {
    onTelegramAuth?: (user: TelegramAuthPayload) => void;
  }
}

export default function Login() {
  const s = useAppState();
  const a = useActions();
  const slot = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!BOT_USERNAME || !slot.current) return;

    window.onTelegramAuth = (user) => void a.loginWithTelegram(user);

    const script = document.createElement('script');
    script.src = 'https://telegram.org/js/telegram-widget.js?22';
    script.async = true;
    script.setAttribute('data-telegram-login', BOT_USERNAME);
    script.setAttribute('data-size', 'large');
    script.setAttribute('data-userpic', 'false');
    script.setAttribute('data-radius', '8');
    script.setAttribute('data-onauth', 'onTelegramAuth(user)');
    slot.current.appendChild(script);

    return () => {
      delete window.onTelegramAuth;
    };
  }, [a]);

  return (
    <div
      style={{
        minHeight: '100dvh',
        display: 'grid',
        placeItems: 'center',
        padding: 16,
        background: 'var(--bg)',
      }}
    >
      <div className="card" style={{ maxWidth: 420, width: '100%', padding: 24, textAlign: 'center' }}>
        <div style={{ fontSize: 28, marginBottom: 8 }}>🌙</div>
        <h1 style={{ fontSize: 20, margin: '0 0 6px' }}>Janykadam</h1>
        <p className="sub" style={{ margin: '0 0 20px' }}>
          Панель марафонов. Вход по Telegram — тому же, что в списке пользователей панели.
        </p>

        {BOT_USERNAME ? (
          <div ref={slot} style={{ display: 'flex', justifyContent: 'center', minHeight: 48 }} />
        ) : (
          <p style={{ color: 'var(--danger)', fontSize: 13, margin: 0 }}>
            Не задан <code>VITE_BOT_USERNAME</code> — виджету Telegram нужен username бота без «@».
          </p>
        )}

        {s.authError ? (
          <p style={{ color: 'var(--danger)', fontSize: 13, marginTop: 16, marginBottom: 0 }}>{s.authError}</p>
        ) : null}

        <p className="sub" style={{ fontSize: 12, marginTop: 20, marginBottom: 0 }}>
          Если кнопка не появилась, в BotFather не задан <code>/setdomain</code> для этого домена.
        </p>
      </div>
    </div>
  );
}
