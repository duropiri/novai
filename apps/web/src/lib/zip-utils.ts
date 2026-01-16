import JSZip from 'jszip';

/**
 * Extract image files from a ZIP archive
 * @param zipFile - The ZIP file to extract
 * @returns Array of extracted image Files
 */
export async function extractImagesFromZip(zipFile: File): Promise<File[]> {
  const zip = await JSZip.loadAsync(zipFile);
  const imageFiles: File[] = [];

  const imageExtensions = ['.png', '.jpg', '.jpeg', '.webp', '.gif'];

  for (const [filename, zipEntry] of Object.entries(zip.files)) {
    // Skip directories and hidden files
    if (zipEntry.dir || filename.startsWith('__MACOSX') || filename.startsWith('.')) {
      continue;
    }

    const lowerFilename = filename.toLowerCase();
    const isImage = imageExtensions.some((ext) => lowerFilename.endsWith(ext));

    if (isImage) {
      try {
        const blob = await zipEntry.async('blob');
        // Determine MIME type from extension
        let mimeType = 'image/jpeg';
        if (lowerFilename.endsWith('.png')) mimeType = 'image/png';
        else if (lowerFilename.endsWith('.webp')) mimeType = 'image/webp';
        else if (lowerFilename.endsWith('.gif')) mimeType = 'image/gif';

        // Get just the filename without path
        const baseName = filename.split('/').pop() || filename;
        const file = new File([blob], baseName, { type: mimeType });
        imageFiles.push(file);
      } catch (error) {
        console.error(`Failed to extract ${filename}:`, error);
      }
    }
  }

  // Sort by filename for consistent ordering
  imageFiles.sort((a, b) => a.name.localeCompare(b.name));

  return imageFiles;
}

/**
 * Check if a file is a ZIP archive
 */
export function isZipFile(file: File): boolean {
  return (
    file.type === 'application/zip' ||
    file.type === 'application/x-zip-compressed' ||
    file.name.toLowerCase().endsWith('.zip')
  );
}

/**
 * Process files that may include ZIPs, extracting images from any ZIP files
 * @param files - Array of files (may include ZIPs)
 * @returns Array of image Files (ZIPs are extracted)
 */
export async function processFilesWithZipSupport(files: File[]): Promise<File[]> {
  const result: File[] = [];

  for (const file of files) {
    if (isZipFile(file)) {
      const extractedImages = await extractImagesFromZip(file);
      result.push(...extractedImages);
    } else if (file.type.startsWith('image/')) {
      result.push(file);
    }
  }

  return result;
}
