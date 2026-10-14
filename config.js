export const SHOP_SITE_URL = "https://ss4gdev.github.io/fukahiro-shop-demo/";
export const AR_SITE_URL = "https://ss4gdev.github.io/fukahiro-ar-demo/";
export function arProductUrl(id, from = 'list') {
  const url = new URL('ar.html', AR_SITE_URL);
  url.searchParams.set('item', id); url.searchParams.set('from', from);
  return url.href;
}
export function shopProductUrl(id) {
  const url = new URL('product.html', SHOP_SITE_URL);
  url.searchParams.set('item', id); return url.href;
}
export function shopCatalogUrl(id) {
  const url = new URL('index.html', SHOP_SITE_URL);
  if (id) url.hash = 'item-' + id;
  return url.href;
}
