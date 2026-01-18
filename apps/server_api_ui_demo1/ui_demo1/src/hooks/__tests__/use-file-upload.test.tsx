import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useFileUpload, SUPPORTED_FILE_TYPES } from '../use-file-upload';

vi.mock('@/lib/multimodal-utils', () => ({
  fileToContentBlock: vi.fn((file) => Promise.resolve({
    type: file.type.startsWith('image/') ? 'image_url' : 'file',
    [file.type.startsWith('image/') ? 'image_url' : 'source_type']: 'base64',
    mime_type: file.type,
    [file.type.startsWith('image/') ? 'url' : 'data']: `data:${file.type};base64,abc123`,
    metadata: { filename: file.name },
  })),
}));

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
  },
}));

describe('useFileUpload Hook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should initialize with empty content blocks', () => {
    const { result } = renderHook(() => useFileUpload());
    expect(result.current.contentBlocks).toEqual([]);
  });

  it('should initialize with provided initial blocks', () => {
    const initialBlocks = [
      {
        type: 'image_url' as const,
        image_url: {
          url: 'data:image/png;base64,abc',
          metadata: { name: 'test.png' },
        },
      },
    ];
    const { result } = renderHook(() => useFileUpload({ initialBlocks }));
    expect(result.current.contentBlocks).toEqual(initialBlocks);
  });

  it('should handle supported image file upload', async () => {
    const { result } = renderHook(() => useFileUpload());
    const file = new File([''], 'test.png', { type: 'image/png' });
    const mockEvent = { target: { files: [file] } } as React.ChangeEvent<HTMLInputElement>;

    await act(async () => {
      result.current.handleFileUpload(mockEvent);
    });

    expect(result.current.contentBlocks).toHaveLength(1);
  });

  it('should handle PDF file upload', async () => {
    const { result } = renderHook(() => useFileUpload());
    const file = new File([''], 'test.pdf', { type: 'application/pdf' });
    const mockEvent = { target: { files: [file] } } as React.ChangeEvent<HTMLInputElement>;

    await act(async () => {
      result.current.handleFileUpload(mockEvent);
    });

    expect(result.current.contentBlocks).toHaveLength(1);
  });

  it('should reject unsupported file type', async () => {
    const { result } = renderHook(() => useFileUpload());
    const file = new File([''], 'test.txt', { type: 'text/plain' });
    const mockEvent = { target: { files: [file] } } as React.ChangeEvent<HTMLInputElement>;

    await act(async () => {
      result.current.handleFileUpload(mockEvent);
    });

    const { toast } = require('sonner');
    expect(toast.error).toHaveBeenCalledWith(
      expect.stringContaining('Unsupported file type')
    );
    expect(result.current.contentBlocks).toHaveLength(0);
  });

  it('should handle duplicate file', async () => {
    const initialBlocks = [
      {
        type: 'image_url' as const,
        image_url: {
          url: 'data:image/png;base64,abc',
          metadata: { name: 'test.png' },
        },
      },
    ];
    const { result } = renderHook(() => useFileUpload({ initialBlocks }));
    const file = new File([''], 'test.png', { type: 'image/png' });
    const mockEvent = { target: { files: [file] } } as React.ChangeEvent<HTMLInputElement>;

    await act(async () => {
      result.current.handleFileUpload(mockEvent);
    });

    const { toast } = require('sonner');
    expect(toast.error).toHaveBeenCalledWith(
      expect.stringContaining('Duplicate file')
    );
    expect(result.current.contentBlocks).toHaveLength(1);
  });

  it('should support all expected file types', () => {
    expect(SUPPORTED_FILE_TYPES).toContain('image/jpeg');
    expect(SUPPORTED_FILE_TYPES).toContain('image/png');
    expect(SUPPORTED_FILE_TYPES).toContain('image/gif');
    expect(SUPPORTED_FILE_TYPES).toContain('image/webp');
    expect(SUPPORTED_FILE_TYPES).toContain('application/pdf');
  });

  it('should provide removeBlock function', () => {
    const initialBlocks = [
      {
        type: 'image_url' as const,
        image_url: {
          url: 'data:image/png;base64,abc',
          metadata: { name: 'test1.png' },
        },
      },
      {
        type: 'image_url' as const,
        image_url: {
          url: 'data:image/png;base64,def',
          metadata: { name: 'test2.png' },
        },
      },
    ];
    const { result } = renderHook(() => useFileUpload({ initialBlocks }));

    act(() => {
      result.current.removeBlock(0);
    });

    expect(result.current.contentBlocks).toHaveLength(1);
    expect(result.current.contentBlocks[0].image_url.metadata.name).toBe('test2.png');
  });

  it('should provide resetBlocks function', () => {
    const initialBlocks = [
      {
        type: 'image_url' as const,
        image_url: {
          url: 'data:image/png;base64,abc',
          metadata: { name: 'test.png' },
        },
      },
    ];
    const { result } = renderHook(() => useFileUpload({ initialBlocks }));

    act(() => {
      result.current.resetBlocks();
    });

    expect(result.current.contentBlocks).toHaveLength(0);
  });

  it('should provide dragOver state', () => {
    const { result } = renderHook(() => useFileUpload());

    expect(result.current.dragOver).toBe(false);
  });

  it('should provide dropRef', () => {
    const { result } = renderHook(() => useFileUpload());

    expect(result.current.dropRef).toBeDefined();
    expect(result.current.dropRef.current).toBeNull();
  });
});
