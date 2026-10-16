import { describe, expect, it } from 'vitest'
import { makeDocx, makeXlsx } from '@/test/office-files'
import { extractDocxText, fileKind, fitWithin, formatBytes, prepareFile, truncateText } from './files'

describe('fileKind', () => {
  it('recognises images, documents and text by type or extension', () => {
    expect(fileKind({ name: 'a.png', type: 'image/png' })).toBe('image')
    expect(fileKind({ name: 'photo.JPG', type: '' })).toBe('image')
    expect(fileKind({ name: 'r.pdf', type: '' })).toBe('pdf')
    expect(fileKind({ name: 'r.docx', type: '' })).toBe('docx')
    expect(fileKind({ name: 'r.xlsx', type: '' })).toBe('xlsx')
    expect(fileKind({ name: 'main.py', type: '' })).toBe('text')
    expect(fileKind({ name: 'Dockerfile', type: '' })).toBe('text')
    expect(fileKind({ name: 'notes', type: 'text/plain' })).toBe('text')
  })

  it('rejects unsupported files', () => {
    expect(fileKind({ name: 'movie.mp4', type: 'video/mp4' })).toBeNull()
    expect(fileKind({ name: 'old.doc', type: 'application/msword' })).toBeNull()
    expect(fileKind({ name: 'photo.heic', type: 'image/heic' })).toBeNull()
  })
})

describe('helpers', () => {
  it('scales images down to fit, never up', () => {
    expect(fitWithin(4000, 3000, 1600)).toEqual({ width: 1600, height: 1200 })
    expect(fitWithin(1000, 3000, 1600)).toEqual({ width: 533, height: 1600 })
    expect(fitWithin(800, 600, 1600)).toEqual({ width: 800, height: 600 })
  })

  it('truncates very long text with a note', () => {
    expect(truncateText('abc', 5)).toBe('abc')
    expect(truncateText('abcdefgh', 5)).toMatch(/^abcde\n\n\[Truncated/)
  })

  it('formats sizes', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(2048)).toBe('2 KB')
    expect(formatBytes(3.5 * 1024 * 1024)).toBe('3.5 MB')
  })
})

describe('prepareFile', () => {
  it('reads text files as UTF-8', async () => {
    const file = new File(['Xin chào\nline 2'], 'notes.md', { type: 'text/markdown' })
    const { attachment, data } = await prepareFile(file)
    expect(attachment).toMatchObject({ kind: 'file', name: 'notes.md', text: 'Xin chào\nline 2' })
    expect(data).toBeNull()
  })

  it('extracts .docx paragraphs', async () => {
    const docx = makeDocx([['Hello ', 'world'], ['Second paragraph']])
    expect(await extractDocxText(docx)).toBe('Hello world\nSecond paragraph')
    const { attachment } = await prepareFile(new File([docx], 'report.docx'))
    expect(attachment.text).toBe('Hello world\nSecond paragraph')
    expect(attachment.mimeType).toContain('wordprocessingml')
  })

  it('extracts .xlsx sheets as CSV', async () => {
    const xlsx = makeXlsx('Budget', [
      ['Item', 'Cost'],
      ['Coffee, beans', 12],
    ])
    const { attachment } = await prepareFile(new File([xlsx], 'budget.xlsx'))
    expect(attachment.text).toBe('## Sheet: Budget\nItem,Cost\n"Coffee, beans",12')
  })

  it('rejects unsupported, broken and oversized files with a clear message', async () => {
    await expect(prepareFile(new File(['x'], 'clip.mp4', { type: 'video/mp4' }))).rejects.toThrow(/isn't supported/)
    await expect(prepareFile(new File(['not a zip'], 'bad.docx'))).rejects.toThrow(/couldn't be read/)
    const big = new File([new Uint8Array(21 * 1024 * 1024)], 'big.txt')
    await expect(prepareFile(big)).rejects.toThrow(/larger than/)
  })
})
