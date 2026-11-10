import { Header } from './components/Header';
import { ParticipantDrawer } from './components/ParticipantDrawer';
import { PointsModal } from './components/PointsModal';
import { PreviewRail } from './components/PreviewRail';
import { Sidebar } from './components/Sidebar';
import { ConfirmDialog, SaveBar, Toast } from './components/ui';
import { GLOBAL, SCREEN_TITLES } from './data/constants';
import { currentMarathon, currentTopic, isCurator } from './lib/derive';
import { isDirty } from './lib/edits';
import { buildPreview } from './lib/preview';
import { StoreProvider } from './store/StoreProvider';
import { useActions, useAppState, useIsMobile } from './store/context';
import { Analytics } from './screens/Analytics';
import { BotSettings } from './screens/BotSettings';
import { BotTexts } from './screens/BotTexts';
import { Broadcasts } from './screens/Broadcasts';
import { Journal } from './screens/Journal';
import Login from './screens/Login';
import { MarathonSettings } from './screens/MarathonSettings';
import { Marathons } from './screens/Marathons';
import { Namaz } from './screens/Namaz';
import { Overview } from './screens/Overview';
import { Participants } from './screens/Participants';
import { QuestionEditor } from './screens/QuestionEditor';
import { TopicEditor } from './screens/TopicEditor';
import { Topics } from './screens/Topics';
import { Users } from './screens/Users';
import type { Screen } from './types';

const MOBILE_TABS: { id: Screen; label: string }[] = [
  { id: 'overview', label: 'Обзор' },
  { id: 'participants', label: 'Участницы' },
  { id: 'topics', label: 'Темы' },
  { id: 'broadcasts', label: 'Рассылки' },
];

function Panel() {
  const s = useAppState();
  const { go, set, saveEdit, undoEdit } = useActions();
  const isMobile = useIsMobile();
  const m = currentMarathon(s);
  const cur = isCurator(s);

  // Куратор не видит «Пользователей» — это состояние «нет прав», а не пустой экран
  const noPerm = cur && s.screen === 'users';
  // Без марафона экраны его контекста недоступны — показываем список марафонов
  const screen: Screen = !m && !GLOBAL.includes(s.screen) ? 'marathons' : s.screen;

  const crumbs =
    screen === 'topicEditor'
      ? `${m?.name} / Темы / `
      : screen === 'questionEditor'
        ? `${m?.name} / Темы / ${currentTopic(s)?.nameKg ?? ''} / `
        : m && !GLOBAL.includes(screen)
          ? `${m.name} / `
          : GLOBAL.includes(screen) && screen !== 'marathons'
            ? (screen === 'users' || screen === 'journal' ? 'Система / ' : 'Бот / ')
            : '';

  const hasRail = !noPerm && !!buildPreview(s);

  const body = noPerm ? (
    <div className="card" style={{ padding: 40, textAlign: 'center', maxWidth: 540, margin: '40px auto' }}>
      <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>Только для админов</div>
      <div style={{ color: 'var(--muted)', marginBottom: 16, lineHeight: 1.5 }}>
        Раздел «Пользователи» видят только админы. Куратор управляет всем остальным: марафонами, темами, участницами, рассылками и ботом.
      </div>
      <button type="button" className="btn" onClick={() => go('overview')}>
        К обзору марафона
      </button>
    </div>
  ) : screen === 'marathons' ? (
    <Marathons />
  ) : screen === 'overview' ? (
    <Overview />
  ) : screen === 'topics' ? (
    <Topics />
  ) : screen === 'topicEditor' ? (
    <TopicEditor />
  ) : screen === 'questionEditor' ? (
    <QuestionEditor />
  ) : screen === 'participants' ? (
    <Participants isMobile={isMobile} />
  ) : screen === 'broadcasts' ? (
    <Broadcasts />
  ) : screen === 'analytics' ? (
    <Analytics />
  ) : screen === 'settings' ? (
    <MarathonSettings />
  ) : screen === 'namaz' ? (
    <Namaz />
  ) : screen === 'texts' ? (
    <BotTexts />
  ) : screen === 'bot' ? (
    <BotSettings />
  ) : screen === 'users' ? (
    <Users />
  ) : (
    <Journal />
  );

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', background: 'var(--bg)' }}>
      {!isMobile ? <Sidebar /> : null}

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <Header isMobile={isMobile} />

        <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
          <main style={{ flex: 1, minWidth: 0, overflow: 'auto', padding: '20px 22px 40px' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
              {crumbs ? <span style={{ color: 'var(--muted)', fontSize: 13 }}>{crumbs}</span> : null}
              <h1 className="h-page">{SCREEN_TITLES[screen]}</h1>
            </div>
            {body}
            {isDirty(s) ? <SaveBar saving={!!s.edit?.saving} onSave={saveEdit} onUndo={undoEdit} /> : null}
          </main>

          {hasRail && !isMobile ? <PreviewRail /> : null}
        </div>

        {isMobile ? (
          <nav aria-label="Разделы" className="mobile-tabs">
            {MOBILE_TABS.map((t) => (
              <button key={t.id} type="button" aria-current={screen === t.id ? 'page' : undefined} onClick={() => go(t.id)}>
                {t.label}
              </button>
            ))}
          </nav>
        ) : null}
      </div>

      {s.drawerId ? <ParticipantDrawer /> : null}
      {s.pointsModal ? <PointsModal /> : null}
      {s.confirm ? (
        <ConfirmDialog
          title={s.confirm.title}
          body={s.confirm.body}
          ok={s.confirm.ok}
          danger={s.confirm.danger}
          onOk={s.confirm.onOk}
          onCancel={() => set({ confirm: null })}
        />
      ) : null}
      {s.toast ? <Toast text={s.toast} /> : null}
    </div>
  );
}

/** Пока проверяется сессия, рисовать панель не на чем — данных ещё нет. */
function Gate() {
  const s = useAppState();

  if (s.auth === 'checking') {
    return (
      <div style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', background: 'var(--bg)' }}>
        <span className="sub">Загрузка…</span>
      </div>
    );
  }
  if (s.auth === 'anonymous') return <Login />;
  return <Panel />;
}

export default function App() {
  return (
    <StoreProvider>
      <Gate />
    </StoreProvider>
  );
}
