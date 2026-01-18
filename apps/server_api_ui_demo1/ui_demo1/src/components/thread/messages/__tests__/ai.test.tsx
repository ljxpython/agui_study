import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import AIMessage from '../ai';
import { parsePartialJson } from '@langchain/core/output_parsers';
import { Message } from '@langchain/langgraph-sdk';

const mockThread = {
  messages: [],
  getMessagesMetadata: vi.fn(() => undefined),
  interrupt: undefined,
  setBranch: vi.fn(),
} as any;

vi.mock('@/providers/Stream', () => ({
  useStreamContext: vi.fn(() => ({ values: { ui: [] }, thread: mockThread })),
}));

vi.mock('nuqs', () => ({
  useQueryState: vi.fn((name: string) => [false]),
}));

describe('AIMessage', () => {
  it('should render loading state', () => {
    const { container } = render(<AIMessage message={undefined} isLoading={true} />);
    expect(container).toBeInTheDocument();
    expect(container.querySelector('.animate-pulse')).toBeInTheDocument();
  });

  it('should render AI content message', () => {
    const message = {
      id: 'test-1',
      type: 'ai',
      content: [{ type: 'text', text: 'Hello, world!' }],
    } as Message;
    const { container } = render(<AIMessage message={message} isLoading={false} />);
    expect(container.textContent).toContain('Hello, world!');
  });

  it('should hide tool results when tool calls have contents', () => {
    const message = {
      id: 'test-2',
      type: 'ai',
      tool_calls: [
        {
          id: 'tool-1',
          name: 'test_tool',
          args: { query: 'SELECT * FROM users' },
        },
      ],
      content: [
        { type: 'text', text: 'Tool executed' },
      ],
    } as Message;
    const { container } = render(<AIMessage message={message} isLoading={false} />);
    expect(container.textContent).toContain('Tool executed');
  });

  it('should render CustomComponent when provided', () => {
    const message = {
      id: 'test-3',
      type: 'ai',
      content: [{ type: 'text', text: 'AI response' }],
    } as Message;
    const { container } = render(
      <AIMessage
        message={message}
        isLoading={false}
      />
    );
    expect(container.textContent).toContain('AI response');
  });
});
