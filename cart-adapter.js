// デモ専用。らくうるへのリクエストや注文処理は行いません。
export const CART_KEY = 'fukahiro-ar-demo-cart-v1';
const MAX_QUANTITY = 99;

export function createDemoCartAdapter(products, storage = window.localStorage) {
  const knownIds = new Set(products.map(product => product.id));
  function validate(id, quantity) {
    if (!knownIds.has(id)) throw new Error('商品が見つかりません。');
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY) {
      throw new Error('数量は1〜99で指定してください。');
    }
  }
  function read() {
    const raw = storage.getItem(CART_KEY);
    if (!raw) return [];
    let data;
    try { data = JSON.parse(raw); } catch { return []; }
    if (!Array.isArray(data)) return [];
    const merged = new Map();
    for (const line of data) {
      if (!line || !knownIds.has(line.id) || !Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > MAX_QUANTITY) continue;
      merged.set(line.id, Math.min(MAX_QUANTITY, (merged.get(line.id) || 0) + line.quantity));
    }
    return [...merged].map(([id, quantity]) => ({ id, quantity }));
  }
  function write(lines) {
    storage.setItem(CART_KEY, JSON.stringify(lines));
    return lines;
  }
  return {
    read,
    add(id, quantity) {
      validate(id, quantity);
      const lines = read();
      const existing = lines.find(line => line.id === id);
      const nextQuantity = (existing?.quantity || 0) + quantity;
      validate(id, nextQuantity);
      if (existing) existing.quantity = nextQuantity;
      else lines.push({ id, quantity });
      return write(lines);
    },
    update(id, quantity) {
      validate(id, quantity);
      return write(read().map(line => line.id === id ? { id, quantity } : line));
    },
    remove(id) { return write(read().filter(line => line.id !== id)); }
  };
}
