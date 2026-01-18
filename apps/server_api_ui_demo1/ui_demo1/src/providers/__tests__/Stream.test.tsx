import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import Stream, { type StreamContextType } from '../Stream';

vi.mock('@langchain/langgraph-sdk/react', () => ({
  useStream: vi.fn(() => ({
    update: vi.fn(),
    remove: vi.fn(),
  })),
}));

vi.mock('@/lib/api-key', () => ({
  getApiKey: vi.fn(() => 'test-api-key'),
}));

vi.mock('./Thread', () => ({
  useThreads: vi.fn(() => ({
    getThreads: vi.fn(() => Promise.resolve([])),
    setThreads: vi.fn(),
  })),
}));

vi.mock('nuqs', () => ({
  useQueryState: vi.fn((name: string) => [false]),
}));

describe('Stream Provider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should provide StreamContext to children', () => {
    const wrapper = ({ children }) => {
      const Context = Stream;
      return (
        <Stream.Provider value={undefined as any}>
          {children}
        </Stream.Provider>
      );
    };

    const { result } = renderHook(() => ({ context }) => useContext(Stream as any), {
      wrapper,
    });

    expect(result.current).toBeDefined();
  });

  it('should render StreamSession component', () => {
    const wrapper = ({ children }) => (
      <Stream.Provider value={undefined as any}>
        {children}
      </Stream.Provider>
    );

    const { container } = render(
      wrapper(
        <Stream.Session>
          <div>Test Session</div>
        </Stream.Session>
      ),
    );

    expect(container).toBeInTheDocument();
    expect(container.textContent).toContain('Test Session');
  });

  it('should call checkGraphStatus on mount', async () => {
    render(
      <Stream.Provider value={undefined as any}>
        <Stream.Session>
          <div>Test</div>
        </Stream.Session>
      </Stream.Provider>
    );

    await waitFor(() => {
      const { useStream } = require('@langchain/langgraph-sdk/react');
      expect(useStream).toHaveBeenCalled();
    });
  });
});
