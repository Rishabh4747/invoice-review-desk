import type { PDFiumLibrary } from '@hyzyla/pdfium'
import { encode } from 'fast-png'
import { ExtractionFailure } from './extract.ts'

const maxPages = 8
const maxRenderedBytes = 5 * 1024 * 1024

export async function renderPdfPages(pdfium: PDFiumLibrary, pdf: Uint8Array) {
  const document = await pdfium.loadDocument(pdf)
  let byteCount = 0
  const images: Uint8Array[] = []
  try {
    const pageCount = document.getPageCount()
    if (pageCount < 1 || pageCount > maxPages) {
      throw new ExtractionFailure('The backup extractor supports PDFs with one to eight pages. Split this PDF or try again when Gemini is available.')
    }
    for (const page of document.pages()) {
      try {
        const { originalWidth, originalHeight } = page.getOriginalSize()
        if (originalWidth <= 0 || originalHeight <= 0) throw new Error('Invalid PDF page dimensions')
        const image = await page.render({
          scale: 1650 / Math.max(originalWidth, originalHeight),
          colorSpace: 'Gray',
          render: async ({ data, width, height }) => encode({ data, width, height, channels: 1 }),
        })
        byteCount += image.data.byteLength
        if (byteCount > maxRenderedBytes) throw new ExtractionFailure('The PDF is too detailed for the backup extractor. Try a smaller scan or retry later.')
        images.push(image.data)
      } finally {
        page.close()
      }
    }
    return images
  } finally {
    document.destroy()
  }
}
