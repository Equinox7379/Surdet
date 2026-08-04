import { describe, expect, it } from 'vitest';
import { VariableStore } from '../src/state/variable-store.js';
import { ShopSystem } from '../src/systems/shop.js';
import type { ShopConfig } from '../src/systems/shop.js';

const config: ShopConfig = {
  items: [
    { id: 'potion', name: '回复药', price: 30 },
    { id: 'sword', name: '铁剑', price: 60 },
  ],
};

function makeStore(): VariableStore {
  return new VariableStore([
    { name: 'gold', type: 'number', initial: 100, min: 0 },
    { name: 'bag', type: 'string[]', initial: [] },
  ]);
}

describe('ShopSystem', () => {
  it('购买成功：扣金币 + 道具入袋', () => {
    const store = makeStore();
    const shop = new ShopSystem(config, store);
    expect(shop.buy('gold', 'bag', 'potion')).toEqual({ ok: true });
    expect(store.getNumber('gold')).toBe(70);
    expect(store.get<string[]>('bag')).toEqual(['potion']);
  });

  it('重复购买同道具：金币照扣，袋子去重', () => {
    const store = makeStore();
    const shop = new ShopSystem(config, store);
    shop.buy('gold', 'bag', 'potion');
    shop.buy('gold', 'bag', 'potion');
    expect(store.getNumber('gold')).toBe(40);
    expect(store.get<string[]>('bag')).toEqual(['potion']);
  });

  it('金币不足：状态完全不变并返回原因', () => {
    const store = makeStore();
    const shop = new ShopSystem(config, store);
    const res = shop.buy('gold', 'bag', 'sword'); // 60 < 100 → 成功；换更贵的测试
    expect(res.ok).toBe(true);
    const res2 = shop.buy('gold', 'bag', 'sword');
    expect(res2.ok).toBe(false);
    expect(res2.reason).toMatch(/金币不足/);
    expect(store.getNumber('gold')).toBe(40); // 未扣款
    expect(store.get<string[]>('bag')).toEqual(['sword']); // 未入袋
  });

  it('未知商品：返回错误且不改变状态', () => {
    const store = makeStore();
    const shop = new ShopSystem(config, store);
    const res = shop.buy('gold', 'bag', 'ghost');
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/不存在/);
    expect(store.getNumber('gold')).toBe(100);
  });

  it('items 返回副本（外部篡改不影响配置）', () => {
    const shop = new ShopSystem(config, makeStore());
    const list = shop.items;
    list[0]!.price = 1;
    expect(shop.items[0]!.price).toBe(30);
  });
});
