import { renderProductChoices } from './product-picker.js';
const container = document.querySelector('#products');
try {
  const response = await fetch('products.json');
  if (!response.ok) throw new Error('products unavailable');
  renderProductChoices(container, await response.json());
  if (location.hash) requestAnimationFrame(() => document.getElementById(location.hash.slice(1))?.scrollIntoView());
} catch {
  container.innerHTML = '<p role="alert">商品情報を表示できませんでした。</p>';
}
