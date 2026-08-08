/**
 * 商店系统（数据驱动）：商品配置 + 金币变量 + 道具数组变量。
 * 引擎只提供购买求解器（纯逻辑、headless 可测）；
 * UI 由宿主展示（PixiStage.showShop），@shop 指令发 system 事件驱动。
 */
import type { VarValue } from '../state/types.js';

/** 商品定义 */
export interface ShopItemDef {
  id: string;
  name: string;
  /** 价格（金币） */
  price: number;
}

/** 商店配置（content/config/shop.json） */
export interface ShopConfig {
  items: ShopItemDef[];
}

/** 商店依赖的变量仓库最小接口（签名对齐 VariableStore，结构兼容可直接传入） */
export interface ShopStoreLike {
  getNumber(name: string): number;
  get<T extends VarValue = VarValue>(name: string): T;
  set(name: string, value: VarValue): void;
  setMany(updates: readonly { name: string; value: VarValue }[]): void;
  modify(name: string, delta: number): void;
}

export class ShopSystem {
  #config: ShopConfig;
  #store: ShopStoreLike;

  constructor(config: ShopConfig, store: ShopStoreLike) {
    this.#config = config;
    this.#store = store;
  }

  /** 商品清单（副本，防外部篡改配置） */
  get items(): ShopItemDef[] {
    return this.#config.items.map((i) => ({ ...i }));
  }

  /** 购买：校验金币 → 扣款 + 道具入袋（去重）。金币不足/商品不存在时不改变任何状态并返回原因。 */
  buy(goldVar: string, itemsVar: string, itemId: string): { ok: boolean; reason?: string } {
    const item = this.#config.items.find((i) => i.id === itemId);
    if (!item) return { ok: false, reason: `商品 '${itemId}' 不存在` };
    const gold = this.#store.getNumber(goldVar);
    if (gold < item.price) {
      return { ok: false, reason: `金币不足（需 ${item.price}，当前 ${gold}）` };
    }
    const rawItems = this.#store.get(itemsVar);
    if (!Array.isArray(rawItems) || rawItems.some((value) => typeof value !== 'string')) {
      throw new TypeError(`商店背包变量 '${itemsVar}' 必须是 string[]`);
    }
    const nextItems = rawItems.includes(itemId) ? rawItems : [...rawItems, itemId];
    this.#store.setMany([
      { name: goldVar, value: gold - item.price },
      { name: itemsVar, value: nextItems },
    ]);
    return { ok: true };
  }
}
