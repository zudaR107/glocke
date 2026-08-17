import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { HelpPage } from '../features/help/HelpPage'

describe('HelpPage notification roadmap', () => {
  it('keeps Browser Push and Telegram explicitly deferred', () => {
    render(<HelpPage />)

    expect(screen.getByText(/Browser Push.*Telegram/i)).toHaveTextContent(/сейчас не работают/i)
  })
})
