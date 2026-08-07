import { ExternalLink, SlidersHorizontal } from 'lucide-react'
import { Button } from '@zudar107/schloss-ui'
import { buildSchluesselAccountUrl } from '../../lib/authRedirect'

export function SettingsPage() {
  return (
    <section className="content-page narrow">
      <div className="eyebrow">Предпочтения</div><h1>Настройки</h1>
      <div className="info-card">
        <SlidersHorizontal size={24}/>
        <div><h2>Способы уведомлений</h2><p>Получение уведомлений в приложении управляется в общем профиле Schlüssel. Glocke проверяет актуальное значение перед обработкой каждого события.</p></div>
      </div>
      <Button variant="primary" onClick={() => { location.href = buildSchluesselAccountUrl('/settings') }}>
        Открыть настройки аккаунта <ExternalLink size={16}/>
      </Button>
      <div className="roadmap-note"><strong>Не входит в текущую версию:</strong> Browser Push с сервис-воркером и VAPID, а также Telegram-бот с привязкой аккаунта запланированы как последовательные будущие этапы и сейчас не работают.</div>
    </section>
  )
}
