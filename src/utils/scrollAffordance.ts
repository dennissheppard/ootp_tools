/**
 * Adds a right-edge fade gradient to horizontally scrollable table wrappers
 * to indicate more content is available. The fade disappears when scrolled
 * to the end.
 */
export function applyScrollAffordance(container: HTMLElement): void {
  const wrappers = container.querySelectorAll<HTMLElement>('.table-wrapper, .scroll-x');
  wrappers.forEach(wrapper => {
    if (wrapper.scrollWidth <= wrapper.clientWidth) return;

    const parent = wrapper.parentElement;
    if (!parent || parent.classList.contains('scroll-affordance')) return;

    parent.classList.add('scroll-affordance');

    const update = () => {
      const atEnd = wrapper.scrollLeft + wrapper.clientWidth >= wrapper.scrollWidth - 2;
      parent.classList.toggle('scrolled-end', atEnd);
    };

    wrapper.addEventListener('scroll', update, { passive: true });
    update();
  });
}
