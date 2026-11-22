import type {CourseFileFormat} from '../types/course';

export const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
export const ODT_MIME = 'application/vnd.oasis.opendocument.text';
export const PDF_MIME = 'application/pdf';

export const SUPPORTED_FILE_ACCEPT = `.pdf,.docx,.odt,${PDF_MIME},${DOCX_MIME},${ODT_MIME}`;

export function getCourseFileFormat(
  fileName: string,
  mimeType?: string
): CourseFileFormat | null {
  const lower = fileName.toLowerCase().trim();
  if (lower.endsWith('.pdf')) return 'pdf';
  if (lower.endsWith('.docx')) return 'docx';
  if (lower.endsWith('.odt')) return 'odt';

  if (mimeType === PDF_MIME) return 'pdf';
  if (mimeType === DOCX_MIME) return 'docx';
  if (mimeType === ODT_MIME) return 'odt';

  return null;
}

export function isSupportedCourseFile(file: {name: string; type?: string}): boolean {
  return getCourseFileFormat(file.name, file.type) !== null;
}

export function stripSupportedExtension(fileName: string): string {
  return fileName.replace(/\.(pdf|docx|odt)$/i, '').trim();
}
