import { fileToContentBlock, isOptimizedContentBlock } from '../multimodal-utils';
// NOTE

// Mock File API
class MockFile extends File {
  constructor(bits: BlobPart[], name: string, options?: FilePropertyBag) {
    super(bits, name, options);
  }
}
// NOTE

// Mock FileReader
global.FileReader = class {
  result: string | ArrayBuffer | null = null;
  onloadend: ((this: FileReader, ev: ProgressEvent<FileReader>) => any) | null = null;
  onerror: ((this: FileReader, ev: ProgressEvent<FileReader>) => any) | null = null;

  readAsDataURL(file: Blob): void {
    // Simulate base64 data
    this.result = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
    setTimeout(() => {
      if (this.onloadend) {
        this.onloadend({} as ProgressEvent<FileReader>);
      }
    }, 0);
  }
} as any;

describe('multimodal-utils', () => {
  describe('fileToContentBlock', () => {
    it('should convert image file to image_url format', async () => {
      const mockImageFile = new MockFile([''], 'test.png', { type: 'image/png' });

      const result = await fileToContentBlock(mockImageFile);

      expect(result.type).toBe('image_url');
      expect(result.image_url.url).toMatch(/^data:image\/png;base64,/);
      expect(result.image_url.metadata?.name).toBe('test.png');
    });

    it('should convert PDF file to file format', async () => {
      const mockPdfFile = new MockFile([''], 'test.pdf', { type: 'application/pdf' });
      
      const result = await fileToContentBlock(mockPdfFile);
      
      expect(result.type).toBe('file');
      expect(result.source_type).toBe('base64');
      expect(result.mime_type).toBe('application/pdf');
      expect(result.metadata.filename).toBe('test.pdf');
    });

    it('should reject unsupported file types', async () => {
      const mockTextFile = new MockFile([''], 'test.txt', { type: 'text/plain' });
      
      await expect(fileToContentBlock(mockTextFile)).rejects.toThrow('Unsupported file type: text/plain');
    });
  });

  describe('isOptimizedContentBlock', () => {
    it('should identify image_url blocks', () => {
      const imageUrlBlock = {
        type: 'image_url',
        image_url: {
          url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
          metadata: {
            name: 'test.png'
          }
        }
      };

      expect(isOptimizedContentBlock(imageUrlBlock)).toBe(true);
    });

    it('should identify file blocks', () => {
      const fileBlock = {
        type: 'file',
        source_type: 'base64',
        mime_type: 'application/pdf',
        data: 'base64data',
        metadata: { filename: 'test.pdf' }
      };
      
      expect(isOptimizedContentBlock(fileBlock)).toBe(true);
    });

    it('should reject invalid blocks', () => {
      expect(isOptimizedContentBlock({})).toBe(false);
      expect(isOptimizedContentBlock(null)).toBe(false);
      expect(isOptimizedContentBlock({ type: 'invalid' })).toBe(false);
    });
  });
});
