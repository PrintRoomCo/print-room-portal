import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PickingFeeInfo } from './PickingFeeInfo'

const format = (n: number) => `$${n.toFixed(2)}`

describe('PickingFeeInfo', () => {
  it('is closed until the info affordance is hovered', async () => {
    render(<PickingFeeInfo goodsBasis={150} format={format} />)
    expect(screen.queryByRole('dialog')).toBeNull()
    await userEvent.hover(
      screen.getByRole('button', { name: 'How the picking fee is calculated' }),
    )
    expect(screen.getByRole('dialog', { name: 'Picking fee bands' })).toBeInTheDocument()
  })

  it('closes when the pointer leaves', async () => {
    render(<PickingFeeInfo goodsBasis={150} format={format} />)
    const button = screen.getByRole('button', { name: 'How the picking fee is calculated' })
    await userEvent.hover(button)
    expect(screen.getByRole('dialog', { name: 'Picking fee bands' })).toBeInTheDocument()
    await userEvent.unhover(button)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('opens on keyboard focus', async () => {
    render(<PickingFeeInfo goodsBasis={150} format={format} />)
    await userEvent.tab()
    expect(screen.getByRole('button', { name: 'How the picking fee is calculated' })).toHaveFocus()
    expect(screen.getByRole('dialog', { name: 'Picking fee bands' })).toBeInTheDocument()
  })

  it('lists every band and highlights only the active one', async () => {
    render(<PickingFeeInfo goodsBasis={150} format={format} />)
    await userEvent.hover(
      screen.getByRole('button', { name: 'How the picking fee is calculated' }),
    )
    const rows = screen.getAllByRole('listitem')
    expect(rows).toHaveLength(5)
    expect(rows[1]).toHaveAttribute('data-active')
    expect(rows[1]).toHaveTextContent('$100 – $199')
    expect(rows[1]).toHaveTextContent('$30.00')
    expect(rows[0]).not.toHaveAttribute('data-active')
    expect(rows[4]).not.toHaveAttribute('data-active')
  })

  it('closes on Escape', async () => {
    render(<PickingFeeInfo goodsBasis={0} format={format} />)
    await userEvent.hover(
      screen.getByRole('button', { name: 'How the picking fee is calculated' }),
    )
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('shows the NZ / stock-on-hand caveat', async () => {
    render(<PickingFeeInfo goodsBasis={0} format={format} />)
    await userEvent.hover(
      screen.getByRole('button', { name: 'How the picking fee is calculated' }),
    )
    expect(
      screen.getByText(
        'Applies to stock-on-hand orders delivered within NZ, based on the order’s goods value.',
      ),
    ).toBeInTheDocument()
  })
})
