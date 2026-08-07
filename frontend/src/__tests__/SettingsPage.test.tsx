import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { downloadJson } from '@zudar107/schloss-ui'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SettingsPage } from '../features/settings/SettingsPage'
import { api } from '../lib/api'

vi.mock('../lib/api', () => ({
  api: { get: vi.fn() },
}))

vi.mock('@zudar107/schloss-ui', async (importOriginal) => ({
  ...await importOriginal<typeof import('@zudar107/schloss-ui')>(),
  downloadJson: vi.fn(),
}))

const snapshot = {
  version: '1',
  service: 'glocke',
  exportedAt: '2026-08-07T12:00:00.000Z',
  data: {
    notifications: [{
      id: 'notification-1',
      eventId: 'event-1',
      source: 'tafel',
      type: 'task.due',
      title: 'Task due',
      body: 'Prepare release notes',
      actionUrl: '/tasks/task-1',
      createdAt: '2026-08-07T10:00:00.000Z',
      readAt: null,
    }],
  },
}

describe('SettingsPage data export', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset()
    vi.mocked(downloadJson).mockReset()
  })

  it('downloads the direct authenticated snapshot through the shared JSON helper', async () => {
    const user = userEvent.setup()
    vi.mocked(api.get).mockResolvedValue(snapshot)

    render(<SettingsPage />)
    await user.click(screen.getByRole('button', { name: /скачать.*данн|экспортировать.*данн/i }))

    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/exports/me'))
    expect(api.get).toHaveBeenCalledOnce()
    expect(downloadJson).toHaveBeenCalledWith(snapshot, expect.stringMatching(
      /^glocke-export-\d{4}-\d{2}-\d{2}\.json$/,
    ))
  })

  it('disables the export action while the snapshot is being prepared', async () => {
    const user = userEvent.setup()
    vi.mocked(api.get).mockReturnValue(new Promise(() => {}))

    render(<SettingsPage />)
    const button = screen.getByRole('button', { name: /скачать.*данн|экспортировать.*данн/i })
    await user.click(button)

    expect(button).toBeDisabled()
    expect(button).toHaveAccessibleName(/подготов/i)
    expect(downloadJson).not.toHaveBeenCalled()
  })

  it('announces a download failure and does not create a file', async () => {
    const user = userEvent.setup()
    vi.mocked(api.get).mockRejectedValue(new Error('network unavailable'))

    render(<SettingsPage />)
    await user.click(screen.getByRole('button', { name: /скачать.*данн|экспортировать.*данн/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/не удалось.*(экспорт|скач)/i)
    expect(downloadJson).not.toHaveBeenCalled()
  })
})
