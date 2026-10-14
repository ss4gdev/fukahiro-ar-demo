export function renderProductChoices(container, products, { currentId = null, from = 'catalog' } = {}) {
  container.replaceChildren();
  for (const product of products) {
    if (product.id === currentId) continue;
    const link = document.createElement('a');
    link.className = 'ar-choice'; link.id = `item-${product.id}`;
    link.href = `ar.html?item=${product.id}&from=${from}`;
    const image = document.createElement('img');
    image.src = product.image; image.alt = ''; image.loading = 'lazy';
    const name = document.createElement('span'); name.textContent = product.name;
    const arrow = document.createElement('span');
    arrow.className = 'choice-arrow'; arrow.textContent = '›'; arrow.setAttribute('aria-hidden', 'true');
    link.append(image, name, arrow); container.append(link);
  }
}

export function initializeProductPicker(products, currentId, from) {
  const dialog = document.querySelector('#product-picker');
  renderProductChoices(document.querySelector('#picker-products'), products, { currentId, from });
  const button = document.querySelector('#other-ar');
  button.addEventListener('click', () => dialog.showModal());
  button.disabled = false;
}
