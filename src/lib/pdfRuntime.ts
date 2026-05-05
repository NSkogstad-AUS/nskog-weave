type PdfJsModule = typeof import('pdfjs-dist');
export type PdfDocument = Awaited<ReturnType<PdfJsModule['getDocument']>['promise']>;

let pdfJsPromise: Promise<PdfJsModule> | null = null;

export async function loadPdfJs(): Promise<PdfJsModule> {
  if (!pdfJsPromise) {
    pdfJsPromise = Promise.all([
      import('pdfjs-dist'),
      import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
    ])
      .then(([pdfjs, workerModule]) => {
        pdfjs.GlobalWorkerOptions.workerSrc = workerModule.default;
        return pdfjs;
      })
      .catch((error) => {
        pdfJsPromise = null;
        throw error;
      });
  }

  return pdfJsPromise;
}
