import { beforeEach, describe, expect, it } from 'vitest';
import { useTabs } from './tabs';

const titles = () => useTabs.getState().tabs.map((t) => `${t.title}${t.pinned ? '*' : ''}`);

describe('abas fixadas', () => {
  let ids: string[];
  beforeEach(() => {
    useTabs.setState({ tabs: [], activeId: null, workspaceRoot: null });
    const { openNewRequest } = useTabs.getState();
    ids = ['A', 'B', 'C', 'D'].map((title) => openNewRequest({ title }));
  });

  it('ficam no início, na ordem em que foram fixadas', () => {
    const [a, , c, d] = ids as [string, string, string, string];
    useTabs.getState().togglePin(c);
    useTabs.getState().togglePin(d);
    expect(titles()).toEqual(['C*', 'D*', 'A', 'B']);
    // Desafixar devolve para o início das não fixadas.
    useTabs.getState().togglePin(c);
    expect(titles()).toEqual(['D*', 'C', 'A', 'B']);
    expect(useTabs.getState().tabs.find((t) => t.id === a)).not.toHaveProperty('pinned');
  });

  it('arrastar não mistura fixadas e não fixadas', () => {
    const [a, b, c] = ids as [string, string, string, string];
    useTabs.getState().togglePin(a);
    useTabs.getState().togglePin(b);
    useTabs.getState().move(c, 0);
    expect(titles()).toEqual(['A*', 'B*', 'C', 'D']);
    useTabs.getState().move(a, 3);
    expect(titles()).toEqual(['B*', 'A*', 'C', 'D']);
  });
});
