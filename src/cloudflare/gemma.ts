import { Buffer } from 'node:buffer'
import { PDFiumLibrary } from '@hyzyla/pdfium'
import pdfiumModule from '@hyzyla/pdfium/pdfium.wasm'
import { extractionInstructions, ExtractionFailure, invoiceSchema, parseInvoice } from '../server/extract.ts'
import { renderPdfPages } from '../server/render-pdf.ts'

const model = '@cf/google/gemma-4-26b-a4b-it'
let engine: Promise<PDFiumLibrary> | undefined

function pdfium() {
  engine ??= PDFiumLibrary.init({
    instantiateWasm(imports, ready) {
      ready(new WebAssembly.Instance(pdfiumModule, imports), pdfiumModule)
    },
  }).catch((error: unknown) => {
    engine = undefined
    throw error
  })
  return engine
}

export async function extractWithGemma(pdf: Uint8Array, ai: Ai) {
  let images: Uint8Array[]
  try {
    images = await renderPdfPages(await pdfium(), pdf)
  } catch (error) {
    if (error instanceof ExtractionFailure) throw error
    throw new ExtractionFailure('The backup extractor could not render this PDF. Try re-exporting it and uploading again.')
  }
  let result: Awaited<ReturnType<Ai['run']>>
  try {
    result = await ai.run(model, {
      messages: [
        { role: 'system', content: extractionInstructions },
        { role: 'user', content: [
          { type: 'text', text: 'Read these PDF pages in order. Return the printed invoice fields.' },
          ...images.map(image => ({
            type: 'image_url' as const,
            image_url: { url: `data:image/png;base64,${Buffer.from(image).toString('base64')}` },
          })),
        ] },
      ],
      response_format: { type: 'json_schema', json_schema: { name: 'invoice', schema: invoiceSchema } },
      chat_template_kwargs: { enable_thinking: false },
      temperature: 0,
      max_completion_tokens: 10000,
      store: false,
    })
  } catch {
    throw new ExtractionFailure('Both extraction services are temporarily unavailable. The PDF was saved and can be uploaded again.')
  }
  try {
    const output = result as { choices?: { finish_reason?: string; message?: { content?: string } }[]; response?: string }
    const choice = output.choices?.[0]
    const content = choice?.message?.content ?? output.response
    if (!content || (choice?.finish_reason && choice.finish_reason !== 'stop')) throw new Error('Incomplete response')
    return { invoice: parseInvoice(JSON.parse(content)), model }
  } catch {
    throw new ExtractionFailure('Gemma did not return a complete extraction. Try uploading the PDF again or use a clearer copy.')
  }
}
