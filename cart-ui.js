import { shopProductUrl } from './config.js';
import { createDemoCartAdapter } from './cart-adapter.js';

export function initializeDemoCart(products, selectedProduct) {
  const dialog = document.querySelector('#demo-cart');
  document.querySelector('.cart-list-link').textContent = 'ARメニューへ';
  const items = document.querySelector('#cart-items');
  const count = document.querySelector('#cart-count');
  const total = document.querySelector('#cart-total');
  const status = document.querySelector('#cart-status');
  const error = document.querySelector('#cart-error');
  const add = document.querySelector('#cart-add');
  const quantity = document.querySelector('#cart-quantity');
  const registry = new Map(products.map(product => [product.id, product]));
  const currency = amount => `${amount.toLocaleString('ja-JP')}円`;
  const priceOf = product => Number(product.price.replace(/[^0-9]/g, ''));
  let adapter;
  function message(element, text) { element.textContent = text; element.hidden = !text; }
  function showError(exception) {
    const text = exception instanceof Error && /数量|商品/.test(exception.message) ? exception.message : 'カートを保存できませんでした。';
    message(dialog.open ? status : error, text);
  }
  function updateSummary(lines) {
    count.textContent = String(lines.reduce((sum, line) => sum + line.quantity, 0));
    const sum = lines.reduce((sum, line) => sum + priceOf(registry.get(line.id)) * line.quantity, 0);
    total.textContent = `商品代金合計（税込み） ${currency(sum)}`;
    total.hidden = !lines.length;
  }
  function render() {
    const lines = adapter.read();
    updateSummary(lines);
    items.replaceChildren();
    for (const line of lines) {
      const product = registry.get(line.id);
      const subtotal = priceOf(product) * line.quantity;
      const row = document.createElement('article');
      row.className = 'cart-item';
      row.dataset.productId = line.id;
      const image = document.createElement('img');
      image.src = product.image;
      image.alt = product.name;
      const body = document.createElement('div');
      const name = document.createElement('a');
      name.className = 'cart-item-name';
      name.href = shopProductUrl(product.id);
      name.textContent = product.name;
      const price = document.createElement('p');
      price.className = 'cart-item-price';
      price.textContent = currency(subtotal);
      const actions = document.createElement('div');
      actions.className = 'cart-item-actions';
      const label = document.createElement('label');
      label.textContent = '数量 ';
      const input = document.createElement('input');
      input.type = 'number'; input.min = '1'; input.max = '99'; input.step = '1';
      input.value = String(line.quantity);
      input.setAttribute('aria-label', `${product.name}の数量`);
      function updateQuantity() {
        const nextQuantity = input.valueAsNumber;
        const nextLines = adapter.update(line.id, nextQuantity);
        line.quantity = nextQuantity;
        price.textContent = currency(priceOf(product) * nextQuantity);
        updateSummary(nextLines);
        message(status, '数量を変更しました。');
      }
      input.addEventListener('input', () => {
        if (!Number.isInteger(input.valueAsNumber) || input.valueAsNumber < 1 || input.valueAsNumber > 99) return;
        try { updateQuantity(); } catch (exception) { showError(exception); }
      });
      input.addEventListener('change', () => {
        try {
          updateQuantity();
        } catch (exception) { input.value = String(line.quantity); showError(exception); }
      });
      input.addEventListener('blur', () => {
        if (input.valueAsNumber === line.quantity) return;
        try { updateQuantity(); }
        catch (exception) { input.value = String(line.quantity); showError(exception); }
      });
      label.append(input);
      const remove = document.createElement('button');
      remove.type = 'button'; remove.className = 'cart-remove'; remove.textContent = '削除';
      remove.setAttribute('aria-label', `${product.name}を削除`);
      remove.addEventListener('click', () => {
        try { adapter.remove(line.id); render(); message(status, '削除しました。'); }
        catch (exception) { showError(exception); }
      });
      actions.append(label, remove); body.append(name, price, actions); row.append(image, body); items.append(row);
    }
    if (!lines.length) {
      const empty = document.createElement('p'); empty.className = 'cart-empty'; empty.textContent = 'カートは空です。'; items.append(empty);
    }
  }
  function open() { render(); message(status, ''); if (!dialog.open) dialog.showModal(); }
  try { adapter = createDemoCartAdapter(products); render(); add.disabled = false; }
  catch (exception) { showError(exception); return; }
  add.addEventListener('click', () => {
    try {
      adapter.add(selectedProduct.id, Number(quantity.value));
      message(error, ''); open(); message(status, '追加しました。');
    } catch (exception) { showError(exception); }
  });
  const openButton = document.querySelector('#cart-open');
  openButton.addEventListener('click', () => {
    try { open(); } catch (exception) { showError(exception); }
  });
  openButton.disabled = false;
}
