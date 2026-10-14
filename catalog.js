const escape = text => String(text).replace(/[&<>"']/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s]));
const container = document.querySelector('#products');
try {
  const response = await fetch('products.json');
  if (!response.ok) throw new Error('products unavailable');
  const products = await response.json();
  container.innerHTML = products.map(p => `<article class="product-card" id="item-${p.id}">
    <a class="product-photo" href="ar.html?item=${p.id}&from=catalog"><img src="${p.image}" alt="${escape(p.name)}" loading="lazy"><span class="rank">${p.rank}</span></a>
    <h2><a href="ar.html?item=${p.id}&from=catalog">${escape(p.name)}</a></h2>
    <p class="price">${escape(p.price)}<small>（税込み）</small></p>
    <a class="ar-link" aria-label="${escape(p.name)}をARで確認する" href="ar.html?item=${p.id}&from=catalog">ARで確認する →</a>
  </article>`).join('');
  if (location.hash) requestAnimationFrame(() => document.getElementById(location.hash.slice(1))?.scrollIntoView());
} catch {
  container.innerHTML = '<p role="alert">商品情報を表示できませんでした。</p>';
}
const toggle = document.querySelector('.menu-toggle');
toggle.addEventListener('click', () => { const expanded = toggle.getAttribute('aria-expanded') === 'true'; toggle.setAttribute('aria-expanded', String(!expanded)); document.querySelector('#shop-menu').hidden = expanded; });
