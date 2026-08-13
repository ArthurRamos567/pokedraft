import { describe, expect, it } from 'bun:test'
import {
  effectiveness,
  offensiveCoverage,
  singleEffectiveness,
  teamDefense,
  typeNames,
} from './coverage'

describe('type chart', () => {
  it('lists real types only', () => {
    const names = typeNames(9)
    expect(names).toContain('Fairy')
    expect(names).not.toContain('Stellar')
    expect(names).not.toContain('???')
  })

  it('drops Fairy before gen 6', () => {
    expect(typeNames(5)).not.toContain('Fairy')
    expect(typeNames(6)).toContain('Fairy')
  })

  it('applies the pre-gen-6 Steel resistances', () => {
    // Steel resisted Ghost and Dark until gen 6 removed both.
    expect(singleEffectiveness('Ghost', 'Steel', 5)).toBe(0.5)
    expect(singleEffectiveness('Dark', 'Steel', 5)).toBe(0.5)
    expect(singleEffectiveness('Ghost', 'Steel', 6)).toBe(1)
    expect(singleEffectiveness('Dark', 'Steel', 6)).toBe(1)
  })

  it('stacks a dual typing', () => {
    // Landorus-Therian: Ground / Flying.
    expect(effectiveness('Ice', ['Ground', 'Flying'])).toBe(4)
    expect(effectiveness('Electric', ['Ground', 'Flying'])).toBe(0)
    expect(effectiveness('Water', ['Ground', 'Flying'])).toBe(2)
  })

  it('counts a roster into weak / resist / immune buckets', () => {
    const roster = [
      ['Ground', 'Flying'], // Landorus-Therian
      ['Water', 'Poison'], // Toxapex
      ['Steel', 'Flying'], // Corviknight
    ]
    const d = teamDefense(roster)
    expect(d.Electric).toEqual({ weak: 2, neutral: 0, resist: 0, immune: 1 })
    expect(d.Ice?.weak).toBe(1)
  })

  it('finds the coverage gaps in a set of attacking types', () => {
    const c = offensiveCoverage(['Ground', 'Fire'])
    expect(c.Steel?.best).toBe(2)
    expect(c.Flying?.best).toBe(1)
    // Ground is neutral into Water and Fire is resisted — no super-effective
    // answer to a bulky Water from these two types alone.
    expect(c.Water?.best).toBe(1)
    expect(c.Water?.from).toEqual(['Ground'])
    expect(c.Steel?.from).toContain('Ground')
  })
})
