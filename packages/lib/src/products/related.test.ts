import { describe, expect, it } from 'vitest';
import { followingInOrder } from './related';

const list = (...slugs: string[]) => slugs.map((slug) => ({ slug }));
const slugs = (items: { slug: string }[]) => items.map((item) => item.slug);

describe('followingInOrder', () => {
  it('takes the products right after self', () => {
    expect(slugs(followingInOrder(list('a', 'b', 'c', 'd', 'e', 'f'), 'b', 3))).toEqual(['c', 'd', 'e']);
  });

  it('wraps round to the start of the category', () => {
    expect(slugs(followingInOrder(list('a', 'b', 'c', 'd', 'e', 'f'), 'e', 3))).toEqual(['f', 'a', 'b']);
  });

  it('links every product from some sibling', () => {
    const items = list('a', 'b', 'c', 'd', 'e', 'f', 'g');
    const linked = new Set(items.flatMap((self) => slugs(followingInOrder(items, self.slug, 2))));
    expect(linked.size).toBe(items.length);
  });

  it('returns all the others when there are no more than count', () => {
    expect(slugs(followingInOrder(list('a', 'b', 'c'), 'a', 4))).toEqual(['b', 'c']);
  });

  it('starts from the top when self is not in the list', () => {
    expect(slugs(followingInOrder(list('a', 'b', 'c', 'd', 'e'), 'x', 2))).toEqual(['a', 'b']);
  });
});
