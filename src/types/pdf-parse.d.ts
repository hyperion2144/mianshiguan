/**
 * Minimal ambient declaration for `pdf-parse`. The npm package
 * ships without types; we only need the Promise-returning default
 * export and the shape of the resolved value.
 */
declare module 'pdf-parse' {
  interface PdfParseResult {
    numpages: number
    numrender: number
    info: unknown
    metadata: unknown
    text: string
    version: string
  }

  interface PdfParseOptions {
    max?: number
    version?: string
    pagerender?: (pageData: unknown) => Promise<string>
  }

  function pdfParse(
    dataBuffer: Buffer | Uint8Array,
    options?: PdfParseOptions,
  ): Promise<PdfParseResult>

  export default pdfParse
}
