import { describe, expect, it } from 'vitest'
import { isSvgCode, pngScale, prepareSvg } from './svg'

describe('isSvgCode', () => {
  it('spots SVG by language or by its first tag', () => {
    expect(isSvgCode('svg', '')).toBe(true)
    expect(isSvgCode('xml', '<?xml version="1.0"?>\n<svg viewBox="0 0 1 1"/>')).toBe(true)
    expect(isSvgCode(null, '  <!-- logo -->\n<svg>')).toBe(true)
    expect(isSvgCode('html', '<div><svg></svg></div>')).toBe(false)
    expect(isSvgCode('ts', '<svg>')).toBe(false)
  })
})

describe('prepareSvg', () => {
  it('gives the image a pixel size from its attributes or viewBox', () => {
    expect(prepareSvg('<svg viewBox="0 0 200 100"><rect width="10" height="10"/></svg>')).toMatchObject({
      width: 200,
      height: 100,
    })
    expect(prepareSvg('<svg width="64px" viewBox="0 0 32 16"/>')).toMatchObject({ width: 64, height: 32 })
    expect(prepareSvg('<svg width="100%" height="100%"/>')).toMatchObject({ width: 512, height: 512 })
  })

  it('adds the SVG namespace and explicit size to the markup', () => {
    const prepared = prepareSvg('<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/></svg>')!
    const root = new DOMParser().parseFromString(prepared.svg, 'image/svg+xml').documentElement
    expect(root.getAttribute('xmlns')).toBe('http://www.w3.org/2000/svg')
    expect([root.getAttribute('width'), root.getAttribute('height')]).toEqual(['24', '24'])
  })

  it('rejects incomplete or non-SVG markup, such as a reply still streaming', () => {
    expect(prepareSvg('<svg viewBox="0 0 10 10"><rect')).toBeNull()
    expect(prepareSvg('<html></html>')).toBeNull()
  })
})

it('exports small drawings at high resolution without huge canvases', () => {
  expect(pngScale(24, 24)).toBeCloseTo(2048 / 24)
  expect(pngScale(4000, 1000)).toBe(1)
  expect(pngScale(20_000, 100)).toBeCloseTo(8192 / 20_000)
})
