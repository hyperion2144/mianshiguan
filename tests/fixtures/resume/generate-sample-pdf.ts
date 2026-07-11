/**
 * Generate a minimal valid one-page PDF containing the marker text
 * `fixture-marker-resume-pdf`. Used as the `sample.pdf` fixture for
 * `ResumeService.importFromFile` PDF tests. Hand-rolled to avoid
 * pulling a heavyweight PDF generation dep into the test surface.
 *
 * Run: `bun run tests/fixtures/resume/generate-sample-pdf.ts`
 */
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const MARKER = 'fixture-marker-resume-pdf'

const objects: string[] = []
const offsets: number[] = []
let cursor = 0

const header = '%PDF-1.4\n%\u00e2\u00e3\u00cf\u00d3\n'
cursor = Buffer.byteLength(header, 'binary')

// Object 1: Catalog
const o1 = '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n'
offsets.push(cursor)
cursor += Buffer.byteLength(o1, 'binary')
objects.push(o1)

const stream = `BT /F1 14 Tf 72 720 Td (${MARKER}) Tj ET\nBT /F1 12 Tf 72 700 Td (Resume Sample Profile for Test) Tj ET\nBT /F1 12 Tf 72 680 Td (Eight years building React + TypeScript UIs.) Tj ET\nBT /F1 12 Tf 72 660 Td (Owned design system at two consumer products.) Tj ET`
const o2 = '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n'
offsets.push(cursor)
cursor += Buffer.byteLength(o2, 'binary')
objects.push(o2)

// Object 3: Page
const o3 =
  '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n'
offsets.push(cursor)
cursor += Buffer.byteLength(o3, 'binary')
objects.push(o3)

// Object 4: Content stream carrying the marker
const o4 = `4 0 obj\n<< /Length ${stream.length} >>\nstream\n${stream}\nendstream\nendobj\n`
offsets.push(cursor)
cursor += Buffer.byteLength(o4, 'binary')
objects.push(o4)

// Object 5: Font
const o5 =
  '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\n'
offsets.push(cursor)
cursor += Buffer.byteLength(o5, 'binary')
objects.push(o5)

// xref
const xrefOffset = cursor
const xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets
  .map((o) => `${String(o).padStart(10, '0')} 00000 n \n`)
  .join('')}`

cursor += Buffer.byteLength(xref, 'binary')
const trailer = `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`

const out = header + objects.join('') + xref + trailer
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
writeFileSync(join(__dirname, 'sample.pdf'), out, 'binary')
console.log('Wrote sample.pdf with marker:', MARKER)
