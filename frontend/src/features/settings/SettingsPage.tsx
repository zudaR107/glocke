import { useState } from 'react'
import { Bell, ExternalLink, SlidersHorizontal } from 'lucide-react'
import { Button, DirectExportAction, downloadJson } from '@zudar107/schloss-ui'
import { buildSchluesselAccountUrl } from '../../lib/authRedirect'
import { api } from '../../lib/api'
import { BrowserPushSettings } from './BrowserPushSettings'

export function SettingsPage() {
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)

  async function downloadExport() {
    setExporting(true)
    setExportError(null)
    try {
      const snapshot = await api.get('/exports/me')
      downloadJson(snapshot, `glocke-export-${new Date().toISOString().slice(0, 10)}.json`)
    } catch {
      setExportError('Не удалось скачать экспорт данных. Попробуйте ещё раз.')
    } finally {
      setExporting(false)
    }
  }

  return (
    <section className="content-page narrow">
      <div className="eyebrow">Предпочтения</div><h1>Настройки</h1>
      <div className="info-card">
        <SlidersHorizontal size={24}/>
        <div>
          <h2>Способы уведомлений</h2>
          <p>Получение уведомлений в приложении управляется в общем профиле Schlüssel. Glocke проверяет актуальное значение перед обработкой каждого события.</p>
          <Button variant="primary" onClick={() => { location.href = buildSchluesselAccountUrl('/settings') }}>
            Открыть настройки аккаунта <ExternalLink size={16}/>
          </Button>
        </div>
      </div>
      <div className="info-card">
        <Bell size={24}/>
        <div>
          <h2>Уведомления в браузере на этом устройстве</h2>
          <BrowserPushSettings />
        </div>
      </div>
      <div className="settings-export">
        <DirectExportAction
          title="Экспорт данных"
          description="Скачайте JSON со всеми вашими уведомлениями Glocke и их состоянием прочтения."
          actionLabel="Скачать данные"
          loadingLabel="Подготовка данных…"
          onExport={downloadExport}
          loading={exporting}
          error={exportError}
        />
      </div>
      <div className="roadmap-note"><strong>Не входит в текущую версию:</strong> Telegram-бот с привязкой аккаунта запланирован как отдельный будущий этап и сейчас не работает.</div>
    </section>
  )
}
